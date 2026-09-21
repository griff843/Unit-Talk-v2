'use client';

import Link from '@/components/OperatorLink';

import { buildScoreInsight, scoreToneClasses } from '@/lib/score-insight';

interface PicksExplorerClientProps {
  picks: Array<Record<string, unknown>>;
  /** Exact matching operator count after all database predicates. */
  sourceTotal: number;
  offset?: number;
  /** Retained for call-site compatibility; the shell TopBar owns the timestamp. */
  observedAt?: string;
}

const STATUS_TONES: Record<string, string> = {
  posted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  settled: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  queued: 'border-blue-400/40 bg-blue-500/10 text-blue-300',
  validated: 'border-gray-600 bg-white/[0.04] text-gray-300',
  awaiting_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  voided: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? 'border-gray-600 bg-white/[0.04] text-gray-400';
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Promotion score is nullable by design: a pick that was never scored has no score,
 * and that is different from a score of zero. Render the distinction rather than
 * collapsing both to a dash.
 */
function ScoreCell({ score, status }: { score: number | null; status: string | null }) {
  if (score != null) {
    return <span className="font-mono text-xs text-gray-200">{score.toFixed(1)}</span>;
  }

  return (
    <span className="text-[11px] text-gray-600">
      {status === 'not_eligible' || status === 'suppressed' ? 'not scored' : 'unscored'}
    </span>
  );
}

/**
 * Routing target plus the promotion status that explains it. Neither alone is legible.
 *
 * Suppression must be explicit: a `suppressed` pick with no reason recorded is
 * rendered as a missing reason, never as a blank cell. `not_eligible` is a
 * different state — it means the pick never qualified — and is deliberately not
 * folded in with it.
 */
function RoutingCell({
  target,
  status,
  reason,
}: {
  target: string | null;
  status: string | null;
  reason: string | null;
}) {
  if (!target && !status) return <span className="text-gray-600">—</span>;

  return (
    <div className="leading-tight">
      <div className="font-mono text-xs text-gray-200">{target ?? 'unrouted'}</div>
      {status ? (
        <div className="text-[10px] uppercase tracking-[0.08em] text-gray-500">
          {status.replaceAll('_', ' ')}
        </div>
      ) : null}
      {status === 'suppressed' ? (
        reason ? (
          <div className="mt-0.5 max-w-[22ch] text-[10px] text-amber-300/90" title={reason}>
            {reason}
          </div>
        ) : (
          <div className="mt-0.5 text-[10px] font-semibold text-rose-400">no reason recorded</div>
        )
      ) : null}
    </div>
  );
}

export function PicksExplorerClient({ picks, sourceTotal, offset = 0 }: PicksExplorerClientProps) {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="text-sm text-gray-400">
        {picks.length ? `Showing ${offset + 1}–${offset + picks.length} of ${sourceTotal} matching governed picks` : `No picks on this page · ${sourceTotal} matching governed picks`}
      </p>
      <p className="text-xs text-gray-400 sm:hidden">Scroll the table horizontally for routing, odds, results and dates.</p>
      <div className="cc-surface overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-[11px] uppercase tracking-[0.16em] text-gray-500">
              <th className="px-4 py-2.5">Pick</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Score</th>
              <th className="px-4 py-2.5">Routing</th>
              <th className="px-4 py-2.5">Edge source</th>
              <th className="px-4 py-2.5">Sport</th>
              <th className="px-4 py-2.5">Market</th>
              <th className="px-4 py-2.5 text-right">Odds</th>
              <th className="px-4 py-2.5 text-right">Line</th>
              <th className="px-4 py-2.5">Result</th>
              <th className="px-4 py-2.5">Created</th>
            </tr>
          </thead>
          <tbody>
            {picks.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-xs text-gray-500">
                  No picks match this filter.
                </td>
              </tr>
            )}
            {picks.map((pick, i) => {
              const id = str(pick['id']) ?? String(i);
              const matchup = str(pick['matchup']);
              const result = str(pick['settlement_result']);
              const promotionStatus = str(pick['promotion_status']);
              const insight = buildScoreInsight(obj(pick['metadata']));
              return (
                <tr key={id} className="border-b border-gray-800/60 text-gray-300 transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-2">
                    <Link href={`/picks/${id}`} className="font-medium text-gray-100 hover:text-blue-300 hover:underline">
                      {str(pick['selection']) ?? 'Unknown pick'}
                    </Link>
                    <div className="text-[11px] text-gray-500">
                      {matchup ?? '—'} · <span className="font-mono">{id.slice(0, 8)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={str(pick['status']) ?? 'unknown'} /></td>
                  <td className="px-4 py-2 text-right">
                    <ScoreCell score={num(pick['promotion_score'])} status={promotionStatus} />
                  </td>
                  <td className="px-4 py-2">
                    <RoutingCell
                      target={str(pick['promotion_target'])}
                      status={promotionStatus}
                      reason={str(pick['promotion_reason'])}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreToneClasses(insight.reliabilityTone)}`}
                      title={insight.edgeSource ? `realEdgeSource: ${insight.edgeSource}` : 'no edge source recorded on this pick'}
                    >
                      {insight.edgeSourceLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs">{str(pick['sport']) ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{str(pick['market']) ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{formatOdds(num(pick['odds']))}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{num(pick['line']) ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">
                    {result ? <StatusBadge status={result} /> : <span className="text-gray-600">pending</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {pick['created_at'] ? new Date(String(pick['created_at'])).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
