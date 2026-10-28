import { pickLifecycleTransitions } from '@unit-talk/contracts';

export const PICK_PAGE_SIZES = [5, 25, 50, 100] as const;
export const PICK_STATUS_OPTIONS = Object.keys(pickLifecycleTransitions);
export const DISTRIBUTION_MODE_OPTIONS = ['track-only', 'delivery-eligible', 'ungoverned'] as const;
export type DistributionModeFilter = typeof DISTRIBUTION_MODE_OPTIONS[number] | '';
export interface PicksExplorerQuery { q: string; status: string; distributionMode: DistributionModeFilter; capper: string; sport: string; dateFrom: string; dateTo: string; page: number; limit: number; fixtures: boolean }

export function readPicksExplorerQuery(params: Record<string, string | string[] | undefined> = {}): PicksExplorerQuery {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] : '';
  const requestedPage = Number(one('page'));
  const requestedLimit = Number(one('limit'));
  return {
    q: one('q').trim().slice(0, 200),
    status: PICK_STATUS_OPTIONS.includes(one('status')) ? one('status') : '',
    distributionMode: DISTRIBUTION_MODE_OPTIONS.includes(one('distributionMode') as typeof DISTRIBUTION_MODE_OPTIONS[number])
      ? one('distributionMode') as DistributionModeFilter
      : '',
    capper: one('capper').trim().slice(0, 100),
    sport: one('sport').trim().slice(0, 100),
    dateFrom: one('dateFrom').trim().slice(0, 30),
    dateTo: one('dateTo').trim().slice(0, 30),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1,
    limit: PICK_PAGE_SIZES.some((size) => size === requestedLimit) ? requestedLimit : 25,
    fixtures: one('population') === 'fixtures',
  };
}

export function picksExplorerHref(query: PicksExplorerQuery, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(query.limit) });
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.distributionMode) params.set('distributionMode', query.distributionMode);
  if (query.capper) params.set('capper', query.capper);
  if (query.sport) params.set('sport', query.sport);
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  if (query.fixtures) params.set('population', 'fixtures');
  return `/picks?${params}`;
}

/**
 * The inclusive uuid range covering every id that starts with `query`, or null
 * when `query` is not an id fragment (at least 6 hex digits, dashes ignored).
 * Postgres orders uuids by their bytes, i.e. by these hex digits.
 */
export function pickIdPrefixRange(query: string): { from: string; to: string } | null {
  const hex = query.trim().toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{6,32}$/.test(hex)) return null;
  const format = (digits: string) =>
    `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
  return {
    from: format(hex.padEnd(32, '0')),
    to: format(hex.padEnd(32, 'f')),
  };
}
