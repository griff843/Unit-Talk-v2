import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TrialConfig {
  enabled: boolean;
  total: number;
  executors: {
    claude: number;
    codex: number;
  };
  allowed_until: string | null;
  rationale: string;
  safe_types_only: string[];
}

/**
 * Per-type distribution caps (UTV2-1533 PM review finding P2). These are
 * independent of, and layered on top of, the total/executor caps above --
 * a lane must pass both the total/executor check AND its type-specific check.
 * `hygiene`/`governance` are simple counts; `delivery-ui`/`verification` are
 * scoped caps (one active lane per app / per target issue), keyed on values
 * derived from the incoming lane's own manifest fields -- see
 * `deriveDeliveryUiApp()` and `verification_target` in shared.ts. Always
 * sourced from base config, never overridden by trial (a trial widens total/
 * executor headroom, not the per-type distribution safety rails).
 */
export interface TypeCapsConfig {
  hygiene: number;
  governance: number;
  'delivery-ui': { max_per_app: number };
  verification: { max_per_target: number };
}

/**
 * Fallback used only if a loaded CONCURRENCY_CONFIG.json predates the
 * `type_caps` field (defense in depth -- every config written by this repo
 * going forward includes it). Matches the ratified §1 values.
 */
export const DEFAULT_TYPE_CAPS: TypeCapsConfig = {
  hygiene: 4,
  governance: 3,
  'delivery-ui': { max_per_app: 1 },
  verification: { max_per_target: 1 },
};

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
  type_caps: TypeCapsConfig;
  trial?: TrialConfig;
}

export interface EffectiveConcurrencyConfig extends ConcurrencyConfig {
  total: number;
  executors: {
    claude: number;
    codex: number;
  };
  trial_active: boolean;
  trial_expires_at: string | null;
  base_total: number;
  base_executors: {
    claude: number;
    codex: number;
  };
  trial_safe_types_only: string[];
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
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8')) as ConcurrencyConfig;
    _cached = { ...parsed, type_caps: parsed.type_caps ?? DEFAULT_TYPE_CAPS };
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

/**
 * Returns the effective limits to enforce. When the trial governor is enabled
 * and allowed_until is in the future (or null), returns trial-scale limits.
 * Auto-reverts to base limits once allowed_until is past.
 */
export function getEffectiveConfig(
  config: ConcurrencyConfig,
  now: Date = new Date(),
): EffectiveConcurrencyConfig {
  const trial = config.trial;
  const trialActive =
    trial !== undefined &&
    trial.enabled === true &&
    (trial.allowed_until === null || new Date(trial.allowed_until) > now);

  if (trialActive && trial !== undefined) {
    return {
      ...config,
      total: trial.total,
      executors: { claude: trial.executors.claude, codex: trial.executors.codex },
      trial_active: true,
      trial_expires_at: trial.allowed_until,
      base_total: config.total,
      base_executors: { claude: config.executors.claude, codex: config.executors.codex },
      trial_safe_types_only: trial.safe_types_only,
    };
  }

  return {
    ...config,
    total: config.total,
    executors: { claude: config.executors.claude, codex: config.executors.codex },
    trial_active: false,
    trial_expires_at: null,
    base_total: config.total,
    base_executors: { claude: config.executors.claude, codex: config.executors.codex },
    trial_safe_types_only: config.trial?.safe_types_only ?? [],
  };
}
