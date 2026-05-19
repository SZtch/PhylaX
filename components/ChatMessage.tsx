"use client";

import { useEffect, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";

export interface ChatStep {
  label: string;
  status: "running" | "done" | "error";
  id: string;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  cardType?: "trade-plan" | "risk-result" | "quote" | null;
  cardData?: Record<string, unknown> | null;
  isLoading?: boolean;
  steps?: ChatStep[];
}

interface Props {
  message: ChatMessageData;
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
  }, []);

  // ── User message: dark capsule bubble, right-aligned ──
  if (isUser) {
    return (
      <div
        ref={ref}
        style={{
          opacity: 0,
          transform: "translateY(6px)",
          transition: "opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="flex justify-end"
      >
        <div
          className="max-w-[80%] sm:max-w-[70%] rounded-3xl px-5 py-3 text-sm sm:text-[15px] leading-relaxed"
          style={{
            background: "var(--app-user-bubble)",
            color: "var(--app-user-bubble-text)",
            border: "1px solid var(--app-user-bubble-border)",
          }}
        >
          <div style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{message.content}</div>
        </div>
      </div>
    );
  }

  // ── System message: warning capsule ──
  if (isSystem) {
    return (
      <div
        ref={ref}
        style={{
          opacity: 0,
          transform: "translateY(6px)",
          transition: "opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="flex justify-start"
      >
        <div className="flex items-start gap-3 max-w-[85%]">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5"
            style={{
              background: "oklch(0.65 0.2 25 / 0.1)",
              color: "oklch(0.65 0.2 25)",
              border: "1px solid oklch(0.65 0.2 25 / 0.2)",
            }}
          >
            <AlertCircle className="w-3.5 h-3.5" />
          </div>
          <div
            className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={{
              background: "oklch(0.65 0.2 25 / 0.06)",
              border: "1px solid oklch(0.65 0.2 25 / 0.12)",
              color: "oklch(0.85 0.05 25)",
            }}
          >
            <div style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{message.content}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message: NO bubble — clean text on grid (Xona-style) ──
  return (
    <div
      ref={ref}
      style={{
        opacity: 0,
        transform: "translateY(6px)",
        transition: "opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      className="flex justify-start"
    >
      <div className="max-w-[90%] sm:max-w-[85%]">
        {/* Step progress — show just the activity spinner, no labels */}
        {message.steps && message.steps.some(s => s.status === "running") && message.isLoading && (
          <div className="flex items-center gap-2 mb-3 ml-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "oklch(0.7 0.19 260)" }} />
          </div>
        )}

        {/* Content — directly rendered, no bubble */}
        {message.isLoading && (!message.steps || message.steps.length === 0) ? (
          <div className="flex items-center gap-2 py-1" style={{ color: "var(--app-text-secondary)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs font-medium">Processing…</span>
          </div>
        ) : (
          <div
            className="text-sm sm:text-[15px] leading-relaxed"
            style={{
              color: "var(--app-text-primary)",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}
