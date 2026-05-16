"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Eye,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Lock,
} from "lucide-react";
import { useState, useCallback } from "react";
import type { SimulationResult } from "../lib/schemas";

type ExecutionState =
  | "idle"
  | "approving"
  | "confirming"
  | "building_tx"
  | "awaiting_signature"
  | "submitted"
  | "confirmed"
  | "failed"
  | "rejected"
  | "wrong_chain";

interface Props {
  quote: SimulationResult;
  fromSymbol: string;
  toSymbol?: string;
  approvalId?: string;
  showExecute?: boolean;
  getAccessToken?: () => Promise<string | null>;
  getIdentityToken?: () => Promise<string | null>;
  walletAddress?: string | null;
  targetWalletAddress?: string | null;
  onConnectWallet?: () => void;
  amount?: number;
  tokenAddress?: string;
  scanDecision?: string;
  chainConfig?: import("../lib/chains").ChainConfig;
  needsApproval?: boolean;
  approveTxData?: { to: string; data: string; value: string; chainId?: string; gas?: string; gasLimit?: string; gasPrice?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string; } | null;
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.ethereum ?? null;
}

const WALLET_ERROR_CODES: Record<number, ExecutionState> = {
  4001: "rejected",
  4100: "rejected",
  4902: "wrong_chain",
};

export function QuoteCard({
  quote,
  fromSymbol,
  toSymbol,
  approvalId,
  showExecute = false,
  getAccessToken,
  getIdentityToken,
  walletAddress,
  targetWalletAddress,
  onConnectWallet,
  amount,
  tokenAddress,
  scanDecision,
  chainConfig,
  needsApproval,
  approveTxData,
}: Props) {
  const slippageOk = quote.slippage < 3;
  const [execState, setExecState] = useState<ExecutionState>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [currentNeedsApproval, setCurrentNeedsApproval] = useState(!!needsApproval);

  // Expiry handling
  const [isExpired, setIsExpired] = useState(false);
  useState(() => {
    // 5 minutes expiry
    const timer = setTimeout(() => setIsExpired(true), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  });

  const walletMismatch = targetWalletAddress && walletAddress && targetWalletAddress.toLowerCase() !== walletAddress.toLowerCase();
  const isHighRisk = scanDecision && scanDecision !== "safe";
  const liveMode = process.env.NEXT_PUBLIC_ENABLE_LIVE_EXECUTION === "true";

  const handleExecute = useCallback(async () => {
    if (!approvalId || !walletAddress || isExpired || isHighRisk || walletMismatch) return;
    
    if (currentNeedsApproval && approveTxData) {
      setExecState("approving");
      setExecError(null);
      const provider = getEthereumProvider();
      if (!provider) {
        setExecState("failed");
        setExecError("No wallet provider found.");
        return;
      }
      try {
        const txParams: Record<string, string> = { from: walletAddress, to: approveTxData.to, data: approveTxData.data };
        if (approveTxData.value) txParams.value = approveTxData.value;
        const hash = await provider.request({ method: "eth_sendTransaction", params: [txParams] }) as string;
        setApprovalTxHash(hash);
        setCurrentNeedsApproval(false);
        setExecState("idle");
        return;
      } catch (err: unknown) {
        setExecState("failed");
        setExecError((err as { message?: string })?.message || "User rejected approval.");
        return;
      }
    }

    setExecState("confirming");
    setExecError(null);

    try {
      let authToken = "client-token";
      let identityToken: string | null = null;
      if (getAccessToken) { try { const t = await getAccessToken(); if (t) authToken = t; } catch { /* */ } }
      if (getIdentityToken) { try { identityToken = await getIdentityToken(); } catch { /* */ } }

      setExecState("building_tx");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        "x-wallet-address": walletAddress,
      };
      if (identityToken) headers["x-privy-identity-token"] = identityToken;

      const execRes = await fetch("/api/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({
          approvalId,
          riskAcknowledged,
          approvalTxHash,
        }),
      });

      const execData = await execRes.json() as {
        executionId?: string;
        unsignedTx?: { to: string; data: string; value: string; chainId?: string; gas?: string; gasLimit?: string; gasPrice?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string; };
        error?: string; message?: string; result?: { status: string };
      };

      if (execData.result?.status === "execution_disabled") {
        setExecState("idle");
        setExecError(execData.message ?? "Live execution is disabled.");
        return;
      }

      if (!execRes.ok || !execData.unsignedTx) {
        setExecState("failed");
        setExecError(execData.error ?? "Failed to build transaction.");
        return;
      }

      setExecState("awaiting_signature");
      const provider = getEthereumProvider();
      if (!provider) {
        setExecState("failed");
        setExecError("No wallet provider found. Please install MetaMask or use Privy embedded wallet.");
        return;
      }

      const tx = execData.unsignedTx;
      const txParams: Record<string, string> = { from: walletAddress, to: tx.to, data: tx.data, value: tx.value };
      if (tx.gas) txParams.gas = tx.gas;
      if (tx.gasLimit) txParams.gas = tx.gasLimit;
      if (tx.gasPrice) txParams.gasPrice = tx.gasPrice;
      if (tx.maxFeePerGas) txParams.maxFeePerGas = tx.maxFeePerGas;
      if (tx.maxPriorityFeePerGas) txParams.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;

      let hash: string;
      try {
        hash = (await provider.request({ method: "eth_sendTransaction", params: [txParams] })) as string;
      } catch (walletError: unknown) {
        const code = (walletError as { code?: number })?.code;
        if (code && WALLET_ERROR_CODES[code]) {
          setExecState(WALLET_ERROR_CODES[code]);
          setExecError(code === 4001 ? "Transaction rejected by wallet." : code === 4902 ? "Please switch to the correct chain." : "Wallet authorization failed.");
        } else {
          setExecState("failed");
          setExecError(`Wallet error: ${walletError instanceof Error ? walletError.message : String(walletError)}`);
        }
        return;
      }

      setTxHash(hash);
      setExecState("submitted");

      try {
        const confirmRes = await fetch("/api/confirm", { method: "POST", headers, body: JSON.stringify({ executionId: execData.executionId, txHash: hash, chainId: tx.chainId }) });
        const confirmData = await confirmRes.json() as { status?: string; explorerUrl?: string };
        if (confirmData.explorerUrl) setExplorerUrl(confirmData.explorerUrl);
        if (confirmData.status === "confirmed") setExecState("confirmed");
        else if (confirmData.status === "reverted" || confirmData.status === "failed") { setExecState("failed"); setExecError("Transaction reverted on-chain."); }
      } catch { /* tx submitted, user checks explorer */ }
    } catch (err) {
      setExecState("failed");
      setExecError(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [approvalId, walletAddress, getAccessToken, getIdentityToken, quote, riskAcknowledged, isExpired, isHighRisk, walletMismatch]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-border rounded-2xl overflow-hidden shadow-soft"
    >
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <Eye className="w-4 h-4 text-electric" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">Trade Preview</h4>
      </div>

      <div className="p-4 space-y-3">
        {/* Route */}
        <div className="flex items-center gap-3">
          <span className="font-bold text-foreground text-sm">{fromSymbol}</span>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <span className="font-bold text-foreground text-sm">{toSymbol ?? "Target"}</span>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Expected Output</p>
            <p className="text-sm font-bold text-foreground">${quote.expectedOutputUsd.toFixed(2)}</p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Slippage</p>
            <p className={`text-sm font-bold ${slippageOk ? "text-emerald-600" : "text-red-600"}`}>{quote.slippage.toFixed(2)}%</p>
          </div>
          <div className="bg-muted/40 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Gas Fee</p>
            <p className="text-sm font-bold text-foreground">${quote.gasFeeUsd.toFixed(4)}</p>
          </div>
        </div>

        {/* Route info */}
        <div className="text-[10px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 font-mono break-all">
          <p>Amount: {amount ? `$${amount}` : "Unknown"} {fromSymbol}</p>
          <p>Token: {tokenAddress || "Unknown"}</p>
          <p>Router: {quote.route}</p>
        </div>

        {/* Chain & Security info */}
        <div className="space-y-1.5 text-xs">
          {chainConfig ? (
            <div className="flex items-center gap-2 bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-muted-foreground">
              <span className="font-semibold">{chainConfig.name}</span>
              <span>(ID: {chainConfig.id})</span>
            </div>
          ) : null}

          {scanDecision === "safe" ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
              LOW risk by current scan
            </div>
          ) : scanDecision ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              BLOCKED: {scanDecision === "high_risk" ? "MEDIUM/HIGH risk detected" : "Unknown risk state"}
            </div>
          ) : null}

          {walletAddress && targetWalletAddress && (
            <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${walletMismatch ? "bg-red-50 border-red-200 text-red-700 font-semibold" : "bg-muted/20 border-border/50 text-muted-foreground"}`}>
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Verified Wallet: {targetWalletAddress.slice(0,6)}...{targetWalletAddress.slice(-4)}</span>
              {walletMismatch && <span className="ml-auto">Mismatch! Connect correct wallet.</span>}
            </div>
          )}
        </div>

        {/* Slippage warning */}
        {!slippageOk && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            High slippage detected. Review carefully before confirming.
          </div>
        )}

        {isExpired && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
            Quote expired, request a new quote.
          </div>
        )}

      {/* ── Execution Section ── */}
        <AnimatePresence mode="wait">
          {showExecute && approvalId && execState === "idle" && (
            <motion.div key="confirm-button" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-3 pt-3 border-t border-border/50">
              {walletAddress ? (
                <>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                    <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-800 mb-0.5">User-Signed Execution (Demo Hard Cap Applies)</p>
                      <p>Your wallet will ask you to review and sign. PhylaX never signs for you.</p>
                    </div>
                  </div>
                  
                  {liveMode ? (
                    <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer bg-muted/20 p-2 rounded-lg border border-border/50 hover:bg-muted/40 transition-colors">
                      <input 
                        type="checkbox" 
                        className="mt-0.5 rounded border-gray-300 text-electric focus:ring-electric"
                        checked={riskAcknowledged}
                        onChange={(e) => setRiskAcknowledged(e.target.checked)}
                      />
                      <span>
                        I acknowledge that PhylaX is not financial advice, signals are not proof of safety, on-chain trades can lose funds, and PhylaX cannot recover losses. I accept all risks.
                      </span>
                    </label>
                  ) : null}

                  <button
                    id="confirm-execute-btn"
                    onClick={handleExecute}
                    disabled={(liveMode && !riskAcknowledged) || isExpired || isHighRisk || !!walletMismatch || execState !== "idle"}
                    className={`w-full py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
                      (!liveMode || riskAcknowledged) && !isExpired && !isHighRisk && !walletMismatch && execState === "idle"
                        ? "bg-gradient-brand text-white hover:shadow-glow hover:scale-[1.01]" 
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {currentNeedsApproval ? "Approve token spending" : "Sign swap in wallet"}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p>Wallet connection required to sign and submit this transaction.</p>
                  </div>
                  <button
                    onClick={onConnectWallet}
                    className="w-full py-3 px-4 rounded-xl border border-electric/30 text-electric text-sm font-bold hover:bg-electric/5 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    Connect Wallet to Sign
                  </button>
                </>
              )}
            </motion.div>
          )}

          {!showExecute && execState === "idle" && (
            <motion.div key="exec-disabled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2.5">
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                Live execution disabled
              </div>
            </motion.div>
          )}

          {(execState === "confirming" || execState === "building_tx" || execState === "approving") && (
            <motion.div key="building" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-sm text-electric font-medium pt-3 border-t border-border/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              {execState === "approving" ? "Awaiting approval signature…" : execState === "confirming" ? "Preparing transaction…" : "Building transaction data…"}
            </motion.div>
          )}

          {execState === "awaiting_signature" && (
            <motion.div key="signing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-sm text-amber-600 font-medium pt-3 border-t border-border/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting for wallet signature…
            </motion.div>
          )}

          {execState === "submitted" && (
            <motion.div key="submitted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                Transaction submitted. Waiting for confirmation…
              </div>
              {txHash && <p className="text-[10px] text-muted-foreground font-mono break-all">Tx: {txHash}</p>}
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          )}

          {execState === "confirmed" && (
            <motion.div key="confirmed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Transaction confirmed on-chain
              </div>
              {txHash && <p className="text-[10px] text-muted-foreground font-mono break-all">Tx: {txHash}</p>}
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          )}

          {(execState === "failed" || execState === "rejected" || execState === "wrong_chain") && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
                <XCircle className="w-4 h-4" />
                {execState === "rejected" ? "Transaction rejected by wallet." : execState === "wrong_chain" ? "Wrong chain. Please switch networks." : "Transaction failed."}
              </div>
              {execError && (
                <div>
                  <button onClick={() => setShowErrorDetail((v) => !v)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    {showErrorDetail ? "▾ Hide detail" : "▸ Show detail"}
                  </button>
                  {showErrorDetail && <p className="text-xs text-red-500 mt-1 font-mono break-all">{execError}</p>}
                </div>
              )}
              {txHash && <p className="text-[10px] text-muted-foreground font-mono break-all">Tx: {txHash}</p>}
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-electric hover:underline">
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
