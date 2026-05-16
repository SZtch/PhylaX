import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { validateAndConsumeApproval } from "../../../lib/approval-store";
import { verifyWalletSession } from "../../../lib/privy-auth";
import { enforceRiskPolicy, isLiveExecutionEnabled } from "../../../lib/risk-policy";
import { consumeApproval, isRedisAvailable } from "../../../lib/redis";
import { audit } from "../../../lib/audit";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * Unsigned transaction shape returned to the client.
 * The client's wallet (MetaMask, Privy embedded, etc.) calls
 * eth_sendTransaction with this payload.
 */
interface UnsignedTx {
  to: string;
  data: string;
  value: string;
  chainId: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`execute:${ip}`, 10, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  // ── 1. Wallet session & ownership verification ────────────────────────
  const auth = await verifyWalletSession(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Wallet connection required." },
      { status: auth.statusCode }
    );
  }

  const session = auth.session!;

  await audit({
    event: "execution_requested",
    privyUserId: session.userId,
    walletAddress: session.walletAddress,
  });

  try {
    const body = await req.json();
    const { approvalId, riskAcknowledged } = body as {
      approvalId?: string;
      riskAcknowledged?: boolean;
    };

    // ── 2. Validate required inputs ───────────────────────────────────────
    if (!approvalId) {
      return NextResponse.json({ error: "Approval ID is missing." }, { status: 400 });
    }
    
    if (!riskAcknowledged) {
      return NextResponse.json({ error: "Risk acknowledgement is required for execution." }, { status: 400 });
    }

    // ── 3. Validate approval (in-memory store) ───────────────────────────
    const { valid, reason, approval } = validateAndConsumeApproval(approvalId);
    if (!valid || !approval) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: reason ?? "invalid_approval", approvalId },
      });
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    const approvalWallet = approval.walletAddress;
    if (approvalWallet && approvalWallet.toLowerCase() !== session.walletAddress.toLowerCase()) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "wallet_mismatch", approvalId },
      });
      return NextResponse.json({ error: "Execution wallet does not match the approval wallet." }, { status: 403 });
    }

    // Spend amount is budgetUsd
    const spendAmountUsd = approval.budgetUsd;

    // Resolve chainIndex for risk policy and OKX API
    const { CHAIN_MAP, getSwapTxData } = await import("../../../lib/okx");
    const chainIndex = CHAIN_MAP[approval.chain.toLowerCase()] ?? approval.chain;

    // ── 4. Check if live execution is enabled ─────────────────────────────
    if (!isLiveExecutionEnabled()) {
      return NextResponse.json({
        result: {
          txHash: null,
          status: "execution_disabled",
          requestedAddress: approval.tokenAddress,
          requestedAmountUsd: spendAmountUsd,
        },
        meta: {
          source: "execution_disabled",
          provider: "PhylaX",
          chainIndex,
          timestamp: new Date().toISOString(),
        },
        message:
          "Live execution is disabled. Quote and risk analysis are real. " +
          "Enable ENABLE_LIVE_EXECUTION=true and connect a browser wallet to execute.",
      });
    }

    // ── 5. Enforce risk policy ────────────────────────────────────────────
    const slippage = approval.slippageLimitPercent;
    const quoteCreatedAt = approval.createdAt;

    const policy = await enforceRiskPolicy({
      chainId: chainIndex,
      slippagePercent: slippage,
      quoteCreatedAt,
      walletAddress: session.walletAddress,
      privyUserId: session.userId,
      amountUsd: spendAmountUsd,
    });

    if (!policy.allowed) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: policy.reason, approvalId },
      });
      return NextResponse.json(
        { error: policy.reason },
        { status: 403 }
      );
    }

    // ── 6. Atomic approval consume via Redis (replay protection) ──────────
    if (isRedisAvailable()) {
      const consumed = await consumeApproval(approvalId);
      if (!consumed) {
        await audit({
          event: "execution_blocked",
          privyUserId: session.userId,
          walletAddress: session.walletAddress,
          metadata: { reason: "approval_replay_rejected", approvalId },
        });
        return NextResponse.json(
          { error: "This approval has already been used." },
          { status: 403 }
        );
      }
    }

    await audit({
      event: "approval_consumed",
      privyUserId: session.userId,
      walletAddress: session.walletAddress,
      metadata: { approvalId },
    });

    // ── 7. Build unsigned transaction SERVER-SIDE ─────────────────────────
    // The unsigned tx data is retrieved from OKX directly.
    // We do NOT trust the client for txData.
    
    const txDataResponse = await getSwapTxData(
      approval.tokenAddress,
      spendAmountUsd,
      chainIndex,
      session.walletAddress,
      undefined, // use default fromToken
      slippage
    );

    if (txDataResponse.error || !txDataResponse.txData) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "swap_build_failed", approvalId, detail: txDataResponse.error },
      });
      return NextResponse.json(
        {
          error: txDataResponse.error || "Failed to build transaction data on the server.",
        },
        { status: 400 }
      );
    }

    const txData = txDataResponse.txData;

    const unsignedTx: UnsignedTx = {
      to: txData.to,
      data: txData.data,
      value: txData.value ?? "0x0",
      chainId: chainIndex,
      ...(txData.gas && { gas: txData.gas }),
      ...(txData.gasLimit && { gasLimit: txData.gasLimit }),
      ...(txData.gasPrice && { gasPrice: txData.gasPrice }),
      ...(txData.maxFeePerGas && { maxFeePerGas: txData.maxFeePerGas }),
      ...(txData.maxPriorityFeePerGas && {
        maxPriorityFeePerGas: txData.maxPriorityFeePerGas,
      }),
    };

    // Block if gas cannot be determined
    if (!unsignedTx.gas && !unsignedTx.gasLimit) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "gas_undetermined", approvalId },
      });
      return NextResponse.json(
        {
          error:
            "Gas limit could not be determined for this transaction. " +
            "Live execution blocked. Please try again with a fresh quote.",
        },
        { status: 400 }
      );
    }

    const executionId = `exec-${randomUUID()}`;

    await audit({
      event: "unsigned_tx_created",
      privyUserId: session.userId,
      walletAddress: session.walletAddress,
      metadata: {
        executionId,
        approvalId,
        chainId: chainIndex,
        to: unsignedTx.to,
      },
    });

    return NextResponse.json({
      executionId,
      unsignedTx,
      walletAddress: session.walletAddress,
      chainId: chainIndex,
      message:
        "Sign this transaction with your wallet. " +
        "PhylaX returns unsigned data only — your wallet handles signing and on-chain submission.",
    });
  } catch (err) {
    console.error("Execution error:", err);
    return NextResponse.json(
      { error: "Failed to process execution request." },
      { status: 500 }
    );
  }
}
