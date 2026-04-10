import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { sha256Text } from './hash.js';
import { BlockError } from './result.js';
import type { IssueMetadata, VerificationCommand } from '../types.js';

const REQUIRED_FIELDS = new Set([
  'id',
  'title',
  'tier',
  'phase',
  'upstream_dependencies',
  'allowed_files',
  'forbidden_files',
  'expected_collateral',
  'requires_migration',
  'requires_sql_review',
  'requires_status_sync',
  'pm_review_required',
  'rollback_plan',
  'verification_commands',
  'sql_review_criteria',
  'downstream_unlocks',
]);

const OPTIONAL_FIELDS = new Set(['branch_prefix', 'pr_template', 'notes', 'pre_existing_failures']);

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new BlockError(`metadata field '${field}' must be a string array`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BlockError(`metadata field '${field}' must be a boolean`);
  }
  return value;
}

function assertNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BlockError(`metadata field '${field}' must be a string or null`);
  }
  return value;
}

function assertVerificationCommands(value: unknown): VerificationCommand[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BlockError("metadata field 'verification_commands' must be a non-empty array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new BlockError(`verification_commands[${index}] must be an object`);
    }
    const named = entry as Record<string, unknown>;
    if (typeof named.name !== 'string' || typeof named.cmd !== 'string') {
      throw new BlockError(`verification_commands[${index}] must contain string 'name' and 'cmd'`);
    }
    return { name: named.name, cmd: named.cmd };
  });
}

export function metadataPath(repoRoot: string, issueId: string): string {
  return path.join(repoRoot, '.ut-issues', `${issueId}.yaml`);
}

export function loadMetadata(repoRoot: string, issueId: string): { metadata: IssueMetadata; hash: string } {
  const target = metadataPath(repoRoot, issueId);
  if (!fs.existsSync(target)) {
    throw new BlockError(`missing metadata file .ut-issues/${issueId}.yaml`);
  }

  const raw = fs.readFileSync(target, 'utf8');
  const parsed = YAML.parse(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new BlockError(`metadata file .ut-issues/${issueId}.yaml is malformed`);
  }

  for (const key of Object.keys(parsed)) {
    if (!REQUIRED_FIELDS.has(key) && !OPTIONAL_FIELDS.has(key)) {
      throw new BlockError(`metadata field '${key}' is not allowed`);
    }
  }
  for (const key of REQUIRED_FIELDS) {
    if (!(key in parsed)) {
      throw new BlockError(`metadata field '${key}' is required`);
    }
  }

  if (typeof parsed.id !== 'string' || parsed.id !== issueId) {
    throw new BlockError(`metadata id must equal '${issueId}'`);
  }
  if (typeof parsed.title !== 'string' || parsed.title.length === 0) {
    throw new BlockError("metadata field 'title' must be a non-empty string");
  }
  if (parsed.tier !== 'T1' && parsed.tier !== 'T2' && parsed.tier !== 'T3') {
    throw new BlockError("metadata field 'tier' must be T1, T2, or T3");
  }
  if (parsed.phase !== null && typeof parsed.phase !== 'string') {
    throw new BlockError("metadata field 'phase' must be a string or null");
  }

  const metadata: IssueMetadata = {
    id: parsed.id as string,
    title: parsed.title as string,
    tier: parsed.tier as 'T1' | 'T2' | 'T3',
    phase: parsed.phase as string | null,
    upstream_dependencies: assertStringArray(parsed.upstream_dependencies, 'upstream_dependencies'),
    allowed_files: assertStringArray(parsed.allowed_files, 'allowed_files'),
    forbidden_files: assertStringArray(parsed.forbidden_files, 'forbidden_files'),
    expected_collateral: assertStringArray(parsed.expected_collateral, 'expected_collateral'),
    requires_migration: assertBoolean(parsed.requires_migration, 'requires_migration'),
    requires_sql_review: assertBoolean(parsed.requires_sql_review, 'requires_sql_review'),
    requires_status_sync: assertBoolean(parsed.requires_status_sync, 'requires_status_sync'),
    pm_review_required: assertBoolean(parsed.pm_review_required, 'pm_review_required'),
    rollback_plan: assertNullableString(parsed.rollback_plan, 'rollback_plan'),
    verification_commands: assertVerificationCommands(parsed.verification_commands),
    sql_review_criteria:
      parsed.sql_review_criteria === null
        ? null
        : assertStringArray(parsed.sql_review_criteria, 'sql_review_criteria'),
    downstream_unlocks: assertStringArray(parsed.downstream_unlocks, 'downstream_unlocks'),
    branch_prefix:
      parsed.branch_prefix === undefined
        ? undefined
        : (assertNullableString(parsed.branch_prefix, 'branch_prefix') ?? undefined),
    pr_template: parsed.pr_template === undefined ? null : assertNullableString(parsed.pr_template, 'pr_template'),
    notes: parsed.notes === undefined ? null : assertNullableString(parsed.notes, 'notes'),
    pre_existing_failures:
      parsed.pre_existing_failures === undefined
        ? null
        : assertNullableString(parsed.pre_existing_failures, 'pre_existing_failures'),
  };

  if (metadata.tier === 'T1' && (!metadata.rollback_plan || metadata.rollback_plan.trim().length === 0)) {
    throw new BlockError('T1 issues require a non-empty rollback_plan');
  }
  if (metadata.tier === 'T3' && metadata.requires_migration) {
    throw new BlockError('T3 issues cannot require migrations in V1');
  }

  return {
    metadata,
    hash: sha256Text(raw),
  };
}
