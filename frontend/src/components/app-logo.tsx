import type { SVGProps } from "react";

/**
 * Official Huseynovlar Terminal Candlestick 'H' Monogram (from huseynovlar-icon-pack.zip).
 * Automatically switches palette between Dark Theme (#0B0E14 / #F1F5F9 / #F59E0B)
 * and Light Theme ([data-theme="light"]: #FFFFFF / #0F172A / #D97706).
 */
export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={24}
      height={24}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {/* App Icon Background */}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        fill="var(--bg-canvas, #0B0E14)"
        stroke="var(--border-strong, #2C3649)"
        strokeWidth="2"
      />
      {/* Left Candlestick Pillar */}
      <rect x="20" y="13" width="2" height="38" rx="1" fill="var(--text-primary, #F1F5F9)" />
      <rect x="16" y="18" width="10" height="28" rx="1.5" fill="var(--text-primary, #F1F5F9)" />
      {/* Center Amber Level Bar */}
      <rect x="28" y="29" width="8" height="6" rx="1" fill="var(--accent-amber, #F59E0B)" />
      {/* Right Candlestick Pillar */}
      <rect x="42" y="13" width="2" height="38" rx="1" fill="var(--text-primary, #F1F5F9)" />
      <rect x="38" y="18" width="10" height="28" rx="1.5" fill="var(--text-primary, #F1F5F9)" />
    </svg>
  );
}
