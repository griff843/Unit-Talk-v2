import { InternalLabelBadge, Table, TableHead, Th, TableBody, EmptyState } from '@/components/ui';
import { getGovernanceBoardSnapshot } from '@/app/api/governance/lanes/route';
import { LANE_BOARD_COLUMNS, type LaneSummary } from '@/lib/governance-contract';

export const metadata = { title: 'Governance / Lanes — Unit Talk Command Center' };

// Display-only: the server-side API reads lane manifests but never changes them.

export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  const snapshot = await getGovernanceBoardSnapshot();
  const lanes = uniqueLanes(snapshot.activeLanes, snapshot.blockedLanes, snapshot.awaitingPmVerdict);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <InternalLabelBadge label={snapshot.sourceStatus === 'available' ? 'Healthy' : 'Data Missing'} />
        </div>
        <p className="text-sm cc-text-muted">
          Lane-manifest state, truth-check results, and recorded PM verdicts. Display-only — GitHub main, proof bundles,
          and lane manifests remain the execution-truth authority.
        </p>
      </div>

      <div className="cc-surface p-5 text-sm cc-text-muted">
        <p>Source: <span className="font-mono">docs/06_status/lanes/*.json</span>. Linear-only fields are not inferred.</p>
        {snapshot.missingSources.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5">{snapshot.missingSources.map((source) => <li key={source}>{source}</li>)}</ul> : null}
      </div>

      <div className="cc-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">Lane Board</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              {LANE_BOARD_COLUMNS.map((column) => (
                <Th key={column}>{column}</Th>
              ))}
            </TableHead>
            <TableBody>{lanes.map((lane) => <LaneRow key={lane.issueId} lane={lane} />)}</TableBody>
          </Table>
        </div>
        {lanes.length === 0 ? <EmptyState message="No readable lane manifests were found." detail={snapshot.sourceStatus === 'unavailable' ? 'Lane data is unavailable; this page is not showing a stale snapshot.' : 'No active, blocked, or PM-pending lanes are currently recorded.'} /> : null}
      </div>
    </div>
  );
}

function uniqueLanes(...groups: LaneSummary[][]): LaneSummary[] {
  return Array.from(new Map(groups.flat().map((lane) => [lane.issueId, lane])).values());
}

function LaneRow({ lane }: { lane: LaneSummary }) {
  return <tr><td>{lane.issueId}</td><td>{lane.tier ?? 'Unavailable'}</td><td>{lane.laneState}</td><td>{lane.prUrl ? <a href={lane.prUrl}>PR</a> : 'Unavailable'}</td><td>{lane.mergeSha ?? 'Unavailable'}</td><td>{lane.truthCheck}</td><td>{lane.pmVerdict}</td><td>{lane.blockerReason ?? '—'}</td><td>{lane.nextAction ?? 'Unavailable'}</td><td>{lane.updatedAt ?? 'Unavailable'}</td></tr>;
}
