"use client";

import { User, Wallet, Layers, Activity, LogOut, Shield, Link2 } from "lucide-react";
import { CopyAddress } from "./CopyAddress";

interface Props {
  isAuthenticated: boolean;
  hasWallet: boolean;
  walletAddress?: string | null;
  userEmail?: string | null;
  chainName: string;
  executionMode: string;
  onConnectWallet: () => void;
  onSignIn: () => void;
  onLogout: () => void;
}

export function SettingsPanel({
  isAuthenticated,
  hasWallet,
  walletAddress,
  userEmail,
  chainName,
  executionMode,
  onConnectWallet,
  onSignIn,
  onLogout,
}: Props) {
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 rounded-2xl bg-gradient-brand flex items-center justify-center mx-auto mb-5 shadow-soft">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground mb-2">Settings</h2>
          <p className="text-sm text-muted-foreground mb-5">Sign in to manage your account and preferences.</p>
          <button onClick={onSignIn} className="inline-flex items-center rounded-full bg-gradient-brand text-white px-6 py-2 text-sm font-medium hover:shadow-glow transition-all duration-200 hover:scale-[1.02]">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scroll-contain">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-display font-bold text-foreground mb-1">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account, wallet, and preferences.</p>
        </div>

        {/* Account */}
        <section className="rounded-xl border border-border/60 bg-white p-5 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-electric" />
            Account
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium text-foreground">{userEmail ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Auth Provider</span>
              <span className="text-sm font-medium text-foreground">Privy</span>
            </div>
          </div>
        </section>

        {/* Wallet */}
        <section className="rounded-xl border border-border/60 bg-white p-5 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-electric" />
            Wallet
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Status</span>
              {hasWallet && walletAddress ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Connected
                </span>
              ) : (
                <span className="text-sm text-muted-foreground/60">Not connected</span>
              )}
            </div>
            {hasWallet && walletAddress && (
              <div className="flex items-center justify-between py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Address</span>
                <CopyAddress address={walletAddress} className="text-sm text-foreground" />
              </div>
            )}
            {!hasWallet && (
              <div className="pt-1">
                <button onClick={onConnectWallet} className="inline-flex items-center gap-2 rounded-lg border border-electric/30 text-electric px-4 py-2 text-sm font-medium hover:bg-electric/5 transition-colors">
                  <Link2 className="w-3.5 h-3.5" />
                  Connect Wallet
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Network & Execution */}
        <section className="rounded-xl border border-border/60 bg-white p-5 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-electric" />
            Network & Execution
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Active Chain</span>
              <span className="text-sm font-medium text-foreground">{chainName}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Execution Mode</span>
              <span className="text-sm font-medium text-foreground">{executionMode}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Security Model</span>
              <span className="text-sm font-medium text-foreground">Non-custodial, user-signed</span>
            </div>
          </div>
        </section>

        {/* Session */}
        <section className="rounded-xl border border-red-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-red-400" />
            Session
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Sign out will disconnect your session. You will need to sign in again.
          </p>
          <button onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-red-200 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
