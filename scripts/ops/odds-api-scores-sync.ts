import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createDatabaseIngestorRepositoryBundle, type IngestorRepositoryBundle } from '@unit-talk/db';
import { isApprovedStagingTarget, extractProjectRefFromUrl, CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF } from '@unit-talk/db/target-identity';

import { createDryRunIngestorRepositoryBundle } from '../../apps/ingestor/src/dry-run-repositories.js';
import { fetchOddsApiScores } from '../../apps/ingestor/src/odds-api-fetcher.js';
import { parseOddsApiScores, type ScoresLeague } from '../../apps/ingestor/src/odds-api-scores-parser.js';
import { resolveOddsApiScores, type ScoresContext } from '../../apps/ingestor/src/odds-api-scores-resolver.js';

export interface ScoresSyncDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  createRepositories: () => IngestorRepositoryBundle;
  now?: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
}
const USAGE = 'pnpm results:odds-api-scores --league <NFL|NBA|NHL|MLB> [--days-from 1|2|3] (--fixture <path> | --live) [--apply]';

export async function runOddsApiScoresSync(deps: ScoresSyncDeps) {
  const args = new Map<string, string>();
  const problems: string[] = [];
  for (let index = 0; index < deps.argv.length; index++) {
    const flag = deps.argv[index]!;
    if (!['--league', '--days-from', '--fixture', '--live', '--apply'].includes(flag)) {
      problems.push(`Unknown argument ${flag}`); continue;
    }
    if (args.has(flag)) problems.push(`Repeated argument ${flag}`);
    if (flag === '--live' || flag === '--apply') { args.set(flag, 'true'); continue; }
    const value = deps.argv[index + 1];
    if (!value || value.startsWith('--')) { problems.push(`${flag} requires a value`); continue; }
    args.set(flag, value); index++;
  }
  const league = args.get('--league');
  if (!league || !['NFL', 'NBA', 'NHL', 'MLB'].includes(league)) problems.push('--league must be NFL, NBA, NHL or MLB');
  const daysFrom = Number(args.get('--days-from') ?? 1);
  if (!Number.isInteger(daysFrom) || daysFrom < 1 || daysFrom > 3) problems.push('--days-from must be 1, 2 or 3');
  const fixture = args.get('--fixture'), live = args.has('--live'), apply = args.has('--apply');
  if (Boolean(fixture) === live) problems.push('Exactly one of --fixture <path> or --live is required');
  if (live && !deps.env['ODDS_API_KEY']) problems.push('--live requires ODDS_API_KEY');
  // Validate target before file reads, vendor requests, or repository construction.
  if (apply && !isApprovedStagingTarget(deps.env['SUPABASE_URL'])) {
    const production = extractProjectRefFromUrl(deps.env['SUPABASE_URL']).projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF;
    problems.push(production ? 'Production --apply is forbidden; only approved staging is allowed' : '--apply requires the approved staging project');
  }
  if (problems.length) {
    deps.error(`${problems.join('; ')}\nCorrect invocation: ${USAGE}`);
    return { exitCode: 1, report: null };
  }
  let quota: { remaining: number | null; used: number | null; last: number | null } = { remaining: null, used: null, last: null };
  try {
    let raw: unknown;
    let fetchedAt: string;
    let payloadKind: ScoresContext['payloadKind'];
    if (fixture) {
      const envelope: unknown = JSON.parse(await readFile(fixture, 'utf8'));
      if (!envelope || typeof envelope !== 'object') throw new Error('Fixture must be a labelled envelope');
      const body = envelope as Record<string, unknown>;
      const provenance = body['provenance'];
      if ((provenance !== 'doc-derived' && provenance !== 'recorded') ||
          !fixture.endsWith(`.${provenance}.json`) || body['league'] !== league) {
        throw new Error('Fixture provenance, filename and requested league must agree');
      }
      raw = body['response'];
      payloadKind = provenance === 'doc-derived' ? 'fixture-doc-derived' : 'fixture-recorded';
      fetchedAt = (deps.now?.() ?? new Date()).toISOString();
    } else {
      const result = await fetchOddsApiScores({ apiKey: deps.env['ODDS_API_KEY']!, league: league!, daysFrom, fetchImpl: deps.fetchImpl });
      raw = result.events; fetchedAt = result.fetchedAt; quota = result.quota; payloadKind = 'live';
    }
    const parsed = parseOddsApiScores(raw, league as ScoresLeague, deps.now?.() ?? new Date());
    const real = deps.createRepositories();
    const dryRun = apply ? null : createDryRunIngestorRepositoryBundle(real);
    const repositories = dryRun?.repositories ?? real;
    let runId = `dry-run:${randomUUID()}`;
    if (apply) {
      const run = await real.runs.startRun({ runType: 'odds-api-scores.operator-run', actor: 'operator-cli', details: { league, payloadKind, quota } });
      runId = run.id;
      // The repository opens as running. Fail it immediately so an interrupted run
      // cannot claim success; only full resolver completion upgrades it.
      await real.runs.completeRun({ runId, status: 'failed', details: { league, payloadKind, quota, reason: 'incomplete' } });
    }
    const summary = await resolveOddsApiScores(parsed, league as ScoresLeague, runId, repositories, { fetchedAt, payloadKind });
    if (apply) await real.runs.completeRun({ runId, status: 'succeeded', details: { league, payloadKind, quota, summary } });
    const report = { mode: apply ? 'apply' : 'dry-run', wroteNothing: !apply, blastRadius: dryRun?.report() ?? null,
      quota, decisions: parsed.map((p) => ({ eventId: p.eventId, status: p.status,
        reason: summary.skipped.find((s) => s.eventId === p.eventId)?.reason ?? null })), summary };
    deps.log(JSON.stringify(report, null, 2));
    return { exitCode: 0, report };
  } catch (error) {
    // Do not echo transport errors that could contain a credential-bearing URL.
    deps.error(`Scores sync failed (${error instanceof Error ? error.name : 'unknown error'}).`);
    deps.log(JSON.stringify({ quota }));
    return { exitCode: 1, report: null };
  }
}

function isMain(): boolean {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]!) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isMain()) {
  // Explicit process configuration only: never load local.env or implicit credentials.
  const env = process.env;
  void runOddsApiScoresSync({ argv: process.argv.slice(2), env, fetchImpl: fetch,
    createRepositories: () => {
      if (!env['SUPABASE_URL'] || !env['SUPABASE_SERVICE_ROLE_KEY']) throw new Error('Database configuration required');
      return createDatabaseIngestorRepositoryBundle({ url: env['SUPABASE_URL'], key: env['SUPABASE_SERVICE_ROLE_KEY'], role: 'service_role' });
    }, log: console.log, error: console.error,
  }).then((result) => { process.exitCode = result.exitCode; });
}
