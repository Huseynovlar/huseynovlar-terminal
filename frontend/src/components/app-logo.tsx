import type { SVGProps } from "react";

/**
 * Institutional geometric monogram for Huseynovlar Terminal (#41).
 * Designed to stay crisp at 16px, 24px, and 48px in both light and dark modes.
 */
export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={24}
      height={24}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="28" height="28" rx="6" stroke="currentColor" strokeWidth="2.2" />
      <path d="M9.5 9V23M22.5 9V23" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" />
      <path d="M9.5 16H17.5L22.5 11.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter" />
      <rect x="19.5" y="19.5" width="3.5" height="3.5" fill="currentColor" />
    </svg>
  );
}
