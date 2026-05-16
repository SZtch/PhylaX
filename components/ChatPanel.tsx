"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Shield,
  Scan,
  Eye,
  BarChart3,
  Search,
} from "lucide-react";
import { ChatMessage, type ChatMessageData } from "./ChatMessage";
import { TradePlanCard } from "./TradePlanCard";
import { RiskResultCard } from "./RiskResultCard";
import { QuoteCard } from "./QuoteCard";
import type { ChatState } from "../lib/chat-states";
import { CHAT_STATE_LABELS, isBusyState } from "../lib/chat-states";
import type { TokenSignal, SimulationResult } from "../lib/schemas";
import { type ChainConfig } from "../lib/chains";

// ─── Pipeline types ───────────────────────────────────────────────────────────

interface TradePlanData { type: "trade-plan"; signals: TokenSignal[]; chainName: string; source: string; }
interface RiskResultData { type: "risk-result"; tokenSymbol: string; tokenAddress: string; riskLevel: "safe" | "high_risk" | "unknown" | "skipped" | "pending"; riskDetails?: string; source: string; }
interface QuoteData { type: "quote"; quote: SimulationResult; fromSymbol: string; toSymbol: string; amount: number; scanDecision: string; source: string; approvalId?: string; tokenAddress?: string; targetWalletAddress?: string; needsApproval?: boolean; approveTxData?: any; }
type PipelineData = TradePlanData | RiskResultData | QuoteData;
interface ChatMessageWithCards extends ChatMessageData { pipelineData?: PipelineData | null; }

// ─── Prompt suggestions ───────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: Eye, label: "Trade Preview", desc: "Quote 100 USDC to OKB", prompt: "Quote 100 USDC to OKB" },
  { icon: Scan, label: "Scan Token", desc: "Check token risk before trading", prompt: "Scan this token before I trade" },
  { icon: Search, label: "Find Low-Risk", desc: "Discover safer tokens on X Layer", prompt: "Find a low-risk token on X Layer" },
  { icon: BarChart3, label: "Route Risk", desc: "Understand swap route risks", prompt: "Explain route risk before swapping" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  conversationId: string;
  isAuthenticated: boolean;
  hasWallet: boolean;
  onConnectWallet: () => void;
  onSignIn: () => void;
  onRenameSession?: (label: string) => void;
  walletAddress?: string | null;
  getAccessToken?: () => Promise<string | null>;
  getIdentityToken?: () => Promise<string | null>;
  selectedChain: ChainConfig;
}

// ─── Pipeline card wrapper with entrance animation ────────────────────────────

function PipelineCardWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
  }, []);
  return (
    <div
      ref={ref}
      style={{
        opacity: 0,
        transform: "translateY(6px)",
        transition: "opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1) 0.1s, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1) 0.1s",
      }}
    >
      {children}
    </div>
  );
}

// ─── Empty-state wrapper with fade-in ─────────────────────────────────────────

function EmptyStateWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
  }, []);
  return (
    <div
      ref={ref}
      style={{
        opacity: 0,
        transform: "translateY(10px)",
        transition: "opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatPanel({
  conversationId,
  isAuthenticated,
  hasWallet,
  onConnectWallet,
  onSignIn,
  onRenameSession,
  walletAddress,
  getAccessToken,
  getIdentityToken,
  selectedChain,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageWithCards[]>([]);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<ChatState>(
    isAuthenticated ? "WALLET_CONNECTED" : "WALLET_REQUIRED"
  );
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canChat = isAuthenticated; // email login is enough for chat
  const prevAuthenticated = useRef(isAuthenticated);
  const hasRenamed = useRef(false);
  const hasMessages = messages.length > 0;

  const [isFetchingMessages, setIsFetchingMessages] = useState(false);

  // ── Fetch messages ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !conversationId || conversationId.startsWith("session-")) {
      return;
    }

    let ignore = false;
    setTimeout(() => setIsFetchingMessages(true), 0);

    const runFetch = async () => {
      try {
        const token = getAccessToken ? await getAccessToken() : null;
        const res = await fetch(`/api/chat/sessions/${conversationId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        
        if (!ignore && data.messages) {
          setMessages(data.messages.map((m: { id: string; role: string; content: string; createdAt: string; metadata: Record<string, unknown> | null }) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
            pipelineData: (m.metadata as unknown as PipelineData) || null,
          })));
          
          if (data.messages.length > 0) {
            hasRenamed.current = true;
            setChatState("WALLET_CONNECTED");
          }
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        if (!ignore) setIsFetchingMessages(false);
      }
    };

    runFetch();
    return () => { ignore = true; };
  }, [isAuthenticated, conversationId, getAccessToken]);

  useEffect(() => {
    if (isAuthenticated && !prevAuthenticated.current && messages.length === 0 && !isFetchingMessages) {
      // Signed in — show welcome only if no messages
      queueMicrotask(() => {
        setChatState("WALLET_CONNECTED");
        setMessages(prev => {
          if (prev.length > 0) return prev;
          return [...prev, {
            id: `system-welcome-${Date.now()}`,
            role: "assistant",
            content: `PhylaX is ready on ${selectedChain.name}.
I can scan tokens, search for signals, and prepare quotes. Every trade requires your wallet signature.`,
            timestamp: Date.now(),
          }];
        });
      });
    } else if (!isAuthenticated && prevAuthenticated.current) {
      // Signed out — reset to welcome state
      setMessages([]);
      setChatState("WALLET_REQUIRED");
      setInput("");
      setIsLoading(false);
      hasRenamed.current = false;
    }
    prevAuthenticated.current = isAuthenticated;
  }, [isAuthenticated, hasWallet, selectedChain.name, messages.length, isFetchingMessages]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Send message ──────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !canChat || isLoading) return;
    const trimmedText = text.trim();
    // Auto-rename session on first user message
    if (!hasRenamed.current && onRenameSession) {
      hasRenamed.current = true;
      onRenameSession(trimmedText);
    }
    const userMsg: ChatMessageWithCards = { id: `user-${Date.now()}`, role: "user", content: trimmedText, timestamp: Date.now() };
    const loadingMsg: ChatMessageWithCards = { id: `assistant-loading-${Date.now()}`, role: "assistant", content: "", timestamp: Date.now(), isLoading: true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput(""); setIsLoading(true); setChatState("UNDERSTANDING_INTENT");
    try {
      let authToken = "client-token"; let identityToken: string | null = null;
      if (getAccessToken) { try { const t = await getAccessToken(); if (t) authToken = t; } catch { /* */ } }
      if (getIdentityToken) { try { identityToken = await getIdentityToken(); } catch { /* */ } }
      const headers: Record<string, string> = { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "x-wallet-address": walletAddress ?? "" };
      if (identityToken) headers["x-privy-identity-token"] = identityToken;
      
      const res = await fetch("/api/chat/stream", { method: "POST", headers, body: JSON.stringify({ conversationId, message: text.trim(), chain: selectedChain.id }) });
      
      if (!res.ok) {
        let errorContent = "Something went wrong. Please try again.";
        try {
          const data = await res.json();
          errorContent = data.error ?? errorContent;
        } catch { /* */ }
        if (res.status === 401) errorContent = errorContent.includes("expired") ? "Session expired. Please reconnect your wallet." : errorContent;
        else if (res.status === 403) errorContent = "Wallet mismatch. Please reconnect.";
        setMessages(prev => prev.map(m => m.id === loadingMsg.id ? { ...m, isLoading: false, content: errorContent, role: "system" as const } : m));
        setChatState("FAILED"); return;
      }

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader available");
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 2);
            
            if (chunk.startsWith("event: ")) {
              const eventTypeLine = chunk.split("\n")[0];
              const dataLine = chunk.split("\n").find(l => l.startsWith("data: "));
              if (!dataLine) continue;
              
              const type = eventTypeLine.replace("event: ", "").trim();
              const data = JSON.parse(dataLine.replace("data: ", ""));
              
              if (type === "step" || type === "tool_start" || type === "tool_result" || type === "partial_failure") {
                setMessages(prev => prev.map(m => {
                  if (m.id === loadingMsg.id) {
                    const currentSteps = m.steps ? [...m.steps] : [];
                    const stepId = data.id || `step-${Date.now()}`;
                    const existingIdx = currentSteps.findIndex(s => s.id === stepId);
                    
                    if (existingIdx >= 0) {
                      currentSteps[existingIdx] = { ...currentSteps[existingIdx], status: data.status, label: data.label || currentSteps[existingIdx].label };
                    } else {
                      currentSteps.push({ id: stepId, label: data.label, status: data.status });
                    }
                    return { ...m, steps: currentSteps };
                  }
                  return m;
                }));
              } else if (type === "final") {
                setMessages(prev => prev.map(m => m.id === loadingMsg.id ? { ...m, isLoading: false, content: data.agentMessage ?? "Done.", pipelineData: data.pipelineData ?? null } : m));
                if (data.chatState) setChatState(data.chatState as ChatState);
              } else if (type === "error") {
                throw new Error(data.error);
              }
            }
          }
        }
      } else {
        const data = await res.json();
        const newState: ChatState = data.chatState ?? "WALLET_CONNECTED";
        setMessages(prev => prev.map(m => m.id === loadingMsg.id ? { ...m, isLoading: false, content: data.agentMessage ?? "Done.", pipelineData: data.pipelineData ?? null } : m));
        setChatState(newState);
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === loadingMsg.id ? { ...m, isLoading: false, content: "Network error. Check your connection.", role: "system" as const } : m));
      setChatState("FAILED");
    } finally { setIsLoading(false); }
  }, [canChat, isLoading, walletAddress, getAccessToken, getIdentityToken, onRenameSession, selectedChain.id, conversationId]);

  const handleSuggestionClick = (prompt: string) => {
    if (!canChat) { onSignIn(); return; }
    sendMessage(prompt);
  };
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const renderPipelineCard = (data: PipelineData) => {
    switch (data.type) {
      case "trade-plan": return <TradePlanCard tokens={data.signals} chainName={data.chainName} />;
      case "risk-result": return <RiskResultCard tokenSymbol={data.tokenSymbol} tokenAddress={data.tokenAddress} riskLevel={data.riskLevel} details={data.riskDetails} />;
      case "quote": return <QuoteCard quote={data.quote} fromSymbol={data.fromSymbol} toSymbol={data.toSymbol} approvalId={data.approvalId} showExecute={!!data.approvalId} getAccessToken={getAccessToken} getIdentityToken={getIdentityToken} walletAddress={walletAddress} targetWalletAddress={data.targetWalletAddress} onConnectWallet={onConnectWallet} amount={data.amount} tokenAddress={data.tokenAddress} scanDecision={data.scanDecision} chainConfig={selectedChain} needsApproval={data.needsApproval} approveTxData={data.approveTxData} />;
      default: return null;
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {hasMessages ? (
        /* ═══ CONVERSATION MODE ═══ */
        <>
          <div className="flex-1 overflow-y-auto scroll-contain min-h-0">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
              {messages.map(msg => (
                <div key={msg.id} className="space-y-3">
                  <ChatMessage message={msg} />
                  {msg.pipelineData && msg.role === "assistant" && !msg.isLoading && (
                    <PipelineCardWrapper>
                      {renderPipelineCard(msg.pipelineData)}
                    </PipelineCardWrapper>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Pinned input */}
          <div className="shrink-0 border-t border-border/40 bg-white px-4 sm:px-6 py-3">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleSubmit}>
                <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3 focus-within:border-electric/40 focus-within:bg-white focus-within:shadow-soft transition-all duration-200">
                  <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} placeholder="Ask PhylaX anything…" rows={1} className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/40 resize-none outline-none min-h-[28px] max-h-[150px]" />
                  <button type="submit" disabled={!input.trim() || isLoading} aria-label="Send" className={`p-2 rounded-xl transition-all duration-150 flex-shrink-0 ${input.trim() && !isLoading ? "bg-gradient-brand text-white hover:shadow-glow" : "bg-muted/60 text-muted-foreground/30 cursor-not-allowed"}`}>
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
              {isBusyState(chatState) && (
                <p className="text-[11px] text-electric font-medium text-center mt-2 animate-pulse">{CHAT_STATE_LABELS[chatState]}</p>
              )}
              <p className="text-[10px] text-muted-foreground/30 text-center mt-2">Non-custodial · User-signed execution · {selectedChain.name}</p>
            </div>
          </div>
        </>
      ) : (
        /* ═══ EMPTY STATE — ChatGPT-style centered ═══ */
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
          <div className="w-full max-w-2xl mx-auto">
            {/* Logo + greeting */}
            <EmptyStateWrapper>
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-brand flex items-center justify-center mx-auto mb-5 shadow-soft">
                  <Shield className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-display font-bold text-foreground mb-2">
                  Trade secure on X Layer
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  Scan tokens and build quotes with risk-first protection.
                </p>
              </div>
            </EmptyStateWrapper>

            {/* Suggestion cards — ChatGPT-style 2x2 grid */}
            <EmptyStateWrapper>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s.prompt}
                    onClick={() => handleSuggestionClick(s.prompt)}
                    disabled={isLoading}
                    className="text-left rounded-xl border border-border/60 bg-white hover:bg-muted/30 hover:border-border px-4 py-3.5 transition-all duration-150 group hover:shadow-sm active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon className="w-4 h-4 text-electric/70 group-hover:text-electric transition-colors duration-150" />
                      <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{s.desc}</p>
                  </button>
                ))}
              </div>
            </EmptyStateWrapper>

            {/* Input */}
            <form onSubmit={handleSubmit}>
              <div className={`flex items-end gap-2 rounded-2xl border px-4 py-3 transition-all duration-200 ${
                canChat
                  ? "border-border bg-muted/20 focus-within:border-electric/40 focus-within:bg-white focus-within:shadow-soft"
                  : "border-border/40 bg-muted/10"
              }`}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!canChat || isLoading}
                  placeholder={canChat ? "Ask PhylaX anything…" : "Please sign in to chat…"}
                  rows={1}
                  className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/40 resize-none outline-none disabled:cursor-not-allowed min-h-[28px] max-h-[150px]"
                />
                <button type="submit" disabled={!canChat || !input.trim() || isLoading} aria-label="Send" className={`p-2 rounded-xl transition-all duration-150 flex-shrink-0 ${canChat && input.trim() && !isLoading ? "bg-gradient-brand text-white hover:shadow-glow" : "bg-muted/60 text-muted-foreground/30 cursor-not-allowed"}`}>
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>

            <p className="text-[10px] text-muted-foreground/30 text-center mt-3">
              Non-custodial · User-signed execution · X Layer
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
