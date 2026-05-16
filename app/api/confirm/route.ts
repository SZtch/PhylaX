import { NextResponse } from "next/server";
import { verifyWalletSession } from "../../../lib/privy-auth";
import { audit } from "../../../lib/audit";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * POST /api/confirm
 *
 * Called by the frontend after the user's wallet submits a transaction.
 * Verifies the tx hash belongs to the authenticated wallet and
 * returns the transaction status.
 *
 * This does NOT perform server-side RPC verification by default
 * (requires an RPC URL). When RPC is available, it checks the receipt.
 */

// Chain ID → RPC URL mapping (from env or defaults)
function getRpcUrl(chainId: string): string | null {
  const envKey = `RPC_URL_${chainId}`;
  const url = process.env[envKey];
  if (url) return url;

  // Common public RPCs as fallback (rate-limited, not for production)
  const defaults: Record<string, string> = {
    "1": "https://eth.llamarpc.com",
    "8453": "https://mainnet.base.org",
    "137": "https://polygon-rpc.com",
    "42161": "https://arb1.arbitrum.io/rpc",
    "56": "https://bsc-dataseed.binance.org",
  };
  return defaults[chainId] ?? null;
}

interface TxReceipt {
  status: "confirmed" | "failed" | "reverted" | "pending";
  blockNumber?: number;
  gasUsed?: string;
  explorerUrl?: string;
}

async function checkTxReceipt(
  txHash: string,
  chainId: string
): Promise<TxReceipt> {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return { status: "pending" };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      }),
    });

    const data = await response.json() as {
      result?: {
        status?: string;
        blockNumber?: string;
        gasUsed?: string;
      };
    };

    if (!data.result) {
      // No receipt yet — transaction still pending
      return { status: "pending" };
    }

    const receipt = data.result;
    const statusHex = receipt.status;
    const blockNumber = receipt.blockNumber
      ? parseInt(receipt.blockNumber, 16)
      : undefined;
    const gasUsed = receipt.gasUsed
      ? parseInt(receipt.gasUsed, 16).toString()
      : undefined;

    // Explorer URL
    const explorerMap: Record<string, string> = {
      "1": "https://etherscan.io/tx/",
      "8453": "https://basescan.org/tx/",
      "137": "https://polygonscan.com/tx/",
      "42161": "https://arbiscan.io/tx/",
      "56": "https://bscscan.com/tx/",
      "196": "https://www.oklink.com/xlayer/tx/",
    };
    const explorerUrl = explorerMap[chainId]
      ? `${explorerMap[chainId]}${txHash}`
      : undefined;

    if (statusHex === "0x1") {
      return { status: "confirmed", blockNumber, gasUsed, explorerUrl };
    } else if (statusHex === "0x0") {
      return { status: "reverted", blockNumber, gasUsed, explorerUrl };
    } else {
      return { status: "failed", blockNumber, gasUsed, explorerUrl };
    }
  } catch (err) {
    console.error(`[confirm] RPC check failed for ${txHash}:`, err);
    return { status: "pending" };
  }
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`confirm:${ip}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  // ── 1. Auth verification ────────────────────────────────────────────────
  const auth = await verifyWalletSession(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Wallet connection required." },
      { status: auth.statusCode }
    );
  }

  const session = auth.session!;

  try {
    const body = await req.json();
    const { executionId, txHash, chainId } = body as {
      executionId?: string;
      txHash?: string;
      chainId?: string;
    };

    // ── 2. Validate inputs ──────────────────────────────────────────────
    if (!executionId) {
      return NextResponse.json(
        { error: "Execution ID is required." },
        { status: 400 }
      );
    }

    if (!txHash) {
      return NextResponse.json(
        { error: "Transaction hash is required." },
        { status: 400 }
      );
    }

    // Validate tx hash format (0x + 64 hex chars)
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return NextResponse.json(
        { error: "Invalid transaction hash format." },
        { status: 400 }
      );
    }

    const { validateExecutionRecord } = await import("../../../lib/approval-store");
    const { valid, reason, record } = await validateExecutionRecord(executionId);
    
    if (!valid || !record) {
      await audit({
        event: "confirm_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: reason || "unknown_execution", executionId, txHash },
      });
      return NextResponse.json({ error: reason || "Invalid or expired execution ID." }, { status: 403 });
    }

    if (record.walletAddress !== session.walletAddress.toLowerCase()) {
      await audit({
        event: "confirm_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "wallet_mismatch", executionId, txHash },
      });
      return NextResponse.json({ error: "Execution wallet does not match the confirm wallet." }, { status: 403 });
    }

    const resolvedChainId = chainId ?? record.chainId;
    
    if (resolvedChainId !== record.chainId) {
      await audit({
        event: "confirm_blocked",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { reason: "chain_mismatch", executionId, txHash, expected: record.chainId, received: resolvedChainId },
      });
      return NextResponse.json({ error: "Execution chain does not match the confirm chain." }, { status: 403 });
    }

    await audit({
      event: "wallet_tx_submitted",
      privyUserId: session.userId,
      walletAddress: session.walletAddress,
      metadata: { executionId, txHash, chainId: resolvedChainId },
    });

    // ── 3. Check transaction receipt ────────────────────────────────────
    const receipt = await checkTxReceipt(txHash, resolvedChainId);

    if (receipt.status === "confirmed") {
      await audit({
        event: "tx_confirmed",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: {
          executionId,
          txHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        },
      });
    } else if (receipt.status === "reverted" || receipt.status === "failed") {
      await audit({
        event: "tx_failed",
        privyUserId: session.userId,
        walletAddress: session.walletAddress,
        metadata: { executionId, txHash, status: receipt.status },
      });
    }

    return NextResponse.json({
      executionId,
      txHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber ?? null,
      gasUsed: receipt.gasUsed ?? null,
      explorerUrl: receipt.explorerUrl ?? null,
      walletAddress: session.walletAddress,
    });
  } catch (err) {
    console.error("Confirm error:", err);
    return NextResponse.json(
      { error: "Failed to confirm transaction." },
      { status: 500 }
    );
  }
}
