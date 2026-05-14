"use client";

import { useState, useRef } from "react";
import { Shield, AlertTriangle, Radio, ScanLine, BarChart3, Wallet, StopCircle, Database } from "lucide-react";
import { motion } from "framer-motion";
import { Navbar } from "../components/Navbar";
import { Hero } from "../components/Hero";
import { SignalDivider } from "../components/SignalDivider";
import { About } from "../components/About";
import { Features } from "../components/Features";
import { Ecosystem } from "../components/Ecosystem";
import { CTA } from "../components/CTA";
import { Footer } from "../components/Footer";
import { AppFooter } from "../components/AppFooter";
import { ThesisInput } from "../components/ThesisInput";
import { AgentProgress, AgentState } from "../components/AgentProgress";
import { ParsedIntentCard } from "../components/ParsedIntentCard";
import { TradePlanTable } from "../components/TradePlanTable";
import { QuotePreflightPanel } from "../components/QuotePreflightPanel";
import { ApprovalPanel } from "../components/ApprovalPanel";
import { ResultReport } from "../components/ResultReport";
import { OkxStatusBadge } from "../components/OkxStatusBadge";
import { RiskPanel } from "../components/RiskPanel";
import { WalletStatusCard } from "../components/WalletStatusCard";
import { useWallet } from "../lib/wallet";
import { DEFAULT_CHAIN, type ChainConfig } from "../lib/chains";
import {
  ThesisIntent,
  TokenSignal,
  SimulationResult,
  ExecutionResult,
  SourceMeta,
} from "../lib/schemas";

type RiskMode = "conservative" | "moderate" | "degen";

const RISK_MODES: { value: RiskMode; label: string; description: string }[] = [
  { value: "conservative", label: "Conservative", description: "Skip unknown and high-risk tokens" },
  { value: "moderate",     label: "Balanced",     description: "Allow unknown, block high-risk" },
  { value: "degen",        label: "Aggressive",   description: "Allow all flagged tokens" },
];

const tradingMode = process.env.NEXT_PUBLIC_DATA_MODE === "real" || process.env.NEXT_PUBLIC_APP_TRADING_MODE === "production"
  ? "Production"
  : "Demo";

export default function Home() {
  // ─── Mode ───
  const [showConsole, setShowConsole] = useState(false);

  // ─── Chain (single source of truth from lib/chains.ts) ───
  const [selectedChain, setSelectedChain] = useState<ChainConfig>(DEFAULT_CHAIN);

  // ─── Real wallet ───
  const wallet = useWallet(parseInt(selectedChain.chainIndex, 10));

  // ─── Agent State ───
  const [thesis, setThesis] = useState("");
  const [riskMode, setRiskMode] = useState<RiskMode>("conservative");
  const [state, setState] = useState<AgentState>("IDLE");
  const [intent, setIntent] = useState<ThesisIntent | null>(null);
  const [signals, setSignals] = useState<TokenSignal[]>([]);
  const [quoteResult, setQuoteResult] = useState<SimulationResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const [fromSymbol, setFromSymbol] = useState<string>(DEFAULT_CHAIN.defaultFromSymbol);

  // ─── Source metadata ───
  const [signalMeta, setSignalMeta] = useState<SourceMeta | null>(null);
  const [scanMeta, setScanMeta] = useState<SourceMeta | null>(null);
  const [quoteMeta, setQuoteMeta] = useState<SourceMeta | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  const consoleRef = useRef<HTMLDivElement>(null);

  // ─── Handlers ───
  const handleLaunch = () => {
    setShowConsole(true);
    setTimeout(() => {
      consoleRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handleChainChange = (chain: ChainConfig) => {
    if (!chain.enabled) return;
    setSelectedChain(chain);
    setFromSymbol(chain.defaultFromSymbol);
  };

  const isAgentRunning =
    state !== "IDLE" &&
    state !== "COMPLETED" &&
    state !== "FAILED" &&
    state !== "BUILDING_TRADE_PLAN";

  const resetState = () => {
    setIntent(null);
    setSignals([]);
    setQuoteResult(null);
    setQuoteError(null);
    setApprovalId(null);
    setExecutionResult(null);
    setExecutionError(null);
    setExecutionMessage(null);
    setSignalMeta(null);
    setScanMeta(null);
    setQuoteMeta(null);
    setIntegrationError(null);
    setFromSymbol(selectedChain.defaultFromSymbol);
  };

  // ─── Agent Pipeline ───
  const runAgent = async () => {
    try {
      resetState();

      // 1. Parse Thesis
      setState("PARSING_THESIS");
      const thesisRes = await fetch("/api/thesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thesis }),
      });
      if (!thesisRes.ok) throw new Error("Failed to parse thesis");
      const { intent: parsedIntent } = await thesisRes.json();

      // Chain from navbar selector is the source of truth
      const mergedIntent: ThesisIntent = {
        ...parsedIntent,
        riskMode,
        chain: selectedChain.id,
      };
      setIntent(mergedIntent);

      // 2. Fetch Signals
      setState("FETCHING_SIGNALS");
      const signalsRes = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: mergedIntent }),
      });

      if (!signalsRes.ok) {
        const errData = await signalsRes.json();
        setIntegrationError(
          errData.error ?? "OKX signal API unavailable. Check configuration and credentials."
        );
        setState("FAILED");
        return;
      }

      const { signals: fetchedSignals, meta: sMeta } = await signalsRes.json();
      setSignals(fetchedSignals);
      setSignalMeta(sMeta ?? null);

      if (!fetchedSignals || fetchedSignals.length === 0) {
        setIntegrationError("No KOL signals found for the current chain and criteria. Try a different chain or broader thesis.");
        setState("FAILED");
        return;
      }

      // 3. Scan Tokens
      setState("SCANNING_SECURITY");
      const scannedSignals = [...fetchedSignals] as TokenSignal[];
      let lastScanMeta: SourceMeta | null = null;

      for (let i = 0; i < scannedSignals.length; i++) {
        const scanRes = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: scannedSignals[i].address,
            riskMode: mergedIntent.riskMode,
            chain: mergedIntent.chain,
          }),
        });

        if (scanRes.ok) {
          const scanData = await scanRes.json();
          scannedSignals[i].riskStatus = scanData.action;
          if (scanData.meta) lastScanMeta = scanData.meta as SourceMeta;
        } else {
          const errData = await scanRes.json();
          if (scanRes.status === 502) {
            setIntegrationError(
              errData.error ?? "OKX security API unavailable. Tokens cannot be verified."
            );
            for (let j = i; j < scannedSignals.length; j++) {
              scannedSignals[j].riskStatus = "skipped";
            }
            break;
          }
          scannedSignals[i].riskStatus = "skipped";
        }
      }

      setSignals(scannedSignals);
      if (lastScanMeta) setScanMeta(lastScanMeta);
      setState("BUILDING_TRADE_PLAN");
    } catch (err) {
      console.error(err);
      setIntegrationError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setState("FAILED");
    }
  };

  const handleQuote = async (token: TokenSignal) => {
    try {
      setState("SIMULATING_SWAP");
      setQuoteError(null);

      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: token.address,
          amountUsd: intent?.maxBudgetUsd,
          chain: intent?.chain,
          maxBudgetUsd: intent?.maxBudgetUsd,
          slippageLimitPercent: intent?.slippageLimitPercent,
          isScanned: token.riskStatus !== "pending",
          riskLevel: token.riskStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = res.status === 502
          ? `OKX quote API unavailable: ${data.error ?? "integration error"}`
          : data.error ?? "Quote failed due to risk guardrails.";
        setQuoteError(msg);
        setState("FAILED");
        return;
      }

      setQuoteResult(data.simulation);
      setApprovalId(data.approvalId);
      if (data.fromSymbol) setFromSymbol(data.fromSymbol as string);
      if (data.meta) setQuoteMeta(data.meta as SourceMeta);
      setState("WAITING_FOR_APPROVAL");
    } catch (err) {
      console.error(err);
      setQuoteError("Network error during quote request.");
      setState("FAILED");
    }
  };

  const handleApprove = async () => {
    try {
      setState("EXECUTING_SWAP");
      setExecutionError(null);
      setExecutionMessage(null);

      const execRes = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, amountUsd: intent?.maxBudgetUsd }),
      });

      const data = await execRes.json();
      if (!execRes.ok) {
        setExecutionError(data.error ?? "Execution request failed.");
        setState("FAILED");
        return;
      }

      setExecutionResult(data.result);
      if (data.message) setExecutionMessage(data.message as string);
      setState("COMPLETED");
    } catch (err) {
      console.error(err);
      setExecutionError("Network error during execution request.");
      setState("FAILED");
    }
  };

  const handleReject = () => {
    setState("BUILDING_TRADE_PLAN");
    setQuoteResult(null);
    setApprovalId(null);
  };

  const activeMeta = quoteMeta ?? scanMeta ?? signalMeta;

  // ─── Source label for readiness row ───
  const sourceLabel = activeMeta
    ? activeMeta.source === "okx_real" ? "OKX Real Data"
    : activeMeta.source === "okx_real_failed" ? "OKX Real Failed"
    : activeMeta.source === "fallback_demo" ? "Demo Data"
    : activeMeta.source === "execution_disabled" ? "Execution Off"
    : "Unknown"
    : "—";

  const sourceBadgeClass = activeMeta
    ? activeMeta.source === "okx_real" ? "bg-emerald-50 text-emerald-600 border-emerald-200"
    : activeMeta.source === "okx_real_failed" ? "bg-red-50 text-red-600 border-red-200"
    : activeMeta.source === "fallback_demo" ? "bg-amber-50 text-amber-600 border-amber-200"
    : "bg-muted text-muted-foreground border-border"
    : "bg-muted text-muted-foreground border-border";

  return (
    <div className="bg-background text-foreground font-sans selection:bg-electric/20">
      <Navbar
        appMode={showConsole}
        onLaunch={handleLaunch}
        selectedChain={selectedChain}
        onChainChange={handleChainChange}
        walletConnected={wallet.connected}
        onConnectWallet={wallet.connect}
      />

      {/* ─── Landing Sections ─── */}
      {!showConsole && (
        <>
          <Hero onLaunch={handleLaunch} />
          <SignalDivider />
          <About />
          <SignalDivider />
          <Features />
          <SignalDivider />
          <Ecosystem />
          <CTA onLaunch={handleLaunch} />
          <Footer />
        </>
      )}

      {/* ─── Agent Console ─── */}
      <div 
        ref={consoleRef}
        className={`transition-opacity duration-1000 ${showConsole ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}`}
      >
        <div className="bg-surface-soft noise-texture pt-24 pb-8 relative">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 relative z-10">
            
            {/* Console Header */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 bg-gradient-brand rounded-2xl flex items-center justify-center flex-shrink-0 shadow-soft">
                  <Shield className="text-white w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">Agent Console</h1>
                  <p className="text-muted-foreground text-xs sm:text-sm">Risk-gated KOL signal execution</p>
                </div>
              </div>
              {activeMeta && (
                <div className="pt-1 sm:pt-0">
                  <OkxStatusBadge meta={activeMeta} />
                </div>
              )}
            </header>

            {/* ─── Readiness / Source Row ─── */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 text-xs">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold ${
                tradingMode === "Production"
                  ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                  : "bg-amber-50 text-amber-600 border-amber-200"
              }`}>
                <Database className="w-3 h-3" />
                Mode: {tradingMode}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold ${sourceBadgeClass}`}>
                Source: {sourceLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-electric/10 border-electric/20 text-electric font-bold">
                ⬡ {selectedChain.name} · {selectedChain.chainIndex}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold ${
                wallet.connected
                  ? wallet.correctNetwork
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                    : "bg-red-50 text-red-600 border-red-200"
                  : "bg-muted text-muted-foreground border-border"
              }`}>
                <Wallet className="w-3 h-3" />
                {wallet.connected
                  ? wallet.correctNetwork ? "Connected" : "Wrong network"
                  : "Not connected"
                }
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-muted border-border text-muted-foreground font-bold">
                <StopCircle className="w-3 h-3" />
                Execution: Disabled
              </span>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
              {/* ─── Main Workflow ─── */}
              <div className="flex-1 space-y-6 min-w-0 max-w-4xl">
                
                {/* Input Section */}
                <div className="space-y-5">
                  <ThesisInput
                    value={thesis}
                    onChange={setThesis}
                    onSubmit={runAgent}
                    disabled={isAgentRunning}
                  />

                  {/* Risk Mode selector */}
                  <div className="bg-white/60 backdrop-blur border border-border p-4 rounded-2xl shadow-soft">
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-[0.15em] mb-2">Risk Mode</label>
                    <div className="flex gap-2">
                      {RISK_MODES.map((m) => (
                        <button
                          key={m.value}
                          disabled={isAgentRunning}
                          onClick={() => setRiskMode(m.value)}
                          title={m.description}
                          aria-label={`Set risk mode to ${m.label}: ${m.description}`}
                          className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider border transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                            riskMode === m.value
                              ? m.value === "conservative"
                                ? "bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm"
                                : m.value === "moderate"
                                ? "bg-amber-50 border-amber-200 text-amber-600 shadow-sm"
                                : "bg-red-50 border-red-200 text-red-600 shadow-sm"
                              : "bg-white border-border text-muted-foreground hover:border-electric/30 hover:text-foreground shadow-sm"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Integration error banner */}
                {integrationError && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-3 bg-destructive/10 border border-destructive/20 rounded-2xl p-5 shadow-sm"
                  >
                    <AlertTriangle className="text-destructive w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-destructive mb-1 uppercase tracking-widest">Error</p>
                      <p className="text-sm text-destructive/80 leading-relaxed font-medium break-words">{integrationError}</p>
                      <button
                        onClick={() => { setState("IDLE"); setIntegrationError(null); }}
                        className="mt-3 text-xs font-bold text-destructive/70 hover:text-destructive underline underline-offset-2"
                      >
                        Dismiss and try again
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* IDLE state — how it works */}
                {state === "IDLE" && !integrationError && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/60 backdrop-blur border border-border rounded-3xl p-6 sm:p-8 shadow-soft"
                  >
                    <h3 className="text-lg font-display font-bold text-foreground mb-5 tracking-tight">How the Agent Works</h3>
                    <div className="grid sm:grid-cols-3 gap-4">
                      {[
                        { icon: Radio, step: "1–2", title: "Discover & Parse", desc: "Parses your thesis, then fetches real KOL signals from OKX." },
                        { icon: ScanLine, step: "3", title: "Security Scan", desc: "Each token is scanned via OKX Security for honeypots and risk flags." },
                        { icon: BarChart3, step: "4–5", title: "Quote & Review", desc: "Safe tokens get a real OKX swap quote. You review before any action." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-3">
                          <div className="shrink-0 w-10 h-10 rounded-xl bg-electric/10 grid place-items-center text-electric">
                            <item.icon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-electric uppercase tracking-widest mb-0.5">Step {item.step}</p>
                            <p className="text-sm font-bold text-foreground mb-1">{item.title}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Dynamic Main Content */}
                {state !== "IDLE" && (
                  <div className="space-y-6">
                    <div className="grid sm:grid-cols-2 gap-5 items-start">
                      <AgentProgress state={state} />
                      <ParsedIntentCard intent={intent} />
                    </div>

                    {signals.length > 0 && (
                      <TradePlanTable
                        tokens={signals}
                        chainName={selectedChain.name}
                        onSimulate={handleQuote}
                        fromSymbol={fromSymbol}
                        isSimulating={
                          state === "SIMULATING_SWAP" ||
                          state === "WAITING_FOR_APPROVAL" ||
                          state === "EXECUTING_SWAP"
                        }
                      />
                    )}

                    {/* No tokens passed risk gate */}
                    {state === "BUILDING_TRADE_PLAN" &&
                      signals.length > 0 &&
                      signals.every((s) => s.riskStatus !== "safe") && (
                        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl p-5 text-sm font-medium flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-500" />
                          <p>No tokens passed the risk gate for execution readiness. All discovered tokens are watchlisted or blocked.</p>
                        </div>
                    )}

                    {(state === "SIMULATING_SWAP" || quoteResult || quoteError) && (
                      <QuotePreflightPanel
                        quote={quoteResult}
                        error={quoteError}
                        fromSymbol={fromSymbol}
                        quoteSource={quoteMeta?.source ?? null}
                      />
                    )}

                    {state === "WAITING_FOR_APPROVAL" && (
                      <ApprovalPanel
                        onApprove={handleApprove}
                        onReject={handleReject}
                        disabled={state !== "WAITING_FOR_APPROVAL"}
                        walletConnected={wallet.connected}
                        correctNetwork={wallet.correctNetwork}
                      />
                    )}

                    {(state === "EXECUTING_SWAP" || state === "COMPLETED" || executionError) && (
                      <ResultReport
                        result={executionResult}
                        error={executionError}
                        message={executionMessage}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* ─── Right Sidebar ─── */}
              <div className="lg:w-80 flex-shrink-0 space-y-6">
                <WalletStatusCard
                  wallet={wallet}
                  onConnectWallet={wallet.connect}
                  onDisconnect={wallet.disconnect}
                />
                {state !== "IDLE" && (
                  <RiskPanel 
                    tokens={signals} 
                    maxBudgetUsd={intent?.maxBudgetUsd ?? 50} 
                    fromSymbol={fromSymbol}
                    walletConnected={wallet.connected}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Compact app footer */}
        <AppFooter />
      </div>
    </div>
  );
}
