import type { Config } from 'tailwindcss';

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
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
