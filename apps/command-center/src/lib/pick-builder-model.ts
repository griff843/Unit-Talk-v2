// Pure validation + readiness logic for the Execution-zone Pick Builder.
// Mirrors the real submission contract in packages/contracts/src/submission.ts
// (SubmissionPayload: source, submittedBy, market, selection, line, odds,
// stakeUnits, confidence, eventName, thesis, metadata). Operator-only fields
// (sport, league, book, tier destination, risk rating, notes, dispatch target,
// scheduled time) travel in `metadata`.

export interface PickBuilderInput {
  sport: string;
  league: string;
  event: string;
  market: string;
  selection: string;
  line: string; // raw form strings; parsed here
  odds: string;
  book: string;
  confidence: string; // 0–1
  tierDestination: string;
  riskRating: string;
  reasoning: string;
  injuryNotes: string;
  movementNotes: string;
  dispatchTarget: string;
  scheduledTime: string; // ISO-ish local datetime string, optional
}

export const EMPTY_PICK_BUILDER_INPUT: PickBuilderInput = {
  sport: '',
  league: '',
  event: '',
  market: '',
  selection: '',
  line: '',
  odds: '',
  book: '',
  confidence: '',
  tierDestination: '',
  riskRating: '',
  reasoning: '',
  injuryNotes: '',
  movementNotes: '',
  dispatchTarget: '',
  scheduledTime: '',
};

export const TIER_DESTINATIONS = ['free', 'silver', 'gold', 'platinum'] as const;
export const RISK_RATINGS = ['low', 'medium', 'high'] as const;
export const DISPATCH_TARGETS = ['discord'] as const;

export interface PickReadiness {
  missingFields: string[];
  fieldErrors: Record<string, string>;
  /** Governance brake: operator-composed picks always require approval. */
  approvalRequired: true;
  /** All required fields present and parseable. */
  valid: boolean;
  /** Valid AND has odds/book/dispatch target — ready to enter dispatch flow (post-approval). */
  dispatchReady: boolean;
}

const REQUIRED_FIELDS: Array<{ key: keyof PickBuilderInput; label: string }> = [
  { key: 'sport', label: 'Sport' },
  { key: 'league', label: 'League' },
  { key: 'event', label: 'Event' },
  { key: 'market', label: 'Market' },
  { key: 'selection', label: 'Selection' },
  { key: 'odds', label: 'Odds' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'tierDestination', label: 'Tier destination' },
  { key: 'riskRating', label: 'Risk rating' },
  { key: 'reasoning', label: 'Reasoning' },
];

function parseNumeric(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function computePickReadiness(input: PickBuilderInput): PickReadiness {
  const missingFields: string[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const { key, label } of REQUIRED_FIELDS) {
    if (!input[key].trim()) missingFields.push(label);
  }

  if (input.line.trim() && parseNumeric(input.line) === null) {
    fieldErrors['line'] = 'Line must be numeric';
  }
  if (input.odds.trim()) {
    const odds = parseNumeric(input.odds);
    if (odds === null) fieldErrors['odds'] = 'Odds must be numeric (American)';
    else if (odds > -100 && odds < 100) fieldErrors['odds'] = 'American odds must be <= -100 or >= +100';
  }
  if (input.confidence.trim()) {
    const c = parseNumeric(input.confidence);
    if (c === null || c < 0 || c > 1) fieldErrors['confidence'] = 'Confidence must be a number between 0 and 1';
  }
  if (input.tierDestination.trim() && !TIER_DESTINATIONS.includes(input.tierDestination as never)) {
    fieldErrors['tierDestination'] = `Tier must be one of: ${TIER_DESTINATIONS.join(', ')}`;
  }
  if (input.riskRating.trim() && !RISK_RATINGS.includes(input.riskRating as never)) {
    fieldErrors['riskRating'] = `Risk rating must be one of: ${RISK_RATINGS.join(', ')}`;
  }
  if (input.scheduledTime.trim() && Number.isNaN(Date.parse(input.scheduledTime))) {
    fieldErrors['scheduledTime'] = 'Scheduled time must be a valid date/time';
  }

  const valid = missingFields.length === 0 && Object.keys(fieldErrors).length === 0;
  const dispatchReady =
    valid && Boolean(input.book.trim()) && Boolean(input.dispatchTarget.trim());

  return { missingFields, fieldErrors, approvalRequired: true, valid, dispatchReady };
}

/** Shape sent to POST /api/submissions (contracts SubmissionPayload). */
export interface SubmissionDraft {
  source: 'api';
  submittedBy?: string;
  market: string;
  selection: string;
  line?: number;
  odds?: number;
  confidence?: number;
  eventName?: string;
  thesis?: string;
  metadata: Record<string, unknown>;
}

export function buildSubmissionDraft(input: PickBuilderInput): SubmissionDraft {
  const line = parseNumeric(input.line);
  const odds = parseNumeric(input.odds);
  const confidence = parseNumeric(input.confidence);

  const metadata: Record<string, unknown> = {
    composer: 'command-center-pick-builder',
    sport: input.sport.trim() || undefined,
    league: input.league.trim() || undefined,
    book: input.book.trim() || undefined,
    tierDestination: input.tierDestination.trim() || undefined,
    riskRating: input.riskRating.trim() || undefined,
    injuryNotes: input.injuryNotes.trim() || undefined,
    movementNotes: input.movementNotes.trim() || undefined,
    dispatchTarget: input.dispatchTarget.trim() || undefined,
    scheduledTime: input.scheduledTime.trim() || undefined,
  };
  for (const key of Object.keys(metadata)) {
    if (metadata[key] === undefined) delete metadata[key];
  }

  return {
    source: 'api',
    market: input.market.trim(),
    selection: input.selection.trim(),
    ...(line !== null ? { line } : {}),
    ...(odds !== null ? { odds } : {}),
    ...(confidence !== null ? { confidence } : {}),
    ...(input.event.trim() ? { eventName: input.event.trim() } : {}),
    ...(input.reasoning.trim() ? { thesis: input.reasoning.trim() } : {}),
    metadata,
  };
}
