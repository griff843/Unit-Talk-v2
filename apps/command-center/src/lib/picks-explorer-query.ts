import { pickLifecycleTransitions } from '@unit-talk/contracts';

export const PICK_PAGE_SIZES = [5, 25, 50, 100] as const;
export const PICK_STATUS_OPTIONS = Object.keys(pickLifecycleTransitions);
export interface PicksExplorerQuery { q: string; status: string; page: number; limit: number; fixtures: boolean }

export function readPicksExplorerQuery(params: Record<string, string | string[] | undefined> = {}): PicksExplorerQuery {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] : '';
  const requestedPage = Number(one('page'));
  const requestedLimit = Number(one('limit'));
  return {
    q: one('q').trim().slice(0, 200),
    status: PICK_STATUS_OPTIONS.includes(one('status')) ? one('status') : '',
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1,
    limit: PICK_PAGE_SIZES.some((size) => size === requestedLimit) ? requestedLimit : 25,
    fixtures: one('population') === 'fixtures',
  };
}

export function picksExplorerHref(query: PicksExplorerQuery, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(query.limit) });
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.fixtures) params.set('population', 'fixtures');
  return `/picks?${params}`;
}
