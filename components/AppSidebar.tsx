"use client";

import { useState, useEffect } from "react";
import { Plus, MessageSquare, Trash2, Bot, BarChart3, Settings, Moon, Sun, Zap } from "lucide-react";

export interface ChatSession {
  id: string;
  label: string;
  createdAt: number;
}

export type SidebarView = "agent" | "portfolio" | "settings";

interface Props {
  sessions: ChatSession[];
  activeSessionId: string;
  activeView: SidebarView;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onChangeView: (view: SidebarView) => void;
  isLightMode?: boolean;
  onToggleTheme?: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AppSidebar({
  sessions,
  activeSessionId,
  activeView,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onChangeView,
  isLightMode,
  onToggleTheme,
}: Props) {
  // Force re-render every minute for "time ago" labels
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  // Theme-aware color tokens
  const t = {
    textPrimary: isLightMode ? "oklch(0.15 0.04 265)" : "oklch(0.95 0 0)",
    textSecondary: isLightMode ? "oklch(0.35 0.02 260)" : "oklch(1 0 0 / 0.4)",
    textTertiary: isLightMode ? "oklch(0.55 0.015 260)" : "oklch(1 0 0 / 0.2)",
    textFaint: isLightMode ? "oklch(0.7 0.01 260)" : "oklch(1 0 0 / 0.15)",
    textMuted: isLightMode ? "oklch(0.5 0.02 260)" : "oklch(1 0 0 / 0.35)",
    bgActive: isLightMode ? "oklch(0.62 0.19 260 / 0.08)" : "oklch(1 0 0 / 0.08)",
    bgHover: isLightMode ? "oklch(0.62 0.19 260 / 0.04)" : "oklch(1 0 0 / 0.04)",
    bgHoverStrong: isLightMode ? "oklch(0.62 0.19 260 / 0.06)" : "oklch(1 0 0 / 0.06)",
    borderActive: isLightMode ? "oklch(0.62 0.19 260 / 0.12)" : "oklch(1 0 0 / 0.08)",
    borderDivider: isLightMode ? "oklch(0.21 0.05 265 / 0.08)" : "oklch(1 0 0 / 0.06)",
    borderDashed: isLightMode ? "oklch(0.21 0.05 265 / 0.15)" : "oklch(1 0 0 / 0.1)",
    iconEmpty: isLightMode ? "oklch(0.7 0.01 260)" : "oklch(1 0 0 / 0.15)",
    hoverText: isLightMode ? "oklch(0.2 0.04 265)" : "oklch(0.85 0 0)",
    hoverNewChat: isLightMode ? "oklch(0.15 0.04 265)" : "oklch(0.95 0 0)",
    sessionIcon: isLightMode ? "oklch(0.62 0.19 260 / 0.35)" : "oklch(1 0 0 / 0.2)",
    deleteColor: isLightMode ? "oklch(0.5 0.02 260)" : "oklch(1 0 0 / 0.25)",
  };

  return (
    <aside
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ background: "transparent" }}
    >
      {/* Spacer — navbar already has brand */}
      <div className="pt-10" />

      {/* ── Main nav ── */}
      <div className="px-3 pb-2 space-y-0.5 stagger-children">
        {[
          { icon: Bot, label: "Agent", view: "agent" as SidebarView },
          { icon: BarChart3, label: "Portfolio", view: "portfolio" as SidebarView },
          { icon: Settings, label: "Settings", view: "settings" as SidebarView },
        ].map(({ icon: Icon, label, view }) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              onClick={() => onChangeView(view)}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[13px] font-medium transition-all duration-200 text-left group"
              style={{
                background: active ? t.bgActive : "transparent",
                color: active ? t.textPrimary : t.textSecondary,
                border: active ? `1px solid ${t.borderActive}` : "1px solid transparent",
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.background = t.bgHover;
                  e.currentTarget.style.color = t.hoverText;
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = t.textSecondary;
                }
              }}
            >
              <Icon
                className="shrink-0 transition-transform duration-200 group-hover:scale-110"
                style={{
                  width: 16,
                  height: 16,
                  color: active ? "oklch(0.7 0.19 260)" : "inherit",
                }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Divider ── */}
      <div className="mx-4 my-2" style={{ borderTop: `1px solid ${t.borderDivider}` }} />

      {/* ── Sessions (agent view only) ── */}
      {activeView === "agent" && (
        <>
          <div className="px-3 pb-2">
            <button
              onClick={() => { onNewChat(); onChangeView("agent"); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-full text-[12px] font-medium transition-all duration-200 group"
              style={{
                background: "transparent",
                color: t.textSecondary,
                border: `1px dashed ${t.borderDashed}`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = t.bgHoverStrong;
                e.currentTarget.style.borderColor = "oklch(0.62 0.19 260 / 0.25)";
                e.currentTarget.style.color = t.hoverNewChat;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = t.borderDashed;
                e.currentTarget.style.color = t.textSecondary;
              }}
            >
              <Plus
                style={{ width: 14, height: 14, color: "inherit" }}
                className="transition-transform duration-300 group-hover:rotate-90"
              />
              New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5 scroll-contain">
            {sessions.length === 0 && (
              <div className="flex flex-col items-center py-10 gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: isLightMode ? "oklch(0.62 0.19 260 / 0.05)" : "oklch(1 0 0 / 0.04)" }}
                >
                  <MessageSquare style={{ width: 16, height: 16, color: t.iconEmpty }} />
                </div>
                <p className="text-[11px]" style={{ color: t.textFaint }}>No sessions yet</p>
              </div>
            )}
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId && activeView === "agent";
              return (
                <div
                  key={session.id}
                  className="group flex items-center gap-2.5 px-4 py-2.5 rounded-full cursor-pointer transition-all duration-200"
                  style={{
                    background: isActive ? t.bgHoverStrong : "transparent",
                    color: isActive ? t.textPrimary : t.textMuted,
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = t.bgHover;
                      e.currentTarget.style.color = t.hoverText;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = t.textMuted;
                    }
                  }}
                  onClick={() => { onSelectSession(session.id); onChangeView("agent"); }}
                >
                  <MessageSquare
                    style={{
                      width: 14,
                      height: 14,
                      color: isActive ? "oklch(0.7 0.19 260)" : t.sessionIcon,
                      flexShrink: 0,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="block text-[12px] font-medium truncate">
                      {session.label || "New chat"}
                    </span>
                    <span className="block text-[10px] mt-0.5" style={{ color: t.textFaint }}>
                      {timeAgo(session.createdAt)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full transition-all duration-150 shrink-0"
                    style={{ color: t.deleteColor }}
                    onMouseEnter={e => { e.currentTarget.style.color = "oklch(0.65 0.2 20)"; e.currentTarget.style.background = "oklch(0.65 0.2 20 / 0.1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = t.deleteColor; e.currentTarget.style.background = "transparent"; }}
                    aria-label={`Delete ${session.label}`}
                  >
                    <Trash2 style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeView !== "agent" && <div className="flex-1" />}

      {/* ── Footer ── */}
      <div
        className="px-4 py-3 space-y-3"
        style={{ borderTop: `1px solid ${t.borderDivider}` }}
      >
        {/* Network status + theme toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: t.textFaint }}
            >
              X Layer Live
            </span>
          </div>

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150"
            style={{
              background: isLightMode ? "oklch(0.62 0.19 260 / 0.08)" : "oklch(1 0 0 / 0.06)",
              border: isLightMode ? "1px solid oklch(0.62 0.19 260 / 0.12)" : "1px solid oklch(1 0 0 / 0.08)",
              color: isLightMode ? "oklch(0.4 0.02 260)" : "oklch(1 0 0 / 0.5)",
            }}
            title="Toggle Theme"
          >
            {isLightMode ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
          </button>
        </div>

        {/* Version badge */}
        <div className="flex items-center gap-2">
          <Zap style={{ width: 10, height: 10, color: "oklch(0.62 0.19 260)" }} />
          <span
            className="text-[9px] font-medium tracking-wider"
            style={{ color: t.textFaint }}
          >
            PhylaX v1.0 · OKX Onchain OS
          </span>
        </div>
      </div>
    </aside>
  );
}
