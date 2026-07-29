import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type DatabaseWorkflowMode =
  | 'control-only'
  | 'production-read-only'
  | 'writable-isolated';

export interface DatabaseTestClassification {
  execution: string[];
  owner: string;
  path: string;
}

export interface DatabaseWorkflowClassification {
  mode: DatabaseWorkflowMode;
  path: string;
  packageScripts: string[];
}

export interface DatabaseWriterInventory {
  schema_version: number;
  canonical_production_project_ref: string;
  credentialed_tests: DatabaseTestClassification[];
  production_read_only_entrypoints: DatabaseTestClassification[];
  workflows: DatabaseWorkflowClassification[];
}

export interface InventoryValidation {
  discoveredCredentialedTests: string[];
  errors: string[];
  ok: boolean;
}

const LIVE_DB_MARKERS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'createServiceRoleDatabaseConnectionConfig',
  'createDatabaseRepositoryBundle',
  'createDatabaseIngestorRepositoryBundle',
  'createDatabaseClientFromConnection',
];

const MUTATION_PATTERNS = [
  /\.delete\s*\(/u,
  /\.enqueue\s*\(/u,
  /\.insert\s*\(/u,
  /\.record\s*\(/u,
  /\.savePick\s*\(/u,
  /\.saveSubmission\s*\(/u,
  /\.update\s*\(/u,
  /\.upsert\s*\(/u,
  /\bclaimNextAtomic\s*\(/u,
  /\btransitionPickLifecycle\s*\(/u,
];

const PRODUCTION_SECRET_REFERENCES = [
  'secrets.SUPABASE_URL',
  'secrets.SUPABASE_ANON_KEY',
  'secrets.SUPABASE_SERVICE_ROLE_KEY',
];

const ISOLATED_SECRET_REFERENCES = [
  'secrets.CI_SUPABASE_URL',
  'secrets.CI_SUPABASE_ANON_KEY',
  'secrets.CI_SUPABASE_SERVICE_ROLE_KEY',
];

export function loadDatabaseWriterInventory(
  root = process.cwd(),
): DatabaseWriterInventory {
  const inventoryPath = path.join(
    root,
    'docs',
    '05_operations',
    'db-writer-classification.json',
  );
  return JSON.parse(
    fs.readFileSync(inventoryPath, 'utf8'),
  ) as DatabaseWriterInventory;
}

export function discoverCredentialedDatabaseTests(
  root = process.cwd(),
): string[] {
  const appsRoot = path.join(root, 'apps');
  if (!fs.existsSync(appsRoot)) return [];

  return walkFiles(appsRoot)
    .filter((filePath) => filePath.endsWith('.test.ts'))
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return LIVE_DB_MARKERS.some((marker) => source.includes(marker));
    })
    .map((filePath) => normalizePath(path.relative(root, filePath)))
    .sort();
}

export function validateDatabaseWriterInventory(
  root = process.cwd(),
  inventory = loadDatabaseWriterInventory(root),
): InventoryValidation {
  const errors: string[] = [];
  const discoveredCredentialedTests = discoverCredentialedDatabaseTests(root);
  const classifiedTests = new Map(
    inventory.credentialed_tests.map((entry) => [entry.path, entry]),
  );

  requireUniquePaths(
    inventory.credentialed_tests,
    'credentialed_tests',
    errors,
  );
  requireUniquePaths(
    inventory.production_read_only_entrypoints,
    'production_read_only_entrypoints',
    errors,
  );
  requireUniquePaths(inventory.workflows, 'workflows', errors);

  for (const testPath of discoveredCredentialedTests) {
    const entry = classifiedTests.get(testPath);
    if (!entry) {
      errors.push(`unclassified credentialed DB test: ${testPath}`);
      continue;
    }
    validateOwnedEntrypoint(root, entry, errors);
  }

  for (const entry of inventory.credentialed_tests) {
    if (!discoveredCredentialedTests.includes(entry.path)) {
      errors.push(`stale credentialed DB test classification: ${entry.path}`);
    }
  }

  for (const entry of inventory.production_read_only_entrypoints) {
    validateOwnedEntrypoint(root, entry, errors);
    const source = readRequiredFile(root, entry.path, errors);
    if (!source) continue;
    const mutation = findMutationSignal(source);
    if (mutation) {
      errors.push(
        `production-read-only entrypoint contains mutation signal ${mutation}: ${entry.path}`,
      );
    }
  }

  const classifiedWorkflows = new Map(
    inventory.workflows.map((entry) => [entry.path, entry]),
  );
  for (const workflowPath of discoverPullRequestDatabaseWorkflows(root)) {
    if (!classifiedWorkflows.has(workflowPath)) {
      errors.push(`unclassified pull-request DB workflow: ${workflowPath}`);
    }
  }

  for (const workflow of inventory.workflows) {
    const source = readRequiredFile(root, workflow.path, errors);
    if (!source) continue;

    if (workflow.mode === 'writable-isolated') {
      for (const secret of PRODUCTION_SECRET_REFERENCES) {
        if (source.includes(secret)) {
          errors.push(
            `writable-isolated workflow references production credential ${secret}: ${workflow.path}`,
          );
        }
      }
      if (
        !/UNIT_TALK_DB_ACCESS_MODE(?::\s*|=)writable-isolated/u.test(source)
      ) {
        errors.push(
          `writable-isolated workflow is missing the access-mode guard: ${workflow.path}`,
        );
      }
      if (
        !workflow.path.endsWith('supabase-pr-db-branch.yml') &&
        !ISOLATED_SECRET_REFERENCES.every((secret) => source.includes(secret))
      ) {
        errors.push(
          `writable-isolated workflow is missing CI_SUPABASE credential wiring: ${workflow.path}`,
        );
      }
      if (
        !source.includes('--assert-isolated-writable') &&
        !source.includes('pnpm ci:db-smoke')
      ) {
        errors.push(
          `writable-isolated workflow does not invoke a guarded DB entrypoint: ${workflow.path}`,
        );
      }
    }

    if (workflow.mode === 'production-read-only') {
      if (!source.includes('UNIT_TALK_DB_ACCESS_MODE: production-read-only')) {
        errors.push(
          `production-read-only workflow is missing the access-mode guard: ${workflow.path}`,
        );
      }
      if (!source.includes('--assert-production-read-only')) {
        errors.push(
          `production-read-only workflow does not invoke the identity guard: ${workflow.path}`,
        );
      }
    }
  }

  validatePackageScriptCoverage(root, inventory, errors);
  validateRequiredGuardPaths(root, errors);

  return {
    discoveredCredentialedTests,
    errors,
    ok: errors.length === 0,
  };
}

function validateRequiredGuardPaths(root: string, errors: string[]): void {
  const smokeSource = readRequiredFile(
    root,
    'scripts/ci/required-db-smoke.ts',
    errors,
  );
  if (
    smokeSource &&
    !smokeSource.includes('assertIsolatedWritableDatabaseTarget')
  ) {
    errors.push('ci:db-smoke no longer invokes the production identity guard');
  }

  const canarySource = readRequiredFile(
    root,
    'apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts',
    errors,
  );
  if (
    canarySource &&
    (!canarySource.includes('production-identity-guard.ts') ||
      !canarySource.includes('--assert-isolated-writable'))
  ) {
    errors.push(
      'UTV2-1497 canary no longer invokes the production identity guard',
    );
  }
}

function discoverPullRequestDatabaseWorkflows(root: string): string[] {
  const workflowRoot = path.join(root, '.github', 'workflows');
  return walkFiles(workflowRoot)
    .filter((filePath) => /\.ya?ml$/u.test(filePath))
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return (
        /^\s*pull_request:/mu.test(source) &&
        (/secrets\.(?:CI_)?SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/u.test(
          source,
        ) ||
          source.includes('supabase branches'))
      );
    })
    .map((filePath) => normalizePath(path.relative(root, filePath)))
    .sort();
}

function validatePackageScriptCoverage(
  root: string,
  inventory: DatabaseWriterInventory,
  errors: string[],
): void {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const classified = new Set(
    inventory.credentialed_tests.map((entry) => entry.path),
  );

  for (const scriptName of ['test:db', 'test:t1-proof:live']) {
    const command = packageJson.scripts?.[scriptName] ?? '';
    const testPaths = [
      ...command.matchAll(/(?:^|\s)(apps\/\S+?\.test\.ts)(?:\s|$)/gu),
    ]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));
    if (testPaths.length === 0) {
      errors.push(
        `package script ${scriptName} has no discoverable DB test entrypoints`,
      );
    }
    for (const testPath of testPaths) {
      if (!classified.has(testPath)) {
        errors.push(
          `package script ${scriptName} reaches unclassified DB test: ${testPath}`,
        );
      }
    }
  }
}

function validateOwnedEntrypoint(
  root: string,
  entry: DatabaseTestClassification,
  errors: string[],
): void {
  readRequiredFile(root, entry.path, errors);
  if (!entry.owner.trim()) {
    errors.push(`database entrypoint has no owner: ${entry.path}`);
  }
  if (
    entry.execution.length === 0 ||
    entry.execution.some((value) => !value.trim())
  ) {
    errors.push(`database entrypoint has no execution path: ${entry.path}`);
  }
}

function readRequiredFile(
  root: string,
  relativePath: string,
  errors: string[],
): string | null {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`classified path does not exist: ${relativePath}`);
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireUniquePaths(
  entries: Array<{ path: string }>,
  collection: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      errors.push(`duplicate ${collection} path: ${entry.path}`);
    }
    seen.add(entry.path);
  }
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

function findMutationSignal(source: string): RegExp | undefined {
  const executableLines = source
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
  return MUTATION_PATTERNS.find((pattern) => pattern.test(executableLines));
}

function main(): void {
  const result = validateDatabaseWriterInventory();
  process.stdout.write(
    `${JSON.stringify(
      {
        schema: 'db-writer-inventory/v1',
        ok: result.ok,
        discovered_credentialed_tests:
          result.discoveredCredentialedTests.length,
        errors: result.errors,
      },
      null,
      2,
    )}\n`,
  );
  if (!result.ok) process.exit(1);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  main();
}
