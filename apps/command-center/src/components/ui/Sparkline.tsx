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

  const viewBox = `0 0 ${points.length * 4} 32`;
  const pathData = points
    .map((point, i) => {
      const normalized = (point - min) / range;
      const y = 28 - normalized * 24;
      const x = i * 4 + 2;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={viewBox} className="h-8 w-full" aria-label={label}>
      <path d={pathData} stroke="currentColor" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
