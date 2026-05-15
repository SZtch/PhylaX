import { NextResponse } from "next/server";
import { validateAndConsumeApproval } from "../../../lib/approval-store";
import { verifyWalletSession } from "../../../lib/privy-auth";
import { enforceRiskPolicy, isLiveExecutionEnabled } from "../../../lib/risk-policy";
import { consumeApproval, isRedisAvailable } from "../../../lib/redis";
import { audit } from "../../../lib/audit";

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
    const { approvalId, amountUsd, quoteSnapshot } = body as {
      approvalId?: string;
      amountUsd?: number;
      quoteSnapshot?: {
        chainId?: string;
        fromToken?: string;
        toToken?: string;
        slippage?: number;
        quoteCreatedAt?: number;
        txData?: {
          to?: string;
          data?: string;
          value?: string;
          gas?: string;
          gasLimit?: string;
          gasPrice?: string;
          maxFeePerGas?: string;
          maxPriorityFeePerGas?: string;
        };
      };
    };

    // ── 2. Validate required inputs ───────────────────────────────────────
    if (!approvalId) {
      return NextResponse.json({ error: "Approval ID is missing." }, { status: 400 });
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

    if (amountUsd && amountUsd > approval.budgetUsd) {
      return NextResponse.json(
        { error: "Amount exceeds approved budget." },
        { status: 400 }
      );
    }

    // ── 4. Check if live execution is enabled ─────────────────────────────
    if (!isLiveExecutionEnabled()) {
      return NextResponse.json({
        result: {
          txHash: null,
          status: "execution_disabled",
          requestedAddress: approval.tokenAddress,
          requestedAmountUsd: amountUsd ?? approval.budgetUsd,
        },
        meta: {
          source: "execution_disabled",
          provider: "PhylaX",
          chainIndex: process.env.OKX_CHAIN_INDEX ?? "196",
          chainName: process.env.OKX_CHAIN_NAME ?? "X Layer",
          chainSlug: process.env.OKX_CHAIN_SLUG ?? "xlayer",
          timestamp: new Date().toISOString(),
          fallbackReason:
            "ENABLE_LIVE_EXECUTION=false — approval recorded, no transaction created",
        },
        message:
          "Live execution is disabled. Quote and risk analysis are real. " +
          "Enable ENABLE_LIVE_EXECUTION=true and connect a browser wallet to execute.",
      });
    }

    // ── 5. Enforce risk policy ────────────────────────────────────────────
    const chainId = quoteSnapshot?.chainId ?? process.env.OKX_CHAIN_INDEX ?? "196";
    const slippage = quoteSnapshot?.slippage ?? approval.slippageLimitPercent;
    const quoteCreatedAt = quoteSnapshot?.quoteCreatedAt ?? approval.createdAt;

    const policy = await enforceRiskPolicy({
      chainId,
      slippagePercent: slippage,
      quoteCreatedAt,
      walletAddress: session.walletAddress,
      privyUserId: session.userId,
      amountUsd: amountUsd ?? approval.budgetUsd,
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

    // ── 7. Build unsigned transaction ─────────────────────────────────────
    // The unsigned tx data comes from the OKX swap quote's tx payload.
    // Server NEVER broadcasts — client wallet signs and submits.
    const txData = quoteSnapshot?.txData;
    if (!txData?.to || !txData?.data) {
      await audit({
        event: "execution_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "missing_tx_data", approvalId },
      });
      return NextResponse.json(
        {
          error:
            "Transaction data is missing from the quote. " +
            "Please request a new quote with transaction data enabled.",
        },
        { status: 400 }
      );
    }

    const unsignedTx: UnsignedTx = {
      to: txData.to,
      data: txData.data,
      value: txData.value ?? "0x0",
      chainId,
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

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await audit({
      event: "unsigned_tx_created",
      privyUserId: session.userId,
      walletAddress: session.walletAddress,
      metadata: {
        executionId,
        approvalId,
        chainId,
        to: unsignedTx.to,
        // Do not log full tx data for security
      },
    });

    return NextResponse.json({
      executionId,
      unsignedTx,
      walletAddress: session.walletAddress,
      chainId,
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
