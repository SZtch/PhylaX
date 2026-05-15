"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { ChainBadge } from "./ChainBadge";
import { SUPPORTED_CHAINS, type ChainConfig } from "../lib/chains";

interface Props {
  selected: ChainConfig;
  onChange: (chain: ChainConfig) => void;
}

export function ChainSelector({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs font-medium bg-muted/30 border border-border/60 rounded-lg px-2.5 py-1.5 hover:bg-muted/50 hover:border-border transition-colors duration-150 whitespace-nowrap"
      >
        <ChainBadge chainName={selected.name} chainId={selected.id} size="sm" />
        <ChevronDown className={`w-3 h-3 text-muted-foreground chevron-rotate ${open ? "is-open" : ""}`} />
      </button>

      {/* Always-mounted dropdown with CSS transitions */}
      <div className={`absolute top-full right-0 mt-1.5 w-[200px] bg-white border border-border rounded-xl shadow-soft py-1 z-50 dropdown-panel ${open ? "is-open" : ""}`}>
        {SUPPORTED_CHAINS.map((chain) => (
          <button
            key={chain.id}
            onClick={() => {
              if (chain.enabled) {
                onChange(chain);
                setOpen(false);
              }
            }}
            disabled={!chain.enabled}
            className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors duration-120 ${
              chain.enabled
                ? "hover:bg-muted/50 cursor-pointer"
                : "opacity-40 cursor-not-allowed"
            }`}
          >
            <ChainBadge chainName={chain.name} chainId={chain.id} size="sm" />
            <div className="flex items-center gap-1.5">
              {!chain.enabled && (
                <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {chain.disabledReason ?? "Soon"}
                </span>
              )}
              {chain.id === selected.id && chain.enabled && (
                <Check className="w-3.5 h-3.5 text-electric" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
