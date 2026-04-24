import { scoreToneClasses } from '@/lib/score-insight';

export interface RoutingExplanation {
  verdict: 'promoted' | 'suppressed' | 'held' | 'pending' | 'none';
  target: string | null;
  score: number | null;
  scoreInputs: {
    edge: number | null;
    trust: number | null;
    readiness: number | null;
    uniqueness: number | null;
    boardFit: number | null;
  } | null;
  edgeSource: string | null;
  edgeSourceLabel: string;
  reliabilityTone: 'high' | 'medium' | 'low';
  suppressionReasons: string[];
  gateFailures: string[];
  reason: string | null;
  decidedAt: string | null;
}

interface RoutingExplanationBlockProps {
  routing: RoutingExplanation;
  compact?: boolean;
}

function verdictStyle(verdict: RoutingExplanation['verdict']): { label: string; className: string } {
  switch (verdict) {
    case 'promoted':
      return { label: 'Promoted', className: 'border-green-700 bg-green-950 text-green-300' };
    case 'held':
      return { label: 'Held', className: 'border-amber-700 bg-amber-950 text-amber-300' };
    case 'suppressed':
      return { label: 'Suppressed', className: 'border-red-700 bg-red-950 text-red-300' };
    case 'pending':
      return { label: 'Pending', className: 'border-gray-600 bg-gray-800 text-gray-300' };
    default:
      return { label: 'Unknown', className: 'border-gray-700 bg-gray-800 text-gray-400' };
  }
}

function buildSentence(routing: RoutingExplanation): string {
  const { verdict, target, edgeSourceLabel, suppressionReasons, gateFailures, reason } = routing;

  switch (verdict) {
    case 'promoted':
      return `Routed to ${target ?? 'a target'} via ${edgeSourceLabel.toLowerCase()}.`;

    case 'held': {
      const holdContext = reason ?? suppressionReasons[0] ?? null;
      return holdContext
        ? `Held: ${holdContext}`
        : 'Held pending operator review. Score present but policy requires sign-off.';
    }

    case 'suppressed': {
      const whyParts: string[] = [];
      if (suppressionReasons.length > 0) whyParts.push(...suppressionReasons);
      if (gateFailures.length > 0) whyParts.push(...gateFailures.map((g) => g.replace(/_/g, ' ')));
      return whyParts.length > 0
        ? `Suppressed: ${whyParts.slice(0, 3).join('; ')}.`
        : 'Suppressed by routing policy — score insufficient or gate condition not met.';
    }

    case 'pending':
      return 'Awaiting routing policy evaluation.';

    default:
      return 'Routing outcome not determined.';
  }
}

export function RoutingExplanationBlock({
  routing,
  compact = false,
}: RoutingExplanationBlockProps) {
  const verdict = verdictStyle(routing.verdict);
  const sentence = buildSentence(routing);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
      {/* Verdict + score row */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${verdict.className}`}>
          {verdict.label}
        </span>
        {routing.score != null && (
          <span className="font-mono text-xs text-gray-400">
            score <span className="text-gray-200">{routing.score.toFixed(1)}</span>
          </span>
        )}
        {routing.target != null && (
          <span className="font-mono text-xs text-gray-500">→ {routing.target}</span>
        )}
        <span className={`rounded border px-2 py-0.5 text-xs ${scoreToneClasses(routing.reliabilityTone)}`}>
          {routing.edgeSourceLabel}
        </span>
      </div>

      {/* Explanation sentence */}
      <p className="text-sm text-gray-300">{sentence}</p>

      {/* Gate failures (only shown when relevant) */}
      {!compact && routing.gateFailures.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {routing.gateFailures.map((gate) => (
            <span
              key={gate}
              className="rounded border border-rose-800 bg-rose-950/40 px-1.5 py-0.5 text-[10px] text-rose-300"
            >
              {gate.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Score components (full view only) */}
      {!compact && routing.scoreInputs != null && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          <p className="mb-2 text-xs uppercase text-gray-500">Score Components</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
            {(
              [
                ['Edge', routing.scoreInputs.edge],
                ['Trust', routing.scoreInputs.trust],
                ['Readiness', routing.scoreInputs.readiness],
                ['Uniqueness', routing.scoreInputs.uniqueness],
                ['Board Fit', routing.scoreInputs.boardFit],
              ] as [string, number | null][]
            ).map(([label, val]) => (
              <div key={label} className="flex justify-between gap-1 text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="font-mono text-gray-300">
                  {val != null ? val.toFixed(1) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decided-at timestamp (full view only) */}
      {!compact && routing.decidedAt != null && (
        <p className="mt-2 text-[10px] text-gray-600">
          Decided {new Date(routing.decidedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
