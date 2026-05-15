"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, HelpCircle, ListChecks } from "lucide-react";
import { ChainBadge } from "./ChainBadge";
import type { TokenSignal } from "../lib/schemas";

interface Props {
  tokens: TokenSignal[];
  chainName: string;
}

const riskBadge = (status: TokenSignal["riskStatus"]) => {
  switch (status) {
    case "safe":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" /> Low Risk
        </span>
      );
    case "high_risk":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200">
          <AlertTriangle className="w-3 h-3" /> High Risk
        </span>
      );
    case "unknown":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
          <HelpCircle className="w-3 h-3" /> Needs Review
        </span>
      );
    case "skipped":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
          Skipped
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
          Pending
        </span>
      );
  }
};

export function TradePlanCard({ tokens, chainName }: Props) {
  if (!tokens.length) return null;

  const chainId = chainName.toLowerCase().includes("layer") ? "x-layer" : chainName.toLowerCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-border rounded-2xl overflow-hidden shadow-soft"
    >
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-electric" />
          <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">
            Trade Plan
          </h4>
        </div>
        <ChainBadge chainName={chainName} chainId={chainId} size="sm" />
      </div>
      <div className="divide-y divide-border">
        {tokens.map((t, i) => (
          <div
            key={`${t.address}-${i}`}
            className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-foreground">{t.symbol}</span>
                {riskBadge(t.riskStatus)}
              </div>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{t.address}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-foreground">${t.amountUsd}</p>
              <p className="text-[10px] text-muted-foreground">
                {t.triggerCount} signal{t.triggerCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
