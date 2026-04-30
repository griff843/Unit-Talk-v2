import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';

const ROOT = process.cwd();
const DEFAULT_PROVIDER = 'sgo';
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_EVENT_SAMPLE_SIZE = 10;
const DEFAULT_PICK_SAMPLE_SIZE = 50;
const DEFAULT_FRESHNESS_TOLERANCE_SECONDS = 300;
const CLV_TOLERANCE = 0.0001;

export type ParityVerdict = 'PARITY PASSED' | 'PARITY FAILED' | 'PARITY BLOCKED';
export type ParityAreaStatus = 'passed' | 'failed' | 'blocked';
export type MismatchSeverity = 'blocker' | 'warning' | 'expected/documented';
export type ParityAreaKey =
  | 'current'
  | 'opening'
  | 'closing'
  | 'pickSnapshots'
  | 'clv'
  | 'scannerScoring'
  | 'commandCenter'
  | 'modelFeatures';

export interface CliOptions {
  eventIds: string[];
  pickIds: string[];
  provider: string;
  windowHours: number;
  sampleSize: number;
  failOnMismatch: boolean;
  json: boolean;
}

export interface OfferIdentityRow {
  identity_key?: string | null;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  sport_key?: string | null;
  line: number | string | null;
  over_odds: number | null;
  under_odds: number | null;
  devig_mode: string | null;
  snapshot_at: string;
  is_opening?: boolean;
  is_closing?: boolean;
  change_reason?: string | null;
}

export interface PickSnapshotComparable {
  pickId: string;
  snapshotKind: string;
  providerEventId: string | null;
  providerMarketKey: string | null;
  providerParticipantId: string | null;
  bookmakerKey: string | null;
  line: number | string | null;
  overOdds: number | null;
  underOdds: number | null;
  sourceSnapshotAt: string | null;
  capturedAt: string | null;
}

export interface ClvComparable {
  pickId: string;
  legacySubmissionValue: number | null;
  legacyClosingValue: number | null;
  newSubmissionValue: number | null;
  newClosingValue: number | null;
}

export interface FeatureComparable {
  subjectId: string;
  featureName: string;
  legacyValue: number | string | boolean | null;
  newValue: number | string | boolean | null;
}

export interface ParityMismatch {
  category: ParityAreaKey;
  event_id: string | null;
  pick_id: string | null;
  identity_key: string | null;
  legacy_value: unknown;
  new_value: unknown;
  severity: MismatchSeverity;
  message: string;
}

export interface ParityAreaReport {
  key: ParityAreaKey;
  title: string;
  status: ParityAreaStatus;
  checked: number;
  matches: number;
  mismatches: number;
  missingLegacy: number;
  missingNew: number;
  blockedReason: string | null;
  mismatchesDetail: ParityMismatch[];
}

export interface HarnessInputs {
  provider: string;
  windowHours: number;
  sampledEventIds: string[];
  sampledPickIds: string[];
}

export interface HarnessOutput {
  inputs: HarnessInputs;
  reports: Record<ParityAreaKey, ParityAreaReport>;
  mismatchDetails: ParityMismatch[];
  verdict: ParityVerdict;
  exitCode: number;
}

interface ManagementCredentials {
  accessToken: string;
  projectRef: string;
}

interface QueryRow {
  [key: string]: string | number | boolean | null;
}

interface PickRow extends QueryRow {
  pick_id: string;
  status: string;
  source: string;
  created_at: string;
  posted_at: string | null;
  settled_at: string | null;
  market: string;
  market_type_id: string | null;
  selection: string;
  odds: number | null;
  provider_event_id: string | null;
  provider_market_key: string | null;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  event_start_time: string | null;
  has_approval_review?: boolean;
  approval_reviewed_at?: string | null;
}

interface SampleEventRow extends QueryRow {
  provider_event_id: string;
}

interface TablePresenceRow extends QueryRow {
  provider_offer_history_compact_exists: boolean;
  pick_offer_snapshots_exists: boolean;
}

function readRawEnvFileValue(key: string): string | null {
  for (const fileName of ['local.env', '.env']) {
    const filePath = path.join(ROOT, fileName);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function resolveManagementCredentials(): ManagementCredentials {
  const env = loadEnvironment(ROOT);
  const accessToken =
    process.env['SUPABASE_ACCESS_TOKEN']?.trim() ??
    readRawEnvFileValue('SUPABASE_ACCESS_TOKEN') ??
    '';
  const projectRef =
    process.env['SUPABASE_PROJECT_REF']?.trim() ??
    env.SUPABASE_PROJECT_REF?.trim() ??
    readRawEnvFileValue('SUPABASE_PROJECT_REF') ??
    '';

  if (!accessToken || !projectRef) {
    throw new Error(
      'Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF. Exact provider-offer parity requires management SQL read access.',
    );
  }

  return { accessToken, projectRef };
}

async function runSqlQuery<T extends QueryRow>(query: string): Promise<T[]> {
  const { accessToken, projectRef } = resolveManagementCredentials();
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase SQL request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T[];
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const eventIds: string[] = [];
  const pickIds: string[] = [];
  let provider = DEFAULT_PROVIDER;
  let windowHours = DEFAULT_WINDOW_HOURS;
  let sampleSize = DEFAULT_EVENT_SAMPLE_SIZE;
  let failOnMismatch = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event-id' && argv[i + 1]) {
      eventIds.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (arg.startsWith('--event-id=')) {
      eventIds.push(arg.slice('--event-id='.length));
      continue;
    }
    if (arg === '--pick-id' && argv[i + 1]) {
      pickIds.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (arg.startsWith('--pick-id=')) {
      pickIds.push(arg.slice('--pick-id='.length));
      continue;
    }
    if (arg === '--provider' && argv[i + 1]) {
      provider = (argv[i + 1] ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      i += 1;
      continue;
    }
    if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length).trim() || DEFAULT_PROVIDER;
      continue;
    }
    if (arg === '--window-hours' && argv[i + 1]) {
      windowHours = parsePositiveInt(argv[i + 1], DEFAULT_WINDOW_HOURS);
      i += 1;
      continue;
    }
    if (arg.startsWith('--window-hours=')) {
      windowHours = parsePositiveInt(arg.slice('--window-hours='.length), DEFAULT_WINDOW_HOURS);
      continue;
    }
    if (arg === '--sample-size' && argv[i + 1]) {
      sampleSize = parsePositiveInt(argv[i + 1], DEFAULT_EVENT_SAMPLE_SIZE);
      i += 1;
      continue;
    }
    if (arg.startsWith('--sample-size=')) {
      sampleSize = parsePositiveInt(arg.slice('--sample-size='.length), DEFAULT_EVENT_SAMPLE_SIZE);
      continue;
    }
    if (arg === '--fail-on-mismatch') {
      failOnMismatch = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
    }
  }

  return {
    eventIds: [...new Set(eventIds.filter(Boolean))],
    pickIds: [...new Set(pickIds.filter(Boolean))],
    provider,
    windowHours,
    sampleSize,
    failOnMismatch,
    json,
  };
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringArray(values: string[]) {
  return values.map(sqlString).join(', ');
}

function buildIdentityKey(row: Pick<
  OfferIdentityRow,
  | 'provider_key'
  | 'provider_event_id'
  | 'provider_market_key'
  | 'provider_participant_id'
  | 'bookmaker_key'
>) {
  return [
    row.provider_key,
    row.provider_event_id,
    row.provider_market_key,
    row.provider_participant_id ?? '',
    row.bookmaker_key ?? '',
  ].join(':');
}

function coerceNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeOfferRow(row: QueryRow): OfferIdentityRow {
  const normalized: OfferIdentityRow = {
    identity_key: coerceNullableString(row['identity_key']),
    provider_key: String(row['provider_key'] ?? ''),
    provider_event_id: String(row['provider_event_id'] ?? ''),
    provider_market_key: String(row['provider_market_key'] ?? ''),
    provider_participant_id: coerceNullableString(row['provider_participant_id']),
    bookmaker_key: coerceNullableString(row['bookmaker_key']),
    sport_key: coerceNullableString(row['sport_key']),
    line: row['line'] ?? null,
    over_odds: coerceNullableNumber(row['over_odds']),
    under_odds: coerceNullableNumber(row['under_odds']),
    devig_mode: coerceNullableString(row['devig_mode']),
    snapshot_at: String(row['snapshot_at'] ?? ''),
    is_opening: row['is_opening'] === true,
    is_closing: row['is_closing'] === true,
    change_reason: coerceNullableString(row['change_reason']),
  };
  normalized.identity_key ??= buildIdentityKey(normalized);
  return normalized;
}

function makeEmptyReport(key: ParityAreaKey, title: string): ParityAreaReport {
  return {
    key,
    title,
    status: 'passed',
    checked: 0,
    matches: 0,
    mismatches: 0,
    missingLegacy: 0,
    missingNew: 0,
    blockedReason: null,
    mismatchesDetail: [],
  };
}

function markBlocked(report: ParityAreaReport, reason: string) {
  report.status = 'blocked';
  report.blockedReason = reason;
  return report;
}

function comparePrimitive(
  left: string | number | null,
  right: string | number | null,
) {
  if (left === null && right === null) return true;
  if (typeof left === 'number' || typeof right === 'number') {
    return coerceNullableNumber(left) === coerceNullableNumber(right);
  }
  return left === right;
}

export function compareOfferParity(
  key: Extract<ParityAreaKey, 'current' | 'opening' | 'closing'>,
  title: string,
  legacyRows: OfferIdentityRow[],
  newRows: OfferIdentityRow[],
  options: {
    freshnessToleranceSeconds?: number;
    documentedExpectedMismatchKeys?: Set<string>;
  } = {},
): ParityAreaReport {
  const report = makeEmptyReport(key, title);
  const toleranceSeconds = options.freshnessToleranceSeconds ?? 0;
  const documentedKeys = options.documentedExpectedMismatchKeys ?? new Set<string>();

  const legacyMap = new Map(legacyRows.map((row) => [row.identity_key ?? buildIdentityKey(row), row]));
  const newMap = new Map(newRows.map((row) => [row.identity_key ?? buildIdentityKey(row), row]));
  const identityKeys = [...new Set([...legacyMap.keys(), ...newMap.keys()])];

  report.checked = identityKeys.length;

  for (const identityKey of identityKeys) {
    const legacy = legacyMap.get(identityKey) ?? null;
    const next = newMap.get(identityKey) ?? null;
    const documentedExpected = documentedKeys.has(identityKey);

    if (!legacy) {
      report.missingLegacy += 1;
      report.mismatches += 1;
      report.status = report.status === 'blocked' ? report.status : 'failed';
      report.mismatchesDetail.push({
        category: key,
        event_id: next?.provider_event_id ?? null,
        pick_id: null,
        identity_key: identityKey,
        legacy_value: null,
        new_value: next,
        severity: documentedExpected ? 'expected/documented' : 'blocker',
        message: 'Identity exists in new surface but not in legacy latest set.',
      });
      continue;
    }

    if (!next) {
      report.missingNew += 1;
      report.mismatches += 1;
      report.status = report.status === 'blocked' ? report.status : 'failed';
      report.mismatchesDetail.push({
        category: key,
        event_id: legacy.provider_event_id,
        pick_id: null,
        identity_key: identityKey,
        legacy_value: legacy,
        new_value: null,
        severity: documentedExpected ? 'expected/documented' : 'blocker',
        message: 'Identity exists in legacy latest set but is missing from new surface.',
      });
      continue;
    }

    const rowMismatches: string[] = [];
    if (!comparePrimitive(coerceNullableNumber(legacy.line), coerceNullableNumber(next.line))) {
      rowMismatches.push('line');
    }
    if (!comparePrimitive(legacy.over_odds, next.over_odds)) {
      rowMismatches.push('over_odds');
    }
    if (!comparePrimitive(legacy.under_odds, next.under_odds)) {
      rowMismatches.push('under_odds');
    }
    if (!comparePrimitive(legacy.devig_mode, next.devig_mode)) {
      rowMismatches.push('devig_mode');
    }

    const legacyMs = Date.parse(legacy.snapshot_at);
    const newMs = Date.parse(next.snapshot_at);
    if (Number.isFinite(legacyMs) && Number.isFinite(newMs)) {
      const skewSeconds = Math.abs(newMs - legacyMs) / 1000;
      if (skewSeconds > toleranceSeconds) {
        rowMismatches.push(`snapshot_at(${skewSeconds.toFixed(0)}s)`);
      }
    }

    if (rowMismatches.length > 0) {
      report.mismatches += 1;
      report.status = report.status === 'blocked' ? report.status : 'failed';
      report.mismatchesDetail.push({
        category: key,
        event_id: legacy.provider_event_id,
        pick_id: null,
        identity_key: identityKey,
        legacy_value: legacy,
        new_value: next,
        severity: documentedExpected ? 'expected/documented' : 'blocker',
        message: `Field mismatch: ${rowMismatches.join(', ')}`,
      });
      continue;
    }

    report.matches += 1;
  }

  return report;
}

function requiredSnapshotKindsForPick(pick: PickRow) {
  const kinds = ['submission'] as string[];
  if (pick.has_approval_review === true) {
    kinds.push('approval');
  }
  if (pick.posted_at || pick.status === 'posted' || pick.status === 'settled') {
    kinds.push('posting');
  }
  if (pick.settled_at) {
    kinds.push('closing_for_clv', 'settlement_proof');
  }
  return kinds;
}

export function comparePickSnapshotParity(
  picks: PickRow[],
  legacySnapshots: PickSnapshotComparable[],
  newSnapshots: PickSnapshotComparable[],
): ParityAreaReport {
  const report = makeEmptyReport('pickSnapshots', 'Pick Snapshot Parity');
  const legacyMap = new Map<string, PickSnapshotComparable>();
  const newMap = new Map<string, PickSnapshotComparable>();

  for (const row of legacySnapshots) legacyMap.set(`${row.pickId}:${row.snapshotKind}`, row);
  for (const row of newSnapshots) newMap.set(`${row.pickId}:${row.snapshotKind}`, row);

  report.checked = picks.length;

  for (const pick of picks) {
    const requiredKinds = requiredSnapshotKindsForPick(pick);
    for (const kind of requiredKinds) {
      const legacy = legacyMap.get(`${pick.pick_id}:${kind}`) ?? null;
      const next = newMap.get(`${pick.pick_id}:${kind}`) ?? null;
      if (!legacy) {
        report.missingLegacy += 1;
        report.mismatches += 1;
        report.status = 'failed';
        report.mismatchesDetail.push({
          category: 'pickSnapshots',
          event_id: pick.provider_event_id,
          pick_id: pick.pick_id,
          identity_key: null,
          legacy_value: null,
          new_value: next,
          severity: 'blocker',
          message: `Legacy equivalent snapshot missing for ${kind}.`,
        });
        continue;
      }
      if (!next) {
        report.missingNew += 1;
        report.mismatches += 1;
        report.status = 'failed';
        report.mismatchesDetail.push({
          category: 'pickSnapshots',
          event_id: pick.provider_event_id,
          pick_id: pick.pick_id,
          identity_key: null,
          legacy_value: legacy,
          new_value: null,
          severity: 'blocker',
          message: `Required pick snapshot missing for ${kind}.`,
        });
        continue;
      }

      const fieldsDiffer =
        !comparePrimitive(legacy.providerEventId, next.providerEventId) ||
        !comparePrimitive(legacy.providerMarketKey, next.providerMarketKey) ||
        !comparePrimitive(legacy.providerParticipantId, next.providerParticipantId) ||
        !comparePrimitive(legacy.bookmakerKey, next.bookmakerKey) ||
        !comparePrimitive(coerceNullableNumber(legacy.line), coerceNullableNumber(next.line)) ||
        !comparePrimitive(legacy.overOdds, next.overOdds) ||
        !comparePrimitive(legacy.underOdds, next.underOdds);

      if (fieldsDiffer) {
        report.mismatches += 1;
        report.status = 'failed';
        report.mismatchesDetail.push({
          category: 'pickSnapshots',
          event_id: pick.provider_event_id,
          pick_id: pick.pick_id,
          identity_key: null,
          legacy_value: legacy,
          new_value: next,
          severity: 'blocker',
          message: `Pick snapshot mismatch for ${kind}.`,
        });
      } else {
        report.matches += 1;
      }
    }
  }

  return report;
}

function inferClvDirection(submission: number | null, closing: number | null) {
  if (submission === null || closing === null) return null;
  const delta = closing - submission;
  if (Math.abs(delta) <= CLV_TOLERANCE) return 'flat';
  return delta > 0 ? 'positive' : 'negative';
}

export function compareClvParity(entries: ClvComparable[]): ParityAreaReport {
  const report = makeEmptyReport('clv', 'CLV Parity');
  report.checked = entries.length;

  for (const entry of entries) {
    const legacyDirection = inferClvDirection(entry.legacySubmissionValue, entry.legacyClosingValue);
    const newDirection = inferClvDirection(entry.newSubmissionValue, entry.newClosingValue);

    if (legacyDirection === null || newDirection === null) {
      report.mismatches += 1;
      report.status = 'failed';
      report.mismatchesDetail.push({
        category: 'clv',
        event_id: null,
        pick_id: entry.pickId,
        identity_key: null,
        legacy_value: entry,
        new_value: entry,
        severity: 'blocker',
        message: 'One side could not compute CLV inputs while the other parity path expected a value.',
      });
      continue;
    }

    const legacyDelta = (entry.legacyClosingValue ?? 0) - (entry.legacySubmissionValue ?? 0);
    const newDelta = (entry.newClosingValue ?? 0) - (entry.newSubmissionValue ?? 0);

    if (legacyDirection !== newDirection || Math.abs(legacyDelta - newDelta) > CLV_TOLERANCE) {
      report.mismatches += 1;
      report.status = 'failed';
      report.mismatchesDetail.push({
        category: 'clv',
        event_id: null,
        pick_id: entry.pickId,
        identity_key: null,
        legacy_value: {
          submission: entry.legacySubmissionValue,
          closing: entry.legacyClosingValue,
          direction: legacyDirection,
          delta: legacyDelta,
        },
        new_value: {
          submission: entry.newSubmissionValue,
          closing: entry.newClosingValue,
          direction: newDirection,
          delta: newDelta,
        },
        severity: 'blocker',
        message: 'CLV direction or value delta differs.',
      });
      continue;
    }

    report.matches += 1;
  }

  return report;
}

function aggregateOfferCoverage(rows: OfferIdentityRow[]) {
  const identityCount = rows.length;
  const marketCount = new Set(rows.map((row) => `${row.provider_event_id}:${row.provider_market_key}`)).size;
  const participantCount = new Set(rows.map((row) => `${row.provider_event_id}:${row.provider_participant_id ?? ''}`)).size;
  const bookmakerCount = new Set(rows.map((row) => row.bookmaker_key ?? '')).size;
  const bestPriceSignature = new Map<string, { over: number | null; under: number | null }>();

  for (const row of rows) {
    const signatureKey = [
      row.provider_event_id,
      row.provider_market_key,
      row.provider_participant_id ?? '',
      row.bookmaker_key ?? '',
      coerceNullableNumber(row.line) ?? '',
    ].join(':');
    const current = bestPriceSignature.get(signatureKey) ?? { over: null, under: null };
    const next = {
      over:
        current.over === null || (row.over_odds !== null && row.over_odds > current.over)
          ? row.over_odds
          : current.over,
      under:
        current.under === null || (row.under_odds !== null && row.under_odds > current.under)
          ? row.under_odds
          : current.under,
    };
    bestPriceSignature.set(signatureKey, next);
  }

  return {
    identityCount,
    marketCount,
    participantCount,
    bookmakerCount,
    bestPriceSignature,
  };
}

export function compareScannerScoringParity(
  legacyRows: OfferIdentityRow[],
  newRows: OfferIdentityRow[],
): ParityAreaReport {
  const report = makeEmptyReport('scannerScoring', 'Scanner / Scoring Input Parity');
  report.checked = 1;

  const legacy = aggregateOfferCoverage(legacyRows);
  const next = aggregateOfferCoverage(newRows);
  const mismatches: string[] = [];

  if (legacy.identityCount !== next.identityCount) mismatches.push('identity_count');
  if (legacy.marketCount !== next.marketCount) mismatches.push('market_count');
  if (legacy.participantCount !== next.participantCount) mismatches.push('participant_count');
  if (legacy.bookmakerCount !== next.bookmakerCount) mismatches.push('bookmaker_count');
  if (legacy.bestPriceSignature.size !== next.bestPriceSignature.size) mismatches.push('best_price_signature_count');

  for (const [signatureKey, legacyPrice] of legacy.bestPriceSignature.entries()) {
    const nextPrice = next.bestPriceSignature.get(signatureKey) ?? null;
    if (!nextPrice) {
      mismatches.push(`best_price_missing:${signatureKey}`);
      continue;
    }
    if (!comparePrimitive(legacyPrice.over, nextPrice.over) || !comparePrimitive(legacyPrice.under, nextPrice.under)) {
      mismatches.push(`best_price_mismatch:${signatureKey}`);
    }
  }

  if (mismatches.length > 0) {
    report.mismatches = mismatches.length;
    report.status = 'failed';
    report.mismatchesDetail.push({
      category: 'scannerScoring',
      event_id: null,
      pick_id: null,
      identity_key: null,
      legacy_value: legacy,
      new_value: next,
      severity: 'blocker',
      message: `Scanner/scoring coverage mismatch: ${mismatches.join(', ')}`,
    });
  } else {
    report.matches = 1;
  }

  return report;
}

export function compareCommandCenterParity(
  currentParity: ParityAreaReport,
  openingParity: ParityAreaReport,
  closingParity: ParityAreaReport,
): ParityAreaReport {
  const report = makeEmptyReport('commandCenter', 'Command Center Read Parity');
  report.checked = currentParity.checked;

  if (currentParity.status === 'blocked') {
    return markBlocked(report, 'Current-offer parity is blocked, so Command Center latest-offer parity cannot be proven.');
  }
  if (openingParity.status === 'blocked' || closingParity.status === 'blocked') {
    return markBlocked(report, 'Opening/closing history parity is blocked, so Command Center historical offer context cannot be proven.');
  }

  if (currentParity.mismatchesDetail.length > 0 || openingParity.mismatchesDetail.length > 0 || closingParity.mismatchesDetail.length > 0) {
    report.status = 'failed';
    report.mismatches =
      currentParity.mismatchesDetail.length +
      openingParity.mismatchesDetail.length +
      closingParity.mismatchesDetail.length;
    report.mismatchesDetail = [
      ...currentParity.mismatchesDetail,
      ...openingParity.mismatchesDetail,
      ...closingParity.mismatchesDetail,
    ].map((mismatch) => ({
      ...mismatch,
      category: 'commandCenter',
    }));
    return report;
  }

  report.matches = report.checked;
  return report;
}

export function compareFeatureParity(
  entries: FeatureComparable[] | null,
  blockedReason = 'Feature-generation parity adapter is not wired. Missing provider-offer feature entry point.',
): ParityAreaReport {
  const report = makeEmptyReport('modelFeatures', 'Model Feature Parity');
  if (entries === null) {
    return markBlocked(report, blockedReason);
  }

  report.checked = entries.length;
  for (const entry of entries) {
    if (!comparePrimitive(entry.legacyValue as string | number | null, entry.newValue as string | number | null)) {
      report.mismatches += 1;
      report.status = 'failed';
      report.mismatchesDetail.push({
        category: 'modelFeatures',
        event_id: null,
        pick_id: entry.subjectId,
        identity_key: entry.featureName,
        legacy_value: entry.legacyValue,
        new_value: entry.newValue,
        severity: 'blocker',
        message: `Feature mismatch for ${entry.featureName}.`,
      });
    } else {
      report.matches += 1;
    }
  }
  return report;
}

export function buildHarnessOutput(
  inputs: HarnessInputs,
  reports: Record<ParityAreaKey, ParityAreaReport>,
  failOnMismatch: boolean,
): HarnessOutput {
  const mismatchDetails = Object.values(reports).flatMap((report) => report.mismatchesDetail);
  const hasBlocker = mismatchDetails.some((detail) => detail.severity === 'blocker');
  const hasBlocked = Object.values(reports).some((report) => report.status === 'blocked');
  const verdict: ParityVerdict = hasBlocker
    ? 'PARITY FAILED'
    : hasBlocked
      ? 'PARITY BLOCKED'
      : 'PARITY PASSED';
  const exitCode = verdict === 'PARITY PASSED'
    ? 0
    : verdict === 'PARITY FAILED'
      ? (failOnMismatch ? 1 : 0)
      : 2;

  return {
    inputs,
    reports,
    mismatchDetails,
    verdict,
    exitCode,
  };
}

function renderHumanSummary(output: HarnessOutput) {
  const lines: string[] = [];
  lines.push('Provider Offer Parity Harness');
  lines.push('');
  lines.push('Inputs');
  lines.push(`provider: ${output.inputs.provider}`);
  lines.push(`window_hours: ${output.inputs.windowHours}`);
  lines.push(`events_sampled: ${output.inputs.sampledEventIds.length}`);
  lines.push(`picks_sampled: ${output.inputs.sampledPickIds.length}`);
  lines.push('');

  for (const key of [
    'current',
    'opening',
    'closing',
    'pickSnapshots',
    'clv',
    'scannerScoring',
    'commandCenter',
    'modelFeatures',
  ] satisfies ParityAreaKey[]) {
    const report = output.reports[key];
    lines.push(report.title);
    lines.push(
      `status=${report.status} checked=${report.checked} matches=${report.matches} mismatches=${report.mismatches} missing_legacy=${report.missingLegacy} missing_new=${report.missingNew}`,
    );
    if (report.blockedReason) {
      lines.push(`blocked_reason=${report.blockedReason}`);
    }
    if (report.mismatchesDetail.length > 0) {
      const sample = report.mismatchesDetail.slice(0, 3);
      for (const mismatch of sample) {
        lines.push(
          `mismatch severity=${mismatch.severity} event=${mismatch.event_id ?? '-'} pick=${mismatch.pick_id ?? '-'} identity=${mismatch.identity_key ?? '-'} message=${mismatch.message}`,
        );
      }
      if (report.mismatchesDetail.length > sample.length) {
        lines.push(`... ${report.mismatchesDetail.length - sample.length} more mismatch(es)`);
      }
    }
    lines.push('');
  }

  lines.push(`Final verdict: ${output.verdict}`);
  return lines.join('\n');
}

async function loadTablePresence() {
  const [row] = await runSqlQuery<TablePresenceRow>(`
    select
      to_regclass('public.provider_offer_history_compact') is not null as provider_offer_history_compact_exists,
      to_regclass('public.pick_offer_snapshots') is not null as pick_offer_snapshots_exists
  `);
  return {
    providerOfferHistoryCompactExists: row?.provider_offer_history_compact_exists === true,
    pickOfferSnapshotsExists: row?.pick_offer_snapshots_exists === true,
  };
}

async function loadSampleEventIds(provider: string, windowHours: number, sampleSize: number) {
  const rows = await runSqlQuery<SampleEventRow>(`
    with unresolved_events as (
      select distinct
        coalesce(
          nullif(p.metadata->>'providerEventId', ''),
          event_by_id.external_id,
          event_by_external.external_id,
          event_by_name.external_id
        ) as provider_event_id
      from public.picks p
      left join public.events event_by_id
        on event_by_id.id::text = nullif(p.metadata->>'eventId', '')
      left join public.events event_by_external
        on event_by_external.external_id = nullif(p.metadata->>'eventId', '')
      left join public.events event_by_name
        on event_by_name.event_name = nullif(p.metadata->>'eventName', '')
      where p.status not in ('settled', 'voided')
    ),
    settled_clv_events as (
      select distinct
        coalesce(
          nullif(p.metadata->>'providerEventId', ''),
          event_by_id.external_id,
          event_by_external.external_id,
          event_by_name.external_id
        ) as provider_event_id
      from public.picks p
      join public.settlement_records sr on sr.pick_id = p.id
      left join public.events event_by_id
        on event_by_id.id::text = nullif(p.metadata->>'eventId', '')
      left join public.events event_by_external
        on event_by_external.external_id = nullif(p.metadata->>'eventId', '')
      left join public.events event_by_name
        on event_by_name.event_name = nullif(p.metadata->>'eventName', '')
      where sr.payload ? 'clvRaw'
      order by provider_event_id
      limit ${Math.max(sampleSize * 2, 20)}
    ),
    recent_current as (
      select distinct on (current_offer.provider_event_id)
        current_offer.provider_event_id,
        current_offer.snapshot_at
      from public.provider_offer_current current_offer
      where current_offer.provider_key = ${sqlString(provider)}
        and current_offer.snapshot_at >= timezone('utc', now()) - interval '${windowHours} hours'
      order by current_offer.provider_event_id, current_offer.snapshot_at desc
    )
    select distinct provider_event_id
    from (
      select provider_event_id, 1 as priority from unresolved_events
      union all
      select provider_event_id, 2 as priority from settled_clv_events
      union all
      select provider_event_id, 3 as priority from recent_current
    ) combined
    where provider_event_id is not null
    order by priority asc, provider_event_id asc
    limit ${Math.max(sampleSize, DEFAULT_EVENT_SAMPLE_SIZE)}
  `);
  return rows.map((row) => row.provider_event_id).filter(Boolean);
}

async function loadSamplePickRows(
  explicitPickIds: string[],
  eventIds: string[],
  sampleSize: number,
) {
  const pickFilter = explicitPickIds.length > 0
    ? `p.id in (${sqlStringArray(explicitPickIds)})`
    : `coalesce(
      nullif(p.metadata->>'providerEventId', ''),
      event_by_id.external_id,
      event_by_external.external_id,
      event_by_name.external_id
    ) in (${sqlStringArray(eventIds)})`;

  return runSqlQuery<PickRow>(`
    select distinct
      p.id as pick_id,
      p.status,
      p.source,
      p.created_at,
      p.posted_at,
      p.settled_at,
      p.market,
      p.market_type_id,
      p.selection,
      p.odds,
      coalesce(
        nullif(p.metadata->>'providerEventId', ''),
        event_by_id.external_id,
        event_by_external.external_id,
        event_by_name.external_id
      ) as provider_event_id,
      coalesce(
        nullif(p.metadata->>'providerMarketKey', ''),
        p.market_type_id,
        p.market
      ) as provider_market_key,
      coalesce(
        nullif(p.metadata->>'participantId', ''),
        nullif(p.metadata->>'playerId', '')
      ) as provider_participant_id,
      nullif(p.metadata->>'bookmakerKey', '') as bookmaker_key,
      event_by_id.metadata->>'starts_at' as event_start_time,
      exists (
        select 1
        from public.pick_reviews review
        where review.pick_id = p.id
          and review.decision = 'approve'
      ) as has_approval_review,
      (
        select max(review.decided_at)
        from public.pick_reviews review
        where review.pick_id = p.id
          and review.decision = 'approve'
      ) as approval_reviewed_at
    from public.picks p
    left join public.events event_by_id
      on event_by_id.id::text = nullif(p.metadata->>'eventId', '')
    left join public.events event_by_external
      on event_by_external.external_id = nullif(p.metadata->>'eventId', '')
    left join public.events event_by_name
      on event_by_name.event_name = nullif(p.metadata->>'eventName', '')
    where ${pickFilter}
      and p.status in ('posted', 'settled')
    order by p.created_at desc
    limit ${Math.max(sampleSize, DEFAULT_PICK_SAMPLE_SIZE)}
  `);
}

async function loadLegacyLatestRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      concat_ws(
        ':',
        latest_offer.provider_key,
        latest_offer.provider_event_id,
        latest_offer.provider_market_key,
        coalesce(latest_offer.provider_participant_id, ''),
        coalesce(latest_offer.bookmaker_key, '')
      ) as identity_key,
      latest_offer.provider_key,
      latest_offer.provider_event_id,
      latest_offer.provider_market_key,
      latest_offer.provider_participant_id,
      latest_offer.bookmaker_key,
      latest_offer.sport_key,
      latest_offer.line,
      latest_offer.over_odds,
      latest_offer.under_odds,
      latest_offer.devig_mode,
      latest_offer.snapshot_at,
      latest_offer.is_opening,
      latest_offer.is_closing
    from (
      select distinct on (
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, '')
      ) *
      from public.provider_offers
      where provider_key = ${sqlString(provider)}
        and provider_event_id in (${sqlStringArray(eventIds)})
      order by
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, ''),
        snapshot_at desc,
        created_at desc,
        id desc
    ) latest_offer
  `);
}

async function loadCurrentRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      snapshot_at,
      is_opening,
      is_closing
    from public.provider_offer_current
    where provider_key = ${sqlString(provider)}
      and provider_event_id in (${sqlStringArray(eventIds)})
  `);
}

async function loadLegacyOpeningRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      concat_ws(
        ':',
        opening_offer.provider_key,
        opening_offer.provider_event_id,
        opening_offer.provider_market_key,
        coalesce(opening_offer.provider_participant_id, ''),
        coalesce(opening_offer.bookmaker_key, '')
      ) as identity_key,
      opening_offer.provider_key,
      opening_offer.provider_event_id,
      opening_offer.provider_market_key,
      opening_offer.provider_participant_id,
      opening_offer.bookmaker_key,
      opening_offer.sport_key,
      opening_offer.line,
      opening_offer.over_odds,
      opening_offer.under_odds,
      opening_offer.devig_mode,
      opening_offer.snapshot_at,
      opening_offer.is_opening,
      opening_offer.is_closing
    from (
      select distinct on (
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, '')
      ) *
      from public.provider_offers
      where provider_key = ${sqlString(provider)}
        and provider_event_id in (${sqlStringArray(eventIds)})
        and is_opening = true
      order by
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, ''),
        snapshot_at asc,
        created_at asc,
        id asc
    ) opening_offer
  `);
}

async function loadLegacyClosingRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      concat_ws(
        ':',
        closing_offer.provider_key,
        closing_offer.provider_event_id,
        closing_offer.provider_market_key,
        coalesce(closing_offer.provider_participant_id, ''),
        coalesce(closing_offer.bookmaker_key, '')
      ) as identity_key,
      closing_offer.provider_key,
      closing_offer.provider_event_id,
      closing_offer.provider_market_key,
      closing_offer.provider_participant_id,
      closing_offer.bookmaker_key,
      closing_offer.sport_key,
      closing_offer.line,
      closing_offer.over_odds,
      closing_offer.under_odds,
      closing_offer.devig_mode,
      closing_offer.snapshot_at,
      closing_offer.is_opening,
      closing_offer.is_closing
    from (
      select distinct on (
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, '')
      ) *
      from public.provider_offers
      where provider_key = ${sqlString(provider)}
        and provider_event_id in (${sqlStringArray(eventIds)})
        and is_closing = true
      order by
        provider_key,
        provider_event_id,
        provider_market_key,
        coalesce(provider_participant_id, ''),
        coalesce(bookmaker_key, ''),
        snapshot_at desc,
        created_at desc,
        id desc
    ) closing_offer
  `);
}

async function loadCompactOpeningRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      snapshot_at,
      is_opening,
      is_closing,
      change_reason
    from (
      select distinct on (
        identity_key
      ) *
      from public.provider_offer_history_compact
      where provider_key = ${sqlString(provider)}
        and provider_event_id in (${sqlStringArray(eventIds)})
        and (is_opening = true or change_reason = 'opening_capture')
      order by identity_key, snapshot_at asc, observed_at asc
    ) compact_opening
  `);
}

async function loadCompactClosingRows(eventIds: string[], provider: string) {
  return runSqlQuery<QueryRow>(`
    select
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      snapshot_at,
      is_opening,
      is_closing,
      change_reason
    from (
      select distinct on (
        identity_key
      ) *
      from public.provider_offer_history_compact
      where provider_key = ${sqlString(provider)}
        and provider_event_id in (${sqlStringArray(eventIds)})
        and (is_closing = true or change_reason = 'closing_capture')
      order by identity_key, snapshot_at desc, observed_at desc
    ) compact_closing
  `);
}

async function loadPickSnapshots(pickIds: string[]) {
  return runSqlQuery<QueryRow>(`
    select
      pick_id,
      snapshot_kind,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      line,
      over_odds,
      under_odds,
      source_snapshot_at,
      captured_at
    from public.pick_offer_snapshots
    where pick_id in (${sqlStringArray(pickIds)})
  `);
}

function buildPickValueRows(picks: PickRow[]) {
  return picks
    .filter((pick) => pick.provider_event_id && pick.provider_market_key)
    .map(
      (pick) => `(
        ${sqlString(pick.pick_id)},
        ${sqlString(pick.created_at)},
        ${pick.posted_at ? sqlString(pick.posted_at) : 'null'},
        ${pick.settled_at ? sqlString(pick.settled_at) : 'null'},
        ${pick.provider_event_id ? sqlString(pick.provider_event_id) : 'null'},
        ${pick.provider_market_key ? sqlString(pick.provider_market_key) : 'null'},
        ${pick.provider_participant_id ? sqlString(pick.provider_participant_id) : 'null'},
        ${pick.bookmaker_key ? sqlString(pick.bookmaker_key) : 'null'},
        ${pick.has_approval_review === true ? 'true' : 'false'},
        ${pick.approval_reviewed_at ? sqlString(pick.approval_reviewed_at) : 'null'}
      )`,
    )
    .join(',\n');
}

async function loadLegacyPickSnapshots(picks: PickRow[], provider: string) {
  const valuesClause = buildPickValueRows(picks);
  if (!valuesClause) {
    return [] as QueryRow[];
  }

  return runSqlQuery<QueryRow>(`
    with pick_targets (
      pick_id,
      created_at,
      posted_at,
      settled_at,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      has_approval_review,
      approval_reviewed_at
    ) as (
      values
      ${valuesClause}
    ),
    submission_snapshots as (
      select
        target.pick_id,
        'submission'::text as snapshot_kind,
        matched.provider_event_id,
        matched.provider_market_key,
        matched.provider_participant_id,
        matched.bookmaker_key,
        matched.line,
        matched.over_odds,
        matched.under_odds,
        matched.snapshot_at as source_snapshot_at,
        target.created_at as captured_at
      from pick_targets target
      left join lateral (
        select po.*
        from public.provider_offers po
        where po.provider_key = ${sqlString(provider)}
          and po.provider_event_id = target.provider_event_id
          and po.provider_market_key = target.provider_market_key
          and coalesce(po.provider_participant_id, '') = coalesce(target.provider_participant_id, '')
          and coalesce(po.bookmaker_key, '') = coalesce(target.bookmaker_key, '')
        order by
          abs(extract(epoch from (po.snapshot_at - target.created_at::timestamptz))) asc,
          po.snapshot_at desc,
          po.created_at desc,
          po.id desc
        limit 1
      ) matched on true
    ),
    approval_snapshots as (
      select
        target.pick_id,
        'approval'::text as snapshot_kind,
        matched.provider_event_id,
        matched.provider_market_key,
        matched.provider_participant_id,
        matched.bookmaker_key,
        matched.line,
        matched.over_odds,
        matched.under_odds,
        matched.snapshot_at as source_snapshot_at,
        target.approval_reviewed_at as captured_at
      from pick_targets target
      left join lateral (
        select po.*
        from public.provider_offers po
        where po.provider_key = ${sqlString(provider)}
          and po.provider_event_id = target.provider_event_id
          and po.provider_market_key = target.provider_market_key
          and coalesce(po.provider_participant_id, '') = coalesce(target.provider_participant_id, '')
          and coalesce(po.bookmaker_key, '') = coalesce(target.bookmaker_key, '')
        order by
          abs(extract(epoch from (po.snapshot_at - coalesce(target.posted_at, target.created_at)::timestamptz))) asc,
          po.snapshot_at desc,
          po.created_at desc,
          po.id desc
        limit 1
      ) matched on target.has_approval_review = true
    ),
    posting_snapshots as (
      select
        target.pick_id,
        'posting'::text as snapshot_kind,
        matched.provider_event_id,
        matched.provider_market_key,
        matched.provider_participant_id,
        matched.bookmaker_key,
        matched.line,
        matched.over_odds,
        matched.under_odds,
        matched.snapshot_at as source_snapshot_at,
        target.posted_at as captured_at
      from pick_targets target
      left join lateral (
        select po.*
        from public.provider_offers po
        where po.provider_key = ${sqlString(provider)}
          and po.provider_event_id = target.provider_event_id
          and po.provider_market_key = target.provider_market_key
          and coalesce(po.provider_participant_id, '') = coalesce(target.provider_participant_id, '')
          and coalesce(po.bookmaker_key, '') = coalesce(target.bookmaker_key, '')
        order by
          abs(extract(epoch from (po.snapshot_at - target.posted_at::timestamptz))) asc,
          po.snapshot_at desc,
          po.created_at desc,
          po.id desc
        limit 1
      ) matched on target.posted_at is not null
    ),
    closing_snapshots as (
      select
        target.pick_id,
        'closing_for_clv'::text as snapshot_kind,
        matched.provider_event_id,
        matched.provider_market_key,
        matched.provider_participant_id,
        matched.bookmaker_key,
        matched.line,
        matched.over_odds,
        matched.under_odds,
        matched.snapshot_at as source_snapshot_at,
        target.settled_at as captured_at
      from pick_targets target
      left join lateral (
        select po.*
        from public.provider_offers po
        where po.provider_key = ${sqlString(provider)}
          and po.provider_event_id = target.provider_event_id
          and po.provider_market_key = target.provider_market_key
          and coalesce(po.provider_participant_id, '') = coalesce(target.provider_participant_id, '')
          and coalesce(po.bookmaker_key, '') = coalesce(target.bookmaker_key, '')
          and po.is_closing = true
        order by
          po.snapshot_at desc,
          po.created_at desc,
          po.id desc
        limit 1
      ) matched on target.settled_at is not null
    ),
    settlement_snapshots as (
      select
        target.pick_id,
        'settlement_proof'::text as snapshot_kind,
        matched.provider_event_id,
        matched.provider_market_key,
        matched.provider_participant_id,
        matched.bookmaker_key,
        matched.line,
        matched.over_odds,
        matched.under_odds,
        matched.snapshot_at as source_snapshot_at,
        target.settled_at as captured_at
      from pick_targets target
      left join lateral (
        select po.*
        from public.provider_offers po
        where po.provider_key = ${sqlString(provider)}
          and po.provider_event_id = target.provider_event_id
          and po.provider_market_key = target.provider_market_key
          and coalesce(po.provider_participant_id, '') = coalesce(target.provider_participant_id, '')
          and coalesce(po.bookmaker_key, '') = coalesce(target.bookmaker_key, '')
          and po.is_closing = true
        order by
          po.snapshot_at desc,
          po.created_at desc,
          po.id desc
        limit 1
      ) matched on target.settled_at is not null
    )
    select * from submission_snapshots
    union all
    select * from approval_snapshots
    union all
    select * from posting_snapshots
    union all
    select * from closing_snapshots
    union all
    select * from settlement_snapshots
  `);
}

function normalizeSnapshotRow(row: QueryRow): PickSnapshotComparable {
  return {
    pickId: String(row['pick_id'] ?? ''),
    snapshotKind: String(row['snapshot_kind'] ?? ''),
    providerEventId: coerceNullableString(row['provider_event_id']),
    providerMarketKey: coerceNullableString(row['provider_market_key']),
    providerParticipantId: coerceNullableString(row['provider_participant_id']),
    bookmakerKey: coerceNullableString(row['bookmaker_key']),
    line: row['line'] ?? null,
    overOdds: coerceNullableNumber(row['over_odds']),
    underOdds: coerceNullableNumber(row['under_odds']),
    sourceSnapshotAt: coerceNullableString(row['source_snapshot_at']),
    capturedAt: coerceNullableString(row['captured_at']),
  };
}

function buildClvComparables(
  picks: PickRow[],
  legacySnapshots: PickSnapshotComparable[],
  newSnapshots: PickSnapshotComparable[],
): ClvComparable[] {
  const legacyMap = new Map(legacySnapshots.map((row) => [`${row.pickId}:${row.snapshotKind}`, row]));
  const newMap = new Map(newSnapshots.map((row) => [`${row.pickId}:${row.snapshotKind}`, row]));
  const clvRows: ClvComparable[] = [];

  for (const pick of picks) {
    const legacySubmission = legacyMap.get(`${pick.pick_id}:submission`) ?? null;
    const legacyClosing = legacyMap.get(`${pick.pick_id}:closing_for_clv`) ?? null;
    const newSubmission = newMap.get(`${pick.pick_id}:submission`) ?? null;
    const newClosing = newMap.get(`${pick.pick_id}:closing_for_clv`) ?? null;
    if (!legacySubmission && !newSubmission && !legacyClosing && !newClosing) {
      continue;
    }
    clvRows.push({
      pickId: pick.pick_id,
      legacySubmissionValue: coerceNullableNumber(legacySubmission?.line),
      legacyClosingValue: coerceNullableNumber(legacyClosing?.line),
      newSubmissionValue: coerceNullableNumber(newSubmission?.line),
      newClosingValue: coerceNullableNumber(newClosing?.line),
    });
  }

  return clvRows;
}

export async function runProviderOfferParityHarness(options: CliOptions): Promise<HarnessOutput> {
  const tablePresence = await loadTablePresence();
  let eventIds = [...options.eventIds];
  if (eventIds.length === 0) {
    eventIds = await loadSampleEventIds(options.provider, options.windowHours, options.sampleSize);
  }

  const pickRows = await loadSamplePickRows(options.pickIds, eventIds, DEFAULT_PICK_SAMPLE_SIZE);
  const settledPickRows = pickRows.filter((pick) => pick.status === 'settled' && pick.settled_at);
  if (eventIds.length === 0) {
    eventIds = [...new Set(pickRows.map((pick) => pick.provider_event_id).filter((value): value is string => Boolean(value)))];
  }

  const legacyLatestRows = (await loadLegacyLatestRows(eventIds, options.provider)).map(normalizeOfferRow);
  const currentRows = (await loadCurrentRows(eventIds, options.provider)).map(normalizeOfferRow);
  const legacyOpeningRows = (await loadLegacyOpeningRows(eventIds, options.provider)).map(normalizeOfferRow);
  const legacyClosingRows = (await loadLegacyClosingRows(eventIds, options.provider)).map(normalizeOfferRow);

  const currentParity = compareOfferParity(
    'current',
    'Hot Current Offer Parity',
    legacyLatestRows,
    currentRows,
    { freshnessToleranceSeconds: DEFAULT_FRESHNESS_TOLERANCE_SECONDS },
  );

  let openingParity: ParityAreaReport;
  let closingParity: ParityAreaReport;
  if (!tablePresence.providerOfferHistoryCompactExists) {
    openingParity = markBlocked(
      makeEmptyReport('opening', 'Opening Line Parity'),
      'provider_offer_history_compact does not exist.',
    );
    closingParity = markBlocked(
      makeEmptyReport('closing', 'Closing Line Parity'),
      'provider_offer_history_compact does not exist.',
    );
  } else {
    const compactOpeningRows = (await loadCompactOpeningRows(eventIds, options.provider)).map(normalizeOfferRow);
    const compactClosingRows = (await loadCompactClosingRows(eventIds, options.provider)).map(normalizeOfferRow);
    openingParity = compareOfferParity('opening', 'Opening Line Parity', legacyOpeningRows, compactOpeningRows);
    closingParity = compareOfferParity('closing', 'Closing Line Parity', legacyClosingRows, compactClosingRows);
  }

  let pickSnapshotParity: ParityAreaReport;
  let clvParity: ParityAreaReport;
  if (!tablePresence.pickOfferSnapshotsExists) {
    pickSnapshotParity = markBlocked(
      makeEmptyReport('pickSnapshots', 'Pick Snapshot Parity'),
      'pick_offer_snapshots does not exist.',
    );
    clvParity = markBlocked(
      makeEmptyReport('clv', 'CLV Parity'),
      'pick_offer_snapshots does not exist, so new CLV snapshot reconstruction is unavailable.',
    );
  } else if (pickRows.length === 0) {
    pickSnapshotParity = markBlocked(
      makeEmptyReport('pickSnapshots', 'Pick Snapshot Parity'),
      'No posted or settled picks matched the requested sample.',
    );
    clvParity = markBlocked(
      makeEmptyReport('clv', 'CLV Parity'),
      'No settled picks matched the requested sample.',
    );
  } else {
    const newSnapshots = (await loadPickSnapshots(pickRows.map((pick) => pick.pick_id))).map(normalizeSnapshotRow);
    const legacySnapshots = (await loadLegacyPickSnapshots(pickRows, options.provider)).map(normalizeSnapshotRow);
    pickSnapshotParity = comparePickSnapshotParity(pickRows, legacySnapshots, newSnapshots);
    clvParity = settledPickRows.length === 0
      ? markBlocked(
          makeEmptyReport('clv', 'CLV Parity'),
          'No settled picks matched the requested sample.',
        )
      : compareClvParity(buildClvComparables(settledPickRows, legacySnapshots, newSnapshots));
  }

  const scannerScoringParity = compareScannerScoringParity(legacyLatestRows, currentRows);
  const commandCenterParity = compareCommandCenterParity(currentParity, openingParity, closingParity);
  const modelFeatureParity = compareFeatureParity(
    null,
    'Model feature parity blocked: no provider-offer feature generation entry point is exposed to the harness yet.',
  );

  return buildHarnessOutput(
    {
      provider: options.provider,
      windowHours: options.windowHours,
      sampledEventIds: eventIds,
      sampledPickIds: pickRows.map((pick) => pick.pick_id),
    },
    {
      current: currentParity,
      opening: openingParity,
      closing: closingParity,
      pickSnapshots: pickSnapshotParity,
      clv: clvParity,
      scannerScoring: scannerScoringParity,
      commandCenter: commandCenterParity,
      modelFeatures: modelFeatureParity,
    },
    options.failOnMismatch,
  );
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  try {
    const output = await runProviderOfferParityHarness(options);
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(renderHumanSummary(output));
    }
    process.exitCode = output.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blockedReport = buildHarnessOutput(
      {
        provider: options.provider,
        windowHours: options.windowHours,
        sampledEventIds: options.eventIds,
        sampledPickIds: options.pickIds,
      },
      {
        current: markBlocked(makeEmptyReport('current', 'Hot Current Offer Parity'), message),
        opening: markBlocked(makeEmptyReport('opening', 'Opening Line Parity'), message),
        closing: markBlocked(makeEmptyReport('closing', 'Closing Line Parity'), message),
        pickSnapshots: markBlocked(makeEmptyReport('pickSnapshots', 'Pick Snapshot Parity'), message),
        clv: markBlocked(makeEmptyReport('clv', 'CLV Parity'), message),
        scannerScoring: markBlocked(makeEmptyReport('scannerScoring', 'Scanner / Scoring Input Parity'), message),
        commandCenter: markBlocked(makeEmptyReport('commandCenter', 'Command Center Read Parity'), message),
        modelFeatures: markBlocked(makeEmptyReport('modelFeatures', 'Model Feature Parity'), message),
      },
      options.failOnMismatch,
    );
    if (options.json) {
      console.log(JSON.stringify(blockedReport, null, 2));
    } else {
      console.log(renderHumanSummary(blockedReport));
    }
    process.exitCode = blockedReport.exitCode;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
