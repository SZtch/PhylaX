import { NextResponse } from "next/server";
import { validateAndConsumeApproval } from "../../../lib/approval-store";
import { isProductionMode } from "../../../lib/okx";

export async function POST(req: Request) {
  try {
    const { approvalId, amountUsd } = await req.json();

    if (!approvalId) {
      return NextResponse.json({ error: "Approval ID is missing" }, { status: 400 });
    }

    const { valid, reason, approval } = validateAndConsumeApproval(approvalId);

    if (!valid || !approval) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    if (amountUsd > approval.budgetUsd) {
      return NextResponse.json({ error: "Amount exceeds approved budget" }, { status: 400 });
    }

    const liveEnabled = process.env.ENABLE_LIVE_EXECUTION === "true";

    if (!liveEnabled) {
      // In production mode: execution is disabled by config — no fake result.
      // Return a clear status explaining what happened.
      return NextResponse.json({
        result: {
          txHash: null,
          status: "execution_disabled",
          requestedAddress: approval.tokenAddress,
          requestedAmountUsd: amountUsd,
        },
        meta: {
          source: "execution_disabled",
          provider: "AegisX",
          chainIndex: process.env.OKX_CHAIN_INDEX ?? "196",
          chainName: process.env.OKX_CHAIN_NAME ?? "X Layer",
          chainSlug: process.env.OKX_CHAIN_SLUG ?? "xlayer",
          timestamp: new Date().toISOString(),
          fallbackReason: "ENABLE_LIVE_EXECUTION=false — approval recorded, no transaction broadcast",
        },
        message: isProductionMode()
          ? "Live execution is disabled by config. Quote and risk analysis are real. Enable ENABLE_LIVE_EXECUTION=true and connect a browser wallet to execute."
          : "Live execution is disabled. This is a demo/dev environment.",
      });
    }

    // ENABLE_LIVE_EXECUTION=true path:
    // In a real implementation, this would:
    //   1. Build transaction calldata from OKX swap API
    //   2. Return unsigned transaction to the frontend
    //   3. Frontend asks user's browser wallet to sign + send
    //
    // This path is NOT yet implemented. Return a clear blocker.
    return NextResponse.json(
      {
        error: "Live execution is enabled but the wallet-signing flow is not yet implemented. " +
               "The real OKX quote and risk data are available. Transaction signing will be added in the next release.",
        status: "not_implemented",
      },
      { status: 501 }
    );
  } catch (err) {
    console.error("Execution error:", err);
    return NextResponse.json({ error: "Failed to process execution request" }, { status: 500 });
  }
}
