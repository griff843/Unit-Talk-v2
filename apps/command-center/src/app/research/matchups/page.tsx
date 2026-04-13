import { EmptyState } from '@/components/ui';

export default function MatchupCardPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Matchup Card</h1>
      </div>

      <EmptyState
        message="No matchup data available"
        detail="The Matchup Card requires an operator-web endpoint that serves events with participant context (teams, start times, sport). No events or matchup endpoint exists in operator-web yet."
        action={{ label: 'Back to Research', href: '/research' }}
      />

      <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Requirements</p>
        <ul className="mt-2 space-y-1 text-xs text-gray-400">
          <li>Data source: <code className="text-gray-300">events</code>, <code className="text-gray-300">event_participants</code>, <code className="text-gray-300">teams</code></li>
          <li>Needed endpoint: <code className="text-gray-300">GET /api/operator/events</code> with sport, date, and team filters</li>
          <li>Current state: The <code className="text-gray-300">events</code> table exists but no operator-web route exposes it</li>
        </ul>
      </div>
    </div>
  );
}
