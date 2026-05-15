"use client";

import { Plus, MessageSquare, Trash2, Bot, BarChart3, Settings } from "lucide-react";

export interface ChatSession {
  id: string;
  label: string;
  createdAt: number;
}

export type SidebarView = "agent" | "portfolio" | "settings";

const NAV_ITEMS: { icon: typeof Bot; label: string; view: SidebarView }[] = [
  { icon: Bot, label: "Agent", view: "agent" },
  { icon: BarChart3, label: "Portfolio", view: "portfolio" },
  { icon: Settings, label: "Settings", view: "settings" },
];

interface Props {
  sessions: ChatSession[];
  activeSessionId: string;
  activeView: SidebarView;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onChangeView: (view: SidebarView) => void;
}

export function AppSidebar({
  sessions,
  activeSessionId,
  activeView,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onChangeView,
}: Props) {
  return (
    <aside className="flex flex-col h-full w-full bg-muted/20 overflow-hidden">
      {/* New Chat button */}
      <div className="p-3 pb-2">
        <button
          onClick={() => { onNewChat(); onChangeView("agent"); }}
          className="w-full flex items-center gap-2.5 rounded-xl border border-border/60 bg-white px-4 py-2.5 text-[13px] font-medium text-foreground hover:bg-muted/40 transition-all duration-150 shadow-sm active:scale-[0.98]"
        >
          <Plus className="w-4 h-4 text-muted-foreground" />
          New Chat
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 pb-2">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.view;
          return (
            <button
              key={item.view}
              onClick={() => onChangeView(item.view)}
              className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-150 ${
                isActive
                  ? "font-medium text-foreground bg-white/70 shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/50"
              }`}
            >
              <item.icon className={`w-4 h-4 transition-colors duration-150 ${isActive ? "text-electric" : "text-muted-foreground/60"}`} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-border/40" />

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto scroll-contain px-2 pt-2 pb-3">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Sessions
        </p>
        <div className="space-y-0.5">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId && activeView === "agent";
            return (
              <div
                key={session.id}
                className={`group relative flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-all duration-150 ${
                  isActive
                    ? "bg-white shadow-sm border border-border/30"
                    : "hover:bg-white/50"
                }`}
                onClick={() => { onSelectSession(session.id); onChangeView("agent"); }}
              >
                <MessageSquare className={`w-3.5 h-3.5 shrink-0 transition-colors duration-150 ${isActive ? "text-foreground" : "text-muted-foreground/50"}`} />
                <span className={`flex-1 text-[13px] truncate transition-colors duration-150 ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {session.label}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                  className={`p-1 rounded-md transition-all duration-120 ${
                    isActive
                      ? "text-muted-foreground/40 hover:text-red-500 hover:bg-red-50"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-red-500 hover:bg-red-50"
                  }`}
                  aria-label={`Delete ${session.label}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
