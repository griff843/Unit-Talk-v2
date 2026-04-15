type JsonObject = Record<string, unknown>;

export interface ScoreInsight {
  edgeSource: string | null;
  edgeSourceLabel: string;
  reliabilityLabel: string;
  reliabilityTone: 'high' | 'medium' | 'low';
}

function readObject(value: unknown): JsonObject | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return null;
}

function readEdgeSource(metadata: JsonObject | null): string | null {
  const domainAnalysis = readObject(metadata?.['domainAnalysis']);
  const directSource =
    typeof domainAnalysis?.['realEdgeSource'] === 'string'
      ? domainAnalysis['realEdgeSource']
      : typeof metadata?.['realEdgeSource'] === 'string'
        ? metadata['realEdgeSource']
        : typeof metadata?.['edgeSource'] === 'string'
          ? metadata['edgeSource']
          : null;

  if (directSource) {
    return directSource.trim();
  }

  const promotionScores = readObject(metadata?.['promotionScores']);
  if (typeof promotionScores?.['edge'] === 'number') {
    return 'explicit';
  }

  if (typeof domainAnalysis?.['edge'] === 'number') {
    return 'confidence-delta';
  }

  return null;
}

export function buildScoreInsight(metadata: JsonObject | null | undefined): ScoreInsight {
  const edgeSource = readEdgeSource(metadata ?? null);

  switch (edgeSource) {
    case 'pinnacle':
    case 'real-edge':
      return {
        edgeSource,
        edgeSourceLabel: 'Market-backed edge',
        reliabilityLabel: 'High trust',
        reliabilityTone: 'high',
      };
    case 'consensus':
    case 'consensus-edge':
      return {
        edgeSource,
        edgeSourceLabel: 'Consensus edge',
        reliabilityLabel: 'Solid trust',
        reliabilityTone: 'high',
      };
    case 'sgo':
    case 'sgo-edge':
      return {
        edgeSource,
        edgeSourceLabel: 'Single-book edge',
        reliabilityLabel: 'Medium trust',
        reliabilityTone: 'medium',
      };
    case 'explicit':
      return {
        edgeSource,
        edgeSourceLabel: 'Explicit component',
        reliabilityLabel: 'Manual input',
        reliabilityTone: 'medium',
      };
    case 'confidence-delta':
      return {
        edgeSource,
        edgeSourceLabel: 'Confidence fallback',
        reliabilityLabel: 'Low trust',
        reliabilityTone: 'low',
      };
    default:
      return {
        edgeSource,
        edgeSourceLabel: 'Unknown edge source',
        reliabilityLabel: 'Unknown trust',
        reliabilityTone: 'low',
      };
  }
}

export function scoreToneClasses(tone: ScoreInsight['reliabilityTone']) {
  if (tone === 'high') {
    return 'border-emerald-800 bg-emerald-950/40 text-emerald-200';
  }
  if (tone === 'medium') {
    return 'border-amber-800 bg-amber-950/40 text-amber-200';
  }
  return 'border-rose-900 bg-rose-950/40 text-rose-200';
}
