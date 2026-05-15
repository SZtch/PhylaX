"use client";

/**
 * ChainBadge — Reusable chain identity badge with inline SVG logo.
 * Light-theme, matches PhylaX landing page design language.
 */

interface Props {
  chainName: string;
  chainId?: string;
  size?: "sm" | "md";
  className?: string;
}

function ChainLogo({ chainId, size }: { chainId: string; size: number }) {
  switch (chainId) {
    case "x-layer":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="6" fill="#121212" />
          <path d="M7 7L12 12M12 12L17 17M12 12L17 7M12 12L7 17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "base":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="6" fill="#0052FF" />
          <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="system-ui">B</text>
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="6" fill="oklch(0.62 0.19 260)" />
          <circle cx="12" cy="12" r="5" stroke="white" strokeWidth="1.5" fill="none" />
          <circle cx="12" cy="12" r="2" fill="white" />
        </svg>
      );
  }
}

export function ChainBadge({ chainName, chainId = "x-layer", size = "sm", className = "" }: Props) {
  const iconSize = size === "sm" ? 16 : 20;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <ChainLogo chainId={chainId} size={iconSize} />
      <span className={`font-semibold text-foreground ${size === "sm" ? "text-[11px]" : "text-xs"}`}>
        {chainName}
      </span>
    </span>
  );
}
