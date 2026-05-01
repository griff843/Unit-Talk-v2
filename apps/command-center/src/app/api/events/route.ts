import { NextResponse } from 'next/server';
import { getEventStream } from '@/lib/data/events';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? '250');
  const limit = Number.isFinite(rawLimit) ? rawLimit : 250;

  const payload = await getEventStream(limit);
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
