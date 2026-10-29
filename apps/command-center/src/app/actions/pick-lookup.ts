'use server';

import { resolveActorOrRefusal } from '@/lib/require-actor';
import { searchPicks } from '@/lib/data/queues';

export async function lookupPicks(input: string): Promise<{ ok: true; picks: Array<Record<string, unknown>> } | { ok: false; error: string }> {
  const actor = await resolveActorOrRefusal();
  if (!actor.ok) return { ok: false, error: actor.error };
  const q = input.trim();
  if (q.length < 3 || q.length > 100) return { ok: true, picks: [] };
  try {
    const result = await searchPicks({ q, limit: '10', offset: '0' });
    return { ok: true, picks: result.picks.map(({ id, submitter, sport, matchup, market, selection, line, status, settlement_result }) => ({ id, submitter, sport, matchup, market, selection, line, status, settlement_result })) };
  } catch {
    return { ok: false, error: 'Pick lookup unavailable. Try again.' };
  }
}
