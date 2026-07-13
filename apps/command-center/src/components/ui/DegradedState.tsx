/**
 * UTV2-1522 — Systematic degraded-state pattern.
 *
 * One shared shape everywhere a data source is down or partial:
 * status glyph + last-known-good timestamp + one-line cause(s) +
 * a retry / where-to-look action. Replaces bare red text and ad-hoc
 * per-page banners. Empty states stay on <EmptyState>; this component
 * is specifically for degraded/failed sources.
 */
import Link from 'next/link';

export interface DegradedStateProps {
  severity: 'warning' | 'critical';
  /** Short headline, e.g. "Partial data" or "Telemetry unavailable". */
  title: string;
  /** One line per failed source/cause — rendered mono, verbatim. */
  causes: string[];
  /** Last time this surface had good data, if known. Never fabricated. */
  lastKnownGoodAt?: string | null;
  /** Where to look / how to retry. */
  action?: { label: string; href: string };
  className?: string;
}

const TONE = {
  warning: {
    border: 'border-amber-600/40',
    bg: 'bg-amber-900/15',
    text: 'text-amber-300',
    sub: 'text-amber-200/70',
    glyph: 'bg-amber-400',
  },
  critical: {
    border: 'border-rose-600/40',
    bg: 'bg-rose-950/25',
    text: 'text-rose-300',
    sub: 'text-rose-200/70',
    glyph: 'bg-rose-400',
  },
} as const;

function formatLastGood(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DegradedState({ severity, title, causes, lastKnownGoodAt, action, className }: DegradedStateProps) {
  const tone = TONE[severity];
  return (
    <div className={`rounded border ${tone.border} ${tone.bg} px-4 py-3 ${className ?? ''}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${tone.glyph}`} aria-hidden="true" />
        <span className={`text-xs font-semibold uppercase tracking-wide ${tone.text}`}>{title}</span>
        {lastKnownGoodAt ? (
          <span className={`cc-num text-[10px] ${tone.sub}`}>last good {formatLastGood(lastKnownGoodAt)}</span>
        ) : null}
        {action ? (
          <Link
            href={action.href}
            className={`ml-auto rounded border ${tone.border} px-2 py-0.5 text-[10px] font-medium ${tone.text} transition-colors hover:bg-white/[0.04]`}
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      <ul className={`mt-1.5 space-y-0.5 pl-4 text-[11px] ${tone.sub}`}>
        {causes.map((cause) => (
          <li key={cause} className="list-disc font-mono">
            {cause}
          </li>
        ))}
      </ul>
    </div>
  );
}
