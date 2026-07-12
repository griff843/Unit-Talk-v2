/**
 * UTV2-1522 — Signature numeric identity.
 *
 * Every odds, line, EV%, score, age, and timestamp in the Command Center
 * renders through this component (or the `.cc-num` utility for raw cases):
 * mono stack + tabular-nums so digits align in columns, with consistent
 * signed-value coloring (+ green, − red, neutral gray) where semantics call
 * for it. No external font fetch — system mono stack only.
 */
import type { ReactNode } from 'react';

export interface NumProps {
  /** Pre-formatted display string (e.g. "+115", "-0.5", "61d ago"). */
  children: ReactNode;
  /**
   * Signed coloring: 'auto' colors by numeric sign of `value` (or parsed
   * children), 'pos'/'neg'/'neutral' force a tone, 'none' inherits.
   */
  tone?: 'auto' | 'pos' | 'neg' | 'neutral' | 'none';
  /** Numeric value used for 'auto' tone; falls back to parsing children. */
  value?: number | null;
  className?: string;
}

function resolveTone(tone: NumProps['tone'], value: number | null | undefined, children: ReactNode): string {
  const t = tone ?? 'none';
  if (t === 'none') return '';
  if (t === 'pos') return 'cc-num-pos';
  if (t === 'neg') return 'cc-num-neg';
  if (t === 'neutral') return 'cc-num-neutral';
  // auto
  let v = value;
  if (v === undefined || v === null) {
    const s = typeof children === 'string' ? children : null;
    if (s) {
      const parsed = Number.parseFloat(s.replace(/[+%,]/g, ''));
      v = Number.isFinite(parsed) ? parsed : null;
    }
  }
  if (v === undefined || v === null) return 'cc-num-neutral';
  if (v > 0) return 'cc-num-pos';
  if (v < 0) return 'cc-num-neg';
  return 'cc-num-neutral';
}

export function Num({ children, tone = 'none', value, className }: NumProps) {
  const toneClass = resolveTone(tone, value, children);
  return <span className={['cc-num', toneClass, className ?? ''].filter(Boolean).join(' ')}>{children}</span>;
}
