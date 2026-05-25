import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ConcurrencyConfig {
  version: number;
  total: number;
  executors: {
    claude: number;
    codex: number;
  };
  merge_serialized_max: number;
  singleton_types: string[];
  forbidden_combinations: [string, string][];
}

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_FILE_PATH = path.join(
  SCRIPT_ROOT,
  'docs',
  'governance',
  'CONCURRENCY_CONFIG.json',
);

let _cached: ConcurrencyConfig | null = null;

export function loadConcurrencyConfig(): ConcurrencyConfig {
  if (_cached !== null) return _cached;
  try {
    _cached = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8')) as ConcurrencyConfig;
    return _cached;
  } catch (error) {
    throw new Error(
      `[concurrency-config] Cannot load ${CONFIG_FILE_PATH}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Ensure docs/governance/CONCURRENCY_CONFIG.json exists.',
    );
  }
}

export function clearConcurrencyConfigCache(): void {
  _cached = null;
}
