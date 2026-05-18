import { z } from "zod";

export interface SourceMeta {
  /** okx_real = live CLI data, okx_real_failed = real mode CLI error, execution_disabled = live execution off by config */
  source: "okx_real" | "okx_real_failed" | "execution_disabled";
  provider: string;
  chainIndex: string;
  chainName: string;
  chainSlug: string;
  timestamp: string;
}

// P0 Phase 9: Server-side hard cap for budget — LLM output cannot exceed this
const getServerHardCap = () => Math.max(1, parseFloat(process.env.MAX_TRADE_USD_HARD_CAP || "1"));

export const ThesisIntentSchema = z.object({
  timeframe: z.string().default("1h"),
  maxBudgetUsd: z.number().max(SERVER_HARD_CAP, { message: `maxBudgetUsd cannot exceed server hard cap of $${SERVER_HARD_CAP}` }).default(50),
  maxTokens: z.number().default(5),
  // P0 Phase 9: riskMode from LLM is accepted by Zod but ALWAYS overridden server-side
  riskMode: z.enum(["conservative", "moderate", "degen"]).default("conservative"),
  chain: z.string().default("x-layer"),
  fallbackChain: z.string().default("base"),
  requireSimulation: z.boolean().default(true),
  requireUserApproval: z.boolean().default(true),
  slippageLimitPercent: z.number().default(2)
});

export type ThesisIntent = z.infer<typeof ThesisIntentSchema>;

export interface TokenSignal {
  symbol: string;
  address: string;
  amountUsd: number;
  triggerCount: number;
  price: string;
  source: string;
  /** pending = not yet scanned, safe = cleared, high_risk = blocked, skipped = skipped by risk mode, unknown = scan returned no data (watchlist) */
  riskStatus?: "pending" | "safe" | "high_risk" | "skipped" | "unknown";
}

export interface TradePlan {
  tokens: TokenSignal[];
}

export interface Approval {
  id: string;
  tokenAddress: string;
  chain: string;
  walletAddress?: string;
  /** Human-readable source-token amount, e.g. 1.25 WETH. Used to build swap calldata. */
  fromAmount: number;
  /** USD value of fromAmount. Used only for risk policy and hard-cap checks. */
  fromAmountUsd: number;
  /** Backward-compatible alias. Treat as USD only; do not use as source-token amount. */
  budgetUsd: number;
  slippageLimitPercent: number;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  fromToken?: string;
  routerAddress?: string;
  needsApproval?: boolean;
  approveAmount?: string;
  spender?: string;
}

export interface SimulationResult {
  success: boolean;
  expectedOutputUsd: number;
  slippage: number;
  gasFeeUsd: number;
  route: string;
}

export interface ExecutionResult {
  txHash: string;
  status: string;
  requestedAddress: string;
  requestedAmountUsd: number;
}
