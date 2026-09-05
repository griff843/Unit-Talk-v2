import { NextResponse } from 'next/server';
import { getEventStream } from '@/lib/data/events';
import { authenticateHeaderBag } from '@/lib/request-auth';

export function createEventsHandler(readEvents = getEventStream) {
  return async function events(request: Request) {
    const auth = authenticateHeaderBag(request.headers);
    if (!auth.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: auth.status === 503 ? 'Command Center is unavailable.' : 'Authentication required.',
        },
        { status: auth.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? '250');
    const limit = Number.isFinite(rawLimit) ? rawLimit : 250;

    const payload = await readEvents(limit);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  };
}

export const GET = createEventsHandler();
