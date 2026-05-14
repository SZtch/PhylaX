import { NextResponse } from "next/server";
import { scanToken, OkxRealModeError } from "../../../lib/okx";
import { determineRiskAction } from "../../../lib/risk-scoring";

export async function POST(req: Request) {
  try {
    const { address, riskMode, chain } = await req.json();

    if (!address) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 });
    }

    const scanResult = await scanToken(address, chain ?? "x-layer");
    const {
      riskLevel,
      decision,
      executionAllowed,
      isScanned,
      isHoneypot,
      triggeredLabels,
      unknownReason,
      meta,
    } = scanResult;

    // decision from OKX adapter: "safe" | "high_risk" | "unknown"
    // Pass through to determineRiskAction for riskMode gating
    const action = determineRiskAction(decision, riskMode ?? "conservative");

    return NextResponse.json({
      riskLevel,
      decision,
      executionAllowed,
      isScanned,
      isHoneypot,
      triggeredLabels,
      unknownReason,
      action,
      meta,
    });
  } catch (err) {
    if (err instanceof OkxRealModeError) {
      return NextResponse.json(
        { error: err.message, meta: err.meta, integration: "okx-security" },
        { status: 502 }
      );
    }
    console.error("Scan error:", err);
    return NextResponse.json({ error: "Failed to scan token" }, { status: 500 });
  }
}
