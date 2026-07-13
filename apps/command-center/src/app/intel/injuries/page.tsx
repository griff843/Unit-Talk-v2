import {
  Card,
  EmptyState,
  InternalLabelBadge,
  Table,
  TableHead,
  TableBody,
  Th,
} from '@/components/ui';
import type { InjuryReport } from '@/lib/injury-contract';

export const metadata = { title: 'Injury Monitor — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

// TODO(data-contract): no injury data source is connected. See
// src/lib/injury-contract.ts for the required provider decision (PM-gated),
// table shape, and ingestion path. Do not scrape ad hoc.
const reports: InjuryReport[] = [];

export default async function InjuriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-secondary mt-1 text-sm">
          Player availability reports and the markets they affect. Data source not yet connected.
        </p>
      </div>

      <Card title="Data Contract Status">
        <div className="flex items-center gap-2">
          <InternalLabelBadge label="Data Missing" />
          <InternalLabelBadge label="Internal Only" />
        </div>
        <p className="cc-text-secondary mt-3 text-xs font-semibold">
          No injury data source connected. Do not scrape ad hoc.
        </p>
        <p className="cc-text-secondary mt-2 text-xs">
          Connecting a source requires a PM-gated provider decision, an `injury_reports` table
          matching the InjuryReport contract in src/lib/injury-contract.ts, and an ingestion path
          in apps/ingestor. All reports must carry a named, attributable source and a published
          timestamp.
        </p>
      </Card>

      <Card title="Injury Reports">
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <Th>Player</Th>
              <Th>Team</Th>
              <Th>Status</Th>
              <Th>Source</Th>
              <Th>Reported At</Th>
              <Th>Affected Markets</Th>
              <Th>Severity</Th>
              <Th>Notes</Th>
            </TableHead>
            <TableBody>
              {reports.map((r) => (
                <tr key={r.id} />
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4">
          <EmptyState
            message="No injury data connected"
            detail="An injury data contract is required before this monitor can populate. See src/lib/injury-contract.ts."
          />
        </div>
      </Card>
    </div>
  );
}
