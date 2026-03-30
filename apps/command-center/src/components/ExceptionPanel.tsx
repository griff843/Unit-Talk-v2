import { Card } from '@/components/ui/Card';
import type { OperationalException } from '@/lib/types';
import Link from 'next/link';

const severityStyles: Record<string, string> = {
  critical: 'border-red-600 bg-red-950 text-red-300',
  warning: 'border-yellow-600 bg-yellow-950 text-yellow-300',
};

const categoryLabels: Record<string, string> = {
  settlement: 'Settlement',
  delivery: 'Delivery',
  lifecycle: 'Lifecycle',
  scoring: 'Scoring',
  correction: 'Correction',
};

export function ExceptionPanel({ exceptions }: { exceptions: OperationalException[] }) {
  if (exceptions.length === 0) {
    return (
      <Card title="Exceptions">
        <p className="text-sm text-gray-500">No exceptions detected.</p>
      </Card>
    );
  }

  const critical = exceptions.filter((e) => e.severity === 'critical');
  const warnings = exceptions.filter((e) => e.severity === 'warning');

  return (
    <Card title={`Exceptions (${exceptions.length})`}>
      <div className="mb-2 flex gap-3 text-xs">
        {critical.length > 0 && (
          <span className="font-bold text-red-400">{critical.length} critical</span>
        )}
        {warnings.length > 0 && (
          <span className="font-bold text-yellow-400">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {exceptions.map((exc) => (
          <div
            key={exc.id}
            className={`rounded border px-3 py-2 text-sm ${severityStyles[exc.severity]}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-gray-300">
                  {categoryLabels[exc.category] ?? exc.category}
                </span>
                <span className="font-semibold">{exc.title}</span>
              </div>
              {exc.pickId && (
                <Link
                  href={`/picks/${exc.pickId}`}
                  className="font-mono text-xs text-blue-400 hover:underline"
                >
                  {exc.pickId.slice(0, 8)}&hellip;
                </Link>
              )}
            </div>
            <p className="mt-1 text-xs opacity-80">{exc.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
