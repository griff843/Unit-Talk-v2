'use server';

import { resolveActorOrRefusal } from '@/lib/require-actor';
import { searchPicks } from '@/lib/data/queues';
import { getPickIdentity } from '@/lib/data/pick-identity';

export async function lookupPicks(input: string): Promise<{ ok: true; picks: Array<Record<string, unknown>> } | { ok: false; error: string }> {
  const actor = await resolveActorOrRefusal();
  if (!actor.ok) return { ok: false, error: actor.error };
  const q = input.trim();
  if (q.length < 3 || q.length > 100) return { ok: true, picks: [] };
  try {
    const result = await searchPicks({ q, limit: '10', offset: '0' });
    const picks = await Promise.all(result.picks.map(async ({ id, submitter, sport, matchup, market, selection, line, status }) => {
      if (typeof id !== 'string') throw new Error('Pick identity is unavailable');
      const identity = await getPickIdentity(id);
      if (!identity) throw new Error('Pick settlement history is unavailable');
      return { id, submitter, sport, matchup, market, selection, line, status, settlement_result: identity.settlement?.status === 'settled' ? identity.settlement.result : null };
    }));
    return { ok: true, picks };
  } catch {
    return { ok: false, error: 'Pick lookup unavailable. Try again.' };
  }
}
