"use client";

import { motion } from "framer-motion";
import { Radio, ScanLine, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

export type AgentState =
  | "IDLE"
  | "PARSING_THESIS"
  | "FETCHING_SIGNALS"
  | "SCANNING_SECURITY"
  | "BUILDING_TRADE_PLAN"
  | "SIMULATING_SWAP"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING_SWAP"
  | "COMPLETED"
  | "FAILED";

const STEPS = [
  { id: "PARSING_THESIS",    label: "Parse",    icon: Radio },
  { id: "FETCHING_SIGNALS",  label: "Signals",  icon: Radio },
  { id: "SCANNING_SECURITY", label: "Scan",     icon: ScanLine },
  { id: "BUILDING_TRADE_PLAN", label: "Plan",   icon: RefreshCw },
  { id: "SIMULATING_SWAP",   label: "Simulate", icon: RefreshCw },
  { id: "WAITING_FOR_APPROVAL", label: "Approve", icon: ShieldCheck },
] as const;

const ORDER = STEPS.map((s) => s.id);

export function AgentProgress({ state }: { state: AgentState }) {
  const currentIdx = ORDER.indexOf(state as typeof ORDER[number]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/60 backdrop-blur border border-border rounded-3xl p-8 relative overflow-hidden shadow-soft"
    >
      <h3 className="text-sm font-bold text-muted-foreground mb-8 uppercase tracking-[0.2em] text-center font-display">
        Signal Processing Pipeline
      </h3>

      {/* Connection line + animated signal pulses (Desktop) */}
      <div className="hidden md:block relative w-full h-24 mt-4">
        <svg
          className="absolute inset-0 w-full h-full -z-0"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="flowGradProgRef" x1="0" x2="1">
              <stop offset="0" stopColor="oklch(0.92 0.01 260)" />
              <stop offset="0.5" stopColor="oklch(0.62 0.19 260)" />
              <stop offset="1" stopColor="oklch(0.92 0.01 260)" />
            </linearGradient>
          </defs>
          <line x1="10%" y1="50%" x2="90%" y2="50%" stroke="url(#flowGradProgRef)" strokeWidth="2" />
          
          {state !== "IDLE" && state !== "COMPLETED" && state !== "FAILED" && [0, 0.6, 1.2].map((delay, i) => (
            <circle key={i} r="4" fill="oklch(0.62 0.19 260)" cy="50%">
              <animate
                attributeName="cx"
                values="10%;90%"
                dur="3s"
                begin={`${delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                dur="3s"
                begin={`${delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </svg>

        <div className="absolute inset-0 flex items-center justify-between px-[8%] z-10">
          {STEPS.map((step, i) => {
            const isCompleted = currentIdx > i;
            const isCurrent = ORDER[currentIdx] === step.id;
            const isError = state === "FAILED" && isCurrent;
            const isPending = !isCompleted && !isCurrent && !isError;

            return (
              <div key={step.id} className="flex flex-col items-center relative group">
                {isCurrent && (
                  <span className="absolute inset-0 rounded-2xl border border-electric/40 animate-ping opacity-40" />
                )}
                <div className={`relative grid place-items-center h-16 w-16 rounded-2xl border transition-all duration-500 bg-white
                  ${isCompleted ? 'border-emerald-200 text-emerald-500 shadow-sm' : ''}
                  ${isCurrent ? 'border-electric text-electric shadow-glow' : ''}
                  ${isError ? 'border-destructive text-destructive shadow-sm' : ''}
                  ${isPending ? 'border-border text-muted-foreground/40' : ''}
                `}>
                  <step.icon size={24} />
                </div>
                <p className={`mt-4 text-xs font-bold uppercase tracking-wider ${
                  isCompleted ? 'text-emerald-600' :
                  isCurrent ? 'text-electric' :
                  isError ? 'text-destructive' :
                  'text-muted-foreground/50'
                }`}>{step.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: vertical */}
      <div className="md:hidden flex flex-col gap-3 mt-4">
        {STEPS.map((step, i) => {
          const isCompleted = currentIdx > i;
          const isCurrent = ORDER[currentIdx] === step.id;
          const isError = state === "FAILED" && isCurrent;

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div className={`grid place-items-center h-10 w-10 rounded-xl border transition-all bg-white shrink-0
                ${isCompleted ? 'border-emerald-200 text-emerald-500' : ''}
                ${isCurrent ? 'border-electric text-electric shadow-glow' : ''}
                ${isError ? 'border-destructive text-destructive' : ''}
                ${!isCompleted && !isCurrent && !isError ? 'border-border text-muted-foreground/30' : ''}
              `}>
                <step.icon size={16} />
              </div>
              <span className={`text-sm font-medium ${
                isCompleted ? 'text-emerald-600' :
                isCurrent ? 'text-electric' :
                isError ? 'text-destructive' :
                'text-muted-foreground/40'
              }`}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Fail/Complete status */}
      {state === "FAILED" && (
        <div className="mt-6 flex items-center gap-2 text-destructive text-sm font-medium bg-destructive/10 px-4 py-2 rounded-xl border border-destructive/20">
          <AlertTriangle className="w-4 h-4" />
          Agent encountered an error. Check error details below.
        </div>
      )}
      {state === "COMPLETED" && (
        <div className="mt-6 flex items-center gap-2 text-emerald-600 text-sm font-medium bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
          <ShieldCheck className="w-4 h-4" />
          Pipeline completed successfully.
        </div>
      )}
    </motion.div>
  );
}
