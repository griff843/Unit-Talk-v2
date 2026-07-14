import type { Config } from 'tailwindcss';

/**
 * Design tokens for the public marketing site — the "signal desk" system.
 *
 * Deliberately distinct from the internal Command Center's blue trading-desk
 * palette: warm near-black canvas, ivory ink, and an amber "signal" accent
 * instead of generic SaaS blue. Sharp/notched geometry instead of rounded
 * card boilerplate. All values resolve to CSS custom properties declared in
 * globals.css so the theme has a single source of truth.
 */
const config: Config = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--ut-bg-canvas)',
        surface: 'var(--ut-bg-surface)',
        elevated: 'var(--ut-bg-surface-elevated)',
        signal: {
          DEFAULT: 'var(--ut-signal)',
          strong: 'var(--ut-signal-strong)',
          ink: 'var(--ut-signal-ink)',
        },
        tick: {
          pos: 'var(--ut-tick-pos)',
          neg: 'var(--ut-tick-neg)',
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      letterSpacing: {
        widest: '0.22em',
      },
      keyframes: {
        'ut-ticker': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'ut-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'ut-ticker': 'ut-ticker 32s linear infinite',
        'ut-pulse': 'ut-pulse 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
