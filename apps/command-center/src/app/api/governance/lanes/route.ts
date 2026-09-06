import { NextResponse } from 'next/server';
import { getGovernanceBoardSnapshot } from '@/lib/governance-board';
import { authenticateHeaderBag } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

export function createGovernanceLanesHandler(readSnapshot = getGovernanceBoardSnapshot) {
  return async function governanceLanes(request: Request) {
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

    return NextResponse.json(await readSnapshot(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  };
}

export const GET = createGovernanceLanesHandler();
