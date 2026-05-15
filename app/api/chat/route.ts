import { NextResponse } from "next/server";
import { verifySession } from "../../../lib/privy-auth";
import { parseAgentToolCall, type AgentToolCall } from "../../../lib/anthropic";
import type { ChatState } from "../../../lib/chat-states";
import { getDb, schema } from "../../../lib/db";
import { eq, sql, and } from "drizzle-orm";
import {
  getSignals,
  scanToken,
  getQuotePreflight,
  searchToken,
  OkxRealModeError,
  type ScanResponse,
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
  if (!auth.authenticated || !auth.session) {
    return NextResponse.json(
      { error: auth.error ?? "Please sign in to use PhylaX." },
      { status: auth.statusCode || 401 }
    );
  }

  // ── 2. Parse request body ───────────────────────────────────────────────
  let body: { conversationId?: string; message?: string; chain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { conversationId, message, chain } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  const db = getDb();

  // ── 3. Persist User Message & Update Title ──────────────────────────────
  if (db) {
    try {
      // 0. Verify ownership of the conversation
      const conversation = await db.query.conversations.findFirst({
        where: and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.privyUserId, auth.session.userId)
        ),
      });

      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found or unauthorized" }, { status: 404 });
      }

      // 1. Save user message
      await db.insert(schema.messages).values({
        conversationId,
        role: "user",
        content: message,
      });

      // 2. Update title if it's the first message
      const [msgCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId));

      if (Number(msgCount.count) <= 1) {
        const title = message.length > 40 ? message.slice(0, 37) + "..." : message;
        await db
          .update(schema.conversations)
          .set({ title, updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
      } else {
        await db
          .update(schema.conversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
      }
    } catch (err) {
      console.error("[api/chat] Failed to persist user message:", err);
    }
  }

  // ── 4. Parse intent (LLM-led) ───────────────────────────────────────────
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (db) {
    try {
      const recentMessages = await db.query.messages.findMany({
        where: eq(schema.messages.conversationId, conversationId),
        orderBy: [sql`${schema.messages.createdAt} desc`],
        limit: 10,
      });
      // Reverse to chronological and filter out the current message (which was just inserted)
      history = recentMessages
        .reverse()
        .filter(m => m.content !== message)
        .map(m => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content 
        }));
    } catch (err) {
      console.error("[api/chat] Failed to fetch history context:", err);
    }
  }

  const toolCall = await parseAgentToolCall(message, chain, history);

  // ── 5. Execute pipeline based on intent ─────────────────────────────────
  let result: {
    agentMessage: string;
    action: string;
    chatState: ChatState;
    conversationId: string;
    pipelineData?: unknown;
    error?: string;
  };
  try {
    switch (toolCall.intent) {
      case "clarification_needed":
        result = {
          agentMessage: toolCall.clarifyingQuestion ?? toolCall.explanation,
          action: "ask_clarification",
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        };
        break;

      case "signal_discovery":
        result = await handleSignals(toolCall, conversationId);
        break;

      case "token_risk_scan":
        result = await handleScan(toolCall, conversationId);
        break;

      case "swap_quote":
        result = await handleQuote(toolCall, conversationId);
        break;

      case "explain_result":
      case "unsupported_request":
      default:
        result = {
          agentMessage: toolCall.explanation,
          action: "ask_clarification",
          chatState: "WALLET_CONNECTED" as ChatState,
          conversationId,
        };
        break;
    }
  } catch (err) {
    const errorMsg =
      err instanceof OkxRealModeError
        ? `OKX integration error: ${err.message}`
        : err instanceof Error
        ? err.message
        : "An unexpected error occurred.";

    result = {
      agentMessage: `⚠️ ${errorMsg}\n\nPlease try again or rephrase your request.`,
      action: toolCall?.intent || "unknown",
      chatState: "FAILED" as ChatState,
      conversationId,
      error: errorMsg,
    };
  }

  // ── 6. Persist Assistant Message ────────────────────────────────────────
  if (db && result) {
    try {
      await db.insert(schema.messages).values({
        conversationId,
        role: "assistant",
        content: result.agentMessage,
        metadata: result.pipelineData as Record<string, unknown>,
      });
    } catch (err) {
      console.error("[api/chat] Failed to persist assistant message:", err);
    }
  }

  return NextResponse.json(result);
}

// ─── Pipeline Handlers ────────────────────────────────────────────────────────

/**
 * Signal discovery: fetch signals → scan each → return trade plan.
 */
async function handleSignals(
  toolCall: AgentToolCall,
  conversationId: string
) {
  const chain = toolCall.chain ?? "x-layer";
  const maxTokens = 5;
  const riskMode = "conservative"; 

  const { signals, meta: signalMeta } = await getSignals(chain, maxTokens);

  if (!signals || signals.length === 0) {
    return {
      agentMessage:
        (toolCall.explanation || "Searching for signals...") +
        "\n\nI couldn't find any token signals for this chain right now.",
      action: "run_signals",
      chatState: "WALLET_CONNECTED" as ChatState,
      conversationId,
      pipelineData: { source: signalMeta.source },
    };
  }

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
  
  const summary =
    `${toolCall.explanation}\n\n` +
    `Found ${signals.length} signal${signals.length !== 1 ? "s" : ""} on ${chain}. ` +
    `${safeCount} passed my risk gate.\n\n` +
    (safeCount > 0
      ? "You can ask me to quote any of the safe tokens for a swap."
      : "No tokens passed the risk gate. Consider trying a different chain.");

  return {
    agentMessage: summary,
    action: "run_signals",
    chatState: (safeCount > 0 ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED") as ChatState,
    conversationId,
    pipelineData: { 
      type: "trade-plan",
      source: signalMeta.source, 
      signals: scannedSignals,
      chainName: chain
    },
  };
}

/**
 * Token scan: scan a specific token and return risk result.
 */
async function handleScan(
  toolCall: AgentToolCall,
  conversationId: string
) {
  const chain = toolCall.chain ?? "x-layer";
  const tokenSymbol = toolCall.toSymbol;

  if (!tokenSymbol) {
    return {
      agentMessage: toolCall.clarifyingQuestion ?? "Which token should I scan?",
      action: "ask_clarification",
      chatState: "NEEDS_CLARIFICATION" as ChatState,
      conversationId,
    };
  }

  let tokenAddress = tokenSymbol;
  if (!tokenSymbol.startsWith("0x")) {
    try {
      const results = await searchToken(tokenSymbol, chain === "x-layer" ? "xlayer" : chain);
      if (results.length > 0) {
        tokenAddress = results[0].address;
      } else {
        return {
          agentMessage: `I couldn't find a token matching "${tokenSymbol}" on ${chain}.`,
          action: "ask_clarification",
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        };
      }
    } catch {
      return {
        agentMessage: `Token search for "${tokenSymbol}" failed.`,
        action: "ask_clarification",
        chatState: "NEEDS_CLARIFICATION" as ChatState,
        conversationId,
      };
    }
  }

  try {
    const scanResult = await scanToken(tokenAddress, chain);
    const riskMode = "conservative";
    const action = determineRiskAction(scanResult.decision, riskMode);

    const summary =
      `${toolCall.explanation}\n\n` +
      (action === "safe"
        ? `✅ **${tokenSymbol.toUpperCase()}** passed security checks.`
        : action === "high_risk"
        ? `🚫 **${tokenSymbol.toUpperCase()}** is flagged as **high risk**.`
        : `⚠️ **${tokenSymbol.toUpperCase()}** has **unknown risk**.`) +
      ` (Level: ${scanResult.riskLevel})`;

    return {
      agentMessage: summary,
      action: "run_scan",
      chatState: (action === "safe" ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED") as ChatState,
      conversationId,
      pipelineData: { 
        type: "risk-result",
        tokenSymbol: tokenSymbol.toUpperCase(),
        tokenAddress,
        riskLevel: action as "safe" | "high_risk" | "unknown" | "skipped" | "pending",
        riskDetails: scanResult.triggeredLabels.join(", ") || undefined,
        source: scanResult.meta?.source || "unknown"
      },
    };
  } catch (err) {
    console.error("[handleScan] Error:", err);
    return {
      agentMessage: `I tried to scan ${tokenAddress} on ${chain} but encountered an error.`,
      action: "run_scan_failed",
      chatState: "FAILED" as ChatState,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Quote: resolve tokens → scan → simulate quote → return quote card.
 */
async function handleQuote(
  toolCall: AgentToolCall,
  conversationId: string
) {
  const chain = toolCall.chain ?? "x-layer";
  const chainSlug = chain === "x-layer" ? "xlayer" : chain;
  const fromSymbol = toolCall.fromSymbol ?? "USDC";
  const toSymbol = toolCall.toSymbol;
  const amount = parseFloat(toolCall.amount || "50");

  if (!toSymbol) {
    return {
      agentMessage: toolCall.clarifyingQuestion ?? "Which token do you want to swap to?",
      action: "ask_clarification",
      chatState: "NEEDS_CLARIFICATION" as ChatState,
      conversationId,
    };
  }

  let toAddress: string;
  if (toSymbol.startsWith("0x")) {
    toAddress = toSymbol;
  } else {
    try {
      const results = await searchToken(toSymbol, chainSlug);
      if (results.length > 0) {
        toAddress = results[0].address;
      } else {
        return {
          agentMessage: `I couldn't find "${toSymbol}" on ${chain}.`,
          action: "ask_clarification",
          chatState: "NEEDS_CLARIFICATION" as ChatState,
          conversationId,
        };
      }
    } catch {
      return {
        agentMessage: `Token search for "${toSymbol}" failed.`,
        action: "ask_clarification",
        chatState: "NEEDS_CLARIFICATION" as ChatState,
        conversationId,
      };
    }
  }

  let scanDecision: "safe" | "high_risk" | "unknown" | "skipped" = "safe";
  let scanResult: ScanResponse;
  try {
    scanResult = await scanToken(toAddress, chain);
    const riskMode = "conservative";
    scanDecision = determineRiskAction(scanResult.decision, riskMode);

    if (scanDecision === "high_risk") {
      return {
        agentMessage:
          `${toolCall.explanation}\n\n🚫 **${toSymbol.toUpperCase()}** is flagged as **high risk**. ` +
          "Quote and execution are blocked for security.",
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
      };
    }
  } catch {
    scanDecision = "skipped";
  }

  // 3. Get swap quote
  try {
    const quoteResult = await getQuotePreflight(toAddress, amount, chain, undefined, fromSymbol.toUpperCase());
    const quote: SimulationResult = quoteResult.quote;

    // Create approval for the quote (enables the "Confirm & Sign" button)
    const approvalId = createApproval(toAddress, chain, amount, 3);

    const summary =
      `${toolCall.explanation}\n\n` +
      `📊 **${amount} ${fromSymbol.toUpperCase()} → ${toSymbol.toUpperCase()}**\n` +
      `Output: $${quote.expectedOutputUsd.toFixed(2)}\n\n` +
      "Click **Confirm & Sign Transaction** below to proceed. PhylaX never signs without your approval.";

    return {
      agentMessage: summary,
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
    };
  } catch (err) {
    console.error("[handleQuote] Error:", err);
    return {
      agentMessage: `${toolCall.explanation}\n\n` + 
        `I encountered an error getting a quote: ${err instanceof Error ? err.message : String(err)}`,
      action: "run_quote_failed",
      chatState: "FAILED" as ChatState,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
