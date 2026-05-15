"use client";

import { useEffect, useRef } from "react";
import { Shield, User, Loader2, AlertCircle } from "lucide-react";

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  cardType?: "trade-plan" | "risk-result" | "quote" | null;
  cardData?: Record<string, unknown> | null;
  isLoading?: boolean;
}

interface Props {
  message: ChatMessageData;
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Trigger CSS entrance animation on mount
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
        transition: "opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
          isUser
            ? "bg-electric/10 text-electric"
            : isSystem
            ? "bg-red-50 text-red-500 border border-red-200"
            : "bg-gradient-brand text-white shadow-soft"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : isSystem ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <Shield className="w-4 h-4" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-electric text-white rounded-tr-md"
            : isSystem
            ? "bg-red-50 border border-red-200 text-red-700 rounded-tl-md"
            : "bg-white border border-border text-foreground rounded-tl-md shadow-soft"
        }`}
      >
        {message.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs font-medium">Processing…</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
      </div>
    </div>
  );
}
