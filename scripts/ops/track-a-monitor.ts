/**
 * Track A monitor (UTV2-1276) — durable, read-only CLV-path watch for UTV2-1250.
 *
 * Consolidates the read-only diagnostics described in
 * `docs/06_status/proof/UTV2-1250/MONITOR_SPEC.md` into a single snapshot, decides
 * whether a report is warranted (see `track-a-triggers.ts`), and posts a comment to
 * the Track A monitor lane ONLY when a trigger fires. Designed to run from a GitHub
 * Actions scheduled workflow every 6 hours.
 *
 * Hard guardrails — this script:
 *   - is READ-ONLY against Supabase (only counts/selects; no insert/update/delete);
 *   - never certifies, never marks any lane Done, never makes CLV/ROI/edge claims;
 *   - never enables delivery / public Discord and never runs backfill;
 *   - never prints secrets.
 *
 * Usage:
 *   tsx scripts/ops/track-a-monitor.ts --output-json artifacts/track-a.json
 *   tsx scripts/ops/track-a-monitor.ts --dry-run        # collect + decide, never post
 *
 * Exits 0 always (a monitor, not a gate). Read failures are surfaced as `errors`
 * in the snapshot and reported as a blocker, but do not crash the workflow.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  evaluateTriggers,
  type TrackASnapshot,
  type TriggerResult,
} from './track-a-triggers.js';

const MONITOR_ISSUE = 'UTV2-1250';
const LINEAR_TEAM_KEY = 'UTV2';
const STATE_MARKER = 'TRACK_A_STATE_JSON:';
const PENDING_STATUSES = 'posted,awaiting_approval,queued';

interface Args {
  outputJson: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { outputJson: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-json') out.outputJson = argv[++i] ?? null;
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

/** Read-only PostgREST count. On error, records the message and returns 0. */
async function restCount(
  base: string,
  headers: Record<string, string>,
  query: string,
  errors: string[],
): Promise<number> {
  try {
    const res = await fetch(`${base}/rest/v1/${query}`, {
      headers: { ...headers, Range: '0-0', Prefer: 'count=exact' },
    });
    if (!res.ok && res.status !== 206) {
      errors.push(`${query.split('?')[0]} -> HTTP ${res.status}`);
      return 0;
    }
    const cr = res.headers.get('content-range') ?? '';
    const total = Number(cr.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch (err) {
    errors.push(`${query.split('?')[0]} -> ${(err as Error).message}`);
    return 0;
  }
}

async function collectSnapshot(): Promise<TrackASnapshot> {
  const env = loadEnvironment();
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const errors: string[] = [];
  const capturedAt = new Date().toISOString();

  if (!base || !key) {
    return emptySnapshot(capturedAt, ['SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unavailable']);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const c = (q: string) => restCount(base, headers, q, errors);

  const [
    closingForClvTotal,
    closingForClvBackfilled,
    settledClvPathNative,
    wellFormedPendingPlayerProps,
    wellFormedSettledPlayerProps,
    clvComputed,
    clvMissingEventContext,
    clvMissingClosingLine,
    suppressPicks,
  ] = await Promise.all([
    c('pick_offer_snapshots?snapshot_kind=eq.closing_for_clv'),
    c('pick_offer_snapshots?snapshot_kind=eq.closing_for_clv&payload->>backfill=eq.true'),
    c(
      'settlement_records?select=id,picks!inner(id),pick_offer_snapshots!inner(id)' +
        '&status=eq.settled&result=in.(win,loss,push)' +
        '&pick_offer_snapshots.snapshot_kind=eq.closing_for_clv' +
        '&pick_offer_snapshots.payload->>backfill=not.eq.true',
    ),
    c(`picks?market=like.player_*&participant_id=not.is.null&status=in.(${PENDING_STATUSES})`),
    c('picks?market=like.player_*&participant_id=not.is.null&status=eq.settled'),
    c('settlement_records?payload->>clvStatus=eq.computed'),
    c('settlement_records?payload->>clvStatus=eq.missing_event_context'),
    c('settlement_records?payload->>clvStatus=eq.missing_closing_line'),
    c('picks?metadata->>band=eq.SUPPRESS'),
  ]);

  return {
    capturedAt,
    settledClvPathNative,
    closingForClvTotal,
    closingForClvBackfilled,
    closingForClvNative: Math.max(0, closingForClvTotal - closingForClvBackfilled),
    wellFormedPendingPlayerProps,
    wellFormedSettledPlayerProps,
    clvComputed,
    clvMissingEventContext,
    clvMissingClosingLine,
    suppressPicks,
    publicDiscordRecentPosts: null, // monitor never queries/changes delivery; public gate stays held.
    errors,
  };
}

function emptySnapshot(capturedAt: string, errors: string[]): TrackASnapshot {
  return {
    capturedAt,
    settledClvPathNative: 0,
    closingForClvTotal: 0,
    closingForClvBackfilled: 0,
    closingForClvNative: 0,
    wellFormedPendingPlayerProps: 0,
    wellFormedSettledPlayerProps: 0,
    clvComputed: 0,
    clvMissingEventContext: 0,
    clvMissingClosingLine: 0,
    suppressPicks: 0,
    publicDiscordRecentPosts: null,
    errors,
  };
}

// --- Linear state (previous snapshot) read + comment write -----------------

async function linearGraphql<T>(token: string, query: string, variables: unknown): Promise<T> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

interface IssueLookup {
  issues: {
    nodes: Array<{
      id: string;
      identifier: string;
      comments: { nodes: Array<{ body: string; createdAt: string }> };
    }>;
  };
}

function parseState(body: string): TrackASnapshot | null {
  const idx = body.indexOf(STATE_MARKER);
  if (idx === -1) return null;
  const rest = body.slice(idx + STATE_MARKER.length).trim();
  const start = rest.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    else if (rest[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(rest.slice(start, i + 1)) as TrackASnapshot;
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface PriorState {
  issueId: string;
  previous: TrackASnapshot | null;
  hoursSinceLastReport: number | null;
}

async function loadPriorState(token: string): Promise<PriorState> {
  const data = await linearGraphql<IssueLookup>(
    token,
    `query($key:String!,$num:Float!){
      issues(filter:{team:{key:{eq:$key}},number:{eq:$num}},first:1){
        nodes{ id identifier comments(first:100){ nodes{ body createdAt } } }
      }
    }`,
    { key: LINEAR_TEAM_KEY, num: Number(MONITOR_ISSUE.split('-')[1]) },
  );
  const issue = data.issues.nodes[0];
  if (!issue) throw new Error(`Linear issue ${MONITOR_ISSUE} not found`);

  const marked = issue.comments.nodes
    .filter((c) => c.body.includes(STATE_MARKER))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = marked[0];
  return {
    issueId: issue.id,
    previous: latest ? parseState(latest.body) : null,
    hoursSinceLastReport: latest
      ? (Date.now() - Date.parse(latest.createdAt)) / 3_600_000
      : null,
  };
}

async function postComment(token: string, issueId: string, body: string): Promise<void> {
  await linearGraphql(
    token,
    `mutation($issueId:String!,$body:String!){
      commentCreate(input:{issueId:$issueId,body:$body}){ success }
    }`,
    { issueId, body },
  );
}

function renderComment(s: TrackASnapshot, t: TriggerResult): string {
  const heading = t.isBaseline
    ? 'Track A monitor — baseline snapshot'
    : t.isHeartbeat
      ? 'Track A monitor — 24h heartbeat'
      : 'Track A monitor — trigger fired';
  const state = JSON.stringify(s);
  return [
    `## ${heading}`,
    '',
    `Captured: ${s.capturedAt} (read-only; no production mutation)`,
    '',
    '**Why reported:**',
    ...t.reasons.map((r) => `- ${r}`),
    '',
    '**Snapshot:**',
    `- settled CLV-path (native, threshold metric): **${s.settledClvPathNative}** / ${50} DEVELOPING`,
    `- closing_for_clv: total ${s.closingForClvTotal} · native ${s.closingForClvNative} · backfilled ${s.closingForClvBackfilled}`,
    `- well-formed pending player-props (participant-linked): ${s.wellFormedPendingPlayerProps}`,
    `- well-formed settled player-props: ${s.wellFormedSettledPlayerProps}`,
    `- clvStatus: computed ${s.clvComputed} · missing_event_context ${s.clvMissingEventContext} · missing_closing_line ${s.clvMissingClosingLine}`,
    `- SUPPRESS/orphan picks: ${s.suppressPicks}`,
    `- public Discord: not enabled (monitor does not query or change delivery)`,
    s.errors.length ? `- errors: ${s.errors.join('; ')}` : '- errors: none',
    '',
    `**Recommendation:** ${t.recommendation}`,
    '',
    '> Eligibility note: "well-formed" = player-prop with a participant_id. Strict CLV-eligibility',
    '> additionally requires event-context resolution (tracked under the orphan-generator',
    '> investigation lane). These counts are leading indicators, not CLV-eligible certifications.',
    '',
    '<details><summary>monitor state (machine-readable)</summary>',
    '',
    '```',
    `${STATE_MARKER} ${state}`,
    '```',
    '',
    '</details>',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await collectSnapshot();
  const token = process.env.LINEAR_API_TOKEN ?? '';

  let prior: PriorState = { issueId: '', previous: null, hoursSinceLastReport: null };
  if (token && !args.dryRun) {
    try {
      prior = await loadPriorState(token);
    } catch (err) {
      snapshot.errors.push(`linear state read failed: ${(err as Error).message}`);
    }
  }

  const decision = evaluateTriggers({
    current: snapshot,
    previous: prior.previous,
    hoursSinceLastReport: prior.hoursSinceLastReport,
  });

  console.log('[track-a-monitor] snapshot:', JSON.stringify(snapshot));
  console.log('[track-a-monitor] decision:', JSON.stringify(decision));

  if (args.outputJson) {
    mkdirSync(dirname(args.outputJson), { recursive: true });
    writeFileSync(args.outputJson, JSON.stringify({ snapshot, decision }, null, 2));
    console.log(`[track-a-monitor] wrote ${args.outputJson}`);
  }

  if (decision.shouldReport && token && !args.dryRun && prior.issueId) {
    try {
      await postComment(token, prior.issueId, renderComment(snapshot, decision));
      console.log(`[track-a-monitor] posted comment to ${MONITOR_ISSUE}`);
    } catch (err) {
      console.error(`[track-a-monitor] comment post failed: ${(err as Error).message}`);
    }
  } else {
    console.log(
      `[track-a-monitor] no comment (shouldReport=${decision.shouldReport} dryRun=${args.dryRun} hasToken=${Boolean(token)})`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[track-a-monitor] fatal:', err instanceof Error ? err.message : String(err));
    process.exit(0); // monitor never blocks the workflow
  });
