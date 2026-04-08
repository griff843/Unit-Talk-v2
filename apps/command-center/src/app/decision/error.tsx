'use client';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DecisionError({ error, reset }: ErrorProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Error</h1>
      </div>
      <div className="rounded-md border border-red-800 bg-red-950/30 px-4 py-3">
        <p className="text-sm font-medium text-red-400">Failed to load Decision data</p>
        <p className="text-xs text-red-600 mt-1">
          {error.message ?? 'An unexpected error occurred while fetching data from the operator service.'}
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
