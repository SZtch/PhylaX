"use client";

import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldOff, Ban } from "lucide-react";

interface Props {
  tokenSymbol: string;
  tokenAddress: string;
  riskLevel: "safe" | "high_risk" | "unknown" | "skipped" | "pending";
  details?: string;
}

export function RiskResultCard({ tokenSymbol, tokenAddress, riskLevel, details }: Props) {
  const config = {
    safe: {
      icon: ShieldCheck,
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      labelColor: "text-emerald-700",
      label: "Low Risk — Passed Security Scan",
      barColor: "bg-emerald-500",
    },
    high_risk: {
      icon: Ban,
      bg: "bg-red-50",
      border: "border-red-200",
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      labelColor: "text-red-700",
      label: "High Risk — Blocked",
      barColor: "bg-red-500",
    },
    unknown: {
      icon: ShieldAlert,
      bg: "bg-amber-50",
      border: "border-amber-200",
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      labelColor: "text-amber-700",
      label: "Unknown Risk — Needs Review",
      barColor: "bg-amber-500",
    },
    skipped: {
      icon: ShieldOff,
      bg: "bg-muted",
      border: "border-border",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      labelColor: "text-muted-foreground",
      label: "Scan Skipped",
      barColor: "bg-muted-foreground/30",
    },
    pending: {
      icon: ShieldQuestion,
      bg: "bg-muted",
      border: "border-border",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      labelColor: "text-muted-foreground",
      label: "Scan Pending",
      barColor: "bg-muted-foreground/30",
    },
  }[riskLevel];

  const Icon = config.icon;
  const isBlocked = riskLevel === "high_risk";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${config.bg} border ${config.border} rounded-2xl overflow-hidden shadow-soft`}
    >
      <div className={`h-1 ${config.barColor}`} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.iconBg} border ${config.border}`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-bold text-sm text-foreground">{tokenSymbol}</span>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${config.labelColor}`}>
                {config.label}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono truncate">{tokenAddress}</p>
            {details && (
              <p className="mt-2 text-xs text-foreground/70 leading-relaxed">{details}</p>
            )}
            {isBlocked && (
              <div className="mt-3 flex items-center gap-2 text-xs text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
                <Ban className="w-3.5 h-3.5 flex-shrink-0" />
                This token has been flagged as high risk. Trade execution is blocked.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
