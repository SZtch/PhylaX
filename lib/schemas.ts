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

export const ThesisIntentSchema = z.object({
  timeframe: z.string().default("1h"),
  maxBudgetUsd: z.number().default(50),
  maxTokens: z.number().default(5),
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
  budgetUsd: number;
  slippageLimitPercent: number;
  createdAt: number;
  expiresAt: number;
  used: boolean;
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
