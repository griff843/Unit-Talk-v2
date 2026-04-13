import { EmptyState } from '@/components/ui';

export default function LineShopperPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Line-Shopper</h1>
      </div>

      <EmptyState
        message="No line comparison data available"
        detail="The Line-Shopper requires an operator-web endpoint that groups provider_offers by event and market, showing odds from multiple bookmakers side-by-side. This endpoint does not exist yet."
        action={{ label: 'Back to Research', href: '/research' }}
      />

      <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Requirements</p>
        <ul className="mt-2 space-y-1 text-xs text-gray-400">
          <li>Data source: <code className="text-gray-300">provider_offers</code> (multi-bookmaker)</li>
          <li>Needed endpoint: <code className="text-gray-300">GET /api/operator/line-comparison</code> grouping offers by event + market across providers</li>
          <li>Current state: <code className="text-gray-300">provider_offers</code> rows exist per-provider but no cross-provider comparison endpoint is available</li>
        </ul>
      </div>
    </div>
  );
}
