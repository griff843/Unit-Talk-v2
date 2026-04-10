import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import type { CliConfig } from '../types.js';

const DEFAULT_CONFIG: CliConfig = {
  defaultBranchPrefix: 'feat/',
  baseBranch: 'main',
  remote: 'origin',
  commitMessageRegex: '^(feat|fix|docs|chore|refactor|test|perf)\\(utv2-\\d+\\): .+',
  coAuthorRequired: null,
  programStatusPath: 'docs/06_status/PROGRAM_STATUS.md',
  lifecycleSpineFiles: [
    'packages/db/src/lifecycle.ts',
    'packages/contracts/src/picks.ts',
    'apps/api/src/distribution-service.ts',
    'apps/api/src/promotion-service.ts',
  ],
};

export function loadConfig(repoRoot: string): CliConfig {
  const configPath = path.join(repoRoot, '.ut-cli.config.yaml');
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8')) as Partial<CliConfig> | null;
  return {
    ...DEFAULT_CONFIG,
    ...(parsed ?? {}),
    lifecycleSpineFiles:
      parsed?.lifecycleSpineFiles && parsed.lifecycleSpineFiles.length > 0
        ? parsed.lifecycleSpineFiles
        : DEFAULT_CONFIG.lifecycleSpineFiles,
  };
}
