import { Anthropic } from "@anthropic-ai/sdk";
import { ThesisIntent, ThesisIntentSchema } from "./schemas";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function parseThesis(thesis: string): Promise<ThesisIntent> {
  if (!anthropic) {
    console.log("No ANTHROPIC_API_KEY found. Using fallback parser.");
    return fallbackParser(thesis);
  }

  try {
    const prompt = `
You are a DeFi intent parser for PhylaX, a risk-first trading agent.
Extract the trading intent from the user's thesis.

The output must be ONLY valid JSON matching this schema:
{
  "timeframe": "string (e.g. 1h, 1d)",
  "maxBudgetUsd": number (max 50 by default),
  "maxTokens": number (max 5 by default),
  "riskMode": "conservative" | "moderate" | "degen",
  "chain": "string (default: x-layer)",
  "fallbackChain": "string (default: base)",
  "requireSimulation": boolean,
  "requireUserApproval": boolean,
  "slippageLimitPercent": number (default 2)
}

If a value is not specified, use a reasonable safe default. Always require simulation and approval.

User thesis: "${thesis}"
`;

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", // Fast and cheap for parsing
      max_tokens: 1000,
      temperature: 0,
      messages: [
        { role: "user", content: prompt }
      ]
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from Anthropic response");
    }

    const parsedData = JSON.parse(jsonMatch[0]);
    return ThesisIntentSchema.parse(parsedData);
  } catch (error) {
    console.error("Anthropic parsing failed, falling back:", error);
    return fallbackParser(thesis);
  }
}

function fallbackParser(thesis: string): ThesisIntent {
  const lowerThesis = thesis.toLowerCase();
  
  let riskMode: "conservative" | "moderate" | "degen" = "conservative";
  if (lowerThesis.includes("degen") || lowerThesis.includes("high risk")) riskMode = "degen";
  else if (lowerThesis.includes("moderate")) riskMode = "moderate";

  let maxBudgetUsd = 50;
  const budgetMatch = thesis.match(/\$?(\d+)/);
  if (budgetMatch && budgetMatch[1]) {
    maxBudgetUsd = Math.min(parseInt(budgetMatch[1], 10), 50); // Enforce max $50
  }

  return ThesisIntentSchema.parse({
    timeframe: "1h",
    maxBudgetUsd,
    maxTokens: 5,
    riskMode,
    chain: "x-layer",
    fallbackChain: "base",
    requireSimulation: true,
    requireUserApproval: true,
    slippageLimitPercent: 2,
  });
}
