export const pickSources = [
  'smart-form',
  'feed',
  'system',
  'alert-agent',
  'model-driven',
  'api',
  'discord-bot',
] as const;

export type PickSource = (typeof pickSources)[number];

export interface SubmissionPayload {
  source: PickSource;
  submittedBy?: string | undefined;
  market: string;
  selection: string;
  line?: number | undefined;
  odds?: number | undefined;
  stakeUnits?: number | undefined;
  confidence?: number | undefined;
  eventName?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ValidatedSubmission {
  id: string;
  receivedAt: string;
  payload: SubmissionPayload;
}

export interface SubmissionValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSubmissionPayload(
  payload: SubmissionPayload,
): SubmissionValidationResult {
  const errors: string[] = [];

  if (!payload.source.trim()) {
    errors.push('source is required');
  }

  if (!payload.market.trim()) {
    errors.push('market is required');
  }

  if (!payload.selection.trim()) {
    errors.push('selection is required');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
