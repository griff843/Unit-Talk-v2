import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { FiberyClient, type FiberyEntityConfig, type FiberyOperationResult } from './fibery-client.js';

export type SyncEvent = 'pr_open' | 'merge';
export type EntityKind = 'issues' | 'findings' | 'controls' | 'proofs';

export type SyncMetadata = {
  version: 1;
  approval: {
    allow_multiple_issues: boolean;
  };
  entities: Record<EntityKind, string[]>;
};

export type FiberyPolicy = {
  version: 1;
  fibery: {
    api_url_env: string;
    api_token_env: string;
    dry_run_env: string;
  };
  defaults: {
    append_only: boolean;
    note_separator: string;
  };
  entities: Record<EntityKind, FiberyEntityConfig & {
    state_updates: Partial<Record<SyncEvent, string>>;
  }>;
};

export type SyncContext = {
  event: SyncEvent;
  prNumber: string;
  prTitle: string;
  prUrl: string;
  actor: string;
  sha: string;
  repository: string;
};

export type SyncAction = {
  kind: EntityKind;
  id: string;
  note: string;
  state: string | null;
};

export type SyncResult = {
  ok: boolean;
  code: string;
  event: SyncEvent;
  dry_run: boolean;
  actions: SyncAction[];
  results: FiberyOperationResult[];
  errors: string[];
  comment_markdown: string;
};

const ENTITY_KINDS: EntityKind[] = ['issues', 'findings', 'controls', 'proofs'];
const ISSUE_ID_PATTERN = /^UTV2-\d+$/;

export function loadSyncMetadata(filePath: string): SyncMetadata {
  const parsed = parseYamlFile(filePath);
  const root = requireRecord(parsed, filePath);
  const entities = requireRecord(root.entities, 'entities');
  const approval = isRecord(root.approval) ? root.approval : {};

  return {
    version: 1,
    approval: {
      allow_multiple_issues: approval.allow_multiple_issues === true,
    },
    entities: {
      issues: readIdList(entities.issues),
      findings: readIdList(entities.findings),
      controls: readIdList(entities.controls),
      proofs: readIdList(entities.proofs),
    },
  };
}

export function loadFiberyPolicy(filePath: string): FiberyPolicy {
  const parsed = parseYamlFile(filePath);
  const root = requireRecord(parsed, filePath);
  const fibery = requireRecord(root.fibery, 'fibery');
  const defaults = requireRecord(root.defaults, 'defaults');
  const entities = requireRecord(root.entities, 'entities');

  return {
    version: 1,
    fibery: {
      api_url_env: requireString(fibery.api_url_env, 'fibery.api_url_env'),
      api_token_env: requireString(fibery.api_token_env, 'fibery.api_token_env'),
      dry_run_env: requireString(fibery.dry_run_env, 'fibery.dry_run_env'),
    },
    defaults: {
      append_only: defaults.append_only !== false,
      note_separator: typeof defaults.note_separator === 'string' ? defaults.note_separator : '\n\n---\n\n',
    },
    entities: {
      issues: readEntityPolicy(entities.issues, 'entities.issues'),
      findings: readEntityPolicy(entities.findings, 'entities.findings'),
      controls: readEntityPolicy(entities.controls, 'entities.controls'),
      proofs: readEntityPolicy(entities.proofs, 'entities.proofs'),
    },
  };
}

export function validateSyncMetadata(metadata: SyncMetadata): string[] {
  const errors: string[] = [];
  if (metadata.entities.issues.length === 0) {
    errors.push('No implementation issue ID declared in .ops/sync.yml');
  }
  const invalidIssues = metadata.entities.issues.filter((id) => !ISSUE_ID_PATTERN.test(id));
  if (invalidIssues.length > 0) {
    errors.push(`Invalid issue IDs: ${invalidIssues.join(', ')}`);
  }
  if (metadata.entities.issues.length > 1 && !metadata.approval.allow_multiple_issues) {
    errors.push('Multiple issue IDs declared without approval.allow_multiple_issues: true');
  }
  return errors;
}

export function buildSyncActions(
  metadata: SyncMetadata,
  policy: FiberyPolicy,
  context: SyncContext,
): SyncAction[] {
  const note = buildDatedSyncNote(context);
  const actions: SyncAction[] = [];
  for (const kind of ENTITY_KINDS) {
    const state = kind === 'issues' ? (policy.entities.issues.state_updates[context.event] ?? null) : null;
    for (const id of metadata.entities[kind]) {
      actions.push({
        kind,
        id,
        note,
        state,
      });
    }
  }
  return actions;
}

export async function runFiberySync(input: {
  metadata: SyncMetadata;
  policy: FiberyPolicy;
  context: SyncContext;
  client: FiberyClient;
  dryRun: boolean;
}): Promise<SyncResult> {
  const errors = validateSyncMetadata(input.metadata);
  if (errors.length > 0) {
    const result = buildResult({
      event: input.context.event,
      dryRun: input.dryRun,
      code: 'sync_metadata_invalid',
      actions: [],
      results: [],
      errors,
    });
    return result;
  }

  const actions = buildSyncActions(input.metadata, input.policy, input.context);
  const results: FiberyOperationResult[] = [];
  for (const action of actions) {
    const config = input.policy.entities[action.kind];
    results.push(
      await input.client.appendNote(config, action.id, action.note, input.policy.defaults.note_separator),
    );
    if (action.state) {
      results.push(await input.client.setState(config, action.id, action.state));
    }
  }

  return buildResult({
    event: input.context.event,
    dryRun: input.dryRun,
    code: 'fibery_sync_complete',
    actions,
    results,
    errors: [],
  });
}

export function buildResult(input: {
  event: SyncEvent;
  dryRun: boolean;
  code: string;
  actions: SyncAction[];
  results: FiberyOperationResult[];
  errors: string[];
}): SyncResult {
  return {
    ok: input.errors.length === 0,
    code: input.code,
    event: input.event,
    dry_run: input.dryRun,
    actions: input.actions,
    results: input.results,
    errors: input.errors,
    comment_markdown: buildCommentMarkdown(input),
  };
}

export function buildCommentMarkdown(input: {
  event: SyncEvent;
  dryRun: boolean;
  code: string;
  actions: SyncAction[];
  results: FiberyOperationResult[];
  errors: string[];
}): string {
  const lines = [
    '### Fibery Sync',
    '',
    `Result: ${input.errors.length === 0 ? 'OK' : 'FAILED'}`,
    `Event: ${input.event}`,
    `Mode: ${input.dryRun ? 'dry run' : 'live'}`,
    '',
  ];
  if (input.errors.length > 0) {
    lines.push('Errors:');
    for (const error of input.errors) {
      lines.push(`- ${error}`);
    }
    return `${lines.join('\n')}\n`;
  }

  lines.push('Actions:');
  for (const action of input.actions) {
    const stateText = action.state ? `; state -> ${action.state}` : '; note only';
    lines.push(`- ${action.kind}: ${action.id}${stateText}`);
  }
  lines.push('');
  lines.push(`Operations posted: ${input.results.length}`);
  return `${lines.join('\n')}\n`;
}

function buildDatedSyncNote(context: SyncContext): string {
  const timestamp = new Date().toISOString();
  const eventLabel = context.event === 'pr_open' ? 'PR opened or updated' : 'PR merged';
  return [
    `## GitHub sync - ${timestamp}`,
    '',
    `Event: ${eventLabel}`,
    `Repository: ${context.repository}`,
    `PR: #${context.prNumber} - ${context.prTitle}`,
    `URL: ${context.prUrl}`,
    `SHA: ${context.sha}`,
    `Actor: ${context.actor}`,
  ].join('\n');
}

function parseYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.normalize(filePath)}`);
  }
  return YAML.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (isRecord(entry) && typeof entry.id === 'string') {
        return entry.id.trim();
      }
      return '';
    })
    .filter(Boolean);
}

function readEntityPolicy(value: unknown, label: string): FiberyPolicy['entities'][EntityKind] {
  const record = requireRecord(value, label);
  const stateUpdatesRaw = isRecord(record.state_updates) ? record.state_updates : {};
  return {
    type: requireString(record.type, `${label}.type`),
    lookup_field: requireString(record.lookup_field, `${label}.lookup_field`),
    note_field: requireString(record.note_field, `${label}.note_field`),
    state_field: typeof record.state_field === 'string' ? record.state_field : undefined,
    state_updates: {
      pr_open: typeof stateUpdatesRaw.pr_open === 'string' ? stateUpdatesRaw.pr_open : undefined,
      merge: typeof stateUpdatesRaw.merge === 'string' ? stateUpdatesRaw.merge : undefined,
    },
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
