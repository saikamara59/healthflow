import { useId } from 'react';

/**
 * Canonical HealthFlow brand mark — v2 "flow" identity.
 *
 * Three care/data streams (graded teal → cyan) converge into a single decision
 * node: the product's whole job in one glyph. The disc carries its own ground,
 * so the mark stays legible on any surface (light login, dark sidebar) without
 * per-theme variants.
 *
 * Reuse this component everywhere a HealthFlow logo appears (sidebar, login,
 * landing nav/footer) instead of inlining one-off SVGs. `useId` namespaces the
 * gradients so multiple instances on one page don't collide.
 */
export default function BrandLogo({ size = 30, className = '' }) {
  const uid = useId().replace(/[:]/g, '');
  const disc = `hfDisc-${uid}`;
  const node = `hfNode-${uid}`;

  return (
    <span
      className={`hf-mark ${className}`.trim()}
      aria-hidden="true"
      style={{ width: size, height: size, display: 'inline-flex' }}
    >
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <defs>
          {/* faint top-lit disc — reads as a glass chip, not a flat fill */}
          <linearGradient id={disc} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="oklch(0.985 0.012 200)" />
            <stop offset="1" stopColor="oklch(0.93 0.025 205)" />
          </linearGradient>
          <linearGradient id={node} x1="20" y1="13" x2="27" y2="19" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="oklch(0.46 0.13 215)" />
            <stop offset="1" stopColor="oklch(0.30 0.05 235)" />
          </linearGradient>
        </defs>

        {/* disc + hairline edge so it holds on light backgrounds */}
        <circle cx="16" cy="16" r="15" fill={`url(#${disc})`} stroke="oklch(0.6 0.08 210 / 0.35)" strokeWidth="1" />

        {/* three converging streams: light → mid → deep teal, top to bottom */}
        <path d="M7 10 C 14 10, 16 16, 23 16" strokeWidth="2.2" stroke="oklch(0.65 0.15 185)" />
        <path d="M7 16 L 23 16" strokeWidth="2.2" stroke="oklch(0.55 0.14 200)" />
        <path d="M7 22 C 14 22, 16 16, 23 16" strokeWidth="2.2" stroke="oklch(0.46 0.13 215)" />

        {/* the node they flow into */}
        <circle cx="24" cy="16" r="3" fill={`url(#${node})`} />
      </svg>
    </span>
  );
}
