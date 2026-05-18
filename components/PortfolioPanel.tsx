"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, Wallet, ChevronRight, AlertCircle, Loader2, ArrowRightLeft, Plus, TrendingUp, ArrowUpRight, Clock, Copy, Check, ChevronDown } from "lucide-react";
import { TokenIcon } from "./icons/TokenIcons";

interface TxRecord {
  id: string;
  fromSymbol: string;
  toSymbol: string;
  amountUsd: number;
  expectedOutputUsd: number;
  gasFeeUsd: number;
  txHash: string;
  explorerUrl: string | null;
  chain: string;
  confirmedAt: string;
}

interface Props {
  isAuthenticated: boolean;
  hasWallet: boolean;
  walletAddress?: string | null;
  chainName: string;
  executionMode: string;
  onConnectWallet: () => void;
  onSignIn: () => void;
  getAccessToken?: () => Promise<string | null>;
}

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  price: number;
  change24h: number;
  contractAddress: string;
  logoUrl: string;
}

export function PortfolioPanel({
  isAuthenticated,
  hasWallet,
  walletAddress,
  chainName,
  executionMode,
  onConnectWallet,
  onSignIn,
  getAccessToken,
}: Props) {
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalUsd, setTotalUsd] = useState("0.00");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [persistedTxs, setPersistedTxs] = useState<TxRecord[]>([]);
  const [chartRange, setChartRange] = useState<string>("7D");
  const [copied, setCopied] = useState(false);
  const [currency, setCurrency] = useState<string>("USD");
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const currencyRates: Record<string, { symbol: string; rate: number }> = {
    USD: { symbol: "$", rate: 1 },
    EUR: { symbol: "€", rate: 0.92 },
    GBP: { symbol: "£", rate: 0.79 },
    IDR: { symbol: "Rp", rate: 16450 },
    JPY: { symbol: "¥", rate: 155.2 },
  };
  const cur = currencyRates[currency] ?? currencyRates.USD;

  const fmtCur = (usd: number) => {
    const val = usd * cur.rate;
    if (currency === "IDR") return `${cur.symbol}${val >= 1_000_000 ? (val / 1_000_000).toFixed(1) + "M" : val >= 1_000 ? (val / 1_000).toFixed(0) + "K" : val.toFixed(0)}`;
    if (currency === "JPY") return `${cur.symbol}${val >= 1_000_000 ? (val / 1_000_000).toFixed(1) + "M" : val >= 1_000 ? (val / 1_000).toFixed(0) + "K" : val.toFixed(0)}`;
    return `${cur.symbol}${val.toFixed(2)}`;
  };

  const handleCopyAddress = useCallback(() => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [walletAddress]);

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (getAccessToken) {
        const token = await getAccessToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(
        `/api/portfolio?address=${encodeURIComponent(walletAddress)}&chain=${encodeURIComponent(chainName)}`,
        { headers }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to fetch portfolio (${res.status})`);
      }
      const data = await res.json();
      setTokens(data.tokens ?? []);
      setTotalUsd(data.totalUsd ?? "0.00");
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
      // Keep existing tokens on error
    } finally {
      setLoading(false);
    }
  }, [walletAddress, chainName, getAccessToken]);

  useEffect(() => {
    if (!isAuthenticated || !hasWallet || !walletAddress) return;
    const timer = setTimeout(() => {
      fetchBalances();
    }, 0);
    return () => clearTimeout(timer);
  }, [isAuthenticated, hasWallet, walletAddress, fetchBalances]);

  // Fetch persisted tx history for cross-session persistence
  useEffect(() => {
    if (!walletAddress) return;
    const timer = setTimeout(() => {
      fetch(`/api/tx-history?wallet=${walletAddress}`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.txs)) {
            setPersistedTxs(data.txs as TxRecord[]);
          }
        })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [walletAddress]);

  /* ═══ UNAUTHENTICATED STATE ═══ */
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: "oklch(0.62 0.19 260 / 0.1)", border: "1px solid oklch(0.62 0.19 260 / 0.15)" }}
          >
            <Wallet className="w-5 h-5" style={{ color: "oklch(0.7 0.19 260)" }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--app-text-primary)" }}>Portfolio</h2>
          <p className="text-sm mb-6" style={{ color: "var(--app-text-secondary)" }}>
            Connect your wallet to view your on-chain assets and token balances.
          </p>
          <button type="button" onClick={onSignIn} className="btn-capsule-white text-sm px-6 py-2.5">
            <Wallet className="w-4 h-4" />
            Sign in
          </button>
        </div>
      </div>
    );
  }

  /* ═══ NO WALLET ═══ */
  if (!hasWallet) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--app-text-primary)" }}>Wallet Required</h2>
          <p className="text-sm mb-6" style={{ color: "var(--app-text-secondary)" }}>Connect a wallet to see your portfolio on {chainName}.</p>
          <button type="button" onClick={onConnectWallet} className="btn-capsule-white text-sm px-6 py-2.5">
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const formatChange = (pct: number) => {
    if (pct === 0) return { text: "0.00%", color: "var(--app-text-tertiary)" };
    if (pct > 0) return { text: `+${pct.toFixed(2)}%`, color: "var(--app-success)" };
    return { text: `${pct.toFixed(2)}%`, color: "var(--app-danger)" };
  };

  const totalNum = parseFloat(totalUsd);
  const totalConverted = totalNum * cur.rate;
  const formattedTotal = totalConverted >= 1_000_000
    ? `${cur.symbol}${(totalConverted / 1_000_000).toFixed(2)}M`
    : totalConverted >= 1_000
      ? `${cur.symbol}${(totalConverted / 1_000).toFixed(1)}K`
      : `${cur.symbol}${totalConverted.toFixed(2)}`;

  return (
    <div className="flex-1 overflow-y-auto scroll-contain">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold" style={{ color: "var(--app-text-primary)" }}>Portfolio</h1>
            <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--app-text-secondary)" }}>
              {chainName} · {executionMode}
              {lastFetched && (
                <span style={{ color: "var(--app-text-tertiary)" }}> · Updated {lastFetched.toLocaleTimeString()}</span>
              )}
            </p>
          </div>
          <button
            onClick={fetchBalances}
            disabled={loading}
            className="p-2.5 sm:p-3 rounded-xl transition-all duration-200"
            style={{ border: "1px solid var(--app-card-border)", background: "var(--app-card-glass)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--app-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--app-card-glass)"; }}
            title="Refresh balances"
          >
            <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${loading ? "animate-spin" : ""}`} style={{ color: "var(--app-text-secondary)" }} />
          </button>
        </div>

        {/* Total Value Card */}
        <div
          className="rounded-2xl p-5 sm:p-6 lg:p-8 mb-6 sm:mb-8 relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, oklch(0.62 0.19 260 / 0.12), oklch(0.7 0.13 280 / 0.06))",
            border: "1px solid oklch(0.62 0.19 260 / 0.15)",
          }}
        >
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ background: "oklch(0.62 0.19 260)" }} />
          
          <p className="text-[10px] sm:text-[11px] lg:text-xs font-semibold uppercase tracking-[0.15em] mb-2" style={{ color: "oklch(0.7 0.19 260)" }}>
            Total Value
          </p>
          <p className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight relative z-10" style={{ color: "var(--app-text-primary)" }}>
            {loading && tokens.length === 0 ? (
              <span className="inline-flex items-center gap-3">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin" style={{ color: "oklch(0.7 0.19 260)" }} />
                <span className="text-lg sm:text-xl" style={{ color: "var(--app-text-tertiary)" }}>Loading…</span>
              </span>
            ) : formattedTotal}
          </p>
          <button
            type="button"
            onClick={handleCopyAddress}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-mono relative z-10 transition-all duration-200 hover:scale-[1.02] cursor-pointer group"
            style={{ background: "var(--app-subtle-bg)", border: "1px solid var(--app-subtle-border)", color: "var(--app-text-tertiary)" }}
            title="Click to copy address"
          >
            {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
            {copied ? (
              <Check className="w-3 h-3" style={{ color: "var(--app-success)" }} />
            ) : (
              <Copy className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>

        {/* Portfolio Chart Section */}
        <div
          className="rounded-2xl mb-6 sm:mb-8 overflow-hidden"
          style={{ background: "var(--app-card-glass)", border: "1px solid var(--app-card-border)" }}
        >
          <div className="px-4 sm:px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--app-card-border)" }}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: "oklch(0.7 0.19 260)" }} />
              <span className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--app-text-secondary)" }}>Performance</span>
            </div>
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "oklch(0.5 0.02 260 / 0.08)" }}>
              {["1D", "7D", "1M", "3M", "1Y"].map(r => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className="px-2.5 py-1 rounded-md text-[10px] sm:text-[11px] font-bold transition-all duration-150"
                  style={{
                    background: chartRange === r ? "oklch(0.62 0.19 260 / 0.15)" : "transparent",
                    color: chartRange === r ? "oklch(0.75 0.19 260)" : "var(--app-text-tertiary)",
                    border: chartRange === r ? "1px solid oklch(0.62 0.19 260 / 0.2)" : "1px solid transparent",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 sm:px-5 py-6 sm:py-8 flex flex-col items-center justify-center" style={{ minHeight: 140 }}>
            {/* SVG Sparkline placeholder */}
            <svg viewBox="0 0 400 80" className="w-full max-w-md" style={{ opacity: 0.3 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.19 260)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="oklch(0.62 0.19 260)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,60 Q50,55 100,45 T200,35 T300,25 T400,20" fill="none" stroke="oklch(0.62 0.19 260)" strokeWidth="2" strokeLinecap="round" />
              <path d="M0,60 Q50,55 100,45 T200,35 T300,25 T400,20 V80 H0 Z" fill="url(#chartGrad)" />
            </svg>
            <p className="text-[11px] mt-3 font-medium" style={{ color: "var(--app-text-tertiary)" }}>Historical chart — Coming Soon</p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="rounded-xl px-4 py-3 mb-4 flex items-center gap-3 text-sm"
            style={{ background: "oklch(0.65 0.2 25 / 0.08)", border: "1px solid oklch(0.65 0.2 25 / 0.15)", color: "var(--app-danger)" }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={fetchBalances} className="text-xs font-semibold underline">Retry</button>
          </div>
        )}

        {/* Token List Header */}
        {tokens.length > 0 && (
          <div className="flex items-center justify-between px-4 mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--app-text-tertiary)" }}>
              Assets ({tokens.length})
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setCurrencyOpen(!currencyOpen)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.1em] transition-all duration-150"
                style={{ color: "oklch(0.7 0.19 260)", background: "oklch(0.62 0.19 260 / 0.08)", border: "1px solid oklch(0.62 0.19 260 / 0.12)" }}
              >
                {currency}
                <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${currencyOpen ? "rotate-180" : ""}`} />
              </button>
              {currencyOpen && (
                <div
                  className="absolute right-0 top-full mt-1 rounded-lg py-1 z-50 min-w-[80px] shadow-lg"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  {Object.keys(currencyRates).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setCurrency(c); setCurrencyOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-[11px] font-bold transition-colors"
                      style={{
                        color: c === currency ? "oklch(0.7 0.19 260)" : "var(--app-text-secondary)",
                        background: c === currency ? "oklch(0.62 0.19 260 / 0.08)" : "transparent",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "var(--app-hover)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = c === currency ? "oklch(0.62 0.19 260 / 0.08)" : "transparent"; }}
                    >
                      {currencyRates[c].symbol} {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Token List */}
        <div className="space-y-1.5 stagger-children">
          {tokens.map((token) => {
            const change = formatChange(token.change24h);
            const isExpanded = expanded === token.symbol;

            return (
              <div key={`${token.symbol}-${token.contractAddress}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : token.symbol)}
                  className="w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 sm:py-4 rounded-xl transition-all duration-200 text-left app-card app-card-hover"
                >
                  {/* Token icon */}
                  <div className="shrink-0">
                    <TokenIcon symbol={token.symbol} size={40} />
                  </div>

                  {/* Token info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm sm:text-base font-bold" style={{ color: "var(--app-text-primary)" }}>{token.symbol}</span>
                      <span className="text-[10px] sm:text-xs hidden sm:inline" style={{ color: "var(--app-text-tertiary)" }}>{token.name}</span>
                    </div>
                    <span className="text-xs sm:text-sm block mt-0.5 font-mono" style={{ color: "var(--app-text-secondary)" }}>
                      {token.balance}
                    </span>
                  </div>

                  {/* Value & change */}
                  <div className="text-right shrink-0">
                    <p className="text-sm sm:text-base font-bold" style={{ color: "var(--app-text-primary)" }}>{fmtCur(parseFloat(token.usdValue))}</p>
                    <p className="text-[10px] sm:text-xs font-semibold" style={{ color: change.color }}>{change.text}</p>
                  </div>

                  <ChevronRight
                    className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                    style={{ color: "var(--app-text-tertiary)" }}
                  />
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div
                    className="ml-14 sm:ml-16 mr-4 mb-2 px-4 sm:px-5 py-3 sm:py-4 rounded-xl view-enter"
                    style={{ background: "var(--app-card-glass)", border: "1px solid var(--app-card-border)" }}
                  >
                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="flex items-center justify-between">
                        <span style={{ color: "var(--app-text-secondary)" }}>Chain</span>
                        <span className="font-medium" style={{ color: "var(--app-text-primary)" }}>{chainName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ color: "var(--app-text-secondary)" }}>Holdings</span>
                        <span className="font-mono font-medium" style={{ color: "var(--app-text-primary)" }}>{token.balance} {token.symbol}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ color: "var(--app-text-secondary)" }}>Unit Price</span>
                        <span className="font-medium" style={{ color: "var(--app-text-primary)" }}>${token.price.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ color: "var(--app-text-secondary)" }}>{currency} Value</span>
                        <span className="font-bold" style={{ color: "var(--app-text-primary)" }}>{fmtCur(parseFloat(token.usdValue))}</span>
                      </div>
                      {token.contractAddress && token.contractAddress !== "native" && (
                        <div className="flex items-center justify-between">
                          <span style={{ color: "var(--app-text-secondary)" }}>Contract</span>
                          <span className="font-mono text-[11px]" style={{ color: "var(--app-text-tertiary)" }}>
                            {token.contractAddress.slice(0, 6)}…{token.contractAddress.slice(-4)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--app-card-border)" }}>
                      <a
                        href={`https://www.okx.com/web3/explorer/xlayer/address/${walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-opacity hover:opacity-80"
                        style={{ color: "oklch(0.7 0.19 260)" }}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View on Explorer
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Loading skeleton */}
        {loading && tokens.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 sm:h-20 rounded-xl animate-pulse" style={{ background: "var(--app-card-glass)" }} />
            ))}
          </div>
        )}

        {tokens.length === 0 && !loading && !error && (
          <div className="text-center py-12 sm:py-16">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: "oklch(0.62 0.19 260 / 0.08)", border: "1px solid oklch(0.62 0.19 260 / 0.12)" }}>
              <Wallet className="w-6 h-6" style={{ color: "oklch(0.7 0.19 260)" }} />
            </div>
            <p className="text-base font-bold mb-1" style={{ color: "var(--app-text-primary)" }}>No tokens found</p>
            <p className="text-sm mb-6" style={{ color: "var(--app-text-tertiary)" }}>Deposit tokens to {chainName} to see your portfolio</p>
            <a
              href="https://www.okx.com/web3/bridge"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.02]"
              style={{
                background: "linear-gradient(135deg, oklch(0.62 0.19 260), oklch(0.7 0.13 280))",
                color: "#fff",
                boxShadow: "0 4px 20px oklch(0.62 0.19 260 / 0.3)",
              }}
            >
              <Plus className="w-4 h-4" />
              Bridge tokens to X Layer
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* ═══ Transaction History ═══ */}
        <div className="mt-8 sm:mt-10">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" style={{ color: "var(--app-text-tertiary)" }} />
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--app-text-tertiary)" }}>
                PhylaX Trades {persistedTxs.length > 0 ? `(${persistedTxs.length})` : ""}
              </span>
            </div>
          </div>
          {persistedTxs.length > 0 ? (
            <div className="space-y-1.5">
              {persistedTxs.slice(0, 10).map((tx) => (
                <div
                  key={tx.txHash ?? tx.id}
                  className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-3.5 rounded-xl app-card"
                >
                  <div
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "oklch(0.62 0.19 260 / 0.1)", border: "1px solid oklch(0.62 0.19 260 / 0.12)" }}
                  >
                    <ArrowRightLeft className="w-4 h-4" style={{ color: "oklch(0.7 0.19 260)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs sm:text-sm font-bold" style={{ color: "var(--app-text-primary)" }}>
                      {tx.fromSymbol} → {tx.toSymbol}
                    </span>
                    <span className="text-[10px] sm:text-xs block mt-0.5" style={{ color: "var(--app-text-tertiary)" }}>
                      {tx.confirmedAt ? new Date(tx.confirmedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs sm:text-sm font-bold" style={{ color: "var(--app-text-primary)" }}>
                      ${(tx.amountUsd ?? 0).toFixed(2)}
                    </p>
                  </div>
                  {(tx.explorerUrl || tx.txHash) && (
                    <a
                      href={tx.explorerUrl || `https://www.okx.com/web3/explorer/xlayer/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 p-1 rounded-lg transition-opacity hover:opacity-70"
                      title="View on explorer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" style={{ color: "oklch(0.7 0.19 260)" }} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              className="rounded-xl px-5 py-8 text-center"
              style={{ background: "var(--app-card-glass)", border: "1px solid var(--app-card-border)" }}
            >
              <ArrowRightLeft className="w-5 h-5 mx-auto mb-2" style={{ color: "var(--app-text-tertiary)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--app-text-secondary)" }}>No trades yet</p>
              <p className="text-xs mt-1" style={{ color: "var(--app-text-tertiary)" }}>Swaps executed via PhylaX Agent will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
