import { getSignals, scanToken, searchToken, getQuotePreflight } from "../okx";
import { determineRiskAction } from "../risk-scoring";
import { normalizeChain } from "../chains";

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  validate?: (input: T) => void | string;
  execute: (input: T, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  conversationId: string;
  walletAddress?: string;
  // Can add more context like user id if needed
}

export const registry = new Map<string, ToolDefinition>();

export function registerTool<T>(tool: ToolDefinition<T>) {
  registry.set(tool.name, tool as ToolDefinition<unknown>);
}

// 1. get_signals
registerTool({
  name: "get_signals",
  description: "Get trending or high-potential token signals on a specific chain.",
  input_schema: {
    type: "object",
    properties: {
      chain: { type: "string", description: "Chain to get signals for, e.g. x-layer or base" },
      max_tokens: { type: "number", description: "Maximum number of tokens to return" },
    },
    required: ["chain"],
  },
  execute: async (input: { chain: string; max_tokens?: number }) => {
    try {
      const chainConfig = normalizeChain(input.chain || "x-layer");
      const maxTokens = input.max_tokens || 5;
      const { signals, meta } = await getSignals(chainConfig.id, maxTokens);
      return { signals, meta };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});

// 2. scan_token
registerTool({
  name: "scan_token",
  description: "Scan a token for security risks (e.g. honeypot, rugged). Must use address.",
  input_schema: {
    type: "object",
    properties: {
      address: { type: "string", description: "Token contract address (0x...)" },
      chain: { type: "string", description: "Chain the token is on" },
      risk_mode: { type: "string", description: "User's risk tolerance (conservative, moderate, degen)" },
    },
    required: ["address", "chain"],
  },
  execute: async (input: { address: string; chain: string; risk_mode?: string }) => {
    try {
      const chainConfig = normalizeChain(input.chain);
      const scanResult = await scanToken(input.address, chainConfig.id);
      const riskMode = (input.risk_mode || "conservative") as "conservative" | "moderate" | "degen";
      const action = determineRiskAction(scanResult.decision, riskMode);
      return {
        address: input.address,
        chain: chainConfig.id,
        action,
        riskLevel: scanResult.riskLevel,
        isHoneypot: scanResult.isHoneypot,
        executionAllowed: scanResult.executionAllowed,
        triggeredLabels: scanResult.triggeredLabels,
        meta: scanResult.meta,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});

// 3. search_token
registerTool({
  name: "search_token",
  description: "Search for a token by symbol to get its contract address.",
  input_schema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Token symbol (e.g. USDC, OKB)" },
      chain: { type: "string", description: "Chain to search on" },
    },
    required: ["symbol", "chain"],
  },
  execute: async (input: { symbol: string; chain: string }) => {
    try {
      const chainConfig = normalizeChain(input.chain);
      const results = await searchToken(input.symbol, chainConfig.id);
      return { results };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});

// 4. get_swap_quote
registerTool({
  name: "get_swap_quote",
  description: "Get a swap quote to exchange tokens. Will perform a security scan first and block if high risk.",
  input_schema: {
    type: "object",
    properties: {
      to_address: { type: "string", description: "Target token contract address (0x...)" },
      from_symbol: { type: "string", description: "Source token symbol (e.g. USDC)" },
      amount: { type: "number", description: "Amount of from_symbol to swap" },
      chain: { type: "string", description: "Chain for the swap" },
      slippage: { type: "number", description: "Slippage tolerance in percent (e.g. 3)" },
      risk_mode: { type: "string", description: "Risk mode: conservative, moderate, degen" },
    },
    required: ["to_address", "amount", "chain"],
  },
  execute: async (input: { to_address: string; from_symbol?: string; amount: number; chain: string, slippage?: number, risk_mode?: string }) => {
    let chainConfig;
    try {
      chainConfig = normalizeChain(input.chain);
    } catch (err: any) {
      return { error: err.message, blocked: true };
    }
    const chain = chainConfig.id;
    const amount = input.amount;
    const fromSymbol = input.from_symbol || chainConfig.defaultFromSymbol;

    // Enforce scan before quote
    let scanDecision: "safe" | "high_risk" | "unknown" | "skipped" = "safe";
    try {
      const scanResult = await scanToken(input.to_address, chain);
      const riskMode = (input.risk_mode || "conservative") as "conservative" | "moderate" | "degen";
      scanDecision = determineRiskAction(scanResult.decision, riskMode);

      if (scanDecision === "high_risk") {
        return {
          error: "High risk token detected. Quote blocked for security.",
          blocked: true,
          scanResult: {
            riskLevel: scanResult.riskLevel,
            triggeredLabels: scanResult.triggeredLabels,
            meta: scanResult.meta
          }
        };
      }
    } catch {
      scanDecision = "skipped";
    }

    const quoteResult = await getQuotePreflight(input.to_address, amount, chain, undefined, fromSymbol.toUpperCase());
    return {
      quote: quoteResult.quote,
      fromSymbol: quoteResult.fromSymbol,
      toSymbol: quoteResult.toSymbol,
      toAddress: input.to_address,
      amount,
      chain,
      slippage: input.slippage,
      riskMode: input.risk_mode,
      scanDecision,
      meta: quoteResult.meta
    };
  },
});

// 5. market_structure_check
import { checkMarketStructure } from "../market-structure";

registerTool({
  name: "market_structure_check",
  description: "Check market structure, smart money, and derivatives positioning for a specific token.",
  input_schema: {
    type: "object",
    properties: {
      symbols: { type: "array", items: { type: "string" }, description: "Array of token symbols to check (e.g. ['BTC', 'ETH'])" },
      depth: { type: "string", description: "'quick' or 'full'. Defaults to 'quick'." },
    },
    required: ["symbols"],
  },
  execute: async (input: { symbols: string[]; depth?: string }) => {
    const results = await checkMarketStructure(input.symbols);
    return { results, depth: input.depth || "quick" };
  },
});

export function getToolsForAnthropic() {
  return Array.from(registry.values()).map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}
