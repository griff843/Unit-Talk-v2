import Link from 'next/link';

interface ResearchModule {
  name: string;
  href: string;
  description: string;
  status: 'live' | 'no-data' | 'deferred';
  statusDetail: string;
}

const modules: ResearchModule[] = [
  {
    name: 'Props Explorer',
    href: '/research/props',
    description: 'Browse individual prop offers from ingested provider data.',
    status: 'live',
    statusDetail: 'Wired to /api/operator/prop-offers (provider_offer_current table).',
  },
  {
    name: 'Line-Shopper',
    href: '/research/lines',
    description: 'Compare lines across multiple bookmakers for the same market.',
    status: 'live',
    statusDetail: 'Wired to /api/operator/line-shopper (provider_offer_current multi-book).',
  },
  {
    name: 'Player Card',
    href: '/research/players',
    description: 'Lookup players and team assignments from the participants index.',
    status: 'live',
    statusDetail: 'Wired to /api/operator/participants.',
  },
  {
    name: 'Matchup Card',
    href: '/research/matchups',
    description: 'View event and participant context for upcoming matchups.',
    status: 'live',
    statusDetail: 'Wired to /api/operator/events.',
  },
  {
    name: 'Hit Rate',
    href: '/research/hit-rate',
    description: 'Settlement hit rates by time window, source, and sport.',
    status: 'live',
    statusDetail: 'Wired to /api/operator/performance.',
  },
  {
    name: 'Trend Filters',
    href: '/research/trends',
    description: 'Historical trend and split filters over player box scores.',
    status: 'deferred',
    statusDetail: 'Requires player_game_stats ingest pipeline (not in current milestone).',
  },
];

const statusColors: Record<ResearchModule['status'], string> = {
  live: 'bg-emerald-900/50 text-emerald-400 border-emerald-700',
  'no-data': 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
  deferred: 'bg-gray-800 text-gray-400 border-gray-700',
};

const statusLabels: Record<ResearchModule['status'], string> = {
  live: 'Live',
  'no-data': 'No Backend',
  deferred: 'Deferred',
};

export default function ResearchPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Research Workspace</h1>
        <p className="mt-2 text-sm text-gray-400">
          Market data exploration modules. Select a module below to begin.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod) => (
          <Link
            key={mod.href}
            href={mod.href}
            className="group flex flex-col gap-3 rounded border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:border-gray-700 hover:bg-gray-800/50"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-200 group-hover:text-white">
                {mod.name}
              </h2>
              <span
                className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${statusColors[mod.status]}`}
              >
                {statusLabels[mod.status]}
              </span>
            </div>
            <p className="text-xs text-gray-400">{mod.description}</p>
            <p className="text-[10px] text-gray-600">{mod.statusDetail}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
