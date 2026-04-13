import { EmptyState } from '@/components/ui';

export default function PropExplorerPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Props Explorer</h1>
      </div>

      <EmptyState
        message="No props data available"
        detail="The Props Explorer requires an operator-web endpoint that serves individual provider_offers rows with prop details (market, selection, odds, line). This endpoint does not exist yet. The provider_offers table is populated by the ingestor, but no read surface exposes individual rows."
        action={{ label: 'Back to Research', href: '/research' }}
      />

      <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Requirements</p>
        <ul className="mt-2 space-y-1 text-xs text-gray-400">
          <li>Data source: <code className="text-gray-300">provider_offers</code></li>
          <li>Needed endpoint: <code className="text-gray-300">GET /api/operator/offers</code> with search, sport, market, and provider filters</li>
          <li>Current state: <code className="text-gray-300">provider_offers</code> table exists and is populated by ingestor runs</li>
        </ul>
      </div>
    </div>
  );
}
