#!/usr/bin/env tsx
/**
 * scope-suggest — suggest file scope for a lane before ops:lane-start
 *
 * Reads the Linear issue description and maps it to likely file paths,
 * reducing scope_bleed CI failures caused by under-declared scope locks.
 *
 * Usage:
 *   pnpm ops:scope-suggest --issue UTV2-###
 *   pnpm ops:scope-suggest --description "add CLV scoring to CanonicalPick"
 *   pnpm ops:scope-suggest --issue UTV2-### --json
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitJson, getFlag, parseArgs, ROOT } from './shared.js';

const __filename = fileURLToPath(import.meta.url);

// Keyword → likely file paths mapping (order matters — more specific first)
const KEYWORD_RULES: Array<{ keywords: string[]; paths: string[] }> = [
  {
    keywords: ['migration', 'schema', 'alter table', 'drop column', 'add column'],
    paths: ['supabase/migrations/'],
  },
  {
    keywords: ['database.types', 'generated types', 'supabase:types'],
    paths: ['packages/db/src/database.types.ts'],
  },
  {
    keywords: ['canonicalpick', 'canonical pick', 'pick schema', 'pick lifecycle'],
    paths: ['packages/domain/src/', 'packages/contracts/src/'],
  },
  {
    keywords: ['clv', 'closing line value', 'clv score'],
    paths: ['packages/domain/src/clv.ts', 'apps/api/src/'],
  },
  {
    keywords: ['scoring', 'score', 'promotion', 'promote'],
    paths: ['packages/domain/src/', 'apps/api/src/scoring'],
  },
  {
    keywords: ['outbox', 'delivery', 'dead letter', 'retry', 'circuit breaker'],
    paths: ['apps/worker/src/', 'packages/db/src/lifecycle.ts'],
  },
  {
    keywords: ['worker', 'poller', 'processor'],
    paths: ['apps/worker/src/'],
  },
  {
    keywords: ['discord', 'notification', 'channel', 'delivery target'],
    paths: ['apps/worker/src/', 'apps/command-center/'],
  },
  {
    keywords: ['command center', 'ui', 'frontend', 'dashboard'],
    paths: ['apps/command-center/'],
  },
  {
    keywords: ['smart form', 'submission', 'submit'],
    paths: ['apps/smart-form/', 'apps/api/src/submission-service.ts'],
  },
  {
    keywords: ['auth', 'rbac', 'role', 'permission'],
    paths: ['apps/api/src/auth.ts'],
  },
  {
    keywords: ['ingestor', 'ingest', 'provider', 'sgo', 'odds'],
    paths: ['apps/worker/src/', 'packages/db/src/'],
  },
  {
    keywords: ['api', 'endpoint', 'route', 'handler'],
    paths: ['apps/api/src/'],
  },
  {
    keywords: ['constitution', 'governance', 'policy', 'audit'],
    paths: ['docs/00_constitution/', 'docs/05_operations/'],
  },
  {
    keywords: ['ci', 'github actions', 'workflow', 'deploy'],
    paths: ['.github/workflows/'],
  },
  {
    keywords: ['lane', 'dispatch', 'ops', 'truth-check'],
    paths: ['scripts/ops/'],
  },
  {
    keywords: ['config', 'env', 'environment variable'],
    paths: ['packages/config/src/'],
  },
  {
    keywords: ['test', 'spec', 'vitest', 'jest'],
    paths: [], // don't suggest test files as scope — they follow the source file
  },
];

function extractExplicitPaths(text: string): string[] {
  // Match patterns like: apps/api/src/foo.ts, packages/domain/src/bar.ts
  const filePathRe = /(?:^|\s)((?:apps|packages|scripts|supabase|docs|\.github)\/[\w\-./]+\.(?:ts|mjs|js|json|md|sql|yml|yaml))/gm;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = filePathRe.exec(text)) !== null) {
    matches.push(m[1]);
  }
  return [...new Set(matches)];
}

function matchKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const suggested = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      rule.paths.forEach((p) => suggested.add(p));
    }
  }
  return [...suggested];
}

function fetchLinearDescription(issueId: string): string | null {
  const token = process.env.LINEAR_API_TOKEN ?? process.env.LINEAR_API_KEY ?? '';
  if (!token) return null;

  const query = `{ issue(id: "${issueId}") { title description } }`;
  try {
    const res = spawnSync('curl', [
      '-s', '-X', 'POST', 'https://api.linear.app/graphql',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: ${token}`,
      '-d', JSON.stringify({ query }),
    ], { encoding: 'utf8' });
    if (res.status !== 0) return null;
    const parsed = JSON.parse(res.stdout ?? '{}');
    const issue = parsed?.data?.issue;
    if (!issue) return null;
    return `${issue.title ?? ''}\n\n${issue.description ?? ''}`;
  } catch {
    return null;
  }
}

function readManifestDescription(issueId: string): string | null {
  const manifestPath = path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
  if (!existsSync(manifestPath)) return null;
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return m.description ?? null;
  } catch {
    return null;
  }
}

interface ScopeSuggestion {
  issue_id: string | null;
  explicit_paths: string[];
  keyword_paths: string[];
  suggested_files: string[];
  lane_start_flags: string;
  source: 'linear' | 'manifest' | 'cli' | 'none';
}

function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const issueId = getFlag(flags, 'issue') ?? null;
  const cliDescription = getFlag(flags, 'description') ?? null;
  const json = bools.has('json');

  let description: string | null = null;
  let source: ScopeSuggestion['source'] = 'none';

  if (cliDescription) {
    description = cliDescription;
    source = 'cli';
  } else if (issueId) {
    description = fetchLinearDescription(issueId);
    if (description) {
      source = 'linear';
    } else {
      description = readManifestDescription(issueId);
      if (description) source = 'manifest';
    }
  }

  if (!description) {
    const result: ScopeSuggestion = {
      issue_id: issueId,
      explicit_paths: [],
      keyword_paths: [],
      suggested_files: [],
      lane_start_flags: '',
      source: 'none',
    };
    if (json) emitJson(result);
    else process.stdout.write('[scope-suggest] no description available — pass --description or ensure LINEAR_API_TOKEN is set\n');
    return 1;
  }

  const explicit = extractExplicitPaths(description);
  const keyword = matchKeywords(description);
  const all = [...new Set([...explicit, ...keyword])];
  const flags_str = all.map((f) => `--files ${f}`).join(' ');

  const result: ScopeSuggestion = {
    issue_id: issueId,
    explicit_paths: explicit,
    keyword_paths: keyword,
    suggested_files: all,
    lane_start_flags: flags_str,
    source,
  };

  if (json) {
    emitJson(result);
  } else {
    process.stdout.write(`Suggested scope (source: ${source}):\n`);
    if (explicit.length) process.stdout.write(`  Explicit paths found in description:\n${explicit.map((p) => `    ${p}`).join('\n')}\n`);
    if (keyword.length) process.stdout.write(`  Keyword-matched paths:\n${keyword.map((p) => `    ${p}`).join('\n')}\n`);
    process.stdout.write(`\nops:lane-start flags:\n  ${flags_str || '(no suggestions — declare scope manually)'}\n`);
  }

  return 0;
}

if (process.argv[1] && import.meta.url === fileURLToPath(new URL(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`[scope-suggest] error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
