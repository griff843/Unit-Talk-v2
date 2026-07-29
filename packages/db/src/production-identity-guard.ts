import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

export type DatabaseAccessMode = 'writable-isolated' | 'production-read-only';

export interface DatabaseIdentityInput {
  accessMode?: string | undefined;
  declaredProjectRef?: string | undefined;
  databaseUrl?: string | undefined;
  supabaseUrl?: string | undefined;
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
  if (
    urlProjectRefs.size > 0 &&
    !urlProjectRefs.has(evaluation.declaredProjectRef)
  ) {
    throw new Error(
      `Isolated DB identity mismatch: declared ${evaluation.declaredProjectRef}, observed ${[
        ...urlProjectRefs,
      ].join(', ')}`,
    );
  }

  return evaluation;
}

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

function main(): void {
  const command = process.argv[2];
  const input = databaseIdentityInputFromEnv();
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
