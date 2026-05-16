"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { PanelLeft, ChevronDown, LogOut, User, AlertTriangle } from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Hero } from "../components/Hero";
import { SignalDivider } from "../components/SignalDivider";
import { About } from "../components/About";
import { Features } from "../components/Features";
import { Ecosystem } from "../components/Ecosystem";
import { CTA } from "../components/CTA";
import { Footer } from "../components/Footer";
import { ChatPanel } from "../components/ChatPanel";
import { AppSidebar, type ChatSession, type SidebarView } from "../components/AppSidebar";
import { PortfolioPanel } from "../components/PortfolioPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { ChainSelector } from "../components/ChainSelector";
import { DEFAULT_CHAIN, type ChainConfig } from "../lib/chains";
import { usePrivyAuth } from "../components/PrivyProviderWrapper";
import { CopyAddress } from "../components/CopyAddress";

function createSession(): ChatSession {
  return { id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: "New Chat", createdAt: Date.now() };
}

const EXECUTION_MODE = process.env.NEXT_PUBLIC_ENABLE_LIVE_EXECUTION === "true" ? "Live" : "Simulation";

export default function Home() {
  const [showConsole, setShowConsole] = useState(false);
  const [selectedChain, setSelectedChain] = useState<ChainConfig>(DEFAULT_CHAIN);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("agent");
  const consoleRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Track view transitions with a key to trigger the CSS animation
  const [viewKey, setViewKey] = useState(0);

  const privy = usePrivyAuth();

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  const handleLaunch = useCallback(() => {
    setShowConsole(true);
    setTimeout(() => consoleRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);
  const handleChainChange = useCallback((chain: ChainConfig) => { if (chain.enabled) setSelectedChain(chain); }, []);
  const handleSignIn = useCallback(() => { privy.login(); }, [privy]);
  const handleLogout = useCallback(async () => { await privy.logout(); setUserMenuOpen(false); }, [privy]);
  const handleConnectWallet = useCallback(() => { privy.connectWallet(); setUserMenuOpen(false); }, [privy]);
  const handleChangeView = useCallback((view: SidebarView) => {
    setActiveView(view);
    setMobileSidebar(false);
    setViewKey(k => k + 1);
  }, []);

  // ─── DB Session Management ──────────────────────────────────────────

  const handleNewChat = useCallback(async () => {
    setActiveView("agent");
    setViewKey(k => k + 1);

    if (privy.authenticated) {
      try {
        const token = await privy.getAccessToken();
        const res = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chain: selectedChain.id }),
        });
        const data = await res.json();
        if (data.session) {
          const newS = {
            id: data.session.id,
            label: data.session.title,
            createdAt: new Date(data.session.createdAt).getTime(),
          };
          setSessions(prev => [newS, ...prev]);
          setActiveSessionId(newS.id);
        }
      } catch (err) {
        console.error("Failed to create session:", err);
      }
    } else {
      const s = createSession();
      setSessions(prev => [s, ...prev]);
      setActiveSessionId(s.id);
    }
  }, [privy, selectedChain.id]);

  const fetchSessions = useCallback(async () => {
    if (!privy.authenticated) return;
    setIsLoadingSessions(true);
    try {
      const token = await privy.getAccessToken();
      const res = await fetch("/api/chat/sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.sessions) {
        const formatted = data.sessions.map((s: { id: string; title: string; createdAt: string }) => ({
          id: s.id,
          label: s.title,
          createdAt: new Date(s.createdAt).getTime(),
        }));
        setSessions(formatted);
        if (formatted.length > 0) {
          setActiveSessionId(formatted[0].id);
        } else {
          // Create an initial session if none exist
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [privy, handleNewChat]);

  useEffect(() => {
    if (!privy.authenticated || sessions.length > 0 || isLoadingSessions) return;

    let ignore = false;
    setTimeout(() => setIsLoadingSessions(true), 0);

    const runFetch = async () => {
      try {
        const token = await privy.getAccessToken();
        const res = await fetch("/api/chat/sessions", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        
        if (!ignore && data.sessions) {
          const formatted = data.sessions.map((s: { id: string; title: string; createdAt: string }) => ({
            id: s.id,
            label: s.title,
            createdAt: new Date(s.createdAt).getTime(),
          }));
          setSessions(formatted);
          if (formatted.length > 0) {
            setActiveSessionId(formatted[0].id);
          } else {
            handleNewChat();
          }
        }
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
      } finally {
        if (!ignore) setIsLoadingSessions(false);
      }
    };

    runFetch();
    return () => { ignore = true; };
  }, [privy, handleNewChat, sessions.length, isLoadingSessions]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setActiveView("agent");
    setViewKey(k => k + 1);
  }, []);

  const handleRenameSession = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const short = trimmed.length > 35 ? trimmed.slice(0, 35) + "…" : trimmed;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, label: short } : s));
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    // Optimistic UI
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        handleNewChat();
        return [];
      }
      if (id === activeSessionId) setActiveSessionId(next[0].id);
      return next;
    });

    if (privy.authenticated) {
      try {
        const token = await privy.getAccessToken();
        await fetch(`/api/chat/sessions/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error("Failed to delete session:", err);
        // Re-fetch on error to sync with DB
        fetchSessions();
      }
    }
  }, [activeSessionId, fetchSessions, handleNewChat, privy]);

  // ─── Landing ──────────────────────────────────────────────────────────

  if (!showConsole) {
    return (
      <div className="bg-background text-foreground font-sans selection:bg-electric/20 overflow-x-hidden">
        <Navbar appMode={false} onLaunch={handleLaunch} selectedChain={selectedChain} onChainChange={handleChainChange} walletConnected={privy.authenticated && privy.hasWallet} onConnectWallet={handleSignIn} />
        <Hero onLaunch={handleLaunch} />
        <SignalDivider /><About /><SignalDivider /><Features /><SignalDivider /><Ecosystem />
        <CTA onLaunch={handleLaunch} /><Footer />
      </div>
    );
  }

  // ─── App shell ────────────────────────────────────────────────────────

  const displayName = privy.userEmail ?? (privy.walletAddress ? `${privy.walletAddress.slice(0, 6)}…${privy.walletAddress.slice(-4)}` : "User");

  const sidebarProps = {
    sessions, activeSessionId, activeView,
    onNewChat: handleNewChat, onSelectSession: handleSelectSession,
    onDeleteSession: handleDeleteSession, onChangeView: handleChangeView,
  };

  return (
    <div className="fixed inset-0 h-[100dvh] flex flex-col bg-white text-foreground font-sans selection:bg-electric/20 overflow-hidden overscroll-none">
      {/* ═══ LIVE MODE BANNER ═══ */}
      {EXECUTION_MODE === "Live" && (
        <div className="bg-red-600 text-white text-[11px] sm:text-xs font-bold px-3 py-1.5 text-center flex items-center justify-center gap-2 shrink-0 z-50 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">LIVE MODE ACTIVE: REAL FUNDS MAY BE USED. USE CAUTION.</span>
        </div>
      )}

      {/* ═══ NAVBAR ═══ */}
      <header className="flex items-center justify-between px-3 sm:px-4 h-12 border-b border-border/60 bg-white shrink-0 z-40">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (window.innerWidth < 1024) setMobileSidebar(v => !v); else setSidebarOpen(v => !v); }}
            className="p-2 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors duration-150"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={() => { if (privy.authenticated) { setActiveView("agent"); } else { setShowConsole(false); } }}
            className="text-base font-bold tracking-tight text-foreground hover:opacity-80 transition-opacity duration-150"
            aria-label="Back to landing page"
          >
            Phyla<span className="text-gradient-brand">X</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {privy.authenticated && (
            <ChainSelector selected={selectedChain} onChange={handleChainChange} />
          )}
          <div className="relative" ref={userMenuRef}>
            {privy.authenticated ? (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setUserMenuOpen(v => !v); }}
                  className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors duration-150"
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-brand flex items-center justify-center">
                    <User className="w-3 h-3 text-white" />
                  </div>
                  <span className="hidden sm:inline text-xs text-foreground/70 max-w-[140px] truncate">{displayName}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground chevron-rotate ${userMenuOpen ? "is-open" : ""}`} />
                </button>
                {/* Account dropdown — CSS-animated */}
                <div className={`absolute right-0 top-full mt-2 w-[240px] rounded-xl bg-white border border-border shadow-soft overflow-hidden z-50 dropdown-panel ${userMenuOpen ? "is-open" : ""}`}>
                  <div className="px-3 py-2.5 border-b border-border/50">
                    {privy.userEmail && <p className="text-[12px] font-semibold text-foreground truncate">{privy.userEmail}</p>}
                    {privy.hasWallet && privy.walletAddress ? (
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-col gap-1.5">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <CopyAddress address={privy.walletAddress} />
                        </span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">No wallet connected</p>
                    )}
                  </div>
                  <div className="py-0.5">
                    <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors duration-120">
                      <LogOut className="w-3.5 h-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button onClick={handleSignIn} className="inline-flex items-center rounded-full bg-gradient-brand text-white px-4 py-1.5 text-sm font-medium hover:shadow-glow transition-all duration-200 hover:scale-[1.02]">
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div className="flex flex-1 min-h-0" ref={consoleRef}>
        {/* Mobile sidebar overlay */}
        <div
          className={`fixed inset-0 z-30 lg:hidden sidebar-mobile-overlay ${mobileSidebar ? "bg-black/20 backdrop-blur-sm pointer-events-auto" : "bg-black/0 backdrop-blur-none pointer-events-none"}`}
          onClick={() => setMobileSidebar(false)}
          aria-hidden={!mobileSidebar}
        />
        {/* Mobile sidebar drawer */}
        <div className={`fixed top-12 bottom-0 left-0 z-40 w-[260px] bg-muted/30 backdrop-blur-xl shadow-xl lg:hidden sidebar-mobile-drawer ${mobileSidebar ? "translate-x-0" : "-translate-x-full"}`}>
          <AppSidebar {...sidebarProps} />
        </div>

        {/* Desktop sidebar — smooth width transition */}
        <div className={`hidden lg:block shrink-0 overflow-hidden sidebar-shell ${sidebarOpen ? "w-[260px]" : "w-0"}`}>
          <div className="w-[260px] h-full">
            <AppSidebar {...sidebarProps} />
          </div>
        </div>

        {/* Main content — switches based on activeView with fade transition */}
        <main className="flex-1 min-w-0 flex flex-col bg-white">
          {activeView === "agent" && (
            <div key={`agent-${activeSessionId}`} className="flex flex-col flex-1 min-h-0 view-enter">
              <ChatPanel
                key={activeSessionId}
                conversationId={activeSessionId}
                isAuthenticated={privy.authenticated}
                hasWallet={privy.hasWallet}
                onConnectWallet={handleConnectWallet}
                onSignIn={handleSignIn}
                onRenameSession={(label) => handleRenameSession(activeSessionId, label)}
                walletAddress={privy.walletAddress}
                getAccessToken={privy.getAccessToken}
                getIdentityToken={privy.getIdentityToken}
                selectedChain={selectedChain}
              />
            </div>
          )}
          {activeView === "portfolio" && (
            <div key={`portfolio-${viewKey}`} className="flex flex-col flex-1 min-h-0 view-enter">
              <PortfolioPanel
                isAuthenticated={privy.authenticated}
                hasWallet={privy.hasWallet}
                walletAddress={privy.walletAddress}
                chainName={selectedChain.name}
                executionMode={EXECUTION_MODE}
                onConnectWallet={handleConnectWallet}
                onSignIn={handleSignIn}
              />
            </div>
          )}
          {activeView === "settings" && (
            <div key={`settings-${viewKey}`} className="flex flex-col flex-1 min-h-0 view-enter">
              <SettingsPanel
                isAuthenticated={privy.authenticated}
                hasWallet={privy.hasWallet}
                walletAddress={privy.walletAddress}
                userEmail={privy.userEmail}
                chainName={selectedChain.name}
                executionMode={EXECUTION_MODE}
                onConnectWallet={handleConnectWallet}
                onSignIn={handleSignIn}
                onLogout={handleLogout}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
