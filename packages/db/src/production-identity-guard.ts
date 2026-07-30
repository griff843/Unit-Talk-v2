import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

export type DatabaseAccessMode = 'writable-isolated' | 'production-read-only';

export interface DatabaseIdentityInput {
  accessMode?: string | undefined;
  declaredProjectRef?: string | undefined;
  databaseUrl?: string | undefined;
  supabaseUrl?: string | undefined;
  /** Explicit opt-in for a genuine loopback Supabase dev stack. */
  allowLocalSupabase?: boolean | undefined;
}

export interface DatabaseIdentityEvaluation {
  accessMode: string | null;
  canonicalProduction: boolean;
  declaredProjectRef: string | null;
  observedProjectRefs: string[];
  targetHosts: string[];
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;

export function evaluateDatabaseIdentity(
  input: DatabaseIdentityInput,
): DatabaseIdentityEvaluation {
  const targetValues = [input.supabaseUrl, input.databaseUrl]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const declaredProjectRef = normalizeProjectRef(input.declaredProjectRef);
  const observedProjectRefs = new Set<string>();
  const targetHosts = new Set<string>();

  for (const value of targetValues) {
    for (const projectRef of extractProjectRefs(value)) {
      observedProjectRefs.add(projectRef);
    }
    const host = parseHost(value);
    if (host) targetHosts.add(host);
  }

  if (declaredProjectRef) observedProjectRefs.add(declaredProjectRef);

  return {
    accessMode: input.accessMode?.trim() || null,
    canonicalProduction:
      targetValues.some((value) => containsCanonicalProductionRef(value)) ||
      declaredProjectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
    declaredProjectRef,
    observedProjectRefs: [...observedProjectRefs].sort(),
    targetHosts: [...targetHosts].sort(),
  };
}

export function assertIsolatedWritableDatabaseTarget(
  input: DatabaseIdentityInput,
): DatabaseIdentityEvaluation {
  const evaluation = evaluateDatabaseIdentity(input);

  if (evaluation.accessMode !== 'writable-isolated') {
    throw new Error(
      'Writable DB execution requires UNIT_TALK_DB_ACCESS_MODE=writable-isolated',
    );
  }
  if (!input.supabaseUrl?.trim() && !input.databaseUrl?.trim()) {
    throw new Error(
      'Writable DB execution requires an actual database target URL',
    );
  }
  if (!evaluation.declaredProjectRef) {
    throw new Error(
      'Writable DB execution requires CI_SUPABASE_PROJECT_REF to declare the isolated target identity',
    );
  }
  // UTV2-1627: a declared ref that is not a well-formed Supabase project ref
  // cannot identify anything. Previously `normalizeProjectRef` only trimmed and
  // lowercased, so `CI_SUPABASE_PROJECT_REF=x` satisfied the check above and
  // then trivially "matched" because no URL ref could be extracted either.
  if (!PROJECT_REF_PATTERN.test(evaluation.declaredProjectRef)) {
    throw new Error(
      `Writable DB execution requires a well-formed 20-character Supabase project ref; got "${evaluation.declaredProjectRef}"`,
    );
  }
  if (evaluation.canonicalProduction) {
    throw new Error(
      `Refusing writable DB execution against canonical production Supabase project ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`,
    );
  }

  const urlProjectRefs = new Set<string>();
  for (const value of [input.supabaseUrl, input.databaseUrl]) {
    if (!value) continue;
    for (const projectRef of extractProjectRefs(value)) {
      urlProjectRefs.add(projectRef);
    }
  }

  // UTV2-1627: fail closed when the target's identity cannot be positively
  // determined from the URL itself. Previously the mismatch check below was
  // skipped entirely when no ref could be extracted, so a Supabase custom
  // domain (https://db.example.com), a proxy, or an SSH tunnel
  // (http://127.0.0.1:54321) forwarding to production was ALLOWED — the guard
  // simply had nothing to compare against. Absence of evidence was treated as
  // evidence of isolation.
  if (urlProjectRefs.size === 0) {
    if (!isExplicitlyAllowedLocalSupabase(input, evaluation)) {
      throw new Error(
        `Cannot positively identify the writable DB target from its URL (hosts: ${
          evaluation.targetHosts.join(', ') || 'none'
        }). A Supabase custom domain, proxy, or tunnel may forward to production. ` +
          'Use the project-ref URL form (https://<ref>.supabase.co), or set ' +
          'UNIT_TALK_ALLOW_LOCAL_SUPABASE=true for a genuine loopback dev stack.',
      );
    }
    return evaluation;
  }

  if (!urlProjectRefs.has(evaluation.declaredProjectRef)) {
    throw new Error(
      `Isolated DB identity mismatch: declared ${evaluation.declaredProjectRef}, observed ${[
        ...urlProjectRefs,
      ].join(', ')}`,
    );
  }

  return evaluation;
}

/**
 * A genuine local Supabase stack has no project ref in its URL. Allowing it
 * requires BOTH an explicit opt-in and a loopback host, so the escape hatch
 * cannot be used to reach a remote proxy.
 */
function isExplicitlyAllowedLocalSupabase(
  input: DatabaseIdentityInput,
  evaluation: DatabaseIdentityEvaluation,
): boolean {
  if (input.allowLocalSupabase !== true) return false;
  if (evaluation.targetHosts.length === 0) return false;
  return evaluation.targetHosts.every((host) => LOOPBACK_HOSTS.has(host));
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function assertProductionReadOnlyDatabaseTarget(
  input: DatabaseIdentityInput,
): DatabaseIdentityEvaluation {
  const evaluation = evaluateDatabaseIdentity(input);

  if (evaluation.accessMode !== 'production-read-only') {
    throw new Error(
      'Production observation requires UNIT_TALK_DB_ACCESS_MODE=production-read-only',
    );
  }
  if (!input.supabaseUrl?.trim() && !input.databaseUrl?.trim()) {
    throw new Error(
      'Production observation requires an actual database target URL',
    );
  }
  if (!evaluation.canonicalProduction) {
    throw new Error(
      'Production-read-only classification may only be used for the canonical production target',
    );
  }

  return evaluation;
}

export function databaseIdentityInputFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseIdentityInput {
  return {
    accessMode: env['UNIT_TALK_DB_ACCESS_MODE'],
    declaredProjectRef:
      env['CI_SUPABASE_PROJECT_REF'] ?? env['SUPABASE_PROJECT_REF'],
    databaseUrl:
      env['CI_SUPABASE_DB_URL'] ??
      env['SUPABASE_DB_URL'] ??
      env['DATABASE_URL'],
    supabaseUrl: env['SUPABASE_URL'],
    allowLocalSupabase: env['UNIT_TALK_ALLOW_LOCAL_SUPABASE'] === 'true',
  };
}

/**
 * UTV2-1627: resolve identity from the SAME configuration the DB clients
 * actually use, not from `process.env` alone.
 *
 * This repo loads credentials from `local.env` via `@unit-talk/config`; they are
 * never exported into the shell. A guard reading only `process.env` therefore
 * saw nothing and could not evaluate the real target — which is exactly how the
 * CI preflight became a no-op. `process.env` still wins where set, so an
 * explicitly exported CI value overrides the file.
 */
export function databaseIdentityInputFromResolvedConfig(
  resolved: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseIdentityInput {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = env[key] ?? resolved[key];
      if (value !== undefined && value !== '') return value;
    }
    return undefined;
  };
  return {
    accessMode: pick('UNIT_TALK_DB_ACCESS_MODE'),
    declaredProjectRef: pick('CI_SUPABASE_PROJECT_REF', 'SUPABASE_PROJECT_REF'),
    databaseUrl: pick('CI_SUPABASE_DB_URL', 'SUPABASE_DB_URL', 'DATABASE_URL'),
    supabaseUrl: pick('CI_SUPABASE_URL', 'SUPABASE_URL'),
    allowLocalSupabase: pick('UNIT_TALK_ALLOW_LOCAL_SUPABASE') === 'true',
  };
}

function containsCanonicalProductionRef(value: string): boolean {
  return value
    .toLowerCase()
    .includes(CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF);
}

function extractProjectRefs(value: string): string[] {
  const normalized = value.toLowerCase();
  const tokens = normalized.match(/[a-z0-9]{20}/gu) ?? [];
  return [
    ...new Set(tokens.filter((token) => PROJECT_REF_PATTERN.test(token))),
  ];
}

function normalizeProjectRef(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function parseHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse the repo's env files with the same precedence `@unit-talk/config` uses
 * (local.env > .env > .env.example). Deliberately dependency-free so the guard
 * can run as a standalone CLI in CI before any build step.
 */
export function readResolvedEnvFiles(
  rootDir: string = process.cwd(),
): Record<string, string> {
  const resolved: Record<string, string> = {};
  // Lowest precedence first so later files overwrite earlier ones.
  for (const fileName of ['.env.example', '.env', 'local.env']) {
    const filePath = path.join(rootDir, fileName);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      resolved[trimmed.slice(0, separator).trim()] = trimmed
        .slice(separator + 1)
        .trim();
    }
  }
  return resolved;
}

function main(): void {
  const command = process.argv[2];
  // UTV2-1627: resolve from the real configuration, not process.env alone.
  const input = databaseIdentityInputFromResolvedConfig(readResolvedEnvFiles());
  const evaluation =
    command === '--assert-production-read-only'
      ? assertProductionReadOnlyDatabaseTarget(input)
      : command === '--assert-isolated-writable'
        ? assertIsolatedWritableDatabaseTarget(input)
        : null;

  if (!evaluation) {
    throw new Error(
      'Usage: production-identity-guard.ts --assert-isolated-writable|--assert-production-read-only',
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      accessMode: evaluation.accessMode,
      canonicalProduction: evaluation.canonicalProduction,
      declaredProjectRef: evaluation.declaredProjectRef,
      observedProjectRefs: evaluation.observedProjectRefs,
      targetHosts: evaluation.targetHosts,
    })}\n`,
  );
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
