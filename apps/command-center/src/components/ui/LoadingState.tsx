interface LoadingStateProps {
  rows?: number;
  columns?: number;
}

export function LoadingState({ rows = 3, columns = 4 }: LoadingStateProps) {
  return (
    <div className="animate-pulse space-y-2" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-3">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <div
              key={colIdx}
              className="h-8 flex-1 rounded bg-gray-800"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
