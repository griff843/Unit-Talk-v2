import { Card, EmptyState } from '@/components/ui';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface Participant {
  id: string;
  name: string;
  type: 'player' | 'team';
  sport: string | null;
  team: string | null;
  externalId: string | null;
}

interface ParticipantsResponse {
  participants: Participant[];
  total: number;
  observedAt: string;
}

async function fetchParticipants(
  type: string,
  sport?: string,
  q?: string,
): Promise<ParticipantsResponse | null> {
  try {
    const params = new URLSearchParams({ type, limit: '50' });
    if (sport) params.set('sport', sport);
    if (q) params.set('q', q);
    const res = await fetch(
      `${OPERATOR_WEB_BASE}/api/operator/participants?${params.toString()}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as ParticipantsResponse;
    return json;
  } catch {
    return null;
  }
}

export default async function PlayerCardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const tab = searchParams['tab'] === 'team' ? 'team' : 'player';
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;
  const q = typeof searchParams['q'] === 'string' ? searchParams['q'] : undefined;

  const data = await fetchParticipants(tab, sport, q);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Player Card</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse players and teams from the participants index.
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-2">
        {(['player', 'team'] as const).map((t) => (
          <Link
            key={t}
            href={`/research/players?tab=${t}${sport ? `&sport=${encodeURIComponent(sport)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              t === tab
                ? 'bg-blue-600 text-white'
                : 'border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            {t === 'player' ? 'Players' : 'Teams'}
          </Link>
        ))}
      </div>

      {/* Search / filter hint */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>Filters:</span>
        <code className="text-gray-400">?q=name</code>
        <code className="text-gray-400">?sport=nba</code>
        {q && (
          <span className="rounded bg-blue-900/30 border border-blue-700/30 px-2 py-0.5 text-blue-300">
            q={q}
          </span>
        )}
        {sport && (
          <span className="rounded bg-blue-900/30 border border-blue-700/30 px-2 py-0.5 text-blue-300">
            sport={sport}
          </span>
        )}
        {(q || sport) && (
          <Link
            href={`/research/players?tab=${tab}`}
            className="text-gray-400 hover:text-gray-200 underline"
          >
            clear
          </Link>
        )}
      </div>

      {!data ? (
        <EmptyState
          message="Unable to load participants data."
          detail="Check that operator-web is reachable and the /api/operator/participants endpoint is responding."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : data.participants.length === 0 ? (
        <EmptyState
          message={`No ${tab}s found`}
          detail={
            q || sport
              ? `No results match the current filters. Try broadening your search.`
              : `The participants index has no ${tab} records yet. Data is populated by the ingestor from provider feeds.`
          }
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : (
        <Card title={`${tab === 'player' ? 'Players' : 'Teams'} (${data.total} total)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Sport</th>
                  {tab === 'player' && <th className="py-2 pr-3">Team</th>}
                  <th className="py-2 pr-3">External ID</th>
                  <th className="py-2">ID</th>
                </tr>
              </thead>
              <tbody>
                {data.participants.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200">{p.name}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{p.sport ?? '—'}</td>
                    {tab === 'player' && (
                      <td className="py-2 pr-3 text-xs text-gray-300">{p.team ?? '—'}</td>
                    )}
                    <td className="py-2 pr-3 text-xs text-gray-400 font-mono">
                      {p.externalId ?? '—'}
                    </td>
                    <td className="py-2 text-xs text-gray-500 font-mono">{p.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[10px] text-gray-600">
            Observed at {new Date(data.observedAt).toLocaleTimeString()}
          </p>
        </Card>
      )}
    </div>
  );
}
