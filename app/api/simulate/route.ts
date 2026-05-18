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
      amount,
      chain,
      slippageLimitPercent,
      isScanned,
      riskLevel,
      fromToken: requestFromToken,
      fromSymbol: requestFromSymbol
    } = await req.json();

    if (!address || amount === undefined || !chain) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const { normalizeChain } = await import("../../../lib/chains");
    let chainConfig;
    try {
      chainConfig = normalizeChain(chain);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    if (chainConfig.id !== "x-layer") {
      return NextResponse.json({
        error: "Live execution is currently available on X Layer only. Base/BSC/Solana support is Coming Soon."
      }, { status: 403 });
    }

    const { scanToken } = await import("../../../lib/okx");
    const scanResult = await scanToken(address, chainConfig.id);

    if (!scanResult.executionAllowed) {
      return NextResponse.json(
        { error: `Token risk is ${scanResult.riskLevel}. Simulation and execution are blocked.` },
        { status: 403 }
      );
    }

    const { simulation, fromToken, fromSymbol, fromAmountUsd, meta } = await simulateSwap(
      address,
      amount,
      chain,
      requestFromToken,
      requestFromSymbol
    );

    const SERVER_HARD_CAP = Math.max(1, parseFloat(process.env.MAX_TRADE_USD_HARD_CAP || "100"));
    const guardrails = checkGuardrails(
      fromAmountUsd,
      SERVER_HARD_CAP,
      slippageLimitPercent !== undefined ? slippageLimitPercent : 2,
      simulation.slippage
    );
    if (!guardrails.valid) {
      return NextResponse.json({ error: guardrails.reason }, { status: 400 });
    }

    // We can fetch allowance here. We need the router address.
    // Let's call getSwapTxData to get the router address!
    const { getSwapTxData, checkAllowance, getApproveTxData, getTokenDecimals, toMinimalUnits } = await import("../../../lib/okx");
    const swapData = await getSwapTxData(address, amount, chain, session.walletAddress, fromToken, slippageLimitPercent);
    
    let routerAddress: string | undefined = undefined;
    let allowanceResult = { hasSufficient: true };
    let approveTxData = null;
    let decimals = 18;
    let approveAmountStr: string | undefined = undefined;

    if (swapData.txData && swapData.txData.to) {
      routerAddress = swapData.txData.to;
      decimals = await getTokenDecimals(chain, fromToken);
      allowanceResult = await checkAllowance(chain, session.walletAddress, fromToken, amount, decimals);
      if (!allowanceResult.hasSufficient) {
        const approveData = await getApproveTxData(chain, fromToken, amount, decimals);
        approveTxData = approveData.txData;
        try {
          approveAmountStr = toMinimalUnits(amount, decimals);
        } catch {}
      }
    } else if (swapData.error) {
       return NextResponse.json({ error: swapData.error }, { status: 400 });
    }

    const approvalId = await createApproval(
      address, 
      chain, 
      fromAmountUsd, 
      slippageLimitPercent, 
      session.walletAddress, 
      fromToken, 
      routerAddress,
      !allowanceResult.hasSufficient,
      approveAmountStr,
      routerAddress
    );

    return NextResponse.json({ 
      simulation, 
      fromToken, 
      fromSymbol, 
      fromAmountUsd,
      approvalId, 
      meta,
      needsApproval: !allowanceResult.hasSufficient,
      approveTxData
    });
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
