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
      
      // Block ambiguous symbols
      if (results.length > 1) {
        return { 
          error: "Symbol is ambiguous. Multiple tokens found. Please ask the user to provide the exact contract address to proceed securely.", 
          blocked: true,
          candidates: results 
        };
      }

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
      from_address: { type: "string", description: "Source token contract address (0x...), leave undefined to use default" },
      from_symbol: { type: "string", description: "Source token symbol (e.g. USDC)" },
      amount: { type: "number", description: "Amount of fromToken to swap" },
      chain: { type: "string", description: "Chain for the swap" },
      slippage: { type: "number", description: "Slippage tolerance in percent (e.g. 3)" },
      risk_mode: { type: "string", description: "Risk mode: conservative, moderate, degen" },
    },
    required: ["to_address", "amount", "chain"],
  },
  execute: async (input: { to_address: string; from_address?: string; from_symbol?: string; amount: number; chain: string, slippage?: number, risk_mode?: string }, context?: ToolContext) => {
    let chainConfig;
    try {
      chainConfig = normalizeChain(input.chain);
    } catch (err: any) {
      return { error: err.message, blocked: true };
    }

    if (chainConfig.id !== "x-layer") {
      return {
        error: `Execution for ${chainConfig.name} is Coming Soon. Switch to X Layer to proceed.`,
        blocked: true
      };
    }
    const chain = chainConfig.id;
    const amount = input.amount;
    const fromSymbol = input.from_symbol || chainConfig.defaultFromSymbol;
    const fromAddress = input.from_address || chainConfig.defaultFromToken;

    if (!context?.walletAddress) {
      return {
        error: "Verified wallet address is required for execution. Please connect your wallet.",
        blocked: true
      };
    }

    const { checkBalance } = await import("../okx");
    const balanceCheck = await checkBalance(chain, context.walletAddress, fromAddress, amount);
    if (!balanceCheck.hasSufficient) {
      return {
        error: `Insufficient balance: verified wallet has ${balanceCheck.balance} ${fromSymbol}. Reduce amount or top up.`,
        blocked: true
      };
    }

    // Enforce scan before quote
    let scanDecision: "safe" | "high_risk" | "unknown" | "skipped" = "safe";
    try {
      const scanResultTo = await scanToken(input.to_address, chain);
      const scanResultFrom = await scanToken(fromAddress, chain);
      
      if (scanResultTo.decision === "unknown" || scanResultFrom.decision === "unknown") {
        return {
          error: "Token safety scan unavailable. Quote blocked for security.",
          blocked: true
        };
      }

      if (!scanResultTo.executionAllowed || scanResultTo.isHoneypot || !scanResultFrom.executionAllowed || scanResultFrom.isHoneypot) {
        return {
          error: "High risk or honeypot token detected. Quote blocked for security.",
          blocked: true,
          scanResultTo: {
            riskLevel: scanResultTo.riskLevel,
            triggeredLabels: scanResultTo.triggeredLabels,
            meta: scanResultTo.meta
          },
          scanResultFrom: {
            riskLevel: scanResultFrom.riskLevel,
            triggeredLabels: scanResultFrom.triggeredLabels,
            meta: scanResultFrom.meta
          }
        };
      }

      const riskMode = (input.risk_mode || "conservative") as "conservative" | "moderate" | "degen";
      const decisionTo = determineRiskAction(scanResultTo.decision, riskMode);
      const decisionFrom = determineRiskAction(scanResultFrom.decision, riskMode);

      if (decisionTo === "skipped" || decisionFrom === "skipped") {
        return {
          error: "Token risk exceeds current risk mode tolerance. Quote blocked.",
          blocked: true,
        };
      }
      scanDecision = decisionTo === "high_risk" || decisionFrom === "high_risk" ? "high_risk" : "safe";
    } catch (err) {
      return {
        error: "Token safety scan unavailable. Quote blocked for security.",
        blocked: true
      };
    }

    try {
      const quoteResult = await getQuotePreflight(input.to_address, amount, chain, fromAddress, fromSymbol.toUpperCase());
      
      const SERVER_HARD_CAP = Math.max(1, parseFloat(process.env.MAX_TRADE_USD_HARD_CAP || "100"));
      if (quoteResult.fromAmountUsd > SERVER_HARD_CAP) {
        return {
          error: `Requested amount ($${quoteResult.fromAmountUsd.toFixed(2)}) exceeds server hard cap ($${SERVER_HARD_CAP}). Quote blocked.`,
          blocked: true
        };
      }

      return {
        quote: quoteResult.quote,
        fromToken: quoteResult.fromToken,
        fromSymbol: quoteResult.fromSymbol,
        fromAmountUsd: quoteResult.fromAmountUsd,
        toSymbol: quoteResult.toSymbol,
        toAddress: input.to_address,
        amount,
        chain,
        slippage: input.slippage,
        riskMode: input.risk_mode,
        scanDecision,
        meta: quoteResult.meta
      };
    } catch (err: any) {
      return { error: err.message, blocked: true };
    }
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
