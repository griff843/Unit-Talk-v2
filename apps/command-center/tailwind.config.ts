import type { Config } from 'tailwindcss';

/**
 * Neutral scale bound to the --cc-n-* RGB triplet tokens declared in
 * globals.css. Every gray-* / slate-* utility in the app resolves to the
 * Command Center palette (blue-tinted, dark-first) and flips automatically
 * under [data-theme='light']. This is the single token source — do not
 * reintroduce raw hex neutrals in components.
 */
function step(name: string) {
  return `rgb(var(--cc-n-${name}) / <alpha-value>)`;
}

const neutralScale = {
  50: step('50'),
  100: step('100'),
  200: step('200'),
  300: step('300'),
  400: step('400'),
  500: step('500'),
  600: step('600'),
  700: step('700'),
  800: step('800'),
  900: step('900'),
  950: step('950'),
};

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        'ease-shell': 'var(--ease-out)',
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
      colors: {
        gray: neutralScale,
        slate: neutralScale,
        zinc: neutralScale,
        'surface-base': 'var(--surface-base)',
        'surface-raised': 'var(--surface-raised)',
        'surface-overlay': 'var(--surface-overlay)',
        cc: {
          canvas: 'rgb(var(--cc-n-950) / <alpha-value>)',
          surface: 'rgb(var(--cc-n-900) / <alpha-value>)',
          elevated: 'rgb(var(--cc-rgb-elevated) / <alpha-value>)',
          hover: 'rgb(var(--cc-rgb-hover) / <alpha-value>)',
          line: 'rgb(var(--cc-n-800) / <alpha-value>)',
          'line-strong': 'rgb(var(--cc-n-700) / <alpha-value>)',
          ink: 'rgb(var(--cc-n-100) / <alpha-value>)',
          'ink-2': 'rgb(var(--cc-n-400) / <alpha-value>)',
          'ink-3': 'rgb(var(--cc-n-500) / <alpha-value>)',
          accent: 'rgb(var(--cc-rgb-accent) / <alpha-value>)',
          success: 'rgb(var(--cc-rgb-success) / <alpha-value>)',
          danger: 'rgb(var(--cc-rgb-danger) / <alpha-value>)',
          warning: 'rgb(var(--cc-rgb-warning) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
