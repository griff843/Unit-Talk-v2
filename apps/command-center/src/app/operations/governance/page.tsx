import { InternalLabelBadge, Table, TableHead, Th, TableBody, EmptyState } from '@/components/ui';
import { LANE_BOARD_COLUMNS } from '@/lib/governance-contract';

// Governance / lane board — UI SHELL.
// Lane manifests live in repo files (docs/06_status/lanes/*.json) and lane
// workflow state lives in Linear; neither is reachable from this app's
// Supabase-only data layer. Display-only: this page must never re-encode
// governance rules as logic.
// TODO(data-contract): needs an API surface exposing lane manifests + Linear state.

export const dynamic = 'force-dynamic';

export default function GovernancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-100">Governance / Lane Board</h1>
          <InternalLabelBadge label="Data Missing" />
        </div>
        <p className="text-sm cc-text-muted">
          Active lane state, truth-check results, and PM verdicts. Display-only — GitHub main, proof bundles,
          and lane manifests remain the execution-truth authority.
        </p>
      </div>

      <div className="cc-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">What will appear here</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm cc-text-muted">
          <li>One row per active lane: issue ID, tier (T1/T2/T3), lane state, branch, and PR link.</li>
          <li>Merge SHA and whether the proof bundle is bound to it.</li>
          <li><code>ops:truth-check</code> result (pass / fail / not run) — the done-gate, never narrative.</li>
          <li>PM verdict state for T1 lanes (t1-approved label), blocker reason, and next action.</li>
        </ul>
        <p className="mt-3 text-xs cc-text-muted">
          Sources: <span className="font-mono">docs/06_status/lanes/*.json</span> (lane manifests) + Linear (tier label,
          workflow state). Neither is reachable from the Command Center data layer today.
        </p>
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
            <TableBody>{null}</TableBody>
          </Table>
        </div>
        <EmptyState
          message="No lane data source is wired to this app yet."
          detail="Requires an API surface exposing lane manifests + Linear state (see src/lib/governance-contract.ts)."
        />
      </div>
    </div>
  );
}
