"use client";

import { useState, useRef, useEffect } from "react";
import {
  Wallet,
  Clock,
  Plus,
  Search,
  ChevronDown,
  X,
  Coins,
} from "lucide-react";
import { CopyAddress } from "./CopyAddress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  isAuthenticated: boolean;
  hasWallet: boolean;
  walletAddress?: string | null;
  chainName: string;
  executionMode: string;
  onConnectWallet: () => void;
  onSignIn: () => void;
}

type TimeSpan = "1D" | "1W" | "1M";
type Currency = "USD" | "EUR" | "GBP";

// ─── Placeholder assets (symbols only — no fake balances) ─────────────────────

const POPULAR_ASSETS = [
  { symbol: "OKB", name: "OKB", color: "#000" },
  { symbol: "ETH", name: "Ethereum", color: "#627EEA" },
  { symbol: "USDC", name: "USD Coin", color: "#2775CA" },
  { symbol: "USDT", name: "Tether", color: "#26A17B" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", color: "#F7931A" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PortfolioPanel({
  isAuthenticated,
  hasWallet,
  walletAddress,
  chainName,
  onConnectWallet,
  onSignIn,
}: Props) {
  const [timeSpan, setTimeSpan] = useState<TimeSpan>("1D");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showAddCoin, setShowAddCoin] = useState(false);
  const [addCoinInput, setAddCoinInput] = useState("");
  const [addedCoins, setAddedCoins] = useState<string[]>([]);
  const currencyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currencyOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) setCurrencyOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [currencyOpen]);

  const currencySymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-gradient-brand flex items-center justify-center mx-auto mb-5 shadow-soft">
            <Wallet className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground mb-2">Portfolio</h2>
          <p className="text-sm text-muted-foreground mb-5">Sign in to view your wallet and assets.</p>
          <button onClick={onSignIn} className="inline-flex items-center rounded-full bg-gradient-brand text-white px-6 py-2.5 text-sm font-medium hover:shadow-glow transition-all duration-200 hover:scale-[1.02]">
            Sign in to get started
          </button>
        </div>
      </div>
    );
  }

  const filteredAssets = POPULAR_ASSETS.filter(a =>
    a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto scroll-contain">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-6">

        {/* ═══ HEADER — Total Asset Value ═══ */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Total Assets
            </p>
            {/* Currency selector */}
            <div className="relative" ref={currencyRef}>
              <button
                onClick={() => setCurrencyOpen(v => !v)}
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider hover:text-muted-foreground transition-colors"
              >
                ({currency})
                <ChevronDown className={`w-2.5 h-2.5 chevron-rotate ${currencyOpen ? "is-open" : ""}`} />
              </button>
              <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 w-20 bg-white border border-border rounded-lg shadow-soft py-0.5 z-50 dropdown-panel ${currencyOpen ? "is-open" : ""}`}>
                {(["USD", "EUR", "GBP"] as Currency[]).map(c => (
                  <button
                    key={c}
                    onClick={() => { setCurrency(c); setCurrencyOpen(false); }}
                    className={`w-full text-center px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      c === currency ? "text-electric bg-electric/5" : "text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">
            {currencySymbol}—
          </h1>
          {hasWallet && walletAddress && (
            <div className="text-[11px] text-muted-foreground/40 mt-1 flex items-center justify-center gap-1.5">
              <CopyAddress address={walletAddress} />
              <span>·</span>
              <span>{chainName}</span>
            </div>
          )}
          {hasWallet && (
            <p className="text-[11px] text-muted-foreground/40 mt-0.5">No assets detected on {chainName}</p>
          )}
          {!hasWallet && (
            <p className="text-xs text-muted-foreground/50 mt-1">Connect wallet to view your assets</p>
          )}
        </div>

        {/* ═══ ASSET CHANGE GRAPH ═══ */}
        <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-white to-muted/10 p-5 mb-5">
          {/* Time span selector */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium text-muted-foreground">Asset Change</span>
            <div className="flex gap-1 bg-muted/30 rounded-lg p-0.5">
              {(["1D", "1W", "1M"] as TimeSpan[]).map(ts => (
                <button
                  key={ts}
                  onClick={() => setTimeSpan(ts)}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all ${
                    ts === timeSpan
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  }`}
                >
                  {ts}
                </button>
              ))}
            </div>
          </div>

          {/* Chart placeholder */}
          {hasWallet ? (
            <div className="h-28 flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 400 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.62 0.19 260)" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="oklch(0.62 0.19 260)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0,70 L400,70" stroke="oklch(0.62 0.19 260)" strokeWidth="1.5" strokeDasharray="4 4" fill="none" opacity="0.3" />
                <text x="200" y="65" textAnchor="middle" fill="oklch(0.55 0 0 / 0.3)" fontSize="11" fontFamily="system-ui">
                  No historical data yet
                </text>
              </svg>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center">
              <p className="text-xs text-muted-foreground/40">Connect wallet to view asset history</p>
            </div>
          )}
        </div>

        {/* ═══ QUICK ACTIONS ═══ */}
        <div className="flex justify-center gap-8 mb-7">
          <button
            onClick={() => { setShowHistory(true); setShowAddCoin(false); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className="w-12 h-12 rounded-full bg-gradient-brand flex items-center justify-center shadow-soft group-hover:shadow-glow transition-shadow">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">History</span>
          </button>
          <button
            onClick={() => { setShowAddCoin(true); setShowHistory(false); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className="w-12 h-12 rounded-full bg-gradient-brand flex items-center justify-center shadow-soft group-hover:shadow-glow transition-shadow">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">Add Coin</span>
          </button>
        </div>

        {/* ═══ HISTORY PANEL ═══ */}
        <div
          className="overflow-hidden mb-5"
          style={{
            maxHeight: showHistory ? "400px" : "0px",
            opacity: showHistory ? 1 : 0,
            transition: "max-height 0.25s ease-out, opacity 0.2s ease-out",
          }}
        >
          <div className="rounded-2xl border border-border/50 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-electric" />
                Transaction History
              </h3>
              <button onClick={() => setShowHistory(false)} className="p-1 rounded-lg hover:bg-muted/40 transition-colors">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="text-center py-6">
              <Clock className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/60">No trade activity yet.</p>
              <p className="text-[11px] text-muted-foreground/30 mt-0.5">Executed trades will appear here.</p>
            </div>
          </div>
        </div>

        {/* ═══ ADD COIN PANEL ═══ */}
        <div
          className="overflow-hidden mb-5"
          style={{
            maxHeight: showAddCoin ? "400px" : "0px",
            opacity: showAddCoin ? 1 : 0,
            transition: "max-height 0.25s ease-out, opacity 0.2s ease-out",
          }}
        >
          <div className="rounded-2xl border border-border/50 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-electric" />
                Add Coin
              </h3>
              <button onClick={() => setShowAddCoin(false)} className="p-1 rounded-lg hover:bg-muted/40 transition-colors">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground/60 mb-3">
              Add a token by coin ID or contract address. This is saved locally only.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={addCoinInput}
                onChange={e => setAddCoinInput(e.target.value)}
                placeholder="Token symbol or 0x… address"
                className="flex-1 bg-muted/20 border border-border/50 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-electric/40 focus:bg-white transition-colors"
              />
              <button
                onClick={() => {
                  if (addCoinInput.trim()) {
                    setAddedCoins(prev => [...prev, addCoinInput.trim()]);
                    setAddCoinInput("");
                  }
                }}
                disabled={!addCoinInput.trim()}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  addCoinInput.trim()
                    ? "bg-gradient-brand text-white hover:shadow-glow"
                    : "bg-muted/40 text-muted-foreground/30 cursor-not-allowed"
                }`}
              >
                Add
              </button>
            </div>
            {addedCoins.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {addedCoins.map((coin, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-muted/30 border border-border/40 rounded-lg px-2.5 py-1 text-[11px] font-medium text-foreground">
                    {coin.length > 10 ? `${coin.slice(0, 6)}…${coin.slice(-4)}` : coin}
                    <button onClick={() => setAddedCoins(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground/40 hover:text-red-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══ CRYPTO ASSETS ═══ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Coins className="w-4 h-4 text-electric" />
                Popular Tokens
              </h2>
              <p className="text-[10px] text-muted-foreground/40 ml-6">on {chainName} · not wallet holdings</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tokens…"
              className="w-full bg-muted/15 border border-border/40 rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-electric/40 focus:bg-white transition-colors"
            />
          </div>

          {/* Asset list */}
          {!hasWallet ? (
            <div className="rounded-2xl border border-border/50 bg-white p-6 text-center">
              <Wallet className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/60 mb-3">Connect wallet to view your assets.</p>
              <button onClick={onConnectWallet} className="inline-flex items-center gap-2 rounded-full border border-electric/30 text-electric px-4 py-1.5 text-sm font-medium hover:bg-electric/5 transition-colors">
                <Wallet className="w-3.5 h-3.5" />
                Connect Wallet
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/50 bg-white overflow-hidden">
              {filteredAssets.length > 0 ? (
                <div className="divide-y divide-border/30">
                  {filteredAssets.map(asset => (
                    <div key={asset.symbol} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors">
                      {/* Token icon */}
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                        style={{ backgroundColor: asset.color }}
                      >
                        {asset.symbol.slice(0, 2)}
                      </div>
                      {/* Token info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{asset.symbol}</p>
                        <p className="text-[11px] text-muted-foreground/50 truncate">{asset.name}</p>
                      </div>
                      {/* Balance */}
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground/20">—</p>
                      </div>
                    </div>
                  ))}
                  {/* Added coins */}
                  {addedCoins.map((coin, i) => (
                    <div key={`added-${i}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors">
                      <div className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground text-[11px] font-bold shrink-0">
                        ?
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{coin.length > 10 ? `${coin.slice(0, 6)}…${coin.slice(-4)}` : coin}</p>
                        <p className="text-[11px] text-muted-foreground/50">Custom token</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground/20">—</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Search className="w-6 h-6 text-muted-foreground/15 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/40">No tokens match &ldquo;{searchQuery}&rdquo;</p>
                </div>
              )}
            </div>
          )}

          {/* Add coin helper */}
          <button
            onClick={() => { setShowAddCoin(true); }}
            className="mt-3 w-full flex items-center justify-center gap-1.5 text-[12px] font-medium text-electric/70 hover:text-electric transition-colors py-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Add coin ID you don&apos;t see here
          </button>
        </div>
      </div>
    </div>
  );
}
