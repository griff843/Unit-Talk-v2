import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, LineShopperFilter } from '../server.js';
import { writeJson } from '../http-utils.js';

export interface LineShopperBook {
  bookmakerKey: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;
}

export interface LineShopperResponse {
  participant: string;
  market: string;
  books: LineShopperBook[];
  bestOver: string | null;
  bestUnder: string | null;
  observedAt: string;
}

export function computeBestOver(books: LineShopperBook[]): string | null {
  let best: LineShopperBook | null = null;
  for (const book of books) {
    if (book.overOdds === null) continue;
    if (best === null || book.overOdds > (best.overOdds ?? -Infinity)) {
      best = book;
    }
  }
  return best?.bookmakerKey ?? null;
}

export function computeBestUnder(books: LineShopperBook[]): string | null {
  let best: LineShopperBook | null = null;
  for (const book of books) {
    if (book.underOdds === null) continue;
    if (best === null || book.underOdds > (best.underOdds ?? -Infinity)) {
      best = book;
    }
  }
  return best?.bookmakerKey ?? null;
}

export async function handleLineShopperRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  const participant = url.searchParams.get('participant') ?? '';
  const market = url.searchParams.get('market') ?? '';

  if (!participant || !market) {
    writeJson(response, 400, {
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'participant and market are required' },
    });
    return;
  }

  const rawEventId = url.searchParams.get('eventId');
  const rawSport = url.searchParams.get('sport');
  const filter: LineShopperFilter = {
    participant,
    market,
    ...(rawEventId !== null ? { eventId: rawEventId } : {}),
    ...(rawSport !== null ? { sport: rawSport } : {}),
  };

  const raw = await deps.provider.getLineShopperBooks?.(filter) ?? [];

  // Sort Pinnacle first, then alphabetical
  const books = [...raw].sort((a, b) => {
    if (a.bookmakerKey === 'pinnacle') return -1;
    if (b.bookmakerKey === 'pinnacle') return 1;
    return a.bookmakerKey.localeCompare(b.bookmakerKey);
  });

  const result: LineShopperResponse = {
    participant,
    market,
    books,
    bestOver: computeBestOver(books),
    bestUnder: computeBestUnder(books),
    observedAt: new Date().toISOString(),
  };

  writeJson(response, 200, result);
}
