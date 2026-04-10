'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';
import type { WriteBoardPicksResult } from '@/lib/types';

/**
 * Governed operator action: trigger the board-pick-writer.
 *
 * Calls POST /api/board/write-picks — the only authorized path to convert
 * system-board candidates into canonical picks. Requires operator role.
 *
 * Idempotent: candidates already linked to a pick are skipped.
 */
export async function writeSystemPicks(): Promise<WriteBoardPicksResult> {
  const apiUrl = resolveApiBaseUrl();
  const headers = resolveCommandCenterApiHeaders();

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/board/write-picks`, {
      method: 'POST',
      headers,
    });
  } catch (err) {
    return {
      ok: false,
      boardRunId: '',
      boardSize: 0,
      written: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
      pickIds: [],
      error: err instanceof Error ? err.message : 'Network error',
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return {
      ok: false,
      boardRunId: '',
      boardSize: 0,
      written: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
      pickIds: [],
      error: body.error?.message ?? `API error ${res.status}`,
    };
  }

  const body = await res.json() as {
    ok: boolean;
    boardRunId: string;
    boardSize: number;
    written: number;
    skipped: number;
    errors: number;
    durationMs: number;
    pickIds: string[];
  };

  revalidatePath('/decision/board-queue');
  revalidatePath('/picks-list');

  return {
    ok: true,
    boardRunId: body.boardRunId ?? '',
    boardSize: body.boardSize ?? 0,
    written: body.written ?? 0,
    skipped: body.skipped ?? 0,
    errors: body.errors ?? 0,
    durationMs: body.durationMs ?? 0,
    pickIds: body.pickIds ?? [],
  };
}
