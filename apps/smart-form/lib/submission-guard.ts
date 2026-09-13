/** Local UI safeguard only; server idempotency remains authoritative. */
export interface PickIdentity {
  capper: string;
  gameDate: string;
  sport: string;
  event: string;
  market: string;
  player?: string | null;
  stat?: string | null;
  team?: string | null;
  direction?: string | null;
  line?: number | null;
  odds: number;
  sportsbook?: string | null;
}
const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
export function buildSessionPickKey(pick: PickIdentity): string {
  // Price/book identify separate recorded bets; changing only stake or conviction does not.
  return JSON.stringify([
    'v1', normalize(pick.capper), normalize(pick.gameDate), normalize(pick.sport),
    normalize(pick.event), normalize(pick.market), normalize(pick.player), normalize(pick.stat),
    normalize(pick.team), normalize(pick.direction), pick.line ?? null, pick.odds,
    normalize(pick.sportsbook),
  ]);
}
export interface SessionPickStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const SESSION_PICK_STORAGE_KEY = 'ut_smart_form_saved_picks_v1';
export function createSessionSubmissionGuard(getStorage: () => SessionPickStorage | null = () => null) {
  const saved = new Set<string>();
  let active: string | null = null;
  function readSaved() {
    try {
      const raw = getStorage()?.getItem(SESSION_PICK_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((key): key is string => typeof key === 'string')) {
        for (const key of parsed) saved.add(key);
      }
    } catch { /* Storage can be unavailable; the live in-memory guard still holds. */ }
  }
  return {
    acquire(key: string): 'acquired' | 'in-flight' | 'already-saved' {
      if (active !== null) return 'in-flight';
      readSaved();
      if (saved.has(key)) return 'already-saved';
      active = key;
      return 'acquired';
    },
    markSaved(key: string): void {
      if (active !== key) return;
      saved.add(key);
      try {
        getStorage()?.setItem(SESSION_PICK_STORAGE_KEY, JSON.stringify([...saved]));
      } catch { /* Do not turn a successfully persisted pick into a submission failure. */ }
    },
    release(key: string): void {
      if (active === key) active = null;
    },
  };
}
