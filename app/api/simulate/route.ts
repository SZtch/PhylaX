import { NextResponse } from "next/server";
import { simulateSwap, OkxRealModeError } from "../../../lib/okx";
import { createApproval } from "../../../lib/approval-store";
import { checkGuardrails } from "../../../lib/guardrails";
import { verifyWalletSession } from "../../../lib/privy-auth";
import { checkRateLimit } from "../../../lib/rate-limit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRateLimit(`simulate:${ip}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  // ── Wallet session enforcement ──────────────────────────────────────────
  const auth = await verifyWalletSession(req);
  if (!auth.authenticated || !auth.session) {
    return NextResponse.json(
      { error: auth.error ?? "Wallet connection required." },
      { status: auth.statusCode || 401 }
    );
  }
  const session = auth.session;

  try {
    const {
      address,
      amountUsd,
      chain,
      maxBudgetUsd,
      slippageLimitPercent,
      isScanned,
      riskLevel,
    } = await req.json();

    if (!address || !amountUsd || !chain) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Block unscanned tokens
    if (!isScanned) {
      return NextResponse.json(
        { error: "Token has not been scanned. Security scan is required before simulation." },
        { status: 403 }
      );
    }

    // Block high_risk tokens
    if (riskLevel === "high_risk") {
      return NextResponse.json(
        { error: "Token is high risk. Simulation and execution are blocked." },
        { status: 403 }
      );
    }

    // Block unknown risk (empty scan result — watchlist only)
    if (riskLevel === "unknown") {
      return NextResponse.json(
        {
          error:
            "Token risk is unknown — OKX security scan returned no data. " +
            "Token is watchlisted. Simulation and execution are blocked until risk is verified.",
        },
        { status: 403 }
      );
    }

    const { simulation, fromToken, fromSymbol, meta } = await simulateSwap(
      address,
      amountUsd,
      chain
    );

    const guardrails = checkGuardrails(
      amountUsd,
      maxBudgetUsd,
      slippageLimitPercent,
      simulation.slippage
    );
    if (!guardrails.valid) {
      return NextResponse.json({ error: guardrails.reason }, { status: 400 });
    }

    const approvalId = await createApproval(address, chain, maxBudgetUsd, slippageLimitPercent, session.walletAddress);

    return NextResponse.json({ simulation, fromToken, fromSymbol, approvalId, meta });
  } catch (err) {
    if (err instanceof OkxRealModeError) {
      return NextResponse.json(
        { error: err.message, meta: err.meta, integration: "okx-dex-swap" },
        { status: 502 }
      );
    }
    console.error("Simulation error:", err);
    return NextResponse.json({ error: "Failed to simulate swap" }, { status: 500 });
  }
}
