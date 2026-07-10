import Link from 'next/link';
import { Card, EmptyState, InternalLabelBadge, Table, TableHead, TableBody, Th, Td } from '@/components/ui';
import { DiscordEmbedPreview } from '@/components/DiscordEmbedPreview';
import { getExecutionPick, listPreviewablePicks } from '@/lib/data/execution';

export const dynamic = 'force-dynamic';

export default async function DiscordPreviewPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const pickId = typeof searchParams['pickId'] === 'string' ? searchParams['pickId'] : null;
  const observedAt = new Date().toISOString();

  let picks: Awaited<ReturnType<typeof listPreviewablePicks>> = [];
  let selected: Awaited<ReturnType<typeof getExecutionPick>> = null;
  let loadError: string | null = null;

  try {
    [picks, selected] = await Promise.all([
      listPreviewablePicks(25),
      pickId ? getExecutionPick(pickId) : Promise.resolve(null),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load picks';
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">Discord Preview</h1>
        <p className="text-sm cc-text-secondary">
          Exactly how a pick renders in Discord before dispatch. Pre-dispatch verification only.
        </p>
        <p className="text-xs cc-text-muted">Observed {observedAt}</p>
      </div>

      {loadError ? (
        <Card title="Load error">
          <p className="text-sm text-red-400">{loadError}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Recent Queued / Posted Picks
            </h2>
            {picks.length === 0 ? (
              <EmptyState message="No queued or posted picks" detail="Nothing in the dispatchable window right now." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Pick</Th>
                      <Th>Status</Th>
                      <Th>Market / Selection</Th>
                      <Th>Created</Th>
                      <Th>Preview</Th>
                  </TableHead>
                  <TableBody>
                    {picks.map((p) => (
                      <tr key={p.id} className={p.id === pickId ? 'bg-white/[0.04]' : ''}>
                        <Td>
                          <span className="font-mono text-xs">{p.id.slice(0, 8)}…</span>
                          <div className="text-xs cc-text-muted">{p.eventName ?? '—'}</div>
                        </Td>
                        <Td>
                          <InternalLabelBadge label={p.status === 'posted' ? 'Sent' : p.status === 'awaiting_approval' ? 'Approval Required' : 'Pending'} />
                        </Td>
                        <Td>
                          {p.market} · {p.selection}
                          {p.line !== null ? ` ${p.line}` : ''}
                        </Td>
                        <Td>
                          <span className="text-xs cc-text-muted">{p.createdAt}</span>
                        </Td>
                        <Td>
                          <Link className="text-sky-400 hover:underline" href={`/execution/discord-preview?pickId=${p.id}`}>
                            Preview
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Embed Preview
            </h2>
            {!pickId ? (
              <EmptyState message="Select a pick" detail="Choose a pick from the list to render its Discord embed." />
            ) : !selected ? (
              <EmptyState message="Pick not found" detail={`No pick with id ${pickId}.`} />
            ) : (
              <>
                <DiscordEmbedPreview
                  source={{
                    market: selected.market,
                    selection: selected.selection,
                    line: selected.line,
                    odds: selected.odds,
                    eventName: selected.eventName,
                    eventStartTime: selected.eventStartTime,
                    sport: selected.sportDisplayName,
                    metadata: selected.metadata,
                  }}
                />
                <p className="mt-3 text-xs cc-text-muted">
                  Pick <Link className="text-sky-400 hover:underline" href={`/picks/${selected.id}`}>{selected.id}</Link>
                  {' · '}status {selected.status} · created {selected.createdAt}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
