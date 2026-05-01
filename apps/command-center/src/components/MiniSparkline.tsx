interface MiniSparklineProps {
  values: number[];
  className?: string;
}

export function MiniSparkline({ values, className }: MiniSparklineProps) {
  const normalized = values.length > 0 ? values : [0];
  const max = Math.max(...normalized, 1);
  const min = Math.min(...normalized, 0);
  const range = max - min || 1;

  const points = normalized
    .map((value, index) => {
      const x = normalized.length === 1 ? 50 : (index / (normalized.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={className ?? 'h-8 w-24'}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
