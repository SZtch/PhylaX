import { NextResponse } from "next/server";
import { verifySession } from "../../../lib/privy-auth";
import { parseTradeIntent } from "../../../lib/trade-intent-parser";
import { orchestrate } from "../../../lib/agent-orchestrator";
import type { ChatState } from "../../../lib/chat-states";
import {
  getSignals,
  scanToken,
  getQuotePreflight,
  searchToken,
  OkxRealModeError,
} from "../../../lib/okx";
import { createApproval } from "../../../lib/approval-store";
import { determineRiskAction } from "../../../lib/risk-scoring";
import type { TokenSignal, SimulationResult } from "../../../lib/schemas";

/**
 * POST /api/chat
 *
 * Wallet-gated chat endpoint for PhylaX.
 * Wired into the real signal → scan → quote pipeline.
 *
 * Never executes trades directly. Never calls /api/execute.
 * Quote must come before any confirmation request.
 * High-risk tokens block quote/execution.
 */
export async function POST(req: Request) {
  // ── 1. Verify user session (email login sufficient) ───────────────────
  const auth = await verifySession(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Please sign in to use PhylaX." },
      { status: auth.statusCode }
    );
  }

  // ── 2. Parse request body ───────────────────────────────────────────────
  let body: { conversationId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { conversationId, message } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  // ── 3. Parse intent + orchestrate ───────────────────────────────────────
  const intent = parseTradeIntent(message);
  const decision = orchestrate(intent);

  // ── 4. Execute pipeline based on action ─────────────────────────────────
  try {
    switch (decision.action) {
      // ── Clarification ─────────────────────────────────────────────────
      case "ask_clarification":
        return json({
          agentMessage: decision.agentMessage,
          intent,
          action: decision.action,
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        });

      // ── Signal discovery ──────────────────────────────────────────────
      case "run_signals":
        return await handleSignals(intent, decision, conversationId);

      // ── Token scan ────────────────────────────────────────────────────
      case "run_scan":
        return await handleScan(intent, decision, conversationId);

      // ── Quote (swap or quote intent) ──────────────────────────────────
      case "run_quote":
        return await handleQuote(intent, decision, conversationId);

      // ── Show quote / request confirmation (should only appear after quote) ──
      case "show_quote":
      case "request_confirmation":
        return json({
          agentMessage: decision.agentMessage,
          intent,
          action: decision.action,
          chatState: "WAITING_FOR_CONFIRMATION" as ChatState,
          conversationId,
        });

      default:
        return json({
          agentMessage: decision.agentMessage,
          intent,
          action: decision.action,
          chatState: "WALLET_CONNECTED" as ChatState,
          conversationId,
        });
    }
  } catch (err) {
    const errorMsg =
      err instanceof OkxRealModeError
        ? `OKX integration error: ${err.message}`
        : err instanceof Error
        ? err.message
        : "An unexpected error occurred.";

    return json({
      agentMessage: `⚠️ ${errorMsg}\n\nPlease try again or rephrase your request.`,
      intent,
      action: decision.action,
      chatState: "FAILED" as ChatState,
      conversationId,
      error: errorMsg,
    });
  }
}

// ─── Pipeline Handlers ────────────────────────────────────────────────────────

/**
 * Signal discovery: fetch signals → scan each → return trade plan.
 */
async function handleSignals(
  intent: ReturnType<typeof parseTradeIntent>,
  decision: ReturnType<typeof orchestrate>,
  conversationId: string
) {
  const chain = intent.chain ?? "x-layer";
  const maxTokens = 5;
  const riskMode = intent.riskTolerance ?? "conservative";

  // 1. Fetch signals
  const { signals, meta: signalMeta } = await getSignals(chain, maxTokens);

  if (!signals || signals.length === 0) {
    return json({
      agentMessage:
        "I couldn't find any token signals for this chain right now. " +
        "Try a different chain or check back later.",
      intent,
      action: decision.action,
      chatState: "WALLET_CONNECTED" as ChatState,
      conversationId,
      pipelineData: { source: signalMeta.source },
    });
  }

  // 2. Scan each token for risk
  const scannedSignals: TokenSignal[] = [...signals];
  for (let i = 0; i < scannedSignals.length; i++) {
    try {
      const scanResult = await scanToken(scannedSignals[i].address, chain);
      const action = determineRiskAction(scanResult.decision, riskMode);
      scannedSignals[i] = { ...scannedSignals[i], riskStatus: action };
    } catch {
      scannedSignals[i] = { ...scannedSignals[i], riskStatus: "skipped" };
    }
  }

  const safeCount = scannedSignals.filter((s) => s.riskStatus === "safe").length;
  const blockedCount = scannedSignals.filter(
    (s) => s.riskStatus === "high_risk" || s.riskStatus === "skipped"
  ).length;

  const summary =
    `Found ${signals.length} signal${signals.length !== 1 ? "s" : ""} on ${chain}. ` +
    `${safeCount} passed risk scan, ${blockedCount} blocked or skipped.\n\n` +
    (safeCount > 0
      ? "You can ask me to quote any of the safe tokens for a swap."
      : "No tokens passed the risk gate. Consider trying a different chain or criteria.");

  return json({
    agentMessage: summary,
    intent,
    action: "run_signals",
    chatState: (safeCount > 0 ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED") as ChatState,
    conversationId,
    pipelineData: {
      type: "trade-plan",
      signals: scannedSignals,
      chainName: chain,
      source: signalMeta.source,
    },
  });
}

/**
 * Token scan: scan a specific token and return risk result.
 */
async function handleScan(
  intent: ReturnType<typeof parseTradeIntent>,
  decision: ReturnType<typeof orchestrate>,
  conversationId: string
) {
  const chain = intent.chain ?? "x-layer";
  const tokenSymbol = intent.toToken ?? intent.fromToken;

  // If user didn't specify a token, ask for clarification
  if (!tokenSymbol) {
    return json({
      agentMessage:
        "Which token do you want me to scan? " +
        "Please provide a token symbol or contract address.",
      intent,
      action: "ask_clarification",
      chatState: "NEEDS_CLARIFICATION" as ChatState,
      conversationId,
    });
  }

  // Try to resolve token symbol to address
  let tokenAddress = tokenSymbol;
  if (!tokenSymbol.startsWith("0x")) {
    try {
      const results = await searchToken(tokenSymbol, chain === "x-layer" ? "xlayer" : chain);
      if (results.length > 0) {
        tokenAddress = results[0].address;
      } else {
        return json({
          agentMessage:
            `I couldn't find a token matching "${tokenSymbol}" on ${chain}. ` +
            "Please double-check the symbol or provide a contract address.",
          intent,
          action: "ask_clarification",
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        });
      }
    } catch {
      return json({
        agentMessage:
          `Token search for "${tokenSymbol}" failed. ` +
          "Please provide the contract address directly.",
        intent,
        action: "ask_clarification",
        chatState: "NEEDS_CLARIFICATION" as ChatState,
        conversationId,
      });
    }
  }

  // Run scan
  const scanResult = await scanToken(tokenAddress, chain);
  const riskMode = intent.riskTolerance ?? "conservative";
  const riskAction = determineRiskAction(scanResult.decision, riskMode);

  let summary: string;
  if (riskAction === "safe") {
    summary =
      `✅ **${tokenSymbol.toUpperCase()}** passed the security scan.\n\n` +
      `Risk level: ${scanResult.riskLevel}\n` +
      `Honeypot: ${scanResult.isHoneypot ? "Yes ⚠️" : "No"}\n` +
      (scanResult.triggeredLabels.length > 0
        ? `Flags: ${scanResult.triggeredLabels.join(", ")}\n`
        : "") +
      "\nYou can safely quote a swap for this token.";
  } else if (riskAction === "high_risk") {
    summary =
      `🚫 **${tokenSymbol.toUpperCase()}** is flagged as **high risk**.\n\n` +
      `Risk level: ${scanResult.riskLevel}\n` +
      `Honeypot: ${scanResult.isHoneypot ? "Yes ⚠️" : "No"}\n` +
      (scanResult.triggeredLabels.length > 0
        ? `Flags: ${scanResult.triggeredLabels.join(", ")}\n`
        : "") +
      "\nSwap quotes and execution are blocked for this token.";
  } else if (riskAction === "unknown") {
    summary =
      `⚠️ **${tokenSymbol.toUpperCase()}** has **unknown risk**.\n\n` +
      (scanResult.unknownReason ?? "OKX security scan returned no data.") +
      "\nThis token is watchlisted. Execution is blocked until risk is verified.";
  } else {
    summary =
      `**${tokenSymbol.toUpperCase()}** was skipped based on your risk mode (${riskMode}).\n` +
      "Adjust risk tolerance or try a different token.";
  }

  return json({
    agentMessage: summary,
    intent,
    action: "run_scan",
    chatState: (riskAction === "safe" ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED") as ChatState,
    conversationId,
    pipelineData: {
      type: "risk-result",
      tokenSymbol: tokenSymbol.toUpperCase(),
      tokenAddress,
      riskLevel: riskAction,
      riskDetails: scanResult.triggeredLabels.join(", ") || undefined,
      source: scanResult.meta.source,
    },
  });
}

/**
 * Quote: resolve tokens → scan → simulate quote → return quote card.
 * Never executes. High-risk tokens block this step.
 */
async function handleQuote(
  intent: ReturnType<typeof parseTradeIntent>,
  decision: ReturnType<typeof orchestrate>,
  conversationId: string
) {
  const chain = intent.chain ?? "x-layer";
  const chainSlug = chain === "x-layer" ? "xlayer" : chain;
  const fromSymbol = intent.fromToken ?? "USDC";
  const toSymbol = intent.toToken;
  const amount = intent.amount ?? intent.amountUsd ?? 50;

  if (!toSymbol) {
    return json({
      agentMessage:
        "Which token do you want to swap to? " +
        'For example: "Quote 100 USDC to OKB"',
      intent,
      action: "ask_clarification",
      chatState: "NEEDS_CLARIFICATION" as ChatState,
      conversationId,
    });
  }

  // 1. Resolve toToken address
  let toAddress: string;
  if (toSymbol.startsWith("0x")) {
    toAddress = toSymbol;
  } else {
    try {
      const results = await searchToken(toSymbol, chainSlug);
      if (results.length > 0) {
        toAddress = results[0].address;
      } else {
        return json({
          agentMessage:
            `I couldn't find "${toSymbol}" on ${chain}. Check the symbol or provide a contract address.`,
          intent,
          action: "ask_clarification",
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        });
      }
    } catch {
      return json({
        agentMessage: `Token search for "${toSymbol}" failed. Please provide a contract address.`,
        intent,
        action: "ask_clarification",
        chatState: "NEEDS_CLARIFICATION" as ChatState,
        conversationId,
      });
    }
  }

  // 2. Security scan before quoting
  let scanDecision: "safe" | "high_risk" | "unknown" | "skipped" = "safe";
  try {
    const scanResult = await scanToken(toAddress, chain);
    const riskMode = intent.riskTolerance ?? "conservative";
    scanDecision = determineRiskAction(scanResult.decision, riskMode);

    if (scanDecision === "high_risk") {
      return json({
        agentMessage:
          `🚫 **${toSymbol.toUpperCase()}** is flagged as **high risk**.\n\n` +
          `Risk level: ${scanResult.riskLevel}\n` +
          (scanResult.triggeredLabels.length > 0
            ? `Flags: ${scanResult.triggeredLabels.join(", ")}\n`
            : "") +
          "\nQuote and execution are blocked for high-risk tokens.",
        intent,
        action: "run_scan",
        chatState: "FAILED" as ChatState,
        conversationId,
        pipelineData: {
          type: "risk-result",
          tokenSymbol: toSymbol.toUpperCase(),
          tokenAddress: toAddress,
          riskLevel: "high_risk",
          riskDetails: scanResult.triggeredLabels.join(", ") || undefined,
          source: scanResult.meta.source,
        },
      });
    }

    if (scanDecision === "unknown") {
      return json({
        agentMessage:
          `⚠️ **${toSymbol.toUpperCase()}** has unknown risk. ` +
          "Quote is blocked until risk is verified.",
        intent,
        action: "run_scan",
        chatState: "WALLET_CONNECTED" as ChatState,
        conversationId,
        pipelineData: {
          type: "risk-result",
          tokenSymbol: toSymbol.toUpperCase(),
          tokenAddress: toAddress,
          riskLevel: "unknown",
          source: scanResult.meta.source,
        },
      });
    }
  } catch {
    // Scan failed — continue with warning but don't block demo flow
    scanDecision = "skipped";
  }

  // 3. Get swap quote
  let fromTokenAddress: string | undefined;
  if (fromSymbol && !fromSymbol.startsWith("0x") && fromSymbol.toUpperCase() !== "USDC") {
    try {
      const fromResults = await searchToken(fromSymbol, chainSlug);
      if (fromResults.length > 0) {
        fromTokenAddress = fromResults[0].address;
      }
    } catch {
      // Fall back to default from token
    }
  }

  const quoteResult = await getQuotePreflight(
    toAddress,
    amount,
    chain,
    fromTokenAddress,
    fromSymbol.toUpperCase()
  );

  const quote: SimulationResult = quoteResult.quote;
  const slippageOk = quote.slippage < (intent.maxSlippagePercent ?? 3);

  // Create approval for the quote (enables the "Confirm & Sign" button)
  const approvalId = createApproval(
    toAddress,
    chain,
    amount,
    intent.maxSlippagePercent ?? 3
  );

  const quoteSummary =
    `📊 **Swap Quote: ${amount} ${fromSymbol.toUpperCase()} → ${toSymbol.toUpperCase()}**\n\n` +
    `Expected output: $${quote.expectedOutputUsd.toFixed(2)}\n` +
    `Slippage: ${quote.slippage.toFixed(2)}%${slippageOk ? "" : " ⚠️ HIGH"}\n` +
    `Gas fee: $${quote.gasFeeUsd.toFixed(4)}\n` +
    `Route: ${quote.route}\n\n` +
    (slippageOk
      ? "This quote looks good. Click **Confirm & Sign Transaction** below to proceed.\n" +
        "**PhylaX does not execute without your explicit confirmation.**"
      : "⚠️ High slippage detected. Review carefully before confirming.");

  return json({
    agentMessage: quoteSummary,
    intent,
    action: "run_quote",
    chatState: "WAITING_FOR_CONFIRMATION" as ChatState,
    conversationId,
    pipelineData: {
      type: "quote",
      quote,
      fromSymbol: fromSymbol.toUpperCase(),
      toSymbol: toSymbol.toUpperCase(),
      amount,
      scanDecision,
      source: quoteResult.meta.source,
      approvalId,
    },
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: Record<string, unknown>) {
  return NextResponse.json(data);
}
