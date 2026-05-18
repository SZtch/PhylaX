"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Ban, ShieldAlert, ShieldOff, ShieldQuestion } from "lucide-react";

interface Props {
  tokenSymbol: string;
  tokenAddress: string;
  riskLevel: "safe" | "high_risk" | "unknown" | "skipped" | "pending";
  details?: string;
}

const CONFIG = {
  safe: {
    icon: ShieldCheck,
    label: "CLEAR",
    sublabel: "Dual scan passed",
    bg: "oklch(0.5 0.15 160 / 0.08)",
    border: "oklch(0.55 0.15 160 / 0.2)",
    iconColor: "oklch(0.6 0.17 160)",
    labelColor: "oklch(0.6 0.17 160)",
    barColor: "oklch(0.6 0.17 160)",
    barWidth: "15%",
    glowColor: "oklch(0.6 0.17 160 / 0.1)",
  },
  high_risk: {
    icon: Ban,
    label: "BLOCKED",
    sublabel: "High risk detected",
    bg: "oklch(0.55 0.22 27 / 0.08)",
    border: "oklch(0.55 0.22 27 / 0.2)",
    iconColor: "oklch(0.7 0.2 27)",
    labelColor: "oklch(0.7 0.2 27)",
    barColor: "oklch(0.65 0.22 27)",
    barWidth: "92%",
    glowColor: "oklch(0.65 0.22 27 / 0.08)",
  },
  unknown: {
    icon: ShieldAlert,
    label: "CAUTION",
    sublabel: "Needs manual review",
    bg: "oklch(0.6 0.18 85 / 0.08)",
    border: "oklch(0.6 0.18 85 / 0.2)",
    iconColor: "oklch(0.7 0.18 85)",
    labelColor: "oklch(0.7 0.18 85)",
    barColor: "oklch(0.65 0.18 85)",
    barWidth: "55%",
    glowColor: "oklch(0.65 0.18 85 / 0.08)",
  },
  skipped: {
    icon: ShieldOff,
    label: "SKIPPED",
    sublabel: "Scan not performed",
    bg: "oklch(0.5 0.02 260 / 0.06)",
    border: "oklch(0.5 0.02 260 / 0.12)",
    iconColor: "oklch(0.6 0.02 260)",
    labelColor: "oklch(0.6 0.02 260)",
    barColor: "oklch(0.6 0.02 260)",
    barWidth: "0%",
    glowColor: "transparent",
  },
  pending: {
    icon: ShieldQuestion,
    label: "PENDING",
    sublabel: "Scan in progress",
    bg: "oklch(0.62 0.19 260 / 0.06)",
    border: "oklch(0.62 0.19 260 / 0.15)",
    iconColor: "oklch(0.7 0.19 260)",
    labelColor: "oklch(0.65 0.12 260)",
    barColor: "oklch(0.62 0.19 260)",
    barWidth: "40%",
    glowColor: "oklch(0.62 0.19 260 / 0.08)",
  },
};

export function RiskResultCard({ tokenSymbol, tokenAddress, riskLevel, details }: Props) {
  const c = CONFIG[riskLevel] ?? CONFIG.pending;
  const Icon = c.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border"
      style={{ background: c.bg, borderColor: c.border, boxShadow: `0 4px 24px ${c.glowColor}` }}
    >
      <div className="px-4 py-3.5 flex items-center gap-3">
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: c.glowColor, border: `1px solid ${c.border}` }}>
          <Icon className="w-5 h-5" style={{ color: c.iconColor }} />
        </div>

        {/* Label + token */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold" style={{ color: c.labelColor }}>
              {c.label}
            </span>
            <span className="text-[11px] font-bold text-foreground">{tokenSymbol}</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: c.labelColor, opacity: 0.7 }}>{c.sublabel}</p>
        </div>

        {/* Risk meter */}
        <div className="shrink-0 text-right">
          <div className="w-20 h-1.5 rounded-full overflow-hidden bg-black/8">
            <motion.div
              className="h-full rounded-full"
              style={{ background: c.barColor }}
              initial={{ width: 0 }}
              animate={{ width: c.barWidth }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <p className="text-[9px] mt-1 font-bold uppercase tracking-wider" style={{ color: c.labelColor, opacity: 0.6 }}>
            Risk level
          </p>
        </div>
      </div>

      {/* Address */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <p className="text-[10px] font-mono truncate" style={{ color: c.labelColor, opacity: 0.5 }}>
          {tokenAddress}
        </p>
      </div>

      {/* Details */}
      {details && (
        <div className="px-4 pb-3.5">
          <p className="text-[11px] leading-relaxed" style={{ color: c.labelColor, opacity: 0.75 }}>
            {details}
          </p>
        </div>
      )}
    </motion.div>
  );
}
