export interface BettorField {
  name: string;
  value: string;
  inline?: boolean;
}

export function buildBettorIntelligenceFields(input: {
  confidence?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}): BettorField[] {
  const metadata = input.metadata ?? {};
  const fields: BettorField[] = [];

  if (typeof metadata['edgePercent'] === 'number' && Number.isFinite(metadata['edgePercent'])) {
    fields.push({
      name: 'Market Edge',
      value: `${formatSignedPercent(metadata['edgePercent'])} edge vs market`,
      inline: true,
    });
  }

  if (typeof input.confidence === 'number' && Number.isFinite(input.confidence)) {
    fields.push({
      name: 'Confidence',
      value: mapConfidenceBand(input.confidence),
      inline: true,
    });
  }

  if (typeof metadata['clvTrend'] === 'string') {
    const trackRecord = mapClvTrend(metadata['clvTrend']);
    if (trackRecord) {
      fields.push({
        name: 'Track Record',
        value: trackRecord,
        inline: false,
      });
    }
  }

  return fields;
}

function formatSignedPercent(value: number) {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Number.isInteger(rounded) ? rounded.toFixed(1) : rounded.toString();
  return `${rounded >= 0 ? '+' : ''}${normalized}%`;
}

function mapConfidenceBand(value: number) {
  if (value >= 0.75) {
    return 'High conviction';
  }

  if (value >= 0.6) {
    return 'Solid confidence';
  }

  return 'Lean only';
}

function mapClvTrend(value: string) {
  switch (value) {
    case 'improving':
      return 'Beating the close lately';
    case 'steady':
      return 'Tracking the close consistently';
    case 'cooling':
      return 'Market has been moving against this more often';
    default:
      return null;
  }
}
