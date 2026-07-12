import {
  Card,
  EmptyState,
  InternalLabelBadge,
  Table,
  TableHead,
  TableBody,
  Th,
  UncertifiedBanner,
} from '@/components/ui';
import type { BoostEntry } from '@/lib/boost-contract';

export const metadata = { title: 'Boost Analyzer — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

// TODO(data-contract): no boost/promo data source exists. See
// src/lib/boost-contract.ts for the required table + ingestion contract.
// This page is a column-complete shell so the analyzer can light up the
// moment a `book_boosts` data module lands in src/lib/data/.
const boosts: BoostEntry[] = [];

export default async function BoostsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-secondary mt-1 text-sm">
          Sportsbook boost/promo evaluation against internal fair pricing. Data source not yet
          connected.
        </p>
      </div>

      <UncertifiedBanner what="Boost EV estimates (consensus de-vig)" />

      <Card title="Data Contract Status">
        <div className="flex items-center gap-2">
          <InternalLabelBadge label="Data Missing" />
          <InternalLabelBadge label="Internal Only" />
        </div>
        <p className="cc-text-secondary mt-3 text-xs">
          No boost/promo data exists in Supabase. Required before this page populates: a
          `book_boosts` table matching the BoostEntry contract in src/lib/boost-contract.ts, an
          ingestion path (manual operator entry or provider feed), and a data module under
          src/lib/data/. Fair odds and EV columns will compute from provider_offer_current
          consensus de-vig once original/boosted prices are recorded.
        </p>
      </Card>

      <Card title="Boosts">
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <Th>Book</Th>
              <Th>Boost Name</Th>
              <Th>Original Odds</Th>
              <Th>Boosted Odds</Th>
              <Th>Implied Prob</Th>
              <Th>Fair Odds</Th>
              <Th>Est. EV</Th>
              <Th>Max Stake</Th>
              <Th>Expiry</Th>
              <Th>Terms</Th>
              <Th>Recommendation</Th>
            </TableHead>
            <TableBody>
              {boosts.map((b) => (
                <tr key={b.id} />
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4">
          <EmptyState
            message="No boost data connected"
            detail="A boost/promo data contract is required before this analyzer can populate. See src/lib/boost-contract.ts."
          />
        </div>
      </Card>
    </div>
  );
}
