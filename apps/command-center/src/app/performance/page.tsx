import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { DegradedState } from '@/components/ui';
import { getOperatorPerformance, type OperatorPerformanceStats } from '@/lib/data/operator-performance';

export const metadata = { title: 'Performance — Unit Talk Command Center' };
export const dynamic = 'force-dynamic';

function units(value: number | null, stats: OperatorPerformanceStats): string {
  if (value !== null) return `${value.toFixed(2)}u`;
  return stats.settled === 0 ? 'No decided picks' : 'Odds or stake unavailable';
}

function Rate({ sample, unavailable }: { sample: number; unavailable?: string }) {
  return <span className="text-xs text-amber-200">{sample === 0 ? unavailable ?? 'No decided sample' : 'Volume gate not configured'} · N={sample}</span>;
}

function PerformanceRecord({ name, stats }: { name: string; stats: OperatorPerformanceStats }) {
  return (
    <article aria-label={name} className="cc-surface min-w-0 p-5">
      <h3 className="text-sm font-semibold">{name}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="cc-text-muted">Picks in record</dt><dd>{stats.total}</dd>
        <dt className="cc-text-muted">Wins / losses / pushes</dt><dd data-testid="performance-record">{stats.wins} / {stats.losses} / {stats.pushes}</dd>
        <dt className="cc-text-muted">Voids / cancelled</dt><dd>{stats.voids} / {stats.cancelled}</dd>
        <dt className="cc-text-muted">Unsettled</dt><dd>{stats.unsettled}</dd>
        <dt className="cc-text-muted">Units staked · decided</dt><dd data-testid="performance-staked">{units(stats.unitsStaked, stats)}</dd>
        <dt className="cc-text-muted">Units returned · decided</dt><dd data-testid="performance-returned">{units(stats.unitsReturned, stats)}</dd>
        <dt className="cc-text-muted">Net units · decided</dt><dd data-testid="performance-net">{units(stats.unitsNet, stats)}</dd>
        <dt className="cc-text-muted">Void / cancellation refunds</dt><dd>{stats.refundUnits === null ? 'Stake unavailable' : `${stats.refundUnits.toFixed(2)}u`}</dd>
        <dt className="cc-text-muted">Hit rate</dt><dd><Rate sample={stats.rateSample} /></dd>
        <dt className="cc-text-muted">Flat-bet ROI</dt><dd><Rate sample={stats.flatBetSample} unavailable="No priced results" /></dd>
        <dt className="cc-text-muted">Stake-weighted ROI</dt><dd><Rate sample={stats.settled - stats.unpriced} unavailable="No priced results" /></dd>
        <dt className="cc-text-muted">Corrections applied</dt><dd>{stats.corrections}</dd>
        <dt className="cc-text-muted">Submissions in window</dt><dd>{stats.submissions}</dd>
      </dl>
      <p className="mt-3 break-words text-xs cc-text-muted">Latest submission: {stats.lastSubmittedAt ?? 'No submissions recorded'}</p>
      {stats.unpriced > 0 && <p className="mt-2 text-xs text-amber-200">{stats.unpriced} decided pick(s) lack usable odds or stake; units cover the priced sample only.</p>}
      {stats.unpricedRefunds > 0 && <p className="mt-2 text-xs text-amber-200">{stats.unpricedRefunds} refund(s) lack a recorded stake.</p>}
    </article>
  );
}

function modeName(mode: string): string {
  if (mode === 'track-only') return 'Track Only · internal evidence';
  if (mode === 'not-recorded') return 'Distribution mode not recorded';
  return mode.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export default async function PerformancePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedWindow = params.window;
  const days = requestedWindow === '7' ? 7 : requestedWindow === '30' ? 30 : requestedWindow === '90' ? 90 : null;
  let data;
  try {
    data = await getOperatorPerformance(days);
  } catch (error) {
    console.error('Operator performance unavailable', error);
    return <DegradedState severity="critical" title="Performance unavailable"
      causes={['The settlement history could not be completely read and reconciled. Refresh to retry; partial totals are not displayed.']}
      action={{ label: 'Inspect settlement records', href: '/settlement' }} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <p className="text-sm cc-text-muted">Operator-governed picks with proof fixtures excluded. Each pick uses its current settlement after corrections. Observed {data.observedAt}.</p>
        <nav aria-label="Performance window" className="flex flex-wrap gap-2">
          {[null, 7, 30, 90].map((window) => <Link key={window ?? 'all'} href={window === null ? '/performance' : `/performance?window=${window}`}
            aria-current={days === window ? 'page' : undefined}
            className={`rounded border px-3 py-2 text-sm ${days === window ? 'border-blue-400 bg-blue-900/30' : 'border-gray-700'}`}>
            {window === null ? 'All time' : `${window} days`}
          </Link>)}
        </nav>
        <p className="text-xs cc-text-muted">{days === null ? 'All recorded operator history.' : `Results use effective settlement time; unsettled picks use submission time within the last ${days} days.`} Units for decided picks use recorded odds and stakes. Void and cancellation refunds are separate.</p>
        <div role="status" className="rounded border border-amber-700/50 bg-amber-900/10 p-3 text-sm text-amber-100">
          Performance-rate volume thresholds are not configured. Records and units are available; rates remain unrated with their sample sizes until that policy is defined.
        </div>
      </div>
      <Card title="Unit Talk aggregate">
        <PerformanceRecord name="All governed picks" stats={data.aggregate} />
        <p className="mt-3 text-xs cc-text-muted">Includes every capper and any pick with no assigned capper. Track Only results are included as internal evidence and separated below by distribution mode.</p>
      </Card>
      <Card title="Record by capper">
        {data.cappers.length === 0 ? <p className="text-sm cc-text-muted">No operator picks are recorded in this window.</p> :
          <div className="grid gap-4 lg:grid-cols-2">{data.cappers.map((capper) => <div key={capper.id}>
            <PerformanceRecord name={capper.name} stats={capper.stats} />
            <p className="mt-2 text-xs cc-text-muted">{capper.modes.map((mode) => `${modeName(mode.mode)}: ${mode.count}`).join(' · ')}</p>
          </div>)}</div>}
      </Card>
      <Card title="Distribution-mode record">
        <div className="grid gap-4 lg:grid-cols-2">{data.modes.map((mode) => <PerformanceRecord key={mode.id} name={modeName(mode.id)} stats={mode.stats} />)}</div>
        {data.modes.length === 0 && <p className="text-sm cc-text-muted">No distribution-mode records in this window.</p>}
      </Card>
      <p className="text-sm cc-text-muted">Closing-line value awaits a verified closing-line feed. <Link href="/settlement" className="text-blue-300 underline">Inspect settlement and correction history</Link>.</p>
    </div>
  );
}
