"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Wallet, ChevronDown } from "lucide-react";
import { SUPPORTED_CHAINS, type ChainConfig } from "../lib/chains";

const landingLinks = [
  { label: "Read More", href: "#about" },
  { label: "Safety Model", href: "#safety-model" },
  { label: "How It Works", href: "#ecosystem" },
];

interface NavbarProps {
  /** Whether the user is in app/console mode vs landing */
  appMode: boolean;
  onLaunch?: () => void;
  /** Selected chain config */
  selectedChain: ChainConfig;
  onChainChange: (chain: ChainConfig) => void;
  walletConnected: boolean;
  onConnectWallet: () => void;
}

function ChainIcon({ label, size = 20 }: { label: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-gradient-brand text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {label}
    </span>
  );
}

export function Navbar({
  appMode,
  onLaunch,
  selectedChain,
  onChainChange,
  walletConnected,
  onConnectWallet,
}: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close chain dropdown on outside click
  useEffect(() => {
    if (!chainOpen) return;
    const close = () => setChainOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [chainOpen]);

  const textColor = scrolled ? "text-white" : "text-foreground";
  const subtextColor = scrolled ? "text-white/70" : "text-foreground/60";

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }}
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? "glass-dark border-b border-white/10" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 h-16 md:h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className={`text-xl md:text-2xl font-bold tracking-tight transition-colors ${textColor}`}>
            Aegis<span className="text-gradient-brand">X</span>
          </span>
        </Link>

        {/* ─── Desktop Nav ─── */}
        <nav className="hidden md:flex items-center gap-1">
          {!appMode && (
            <>
              {/* Landing links */}
              {landingLinks.map((it) => (
                <a
                  key={it.label}
                  href={it.href}
                  className={`relative group px-4 py-2 text-sm rounded-full transition-all duration-300 ${
                    scrolled ? "text-white/80 hover:text-white" : "text-foreground/70 hover:text-foreground"
                  }`}
                >
                  {it.label}
                  <span
                    className={`absolute left-4 right-4 -bottom-0.5 h-px scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left ${
                      scrolled ? "bg-gradient-to-r from-electric to-indigo-soft" : "bg-foreground/40"
                    }`}
                  />
                </a>
              ))}
              {/* Launch App — landing only */}
              <button
                onClick={onLaunch}
                aria-label="Launch Agent Console"
                className="ml-2 relative inline-flex items-center rounded-full bg-gradient-brand text-white px-5 py-2 text-sm font-medium hover:shadow-glow transition-all duration-300 hover:scale-[1.03]"
                style={{ boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.2), 0 10px 30px -10px oklch(0.62 0.19 260 / 0.5)" }}
              >
                Launch App
              </button>
            </>
          )}

          {appMode && (
            <>
              {/* Back to overview */}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className={`px-4 py-2 text-sm rounded-full transition-all duration-300 ${subtextColor} hover:${textColor}`}
              >
                Overview
              </a>

              {/* Chain Selector */}
              <div className="relative ml-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setChainOpen((o) => !o); }}
                  aria-label="Select chain"
                  aria-expanded={chainOpen}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium border transition-all duration-300 ${
                    scrolled
                      ? "bg-white/10 border-white/20 text-white/90 hover:bg-white/20"
                      : "bg-white border-border text-foreground hover:border-electric/30"
                  }`}
                >
                  <ChainIcon label={selectedChain.iconLabel} />
                  <span className="hidden lg:inline">{selectedChain.name}</span>
                  <ChevronDown size={14} className={`transition-transform ${chainOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {chainOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-white border border-border shadow-soft overflow-hidden z-50"
                    >
                      {SUPPORTED_CHAINS.map((c) => (
                        <button
                          key={c.id}
                          disabled={!c.enabled}
                          onClick={() => { if (c.enabled) { onChainChange(c); setChainOpen(false); } }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                            c.id === selectedChain.id
                              ? "bg-electric/10 text-electric font-bold"
                              : c.enabled
                              ? "text-foreground hover:bg-muted"
                              : "text-muted-foreground/50 cursor-not-allowed"
                          }`}
                        >
                          <ChainIcon label={c.iconLabel} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-[10px] text-muted-foreground">Index: {c.chainIndex}</div>
                          </div>
                          {c.id === selectedChain.id && (
                            <span className="w-1.5 h-1.5 rounded-full bg-electric" />
                          )}
                          {!c.enabled && c.disabledReason && (
                            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{c.disabledReason}</span>
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Connect Wallet */}
              <button
                onClick={onConnectWallet}
                aria-label={walletConnected ? "Wallet connected" : "Connect wallet"}
                className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border transition-all duration-300 ${
                  walletConnected
                    ? scrolled
                      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300"
                      : "bg-emerald-50 border-emerald-200 text-emerald-600"
                    : scrolled
                    ? "bg-white/10 border-white/20 text-white/80 hover:bg-white/20 hover:text-white"
                    : "bg-white border-border text-foreground/70 hover:border-electric/30 hover:text-foreground"
                }`}
              >
                <Wallet size={14} />
                <span className="hidden lg:inline">{walletConnected ? "Connected" : "Connect"}</span>
                {walletConnected && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                )}
              </button>
            </>
          )}
        </nav>

        {/* ─── Mobile Right ─── */}
        <div className="md:hidden flex items-center gap-1.5">
          {appMode && (
            <>
              {/* Compact chain icon */}
              <button
                onClick={(e) => { e.stopPropagation(); setChainOpen((o) => !o); }}
                aria-label="Select chain"
                className={`p-2 rounded-full transition-colors ${scrolled ? "text-white/80" : "text-foreground/70"}`}
              >
                <ChainIcon label={selectedChain.iconLabel} size={22} />
              </button>
              {/* Compact wallet icon */}
              <button
                onClick={onConnectWallet}
                aria-label={walletConnected ? "Wallet connected" : "Connect wallet"}
                className={`p-2 rounded-full transition-colors ${
                  walletConnected
                    ? scrolled ? "text-emerald-300" : "text-emerald-600"
                    : scrolled ? "text-white/70" : "text-foreground/60"
                }`}
              >
                <Wallet size={18} />
              </button>
            </>
          )}
          <button
            aria-label="Toggle navigation menu"
            onClick={() => setMobileOpen((o) => !o)}
            className={`p-2 rounded-full transition-colors ${scrolled ? "text-white" : "text-foreground"}`}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* ─── Mobile Drawer ─── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="md:hidden overflow-hidden bg-navy text-white"
          >
            <div className="px-6 py-6 flex flex-col gap-1">
              {!appMode && (
                <>
                  {landingLinks.map((it) => (
                    <a
                      key={it.label}
                      href={it.href}
                      onClick={() => setMobileOpen(false)}
                      className="px-3 py-3 rounded-xl text-base text-white/80 hover:bg-white/10 hover:text-white"
                    >
                      {it.label}
                    </a>
                  ))}
                  <button
                    onClick={() => { setMobileOpen(false); onLaunch?.(); }}
                    className="mt-2 rounded-xl bg-gradient-brand text-white px-5 py-3 text-center font-medium"
                  >
                    Launch App
                  </button>
                </>
              )}

              {appMode && (
                <>
                  {/* Chain selector in mobile menu */}
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Network</p>
                    <div className="flex gap-2">
                      {SUPPORTED_CHAINS.map((c) => (
                        <button
                          key={c.id}
                          disabled={!c.enabled}
                          onClick={() => { onChainChange(c); }}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                            c.id === selectedChain.id
                              ? "bg-electric/20 border-electric/40 text-white"
                              : c.enabled
                              ? "border-white/10 text-white/60 hover:bg-white/10"
                              : "border-white/5 text-white/30 cursor-not-allowed"
                          }`}
                        >
                          <ChainIcon label={c.iconLabel} size={18} />
                          {c.name}
                          {!c.enabled && <span className="text-[9px] uppercase">Soon</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => { setMobileOpen(false); onConnectWallet(); }}
                    className={`mt-2 rounded-xl px-5 py-3 text-center font-medium border ${
                      walletConnected
                        ? "border-emerald-400/40 text-emerald-300 bg-emerald-500/20"
                        : "border-white/20 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Wallet size={16} />
                      {walletConnected ? "Wallet Connected" : "Connect Wallet"}
                    </span>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile chain dropdown overlay (app mode) */}
      <AnimatePresence>
        {chainOpen && appMode && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="md:hidden absolute right-4 top-full mt-1 w-56 rounded-2xl bg-white border border-border shadow-soft overflow-hidden z-50"
          >
            {SUPPORTED_CHAINS.map((c) => (
              <button
                key={c.id}
                disabled={!c.enabled}
                onClick={() => { if (c.enabled) { onChainChange(c); setChainOpen(false); } }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                  c.id === selectedChain.id
                    ? "bg-electric/10 text-electric font-bold"
                    : c.enabled
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground/50 cursor-not-allowed"
                }`}
              >
                <ChainIcon label={c.iconLabel} />
                <span>{c.name}</span>
                {!c.enabled && c.disabledReason && (
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">{c.disabledReason}</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
