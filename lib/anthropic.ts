import { Anthropic } from "@anthropic-ai/sdk";
import { ThesisIntent, ThesisIntentSchema } from "./schemas";

import { getToolsForAnthropic, registry } from "./tools/registry";
import { createApproval } from "./approval-store";
import { ChatState } from "./chat-states";

let anthropic: Anthropic | null = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/** FOR TESTING ONLY: Inject a mock Anthropic client */
export function __setAnthropicForTesting(client: any) {
  anthropic = client;
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const PHYLAX_PERSONA = `
You are PhylaX, a compact, professional trading assistant.
Your responses must be short (2–5 sentences), action-oriented, and focused on the user's intent.

Persona Guidelines:
- Tone: Direct, professional, security-conscious.
- Concise: NO generic fillers like "analyzed-style" or "based-on" preambles. Start with the result.
- Scan-First: Always lead with risk results if available.
- Action-Oriented: Every message should clear the path to the next safe step.

Response Patterns:
1. Quote Ready: "Quote ready on [Chain]. Risk scan: [LEVEL]. Estimated output: [Amount]. [Action]."
2. Blocked: "Trade blocked: [Reason]. Try a lower-risk token."
3. Coming Soon: "Live execution for [Chain] is Coming Soon. Switch to X Layer to proceed."
4. Insufficient Balance: "Insufficient balance: verified wallet has [Balance] [Symbol]. Reduce amount or top up."
5. Submitted: "Transaction submitted to [Chain]. Check status or view on explorer."

Meme / Trenches / Smart Money Rules:
1. Use \`market_structure_check\` for supported tokens (BTC, ETH, etc.). The market_structure_check tool is read-only.
2. If unsupported, say "not available yet" or "unsupported".
3. NEVER fake data or results.
4. Always state: Smart money activity does not mean safe. KOL activity does not mean safe. Trending does not mean safe.
5. Do not fake holder/liquidity data.
6. Refuse requests to auto-trade, snipe, or run a bot.

Agent Planning & Decision Rules:
1. Output an <agent_plan> JSON block BEFORE calling tools.
2. Produce a Candidate Comparison summary if multiple tokens are checked.
3. Decision Summary: Final answer must include found risks and whether wallet signing is required.
4. Next Action: Suggest exactly ONE safe next action (e.g. "Preview quote").
5. Never suggest auto-buy, copy-trade, sniper, or bypass scan.

Safety Rules:
- NEVER use: "safe token", "guaranteed", "risk-free", "auto-execute".
- USE: "LOW risk by current scan", "blocked", "wallet signature required", "server never broadcasts".
- Execution always requires user's wallet signature.
`;

export async function parseThesis(thesis: string, trustedRiskMode?: "conservative" | "moderate" | "degen"): Promise<ThesisIntent> {
  if (!anthropic) {
    throw new Error("Anthropic API key is not configured. Real AI agent is unavailable.");
  }

  // P0 Phase 9: Truncate thesis to prevent oversized injection payloads
  const sanitizedThesis = thesis.slice(0, 2000);
  const hardCap = parseFloat(process.env.MAX_TRADE_USD_HARD_CAP || "100");

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: "user", content: `${PHYLAX_PERSONA}\nExtract trading intent. Output ONLY valid JSON matching this schema: {"timeframe": "string", "maxBudgetUsd": number, "maxTokens": number, "riskMode": "conservative" | "moderate" | "degen", "chain": "string", "fallbackChain": "string", "requireSimulation": true, "requireUserApproval": true, "slippageLimitPercent": number}. User thesis: "${sanitizedThesis}"` }]
    });
    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = ThesisIntentSchema.parse(JSON.parse(jsonMatch[0]));

    // P0 Phase 9: ALWAYS override riskMode — LLM cannot set this
    parsed.riskMode = trustedRiskMode || "conservative";

    // P0 Phase 9: ALWAYS clamp budget — LLM cannot exceed hard cap
    if (parsed.maxBudgetUsd > hardCap) {
      parsed.maxBudgetUsd = hardCap;
    }

    // P0 Phase 9: Force safety invariants regardless of LLM output
    parsed.requireSimulation = true;
    parsed.requireUserApproval = true;

    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse thesis using Anthropic: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface AgentRunResult {
  agentMessage: string;
  action: string;
  chatState: ChatState;
  pipelineData?: unknown;
  error?: string;
  toolCallsLog: unknown[];
}

export type AgentProgressCallback = (type: string, data: Record<string, unknown>) => void;

export async function runAgentLoop(
  message: string,
  chainHint?: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  conversationId: string = "",
  onProgress?: AgentProgressCallback,
  walletAddress: string = ""
): Promise<AgentRunResult> {
  if (!anthropic) {
    throw new Error("Anthropic API key is not configured. Real AI agent is unavailable.");
  }

  const systemPrompt = `${PHYLAX_PERSONA}\n${chainHint ? `Context: User selected ${chainHint} as default chain.` : ""}`;
  const limitedHistory = history.slice(-10);

  const messages: Anthropic.MessageParam[] = [
    ...limitedHistory.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const tools = getToolsForAnthropic();
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  let pipelineData: unknown = undefined;
  let action = "ask_clarification";
  let chatState: ChatState = "WALLET_CONNECTED";
  const toolCallsLog: unknown[] = [];
  let agentPlan: Record<string, unknown> | undefined;

  while (iterations < MAX_ITERATIONS) {
    if (iterations === 0) {
      onProgress?.("step", { label: "Understanding request", status: "running", timestamp: new Date().toISOString() });
    }
    iterations++;

    let response;
    try {
      response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        temperature: 0,
        system: systemPrompt,
        messages: messages,
        tools: tools as Anthropic.Tool[],
      });
    } catch (err: unknown) {
      console.error("Anthropic API Error:", err);
      return {
        agentMessage: `⚠️ Model API error: ${err instanceof Error ? err.message : String(err)}`,
        action: "error",
        chatState: "FAILED",
        toolCallsLog,
        error: err instanceof Error ? err.message : String(err)
      };
    }

    messages.push({
      role: "assistant",
      content: response.content,
    });

    const textBlocks = response.content.filter((c: unknown) => (c as Record<string, unknown>).type === "text") as unknown as Record<string, unknown>[];
    for (const textBlock of textBlocks) {
      const text = String(textBlock.text);
      const planMatch = text.match(/<agent_plan>([\s\S]*?)<\/agent_plan>/);
      if (planMatch && !agentPlan) {
        try {
          agentPlan = JSON.parse(planMatch[1]);
          onProgress?.("step", { label: "Planning route", status: "done", timestamp: new Date().toISOString() });
        } catch {}
      }
    }

    if (response.stop_reason !== "tool_use") {
      if (agentPlan?.plan && Array.isArray(agentPlan.plan) && agentPlan.plan.some(p => typeof p === 'string' && p.toLowerCase().includes("compare"))) {
        onProgress?.("step", { label: "Comparing candidates", status: "done", timestamp: new Date().toISOString() });
      }
      onProgress?.("step", { label: "Synthesizing decision", status: "running", timestamp: new Date().toISOString() });
      // Loop ends, we have a final text response
      const textContent = response.content.find((c: unknown) => (c as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
      let finalAgentMessage = textContent?.type === "text" ? String(textContent.text) : "I have completed the request.";

      const finalPlanMatch = finalAgentMessage.match(/<agent_plan>([\s\S]*?)<\/agent_plan>/);
      if (finalPlanMatch) {
        try {
          agentPlan = JSON.parse(finalPlanMatch[1]);
          const planText = agentPlan?.plan ? `**Plan:**\n${(agentPlan.plan as string[]).map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}\n\n` : "";
          finalAgentMessage = finalAgentMessage.replace(finalPlanMatch[0], planText).trim();
        } catch {
          finalAgentMessage = finalAgentMessage.replace(finalPlanMatch[0], "").trim();
        }
      } else if (agentPlan && !finalAgentMessage.includes("**Plan:**")) {
        const planText = agentPlan.plan ? `**Plan:**\n${(agentPlan.plan as string[]).map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}\n\n` : "";
        finalAgentMessage = planText + finalAgentMessage;
      }

      // If we have a plan, inject it into pipelineData metadata for storage if pipelineData is an object
      if (agentPlan) {
        if (pipelineData && typeof pipelineData === "object" && !Array.isArray(pipelineData)) {
          (pipelineData as Record<string, unknown>).agentPlan = agentPlan;
        } else if (!pipelineData) {
          pipelineData = { type: "agent-plan", agentPlan };
        }
      }

      return {
        agentMessage: finalAgentMessage,
        action,
        chatState,
        pipelineData,
        toolCallsLog
      };
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter((c: unknown) => (c as Record<string, unknown>).type === "tool_use") as Anthropic.ToolUseBlock[];
    
    if (toolUseBlocks.length > 0) {
      // Bounded Orchestration: Max 5 tool calls total, max 3 scan candidates
      const blocksToExecute = toolUseBlocks.slice(0, 5);
      const finalBlocksToExecute: Anthropic.ToolUseBlock[] = [];
      let scanCount = 0;
      
      for (const block of blocksToExecute) {
        if (block.name === "scan_token") {
          if (scanCount >= 3) continue; // Skip to enforce cap
          scanCount++;
        }
        finalBlocksToExecute.push(block);
      }

      // Execute tools concurrently
      const executionPromises = finalBlocksToExecute.map(async (block) => {
        const toolName = block.name;
        const toolInput = block.input as Record<string, unknown>;
        
        let label = "Using tool";
        if (toolName === "get_signals") label = "Searching candidates";
        if (toolName === "scan_token") label = "Scanning risks";
        if (toolName === "search_token") label = "Searching candidates";
        if (toolName === "get_swap_quote") label = "Preparing quote preview";
        if (toolName === "market_structure_check") {
          label = "Checking market structure";
        }
        
        onProgress?.("tool_start", { id: block.id, label, status: "running", timestamp: new Date().toISOString() });

        const toolDef = registry.get(toolName);

        const startTime = Date.now();
        let result: unknown;
        let isError = false;

        if (!toolDef) {
          result = { error: `Tool ${toolName} not found.` };
          isError = true;
        } else {
          try {
            result = await toolDef.execute(toolInput, { conversationId, walletAddress });
          } catch (err: unknown) {
            result = { error: err instanceof Error ? err.message : String(err) };
            isError = true;
          }
        }

        const latencyMs = Date.now() - startTime;
        
        if (isError) {
          onProgress?.("partial_failure", { id: block.id, label, status: "error", error: result, timestamp: new Date().toISOString() });
        } else {
          onProgress?.("tool_result", { id: block.id, label, status: "done", timestamp: new Date().toISOString() });
        }
        
        return { block, toolName, toolInput, result, isError, latencyMs };
      });

      const settledResults = await Promise.allSettled(executionPromises);

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      const successfulSignals: Record<string, unknown>[] = [];
      const successfulScans: Record<string, unknown>[] = [];
      let quoteResultData: Record<string, unknown> | null = null;
      let quoteBlockInput: Record<string, unknown> | null = null;

      for (let i = 0; i < toolUseBlocks.length; i++) {
        const originalBlock = toolUseBlocks[i];
        const executedIndex = finalBlocksToExecute.findIndex(b => b.id === originalBlock.id);

        if (executedIndex === -1) {
          // Block was skipped due to caps
          toolResults.push({
            type: "tool_result",
            tool_use_id: originalBlock.id,
            content: JSON.stringify({ error: "Skipped: Exceeded maximum allowed tool executions or scan candidates for this turn." }),
            is_error: true,
          });
          continue;
        }

        const settled = settledResults[executedIndex];
        if (settled.status === "rejected") {
           toolResults.push({
             type: "tool_result",
             tool_use_id: originalBlock.id,
             content: JSON.stringify({ error: String(settled.reason) }),
             is_error: true,
           });
           continue;
        }

        const { toolName, toolInput, result, isError, latencyMs } = settled.value;

        toolCallsLog.push({
          toolName,
          input: toolInput,
          output: result,
          latencyMs,
          timestamp: new Date().toISOString()
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: originalBlock.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
          is_error: isError,
        });

        if (!isError) {
          const res = result as Record<string, unknown>;
          if (toolName === "get_signals") {
            const sigs = (res.signals as Record<string, unknown>[]) || [];
            successfulSignals.push(...sigs.map(s => ({ ...s, chainName: toolInput.chain || chainHint || "x-layer" })));
          } else if (toolName === "scan_token") {
            successfulScans.push({
               ...res,
               chainName: toolInput.chain || chainHint || "x-layer",
               symbol: toolInput.symbol || "TOKEN",
            });
          } else if (toolName === "get_swap_quote") {
            quoteResultData = res;
            quoteBlockInput = toolInput;
          }
        }
      }

      // Reconcile overall action and pipelineData
      if (quoteResultData) {
        action = "run_quote";
        if (quoteResultData.blocked) {
          chatState = "FAILED";
          const scanRes = quoteResultData.scanResult as Record<string, unknown>;
          pipelineData = {
            type: "risk-result",
            tokenSymbol: quoteResultData.toAddress || "TOKEN",
            tokenAddress: quoteResultData.toAddress,
            riskLevel: "high_risk",
            riskDetails: (scanRes?.triggeredLabels as string[])?.join(", "),
            source: (scanRes?.meta as Record<string, unknown>)?.source
          };
        } else {
          if (!walletAddress) {
             return {
               agentMessage: "A verified wallet is required to prepare a quote. Please connect your wallet in the settings or via the popup to continue.",
               action: "ask_clarification",
               chatState: "WALLET_REQUIRED",
               pipelineData: null,
               toolCallsLog
             };
          }
          chatState = "WAITING_FOR_CONFIRMATION";
          const slippage = quoteResultData.slippage !== undefined ? Number(quoteResultData.slippage) : 2; // Default to 2% if missing
          const approvalId = await createApproval(String(quoteResultData.toAddress), String(quoteBlockInput!.chain), Number(quoteResultData.amount), slippage, walletAddress);
          pipelineData = {
            type: "quote",
            quote: quoteResultData.quote,
            fromSymbol: quoteResultData.fromSymbol,
            toSymbol: quoteResultData.toSymbol || "UNKNOWN",
            tokenAddress: quoteResultData.toAddress,
            amount: quoteResultData.amount,
            scanDecision: quoteResultData.scanDecision,
            source: (quoteResultData.meta as Record<string, unknown>)?.source,
            approvalId,
            targetWalletAddress: walletAddress
          };
        }
      } else if (successfulSignals.length > 0) {
        action = "run_signals";
        const safeCount = successfulSignals.filter(s => s.riskStatus === "safe").length;
        chatState = safeCount > 0 ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED";
        pipelineData = {
          type: "trade-plan",
          signals: successfulSignals,
          chainName: successfulSignals[0]?.chainName || chainHint || "x-layer"
        };
      } else if (successfulScans.length > 0) {
        if (successfulScans.length === 1) {
          action = "run_scan";
          const res = successfulScans[0];
          chatState = res.action === "safe" ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED";
          pipelineData = {
            type: "risk-result",
            tokenSymbol: res.symbol || "TOKEN",
            tokenAddress: res.address,
            riskLevel: res.action === "safe" ? "safe" : (res.action === "high_risk" ? "high_risk" : "unknown"),
            riskDetails: (res.triggeredLabels as string[])?.join(", "),
            source: (res.meta as Record<string, unknown>)?.source || "unknown"
          };
        } else {
          action = "run_signals";
          const combinedSignals = successfulScans.map(scan => ({
             address: scan.address,
             symbol: scan.symbol || "TOKEN",
             chain: scan.chainName,
             riskStatus: scan.action === "safe" ? "safe" : (scan.action === "high_risk" ? "high_risk" : "unknown"),
             amountUsd: 0,
             triggerCount: 1,
          }));
          const safeCount = combinedSignals.filter(s => s.riskStatus === "safe").length;
          chatState = safeCount > 0 ? "WAITING_FOR_CONFIRMATION" : "WALLET_CONNECTED";
          pipelineData = {
            type: "trade-plan",
            signals: combinedSignals,
            chainName: combinedSignals[0]?.chain || chainHint || "x-layer"
          };
        }
      }

      messages.push({
        role: "user",
        content: toolResults,
      });
    }
  }

  return {
    agentMessage: "Max iterations reached.",
    action: "error",
    chatState: "FAILED",
    toolCallsLog
  };
}

// ─── End ─────────────────────────────────────────────────────────────────
