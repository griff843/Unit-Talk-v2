import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALWAYS_EXCLUDED = [
  '!**/node_modules/**',
  '!**/dist/**',
  '!**/.next/**',
  '!.out/**',
  '!coverage/**',
];

const DEFAULT_HISTORY_EXCLUDED = [
  '!docs/archive/**',
  '!docs/06_status/**',
  '!.ops/sync/**',
];

export function buildAgentSearchArgs(argv: string[]): string[] {
  const history = argv.includes('--history');
  const forwarded = argv.filter((argument) => argument !== '--history');
  const exclusions = history
    ? ALWAYS_EXCLUDED
    : [...ALWAYS_EXCLUDED, ...DEFAULT_HISTORY_EXCLUDED];

  return [
    '--line-number',
    '--color=never',
    '--smart-case',
    ...exclusions.flatMap((glob) => ['--glob', glob]),
    ...forwarded,
  ];
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || argv.every((argument) => argument === '--history')) {
    process.stderr.write(
      'Usage: pnpm agent:search -- [--history] <ripgrep-pattern> [paths/options]\n',
    );
    return 2;
  }

  const result = spawnSync('rg', buildAgentSearchArgs(argv), {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    process.stderr.write(
      `[agent:search] unable to run ripgrep: ${result.error.message}\n`,
    );
    return 2;
  }
  return result.status ?? 2;
}

const argv1 = process.argv[1];
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  process.exitCode = main();
}
