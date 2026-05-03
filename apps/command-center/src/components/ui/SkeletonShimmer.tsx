'use client';

import React from 'react';

export interface SkeletonShimmerProps {
  width: number | string;
  height: number | string;
  variant?: 'rect' | 'pill' | 'circle';
}

export function SkeletonShimmer({ width, height, variant = 'rect' }: SkeletonShimmerProps) {
  const radiusClass =
    variant === 'circle' ? 'rounded-full' : variant === 'pill' ? 'rounded-full' : 'rounded-2xl';

  return (
    <div
      className={`relative overflow-hidden border border-white/6 bg-[linear-gradient(110deg,rgba(148,163,184,0.08),rgba(255,255,255,0.14),rgba(148,163,184,0.08))] bg-[length:200%_100%] animate-[cc-shimmer_1.4s_linear_infinite] ${radiusClass}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
