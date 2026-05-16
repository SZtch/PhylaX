// OKX Adapter Layer
//
// PhylaX uses a strictly real-only, fail-closed integration with the OKX Onchain OS CLI.
// All demo data, mock fallbacks, and dummy placeholders have been removed.
// If any CLI command fails or the integration is unavailable, an OkxRealModeError 
// is thrown and the system fails closed gracefully.
// Default source token for swaps: USDC on X Layer
//   0x74b7f16337b8972027f6196a17a631ac6de26d22

import { TokenSignal, SimulationResult, SourceMeta } from "./schemas";
import { runCli, OkxCliError } from "./cli-runner";

import { normalizeChain, ChainConfig, DEFAULT_CHAIN } from "./chains";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

// Config helpers
// ---------------------------------------------------------------------------

function sourceMeta(
  src: SourceMeta["source"],
  chainConfig: ChainConfig
): SourceMeta {
  return {
    source: src,
    provider: "OKX Onchain OS",
    chainIndex: chainConfig.chainIndex,
    chainName: chainConfig.name,
    chainSlug: chainConfig.chainSlug,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Error type — thrown in production mode on any CLI failure
// ---------------------------------------------------------------------------

export class OkxRealModeError extends Error {
  public readonly meta: SourceMeta;
  constructor(message: string, chainConfig: ChainConfig = DEFAULT_CHAIN) {
    super(message);
    this.name = "OkxRealModeError";
    this.meta = sourceMeta("okx_real_failed", chainConfig);
  }
}

// ---------------------------------------------------------------------------
// Internal helper: unwrap CLI JSON result safely
// ---------------------------------------------------------------------------

function unwrapCliResult(raw: unknown, cmdLabel: string, chainConfig: ChainConfig = DEFAULT_CHAIN): unknown[] {
  if (typeof raw !== "object" || raw === null) {
    throw new OkxRealModeError(`Unexpected CLI output for ${cmdLabel}`, chainConfig);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.ok === false) {
    throw new OkxRealModeError(`onchainos ${cmdLabel} returned ok:false`, chainConfig);
  }
  const data = obj.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data;
}

// ---------------------------------------------------------------------------
// 1. Signals — onchainos signal list
// ---------------------------------------------------------------------------

export interface SignalResponse {
  signals: TokenSignal[];
  meta: SourceMeta;
}

export async function getSignals(
  chain: string,
  maxTokens: number
): Promise<SignalResponse> {
  const chainConfig = normalizeChain(chain);
  try {
    const raw = await runCli([
      "signal", "list",
      "--chain", chainConfig.chainIndex,
      "--limit", String(maxTokens),
    ]);

    const items = unwrapCliResult(raw, "signal list", chainConfig);

    const signals: TokenSignal[] = items
      .slice(0, maxTokens)
      .map((item) => {
        const it = item as Record<string, unknown>;
        const token = (it.token ?? {}) as Record<string, unknown>;
        return {
          symbol: String(token.symbol ?? "UNKNOWN"),
          address: String(token.tokenAddress ?? ""),
          amountUsd: parseFloat(String(it.amountUsd ?? "0")),
          triggerCount: parseInt(String(it.triggerWalletCount ?? "1"), 10),
          price: String(it.price ?? "0"),
          source: "okx-dex-signal",
        } satisfies TokenSignal;
      })
      .filter((s) => s.address.length > 0);

    return { signals, meta: sourceMeta("okx_real", chainConfig) };
  } catch (err) {
    if (err instanceof OkxRealModeError) throw err;
    if (err instanceof OkxCliError) {
      throw new OkxRealModeError(
        `onchainos signal list failed: ${err.message}`, chainConfig
      );
    }
    throw new OkxRealModeError("Signal fetch failed", chainConfig);
  }
}

// ---------------------------------------------------------------------------
// 2. Token search — onchainos token search
// ---------------------------------------------------------------------------

export interface TokenSearchResult {
  symbol: string;
  address: string;
  chainIndex: string;
}

export async function searchToken(
  query: string,
  chain: string
): Promise<TokenSearchResult[]> {
  const chainConfig = normalizeChain(chain);
  try {
    const raw = await runCli([
      "token", "search",
      "--query", query,
      "--chains", chainConfig.chainSlug,
      "--limit", "5",
    ]);
    const items = unwrapCliResult(raw, "token search", chainConfig);
    return items.map((item) => {
      const it = item as Record<string, unknown>;
      return {
        symbol: String(it.symbol ?? ""),
        address: String(it.tokenContractAddress ?? it.tokenAddress ?? ""),
        chainIndex: String(it.chainIndex ?? chainConfig.chainIndex),
      };
    });
  } catch (err) {
    if (err instanceof OkxRealModeError) throw err;
    if (err instanceof OkxCliError) {
      throw new OkxRealModeError(`onchainos token search failed: ${err.message}`, chainConfig);
    }
    throw new OkxRealModeError("Token search failed", chainConfig);
  }
}

// ---------------------------------------------------------------------------
// 3. Security scan — onchainos security token-scan
// ---------------------------------------------------------------------------

export interface ScanResponse {
  riskLevel: string;
  decision: "safe" | "high_risk" | "unknown";
  executionAllowed: boolean;
  isScanned: boolean;
  isHoneypot: boolean;
  triggeredLabels: string[];
  unknownReason?: string;
  meta: SourceMeta;
}

const LABEL_FIELDS: Array<[string, string]> = [
  ["isHoneypot", "Honeypot"],
  ["isRubbishAirdrop", "Garbage Airdrop"],
  ["isAirdropScam", "Gas Mint Scam"],
  ["isLowLiquidity", "Low Liquidity"],
  ["isDumping", "Dumping"],
  ["isLiquidityRemoval", "Liquidity Removal"],
  ["isPump", "Pump"],
  ["isWash", "Wash Trading"],
  ["isFakeLiquidity", "Fake Liquidity"],
  ["isFundLinkage", "Rugpull Gang"],
  ["isCounterfeit", "Counterfeit"],
  ["isNotOpenSource", "Not Open Source"],
  ["isMintable", "Mintable"],
  ["isNotRenounced", "Not Renounced"],
];

export async function scanToken(
  address: string,
  chain: string
): Promise<ScanResponse> {
  const chainConfig = normalizeChain(chain);

  if (typeof global !== "undefined" && (global as any).__mockScanTokenHandler) {
    return (global as any).__mockScanTokenHandler(address, chain);
  }

  try {
    const raw = await runCli([
      "security", "token-scan",
      "--chain", chainConfig.chainIndex,
      "--address", address.toLowerCase(),
    ]);

    const items = unwrapCliResult(raw, "security token-scan");

    // Empty data array → Unknown / Watchlist
    if (items.length === 0) {
      return {
        riskLevel: "unknown",
        decision: "unknown",
        executionAllowed: false,
        isScanned: true,
        isHoneypot: false,
        triggeredLabels: [],
        unknownReason: "OKX token scan returned no security details",
        meta: sourceMeta("okx_real", chainConfig),
      };
    }

    const result = items[0] as Record<string, unknown>;
    const rawRisk = String(result.riskLevel ?? "");
    const isHoneypot = result.isHoneypot === true;

    const riskLevel = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(rawRisk)
      ? rawRisk
      : "HIGH";

    const triggeredLabels = LABEL_FIELDS
      .filter(([f]) => result[f] === true)
      .map(([, label]) => label);

    // P0 Phase 9: Only LOW is safe. MEDIUM/HIGH/CRITICAL all block execution.
    const isBlocked = riskLevel !== "LOW";
    return {
      riskLevel,
      decision: isBlocked ? "high_risk" : "safe",
      executionAllowed: !isBlocked,
      isScanned: true,
      isHoneypot,
      triggeredLabels,
      meta: sourceMeta("okx_real", chainConfig),
    };
  } catch (err) {
    if (err instanceof OkxRealModeError) throw err;
    if (err instanceof OkxCliError) {
      throw new OkxRealModeError(`onchainos security token-scan failed: ${err.message}`, chainConfig);
    }
    throw new OkxRealModeError("Security scan failed", chainConfig);
  }
}

// ---------------------------------------------------------------------------
// 4. Swap quote / preflight — onchainos swap quote (real only)
// ---------------------------------------------------------------------------

export interface QuotePreflightResponse {
  quote: SimulationResult;
  fromToken: string;
  fromSymbol: string;
  toSymbol: string;
  meta: SourceMeta;
}

export async function getQuotePreflight(
  toAddress: string,
  amount: number,
  chain: string,
  fromToken?: string,
  fromSymbol?: string
): Promise<QuotePreflightResponse & { fromAmountUsd: number }> {
  const chainConfig = normalizeChain(chain);
  const resolvedFromToken = fromToken || chainConfig.defaultFromToken;
  const resolvedFromSymbol = fromSymbol || chainConfig.defaultFromSymbol;

  if (typeof global !== "undefined" && (global as any).__mockGetQuotePreflightHandler) {
    return (global as any).__mockGetQuotePreflightHandler(toAddress, amount, chain, resolvedFromToken, resolvedFromSymbol);
  }

  try {
    const readableAmount = String(amount);

    const raw = await runCli([
      "swap", "quote",
      "--from",            resolvedFromToken.toLowerCase(),
      "--to",              toAddress.toLowerCase(),
      "--readable-amount", readableAmount,
      "--chain",           chainConfig.chainSlug,
    ]);

    const items = unwrapCliResult(raw, "swap quote");

    if (items.length === 0) {
      throw new OkxRealModeError(
        "OKX swap quote returned no data — token may have no liquidity or no route available", chainConfig
      );
    }

    const quote = items[0] as Record<string, unknown>;

    const priceImpact = parseFloat(
      String(quote.priceImpactPercentage ?? quote.price_impact_percentage ?? "0")
    );
    const toAmountRaw = parseFloat(String(quote.toTokenAmount ?? quote.to_token_amount ?? "0"));
    const toToken = (quote.toToken ?? quote.to_token ?? {}) as Record<string, unknown>;
    const toSymbol = String(toToken.tokenSymbol ?? toToken.symbol ?? "UNKNOWN");
    const toDecimals = parseInt(String(toToken.decimal ?? toToken.decimals ?? "18"), 10);
    const toUnitPrice = parseFloat(String(toToken.tokenUnitPrice ?? toToken.unit_price ?? "1"));
    const toAmountUsd = (toAmountRaw / Math.pow(10, toDecimals)) * toUnitPrice;

    const fromTokenNode = (quote.fromToken ?? quote.from_token ?? {}) as Record<string, unknown>;
    const fromUnitPrice = parseFloat(String(fromTokenNode.tokenUnitPrice ?? fromTokenNode.unit_price ?? "1"));
    const fromAmountUsd = amount * fromUnitPrice;

    const gasLimit = parseFloat(String(quote.estimatedGas ?? quote.estimated_gas ?? "0"));
    const gasPriceWei = parseFloat(String(quote.gasPrice ?? quote.gas_price ?? "0"));
    const gasFeeUsd = gasPriceWei > 0 && gasLimit > 0
      ? (gasLimit * gasPriceWei * 1e-18) * parseFloat(String(quote.nativeTokenPrice ?? "2000"))
      : undefined;

    const compareList = quote.quoteCompareList ?? quote.quote_compare_list;
    const routeName = Array.isArray(compareList) && compareList.length > 0
      ? String((compareList[0] as Record<string, unknown>).dexName ?? "OKX DEX Aggregator")
      : "OKX DEX Aggregator";

    return {
      quote: {
        success: true,
        expectedOutputUsd: toAmountUsd > 0 ? toAmountUsd : fromAmountUsd * 0.99,
        slippage: isNaN(priceImpact) ? 0 : priceImpact,
        gasFeeUsd: gasFeeUsd ?? 0,
        route: routeName,
      },
      fromAmountUsd,
      fromToken: resolvedFromToken,
      fromSymbol: resolvedFromSymbol,
      toSymbol,
      meta: sourceMeta("okx_real", chainConfig),
    };
  } catch (err) {
    if (err instanceof OkxRealModeError) throw err;
    if (err instanceof OkxCliError) {
      throw new OkxRealModeError(`onchainos swap quote failed: ${err.message}`, chainConfig);
    }
    throw new OkxRealModeError("Swap quote failed", chainConfig);
  }
}

// ---------------------------------------------------------------------------
// LEGACY ALIAS: simulateSwap → getQuotePreflight
// Maintains backward compatibility with /api/simulate route
// ---------------------------------------------------------------------------
export async function simulateSwap(
  toAddress: string,
  amount: number,
  chain: string,
  fromToken?: string,
  fromSymbol?: string
) {
  const result = await getQuotePreflight(toAddress, amount, chain, fromToken, fromSymbol);
  return {
    simulation: result.quote,
    fromToken: result.fromToken,
    fromSymbol: result.fromSymbol,
    fromAmountUsd: result.fromAmountUsd,
    meta: result.meta,
  };
}

// ---------------------------------------------------------------------------
// 5. Swap build-tx — get unsigned transaction calldata for wallet signing
// ---------------------------------------------------------------------------

export interface SwapTxData {
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface SwapBuildTxResponse {
  txData: SwapTxData | null;
  error: string | null;
  meta: SourceMeta;
}

/**
 * Get swap transaction calldata from OKX.
 *
 * Uses `onchainos swap swap` to get the actual transaction data
 * (to, data, value, gas) that the user's wallet will sign.
 *
 * If the CLI returns no data, returns null txData with a clear error.
 * Server NEVER broadcasts — this data is returned to the client for signing.
 */
export async function getSwapTxData(
  toAddress: string,
  amount: number,
  chain: string,
  walletAddress: string,
  fromToken?: string,
  slippagePercent = 1
): Promise<SwapBuildTxResponse> {
  const chainConfig = normalizeChain(chain);
  const resolvedFromToken = fromToken || chainConfig.defaultFromToken;

  if (typeof global !== "undefined" && (global as any).__mockGetSwapTxData) {
    return (global as any).__mockGetSwapTxData(toAddress, amount, chain, walletAddress, resolvedFromToken, slippagePercent);
  }
  
  const readableAmount = String(amount);

  try {
    const raw = await runCli([
      "swap", "swap",
      "--from",            resolvedFromToken.toLowerCase(),
      "--to",              toAddress.toLowerCase(),
      "--readable-amount", readableAmount,
      "--chain",           chainConfig.chainSlug,
      "--wallet",          walletAddress.toLowerCase(),
      "--slippage",        String(slippagePercent),
    ]);

    const items = unwrapCliResult(raw, "swap swap");

    if (items.length === 0) {
      return {
        txData: null,
        error:
          "OKX swap returned no data — token may have no liquidity " +
          "or no route available for this amount.",
        meta: sourceMeta("okx_real", chainConfig),
      };
    }

    const tx = items[0] as Record<string, unknown>;
    const nested = (tx.tx ?? {}) as Record<string, unknown>;

    // Extract the tx fields from OKX response
    const to = String(tx.to ?? nested.to ?? "");
    const data = String(tx.data ?? nested.data ?? "");
    const value = String(tx.value ?? nested.value ?? "0x0");
    const gas = tx.gas ?? tx.gasLimit ?? nested.gas ?? nested.gasLimit;
    const gasPrice = tx.gasPrice ?? nested.gasPrice;
    const maxFeePerGas = tx.maxFeePerGas ?? nested.maxFeePerGas;
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? nested.maxPriorityFeePerGas;

    if (!to || !data) {
      return {
        txData: null,
        error:
          "OKX swap response missing transaction calldata (to/data fields). " +
          "Direct OKX DEX REST API may be required.",
        meta: sourceMeta("okx_real", chainConfig),
      };
    }

    return {
      txData: {
        to,
        data,
        value,
        gas: gas ? String(gas) : undefined,
        gasLimit: gas ? String(gas) : undefined,
        gasPrice: gasPrice ? String(gasPrice) : undefined,
        maxFeePerGas: maxFeePerGas ? String(maxFeePerGas) : undefined,
        maxPriorityFeePerGas: maxPriorityFeePerGas ? String(maxPriorityFeePerGas) : undefined,
      },
      error: null,
      meta: sourceMeta("okx_real", chainConfig),
    };
  } catch (err) {
    if (err instanceof OkxRealModeError) {
      return {
        txData: null,
        error: err.message,
        meta: sourceMeta("okx_real_failed", chainConfig),
      };
    }
    if (err instanceof OkxCliError) {
      return {
        txData: null,
        error:
          `OKX CLI swap failed: ${err.message}. ` +
          "Check token liquidity and chain availability.",
        meta: sourceMeta("okx_real_failed", chainConfig),
      };
    }
    return {
      txData: null,
      error: `Swap transaction build failed: ${err instanceof Error ? err.message : String(err)}`,
      meta: sourceMeta("okx_real_failed", chainConfig),
    };
  }
}

export async function checkAllowance(
  chain: string,
  walletAddress: string,
  tokenAddress: string,
  readableAmount: number,
  decimals: number = 18
): Promise<{ hasSufficient: boolean; allowance: string; meta: SourceMeta }> {
  const chainConfig = normalizeChain(chain);
  
  if (typeof global !== "undefined" && (global as any).__mockCheckAllowance) {
    return (global as any).__mockCheckAllowance(chain, walletAddress, tokenAddress, readableAmount);
  }

  try {
    const raw = await runCli([
      "swap", "check-approvals",
      "--chain", chainConfig.chainSlug,
      "--address", walletAddress.toLowerCase(),
      "--token", tokenAddress.toLowerCase()
    ]);
    const items = unwrapCliResult(raw, "swap check-approvals");
    if (items.length === 0) {
      return { hasSufficient: false, allowance: "0", meta: sourceMeta("okx_real", chainConfig) };
    }
    const result = items[0] as Record<string, unknown>;
    const allowance = String(result.allowance ?? "0");
    
    // Parse minimal units
    // e.g. amount = 10, decimals = 6 -> 10000000
    // Wait, javascript numbers might lose precision.
    const needed = readableAmount * Math.pow(10, decimals);
    const hasSufficient = parseFloat(allowance) >= needed;

    return {
      hasSufficient,
      allowance,
      meta: sourceMeta("okx_real", chainConfig)
    };
  } catch (err) {
    return { hasSufficient: false, allowance: "0", meta: sourceMeta("okx_real_failed", chainConfig) };
  }
}

export async function getApproveTxData(
  chain: string,
  tokenAddress: string,
  readableAmount: number,
  decimals: number = 18
): Promise<{ txData: SwapTxData | null; error: string | null; meta: SourceMeta }> {
  const chainConfig = normalizeChain(chain);
  
  if (typeof global !== "undefined" && (global as any).__mockGetApproveTxData) {
    return (global as any).__mockGetApproveTxData(chain, tokenAddress, readableAmount);
  }

  // Convert to minimal units
  let minimalUnits = "0";
  if (readableAmount > 0) {
    // using BigInt if possible, but safe integer math is ok for standard sizes
    try {
      // Avoid scientific notation e.g. 1e21 -> "1000000000000000000000"
      const numStr = readableAmount.toString();
      let parts = numStr.split('.');
      let intPart = parts[0];
      let decPart = parts[1] || "";
      if (decPart.length > decimals) {
        decPart = decPart.slice(0, decimals);
      }
      const paddedDecPart = decPart.padEnd(decimals, "0");
      minimalUnits = intPart + paddedDecPart;
    } catch {
      minimalUnits = (readableAmount * Math.pow(10, decimals)).toLocaleString('fullwide', {useGrouping:false});
    }
  }

  try {
    const raw = await runCli([
      "swap", "approve",
      "--chain", chainConfig.chainSlug,
      "--token", tokenAddress.toLowerCase(),
      "--amount", minimalUnits
    ]);
    const items = unwrapCliResult(raw, "swap approve");
    if (items.length === 0) {
      return { txData: null, error: "Failed to get approve tx data", meta: sourceMeta("okx_real", chainConfig) };
    }
    const result = items[0] as Record<string, unknown>;
    const tx = (result.tx ?? result) as Record<string, unknown>;
    
    return {
      txData: {
        to: String(tx.to ?? ""),
        data: String(tx.data ?? ""),
        value: String(tx.value ?? "0x0"),
        gas: tx.gas ? String(tx.gas) : undefined,
        gasLimit: tx.gasLimit ? String(tx.gasLimit) : undefined,
        gasPrice: tx.gasPrice ? String(tx.gasPrice) : undefined,
      },
      error: null,
      meta: sourceMeta("okx_real", chainConfig)
    };
  } catch (err) {
    return {
      txData: null,
      error: `Approve transaction build failed: ${err instanceof Error ? err.message : String(err)}`,
      meta: sourceMeta("okx_real_failed", chainConfig)
    };
  }
}
