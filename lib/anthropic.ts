import { Anthropic } from "@anthropic-ai/sdk";
import { ThesisIntent, ThesisIntentSchema } from "./schemas";
import { parseTradeIntent } from "./trade-intent-parser";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Use Claude 4.5 Sonnet for flagship reasoning in production.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

// ─── Agent Tool Call Schema ───────────────────────────────────────────────────

export interface AgentToolCall {
  intent: "signal_discovery" | "token_risk_scan" | "swap_quote" | "explain_result" | "clarification_needed" | "unsupported_request";
  chain?: string;
  fromSymbol?: string;
  toSymbol?: string;
  amount?: string;
  needsClarification: boolean;
  clarifyingQuestion?: string;
  explanation: string;
  safetyNotes: string[];
}

// ─── PhylaX Persona ───────────────────────────────────────────────────────────

const PHYLAX_PERSONA = `
You are PhylaX, a risk-first on-chain trading assistant.
Your goal is to help users scan tokens for risk, find opportunities, and prepare secure trades on X Layer.

Persona Guidelines:
- Tone: Direct, helpful, security-conscious, professional.
- Risk-First: Always emphasize risk scans and security checks.
- Non-Custodial: You never trade for the user. Every transaction requires their explicit wallet signature.
- Safety: Never claim "guaranteed profit" or that a token is "100% safe/risk-free". Use terms like "lower risk" or "passed security checks".
- Clarity: Explain what you are doing (e.g., "I'm scanning this token for honeypot risks...").
- Concise: Keep explanations short and actionable.
`;

// ─── Parsing Functions ────────────────────────────────────────────────────────

export async function parseThesis(thesis: string): Promise<ThesisIntent> {
  if (!anthropic) {
    console.log("No ANTHROPIC_API_KEY found. Using fallback parser.");
    return fallbackThesisParser(thesis);
  }

  try {
    const prompt = `
${PHYLAX_PERSONA}
Extract the trading intent from the user's thesis.
The output must be ONLY valid JSON matching this schema:
{
  "timeframe": "string",
  "maxBudgetUsd": number,
  "maxTokens": number,
  "riskMode": "conservative" | "moderate" | "degen",
  "chain": "string (default: xlayer)",
  "fallbackChain": "string",
  "requireSimulation": true,
  "requireUserApproval": true,
  "slippageLimitPercent": number
}

User thesis: "${thesis}"
`;

    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return ThesisIntentSchema.parse(JSON.parse(jsonMatch[0]));
  } catch (error) {
    console.error("Thesis parsing failed:", error);
    return fallbackThesisParser(thesis);
  }
}

/**
 * Parses user chat message into structured agent tool calls.
 * This is the "brain" of the PhylaX chat experience.
 */
export async function parseAgentToolCall(
  message: string, 
  chainHint?: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<AgentToolCall> {
  if (!anthropic) {
    return fallbackAgentParser(message, chainHint);
  }

  try {
    const systemPrompt = `
${PHYLAX_PERSONA}

Classify the user message into one of these intents:
- signal_discovery: User wants to find tokens or see trending signals.
- token_risk_scan: User wants to check a specific token address or symbol for risk.
- swap_quote: User wants to trade, buy, sell, or get a quote.
- explain_result: User asks for an explanation of a result or risk.
- clarification_needed: The request is ambiguous or missing key info.
- unsupported_request: Request for auto-trading, signing, or anything outside of PhylaX's capabilities.

Output ONLY valid JSON matching this schema:
{
  "intent": "intent_name",
  "chain": "string (default: xlayer)",
  "fromSymbol": "string (e.g. USDC)",
  "toSymbol": "string (the target token)",
  "amount": "string (the number)",
  "needsClarification": boolean,
  "clarifyingQuestion": "string or null",
  "explanation": "Brief user-facing explanation of what you will do",
  "safetyNotes": ["note 1", "note 2"]
}

${chainHint ? `Context: The user has selected ${chainHint} in their UI. Use this as the default chain if no other chain is mentioned.` : ""}
`;

    // Limit history to last 10 messages for token efficiency
    const limitedHistory = history.slice(-10);
    const messages: Anthropic.MessageParam[] = [
      ...limitedHistory.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];

    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      temperature: 0,
      system: systemPrompt,
      messages: messages
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]) as AgentToolCall;
  } catch (error) {
    console.error("Agent parsing failed:", error);
    return fallbackAgentParser(message);
  }
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

function fallbackAgentParser(message: string, chainHint?: string): AgentToolCall {
  const intent = parseTradeIntent(message);
  
  let action: AgentToolCall["intent"] = "clarification_needed";
  if (intent.intentType === "swap") action = "swap_quote";
  else if (intent.intentType === "quote") action = "swap_quote";
  else if (intent.intentType === "scan") action = "token_risk_scan";
  
  return {
    intent: action,
    chain: intent.chain ?? chainHint ?? "xlayer",
    fromSymbol: intent.fromToken ?? "USDC",
    toSymbol: intent.toToken ?? undefined,
    amount: intent.amount?.toString() ?? intent.amountUsd?.toString() ?? undefined,
    needsClarification: intent.needsClarification,
    clarifyingQuestion: intent.clarificationQuestion ?? undefined,
    explanation: "I'll help you with that request using my secure trading pipeline.",
    safetyNotes: ["Deterministic fallback active"],
  };
}
