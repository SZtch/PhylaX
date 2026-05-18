import { Anthropic } from "@anthropic-ai/sdk";
import { ThesisIntent, ThesisIntentSchema } from "./schemas";

import { getToolsForAnthropic, registry } from "./tools/registry";
import { createApproval } from "./approval-store";
import { ChatState } from "./chat-states";
import { getActiveProviderWithFallback, chatWithFallback, type LLMProvider, type LLMToolCall, type LLMResponse } from "./llm-provider";

let anthropic: Anthropic | null = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/** FOR TESTING ONLY: Inject a mock Anthropic client */
export function __setAnthropicForTesting(client: any) {
  anthropic = client;
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const PHYLAX_PERSONA = `
You are PhylaX, a DeFi copilot that feels like chatting with a sharp friend who knows crypto inside out. You protect the wallet, scan before every trade, and quote with real OKX data.

PERSONALITY:
- Talk like a real person, not a robot. Casual, warm, but still precise when it matters.
- Short replies. 1 to 3 sentences max. Never pad or over-explain.
- No markdown bold, no bullet lists, no headers, no long dashes.
- Skip filler like "Great question!", "Sure!", "Of course!", "I'll help you with that", "Based on my analysis".
- Lead with the answer, not the process.
- You genuinely care about the user's money. Show it by being direct, not by writing essays.
- Default language is English. If the user writes in another language, reply in that same language.

RESPONSE STYLE:
- Scan result: "OKB looks clean, LOW risk. Quote ready, 50 USDC gets you around 12.4 OKB. Slippage 0.3%. Sign when you're good."
- Blocked trade: "Nah that token's flagged. Not worth the risk. Try OKB or USDC instead."
- Missing chain: "X Layer only for now, switch over and try again."
- Low balance: "You've got [X] in the wallet. Not enough for that trade, try lowering the amount."
- Confirmed: "Done, tx submitted. Check explorer if you wanna track it."
- Market read: one line on what smart money is doing, one line caveat. No lectures.
- Unsupported request: decline in one sentence, no apology.

SAFETY (always):
- Never say "safe token" or "guaranteed" or "risk-free".
- Say "LOW risk by current scan", not a promise.
- Wallet signature required, server never broadcasts.

TOOLS:
- Output <agent_plan> JSON block before calling tools.
- After tools: give ONE clear next action. Not a list of options.
- If multiple tokens scanned: compare them in 1 to 2 lines max.
- CRITICAL: Native tokens (like OKB on X Layer, ETH on Base) ALWAYS use the address \`0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\`. NEVER use \`search_token\` to find the address of Native OKB. You MUST explicitly pass \`0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\` for the \`from_address\` if swapping from OKB. DO NOT leave it undefined.
- CRITICAL: If the user provides a fiat amount for a swap (e.g. "$1", "10 USD", "1 USDC" if 1 USDC = $1), you should use the \`amount_usd\` parameter instead of \`amount\` in the \`get_swap_quote\` tool! The tool will auto-convert it to the correct token amount using live CoinGecko prices.
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
  const providers = getActiveProviderWithFallback();
  if (!providers) {
    return {
      agentMessage: "PhylaX AI is not configured yet. Your wallet and funds are safe, but I can't process requests right now. Contact the team.",
      action: "error",
      chatState: "FAILED",
      toolCallsLog: [],
      error: "No LLM provider configured (set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY)"
    };
  }
  let activeProvider: LLMProvider = providers.provider;
  const fallbackProvider = providers.fallback;

  const systemPrompt = `${PHYLAX_PERSONA}
${chainHint ? `Context: User selected ${chainHint} as default chain.` : ""}
${walletAddress ? `Context: The user's connected wallet address is ${walletAddress}. Use this for any balance or portfolio queries.` : ""}`;
  const limitedHistory = history.slice(-10);

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    ...limitedHistory.map(h => ({ role: h.role, content: h.content as unknown })),
    { role: "user" as const, content: message }
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

    let llmResponse: LLMResponse;
    try {
      const result = await chatWithFallback(activeProvider, fallbackProvider, systemPrompt, messages, tools, 1000);
      llmResponse = result.response;
      if (result.usedProvider !== activeProvider.name) {
        console.log(`[agent] Switched to ${result.usedProvider} (fallback)`);
      }
    } catch (err: unknown) {
      console.error("LLM API Error:", err);
      const rawMsg = err instanceof Error ? err.message : String(err);
      const rawLower = rawMsg.toLowerCase();
      let friendlyMessage: string;
      if (rawLower.includes("credit") || rawLower.includes("billing") || rawLower.includes("payment") || rawLower.includes("insufficient")) {
        friendlyMessage = "PhylaX's brain is temporarily offline (API credits ran out). Your wallet and funds are safe. Try again later or contact the team.";
      } else if (rawLower.includes("rate_limit") || rawLower.includes("rate limit") || rawLower.includes("too many")) {
        friendlyMessage = "Too many requests right now, give it a sec and try again.";
      } else if (rawLower.includes("overloaded") || rawLower.includes("529") || rawLower.includes("capacity")) {
        friendlyMessage = "The AI model is overloaded right now. Try again in a minute.";
      } else if (rawLower.includes("timeout") || rawLower.includes("network") || rawLower.includes("econnrefused") || rawLower.includes("fetch failed")) {
        friendlyMessage = "Couldn't reach the AI service. Check your connection or try again.";
      } else {
        friendlyMessage = "Something went wrong on PhylaX's end. Your wallet is safe. Try again in a moment.";
      }
      return { agentMessage: friendlyMessage, action: "error", chatState: "FAILED" as ChatState, toolCallsLog, error: rawMsg };
    }

    messages.push(activeProvider.buildAssistantMessage(llmResponse));

    // Extract agent plan from text
    if (llmResponse.textContent) {
      const planMatch = llmResponse.textContent.match(/<agent_plan>([\s\S]*?)<\/agent_plan>/);
      if (planMatch && !agentPlan) {
        try {
          agentPlan = JSON.parse(planMatch[1]);
          onProgress?.("step", { label: "Planning route", status: "done", timestamp: new Date().toISOString() });
        } catch {}
      }
    }

    if (llmResponse.stopReason !== "tool_use") {
      if (agentPlan?.plan && Array.isArray(agentPlan.plan) && agentPlan.plan.some(p => typeof p === 'string' && p.toLowerCase().includes("compare"))) {
        onProgress?.("step", { label: "Comparing candidates", status: "done", timestamp: new Date().toISOString() });
      }
      onProgress?.("step", { label: "Synthesizing decision", status: "running", timestamp: new Date().toISOString() });
      let finalAgentMessage = llmResponse.textContent || "I have completed the request.";

      const finalPlanMatch = finalAgentMessage.match(/<agent_plan>([\s\S]*?)<\/agent_plan>/);
      if (finalPlanMatch) {
        try {
          agentPlan = JSON.parse(finalPlanMatch[1]);
          // Strip the raw <agent_plan> block from the message — no markdown bold per persona
          const planText = agentPlan?.plan
            ? `Plan: ${(agentPlan.plan as string[]).join(" → ")}\n\n`
            : "";
          finalAgentMessage = finalAgentMessage.replace(finalPlanMatch[0], planText).trim();
        } catch {
          finalAgentMessage = finalAgentMessage.replace(finalPlanMatch[0], "").trim();
        }
      } else if (agentPlan && !finalAgentMessage.includes("Plan:")) {
        const planText = agentPlan.plan
          ? `Plan: ${(agentPlan.plan as string[]).join(" → ")}\n\n`
          : "";
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
    const toolUseBlocks = llmResponse.toolCalls;
    
    if (toolUseBlocks.length > 0) {
      // Bounded Orchestration: Max 5 tool calls total, max 3 scan candidates
      const blocksToExecute = toolUseBlocks.slice(0, 5);
      const finalBlocksToExecute: LLMToolCall[] = [];
      let scanCount = 0;
      
      for (const block of blocksToExecute) {
        if (block.name === "scan_token") {
          if (scanCount >= 3) continue;
          scanCount++;
        }
        finalBlocksToExecute.push(block);
      }

      // Execute tools concurrently
      const executionPromises = finalBlocksToExecute.map(async (block) => {
        const toolName = block.name;
        const toolInput = block.input;
        
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

      const toolResults: { toolCallId: string; content: string; isError: boolean }[] = [];
      const successfulSignals: Record<string, unknown>[] = [];
      const successfulScans: Record<string, unknown>[] = [];
      let quoteResultData: Record<string, unknown> | null = null;
      let quoteBlockInput: Record<string, unknown> | null = null;

      for (let i = 0; i < toolUseBlocks.length; i++) {
        const originalBlock = toolUseBlocks[i];
        const executedIndex = finalBlocksToExecute.findIndex(b => b.id === originalBlock.id);

        if (executedIndex === -1) {
          toolResults.push({
            toolCallId: originalBlock.id,
            content: JSON.stringify({ error: "Skipped: Exceeded maximum allowed tool executions or scan candidates for this turn." }),
            isError: true,
          });
          continue;
        }

        const settled = settledResults[executedIndex];
        if (settled.status === "rejected") {
           toolResults.push({
             toolCallId: originalBlock.id,
             content: JSON.stringify({ error: String(settled.reason) }),
             isError: true,
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
          toolCallId: originalBlock.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
          isError: isError,
        });

        if (!isError) {
          const res = result as Record<string, unknown>;
          if (toolName === "get_signals") {
            const sigs = (res.signals as Record<string, unknown>[]) || [];
            const seenAddresses = new Set(successfulSignals.map(s => String(s.address).toLowerCase()));
            for (const s of sigs) {
              const addr = String(s.address).toLowerCase();
              if (addr && !seenAddresses.has(addr)) {
                seenAddresses.add(addr);
                successfulSignals.push({
                  ...s,
                  amountUsd: Math.round((Number(s.amountUsd) || 0) * 100) / 100,
                  chainName: toolInput.chain || chainHint || "x-layer",
                });
              }
            }
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
          const scanResTo = quoteResultData.scanResultTo as Record<string, unknown> | undefined;
          const scanResFrom = quoteResultData.scanResultFrom as Record<string, unknown> | undefined;
          
          if (scanResTo || scanResFrom) {
            // It's blocked due to a high risk scan
            const scanRes = scanResTo || scanResFrom;
            pipelineData = {
              type: "risk-result",
              tokenSymbol: quoteResultData.toSymbol || "TOKEN",
              tokenAddress: quoteResultData.toAddress,
              riskLevel: "high_risk",
              riskDetails: (scanRes?.triggeredLabels as string[])?.join(", "),
              source: (scanRes?.meta as Record<string, unknown>)?.source
            };
          } else {
            // It's blocked due to insufficient balance or missing wallet
            // Just let the AI explain the error, no risk card needed.
            pipelineData = null;
          }
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
          const approvalId = await createApproval(
            String(quoteResultData.toAddress), 
            String(quoteBlockInput!.chain), 
            Number(quoteResultData.amount), 
            slippage, 
            walletAddress, 
            quoteResultData.fromToken ? String(quoteResultData.fromToken) : undefined,
            quoteResultData.routerAddress ? String(quoteResultData.routerAddress) : undefined,
            Boolean(quoteResultData.needsApproval),
            quoteResultData.approveAmountStr ? String(quoteResultData.approveAmountStr) : undefined,
            quoteResultData.routerAddress ? String(quoteResultData.routerAddress) : undefined
          );
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

      messages.push(activeProvider.buildToolResultsMessage(toolResults));
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
