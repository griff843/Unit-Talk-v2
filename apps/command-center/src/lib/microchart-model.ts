/**
 * UTV2-1522 — Zero-dependency micro-chart geometry.
 *
 * Pure functions that turn numeric series into inline-SVG geometry (path
 * strings, bar rects). No I/O, no DOM, no chart libraries — components render
 * the returned geometry directly into <svg> elements.
 */

export interface SparklineOptions {
  width: number;
  height: number;
  /** Inner padding in px (default 2). */
  pad?: number;
}

export interface MiniBarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Original value the bar encodes. */
  value: number;
}

function scalePoints(values: number[], opts: SparklineOptions): Array<{ x: number; y: number }> {
  const pad = opts.pad ?? 2;
  const w = opts.width - pad * 2;
  const h = opts.height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v, i) => ({
    x: pad + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w),
    y: pad + h - ((v - min) / range) * h,
  }));
}

/** Round to 2 decimals to keep path strings compact and deterministic. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * SVG path ("M x y L x y …") for a line sparkline. Returns null when fewer
 * than 2 finite points exist — callers must render an explicit empty state,
 * never a fabricated flat line.
 */
export function sparklinePath(values: number[], opts: SparklineOptions): string | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2 || finite.length !== values.length) {
    if (finite.length < 2) return null;
  }
  if (values.some((v) => !Number.isFinite(v))) return null;
  const pts = scalePoints(values, opts);
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(p.x)} ${r2(p.y)}`).join(' ');
}

/**
 * Closed area path under the sparkline (for a soft fill). Null under the same
 * conditions as sparklinePath.
 */
export function sparklineAreaPath(values: number[], opts: SparklineOptions): string | null {
  const line = sparklinePath(values, opts);
  if (line === null) return null;
  const pad = opts.pad ?? 2;
  const pts = scalePoints(values, opts);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const bottom = opts.height - pad;
  return `${line} L ${r2(last.x)} ${r2(bottom)} L ${r2(first.x)} ${r2(bottom)} Z`;
}

/**
 * Bar rects for a mini bar chart. Bars are bottom-anchored, scaled to the max
 * value; zero/negative values render as zero-height (data floor, not lies).
 * Returns [] for an empty series or when no finite positive value exists.
 */
export function miniBars(
  values: number[],
  opts: SparklineOptions & { gap?: number },
): MiniBarRect[] {
  if (values.length === 0) return [];
  if (values.some((v) => !Number.isFinite(v))) return [];
  const pad = opts.pad ?? 2;
  const gap = opts.gap ?? 2;
  const w = opts.width - pad * 2;
  const h = opts.height - pad * 2;
  const max = Math.max(...values, 0);
  if (max <= 0) return [];
  const barW = (w - gap * (values.length - 1)) / values.length;
  if (barW <= 0) return [];
  return values.map((v, i) => {
    const barH = v > 0 ? (v / max) * h : 0;
    return {
      x: r2(pad + i * (barW + gap)),
      y: r2(pad + h - barH),
      width: r2(barW),
      height: r2(barH),
      value: v,
    };
  });
}
