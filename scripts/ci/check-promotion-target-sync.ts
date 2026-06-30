#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ConstraintDefinition {
  file: string;
  targets: string[];
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const CONTRACTS_PROMOTION_PATH = path.join(
  REPO_ROOT,
  'packages/contracts/src/promotion.ts',
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations');
const CONSTRAINT_NAME = 'picks_promotion_target_check';

function main(): void {
  const contractTargets = readPromotionTargets(CONTRACTS_PROMOTION_PATH);
  const constraintDefinitions = readPromotionTargetConstraints(MIGRATIONS_DIR);
  const findings = compareConstraintDefinitions(contractTargets, constraintDefinitions);

  if (findings.length > 0) {
    console.error('[promotion-target-sync] FAIL');
    console.error(`Canonical targets: ${formatTargets(contractTargets)}`);
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[promotion-target-sync] PASS');
  console.log(`Canonical targets: ${formatTargets(contractTargets)}`);
  for (const definition of constraintDefinitions) {
    console.log(`Constraint ${definition.file}: ${formatTargets(definition.targets)}`);
  }
}

export function readPromotionTargets(filePath: string): string[] {
  const source = readRequiredFile(filePath);
  const match = source.match(
    /export\s+const\s+promotionTargets\s*=\s*\[([\s\S]*?)\]\s+as\s+const/,
  );

  if (!match) {
    throw new Error(`Could not find promotionTargets export in ${filePath}`);
  }

  const targets = parseQuotedStrings(match[1] ?? '');
  if (targets.length === 0) {
    throw new Error(`promotionTargets export in ${filePath} is empty`);
  }
  return targets;
}

export function readPromotionTargetConstraints(migrationsDir: string): ConstraintDefinition[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const definitions: ConstraintDefinition[] = [];
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const absolutePath = path.join(migrationsDir, file);
    const sql = readRequiredFile(absolutePath);
    for (const body of extractConstraintBodies(sql)) {
      const targets = parseQuotedStrings(body);
      definitions.push({ file, targets });
    }
  }

  return definitions;
}

export function compareConstraintDefinitions(
  contractTargets: string[],
  definitions: ConstraintDefinition[],
): string[] {
  const findings: string[] = [];

  if (definitions.length === 0) {
    findings.push(`No ${CONSTRAINT_NAME} definition found in supabase/migrations`);
    return findings;
  }

  for (const definition of definitions) {
    if (!sameOrderedTargets(contractTargets, definition.targets)) {
      findings.push(
        `${definition.file} has ${formatTargets(definition.targets)}, expected ${formatTargets(contractTargets)}`,
      );
    }
  }

  return findings;
}

function extractConstraintBodies(sql: string): string[] {
  const bodies: string[] = [];
  const constraintPattern = new RegExp(`CONSTRAINT\\s+${CONSTRAINT_NAME}\\s+CHECK\\s*\\(`, 'g');
  let match: RegExpExecArray | null;

  while ((match = constraintPattern.exec(sql)) !== null) {
    const bodyStart = match.index;
    const nextConstraint = sql.indexOf('\n    CONSTRAINT ', bodyStart + 1);
    const tableEnd = sql.indexOf('\n);', bodyStart + 1);
    const endCandidates = [nextConstraint, tableEnd].filter((index) => index !== -1);
    const bodyEnd = endCandidates.length > 0 ? Math.min(...endCandidates) : sql.length;
    bodies.push(sql.slice(bodyStart, bodyEnd));
  }

  return bodies;
}

function parseQuotedStrings(input: string): string[] {
  const values: string[] = [];
  const quotedStringPattern = /'([^']+)'/g;
  let match: RegExpExecArray | null;

  while ((match = quotedStringPattern.exec(input)) !== null) {
    const value = match[1];
    if (value !== undefined) {
      values.push(value);
    }
  }

  return values;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function sameOrderedTargets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((target, index) => target === right[index]);
}

function formatTargets(targets: string[]): string {
  return `[${targets.join(', ')}]`;
}

try {
  main();
} catch (error) {
  console.error('[promotion-target-sync] ERROR');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
