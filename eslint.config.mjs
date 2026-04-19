import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '.turbo/**',
      '.pnpm-store/**',
      'coverage/**',
      'artifacts/**',
      '.claude/worktrees/**',
      '.out/**',
      'scripts/debug-*.ts',
      'scripts/live-data-lab-*.ts',
      // smart-form is a Next.js app with its own eslint-config-next setup.
      // Root lint covers .ts only; Next.js handles .tsx linting via `next lint`.
      'apps/smart-form/**/*.tsx',
      'apps/smart-form/**/*.jsx',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Architecture boundary: apps must not import from other apps
  {
    files: ['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@unit-talk/api', '@unit-talk/api/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/worker', '@unit-talk/worker/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/operator-web', '@unit-talk/operator-web/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/command-center', '@unit-talk/command-center/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/smart-form', '@unit-talk/smart-form/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/discord-bot', '@unit-talk/discord-bot/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/alert-agent', '@unit-talk/alert-agent/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
            {
              group: ['@unit-talk/ingestor', '@unit-talk/ingestor/*'],
              message: 'Apps must not import from other apps. Move shared code to a package.',
            },
          ],
        },
      ],
    },
  },
  // Ported shadcn/ui + Radix UI components — intentional `any` usage in forwardRef/CVA patterns
  {
    files: ['apps/smart-form/components/ui/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
);
