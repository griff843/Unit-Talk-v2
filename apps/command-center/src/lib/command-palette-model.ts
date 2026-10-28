/**
 * Pure model for the command-K jump palette. No I/O, no React — the shell
 * feeds it the nav registry and a query; it returns ranked matches.
 */

export interface CommandEntry {
  href: string;
  label: string;
  group: string;
  keywords?: string[];
  detail?: string;
}

export interface RankedCommand extends CommandEntry {
  score: number;
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

/**
 * A "find pick" jump for an id fragment (6+ hex digits, dashes allowed), so an
 * operator can paste part of a pick id anywhere. Null for any other query.
 */
export function pickSearchEntry(query: string): CommandEntry | null {
  const fragment = query.trim().toLowerCase();
  if (!pickIdPrefixRange(fragment)) return null;
  return {
    href: `/picks?${new URLSearchParams({ q: fragment })}`,
    label: `Find pick ${fragment}`,
    group: 'Picks',
  };
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Score a candidate string against a query.
 * Exact match > prefix > word-start > substring > in-order subsequence.
 * Returns 0 when the query does not match at all.
 */
export function scoreMatch(candidate: string, query: string): number {
  const c = normalize(candidate);
  const q = normalize(query);
  if (q.length === 0) return 1;
  if (c === q) return 100;
  if (c.startsWith(q)) return 80;
  const wordStart = c.split(/[\s/-]+/).some((word) => word.startsWith(q));
  if (wordStart) return 60;
  if (c.includes(q)) return 40;
  // in-order subsequence, e.g. "lnmv" -> "line movement"
  let i = 0;
  for (const ch of c) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return 15;
  }
  return 0;
}

export function scoreEntry(entry: CommandEntry, query: string): number {
  const labelScore = scoreMatch(entry.label, query);
  const groupScore = scoreMatch(entry.group, query) * 0.3;
  const keywordScore = Math.max(
    0,
    ...(entry.keywords ?? []).map((keyword) => scoreMatch(keyword, query) * 0.6),
  );
  const hrefScore = scoreMatch(entry.href.replace(/\//g, ' '), query) * 0.4;
  return Math.max(labelScore, groupScore, keywordScore, hrefScore);
}

/**
 * Rank entries for a query. Empty query returns all entries in registry
 * order (browse mode). Non-matching entries are dropped.
 */
export function filterCommands(entries: CommandEntry[], query: string): RankedCommand[] {
  const q = normalize(query);
  if (q.length === 0) {
    return entries.map((entry) => ({ ...entry, score: 1 }));
  }
  return entries
    .map((entry) => ({ ...entry, score: scoreEntry(entry, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/** Clamp the active index as results change or arrows move it. */
export function moveActiveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
