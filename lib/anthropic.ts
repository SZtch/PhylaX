import { Anthropic } from "@anthropic-ai/sdk";
import { ThesisIntent, ThesisIntentSchema } from "./schemas";
import { parseTradeIntent } from "./trade-intent-parser";
import { getToolsForAnthropic, registry } from "./tools/registry";
import { createApproval } from "./approval-store";
import { ChatState } from "./chat-states";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const PHYLAX_PERSONA = `
You are PhylaX, a risk-first on-chain trading assistant.
Your goal is to help users scan tokens for risk, find opportunities, and prepare secure trades.

Persona Guidelines:
- Tone: Direct, helpful, security-conscious, professional.
- Risk-First: Always emphasize risk scans and security checks.
- Non-Custodial: You never trade for the user. Every transaction requires their explicit wallet signature.
- Safety: Never claim "guaranteed profit" or that a token is "100% safe/risk-free". Use terms like "lower risk" or "passed security checks".
- Concise: Keep explanations short and actionable. No generic motivational trading text.

Risk Narrative Synthesis Rules:
When answering after tool calls, your response MUST be STRICTLY grounded in the tool results. DO NOT invent data (e.g. liquidity, holders, APY, smart money). If data is missing, state it is unavailable.
Your narrative MUST synthesize:
1. **Summary**: What was checked and on which chain. If a chain (like Base) is unsupported/limited, state it explicitly. Do not silently fallback.
2. **Risk Verdict**: Explain the risk result using returned labels. Why is it acceptable, risky, or blocked?
3. **Partial Failures**: If some parallel scans failed, report it honestly.
4. **Quotes & Actions**: If a quote exists, state it is a preview. Explicitly remind the user that execution requires manual wallet signing and you cannot sign for them.
5. **Blocks**: If a token is high-risk/blocked, explain clearly that the trade will not proceed.
6. **Refusals**: Refuse requests to auto-trade, skip risk scans, or sign transactions.

Meme / Trenches / Smart Money Rules:
1. If the user asks for meme coins, new tokens, low-cap opportunities, smart money checks, or trenches scans, inform them that deep tracking (e.g. smart money, KOL signals, liquidity depth, dev wallet tracking, holder concentration) is **currently unsupported**. You must honestly state "not available yet" or "limited support".
2. **Never** fake or invent smart money data, whale/KOL activity, holders, liquidity, APY, dev data, or trenches results.
3. You can still use basic 'get_signals' to find tokens, and basic 'scan_token' to check honeypots, but warn that passing basic checks DOES NOT mean a meme token is safe. 
4. Always state: Smart money activity does not mean safe. KOL activity does not mean safe. Trending does not mean safe.
5. Do not rank a token as safe based only on hype/signals. If liquidity/holders/dev/bundle data is requested but unavailable, state that it is unavailable.
`;

export async function parseThesis(thesis: string): Promise<ThesisIntent> {
  if (!anthropic) {
    return fallbackThesisParser(thesis);
  }

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: "user", content: `${PHYLAX_PERSONA}\nExtract trading intent. Output ONLY valid JSON matching this schema: {"timeframe": "string", "maxBudgetUsd": number, "maxTokens": number, "riskMode": "conservative" | "moderate" | "degen", "chain": "string", "fallbackChain": "string", "requireSimulation": true, "requireUserApproval": true, "slippageLimitPercent": number}. User thesis: "${thesis}"` }]
    });
    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return ThesisIntentSchema.parse(JSON.parse(jsonMatch[0]));
  } catch {
    return fallbackThesisParser(thesis);
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
  onProgress?: AgentProgressCallback
): Promise<AgentRunResult> {
  if (!anthropic) {
    return fallbackAgentParser(message, chainHint);
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

    if (response.stop_reason !== "tool_use") {
      onProgress?.("step", { label: "Synthesizing result", status: "running", timestamp: new Date().toISOString() });
      // Loop ends, we have a final text response
      const textContent = response.content.find((c: unknown) => (c as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
      return {
        agentMessage: textContent?.type === "text" ? String(textContent.text) : "I have completed the request.",
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
        if (toolName === "get_signals") label = "Searching tokens";
        if (toolName === "scan_token") label = `Scanning ${toolInput.symbol || "token"} risk`;
        if (toolName === "search_token") label = "Searching token";
        if (toolName === "get_swap_quote") label = "Checking quote";
        
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
            result = await toolDef.execute(toolInput, { conversationId });
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
          chatState = "WAITING_FOR_CONFIRMATION";
          const approvalId = createApproval(String(quoteResultData.toAddress), String(quoteBlockInput!.chain), Number(quoteResultData.amount), 3);
          pipelineData = {
            type: "quote",
            quote: quoteResultData.quote,
            fromSymbol: quoteResultData.fromSymbol,
            toSymbol: quoteResultData.toAddress,
            amount: quoteResultData.amount,
            scanDecision: quoteResultData.scanDecision,
            source: (quoteResultData.meta as Record<string, unknown>)?.source,
            approvalId
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

// ─── Fallbacks ───────────────────────────────────────────────────────────────

function fallbackThesisParser(thesis: string): ThesisIntent {
  const lower = thesis.toLowerCase();
  return ThesisIntentSchema.parse({
    timeframe: "1h",
    maxBudgetUsd: lower.includes("100") ? 100 : 50,
    maxTokens: 5,
    riskMode: lower.includes("degen") ? "degen" : "conservative",
    chain: "x-layer",
    fallbackChain: "base",
    requireSimulation: true,
    requireUserApproval: true,
    slippageLimitPercent: 2,
  });
}

function fallbackAgentParser(message: string, chainHint?: string): AgentRunResult {
  const intent = parseTradeIntent(message);
  
  return {
    agentMessage: "I am running in deterministic fallback mode due to missing API keys.",
    action: intent.intentType === "swap" || intent.intentType === "quote" ? "swap_quote" : "ask_clarification",
    chatState: "WALLET_CONNECTED",
    toolCallsLog: [{ fallback: true, message: "No API key found, used deterministic parser.", chainHint }]
  };
}
