/**
 * UTV2-1522 — Inline-SVG micro-charts (zero chart-lib dependencies).
 * Geometry comes from src/lib/microchart-model.ts; these components only render.
 */
import { sparklinePath, sparklineAreaPath, miniBars } from '@/lib/microchart-model';

export function MicroSparkline({
  values,
  label,
  width = 120,
  height = 32,
  className,
  stroke = 'var(--cc-accent)',
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}) {
  const line = sparklinePath(values, { width, height });
  const area = sparklineAreaPath(values, { width, height });
  if (!line) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-dashed border-[var(--cc-border-subtle)] bg-white/[0.02] ${className ?? ''}`}
        style={{ width, height }}
      >
        <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--cc-text-muted)]">no trend data</span>
      </div>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={label}
    >
      {area && <path d={area} fill={stroke} opacity="0.12" />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.25" />
    </svg>
  );
}

export function MicroBars({
  values,
  label,
  width = 72,
  height = 20,
  className,
  fill = 'var(--cc-accent)',
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  className?: string;
  fill?: string;
}) {
  const bars = miniBars(values, { width, height, gap: 2 });
  if (bars.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-dashed border-[var(--cc-border-subtle)] bg-white/[0.02] ${className ?? ''}`}
        style={{ width, height }}
      >
        <span className="text-[8px] uppercase tracking-[0.12em] text-[var(--cc-text-muted)]">no data</span>
      </div>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={label}
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx="1" fill={fill} opacity={0.85} />
      ))}
    </svg>
  );
}
