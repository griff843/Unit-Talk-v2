'use client';

import React from 'react';

export interface SparklineProps {
  points: number[];
  label: string;
  strokeClassName?: string;
  fillClassName?: string;
}

export function Sparkline({ points, label, strokeClassName, fillClassName }: SparklineProps) {
  if (points.length === 0) {
    return <div className="h-8 bg-white/[0.06] rounded" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const width = points.length * 4;
  const viewBox = `0 0 ${width} 32`;
  const coords = points.map((point, i) => {
    const normalized = (point - min) / range;
    const y = 28 - normalized * 24;
    const x = i * 4 + 2;
    return { x, y };
  });
  const pathData = coords.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const fillData = fillClassName
    ? `${pathData} L ${width} 32 L 2 32 Z`
    : null;

  return (
    <svg viewBox={viewBox} className="h-8 w-full" aria-label={label}>
      {fillData && (
        <path d={fillData} strokeWidth="0" vectorEffect="non-scaling-stroke" className={fillClassName} />
      )}
      <path
        d={pathData}
        strokeWidth="1"
        fill="none"
        vectorEffect="non-scaling-stroke"
        className={strokeClassName ?? 'stroke-current'}
      />
    </svg>
  );
}
