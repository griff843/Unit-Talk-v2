import { getDataClient } from './client.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type JsonObject = Record<string, unknown>;

const ENRICHMENT_BATCH_SIZE = 100;

function readJsonObject(value: unknown): JsonObject | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch { return null; }
  }
  return null;
}

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function collectUniqueStringValues(rows: Array<JsonObject>, key: string) {
  return [...new Set(rows.map((row) => row[key]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0))];
}

function readEventId(metadata: JsonObject | null, submissionPayload: JsonObject | null) {
  const submissionMetadata = readJsonObject(submissionPayload?.['metadata']);
  return readTrimmedString(metadata?.['eventId'], submissionPayload?.['eventId'], submissionMetadata?.['eventId']);
}

function mergeMetadata(metadata: JsonObject | null, patch: Record<string, string | null>): JsonObject {
  const next: JsonObject = { ...(metadata ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) next[key] = value;
  }
  return next;
}

function chunkValues(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function enrichPickRowsWithIdentity(client: Client, rows: Array<JsonObject>): Promise<Array<JsonObject>> {
  if (rows.length === 0) return rows;

  const submissionIds = collectUniqueStringValues(rows, 'submission_id');
  const participantIds = collectUniqueStringValues(rows, 'participant_id');

  const submissionMap = new Map<string, { id: string; submitted_by: string | null; payload: JsonObject | null }>();
  for (const batch of chunkValues(submissionIds, ENRICHMENT_BATCH_SIZE)) {
    const result = await client.from('submissions').select('id, submitted_by, payload').in('id', batch);
    for (const row of ((result.data ?? []) as Array<JsonObject>)) {
      const id = readTrimmedString(row['id']);
      if (id) submissionMap.set(id, { id, submitted_by: readTrimmedString(row['submitted_by']), payload: readJsonObject(row['payload']) });
    }
  }

  const participantMap = new Map<string, { id: string; display_name: string | null; participant_type: string | null }>();
  for (const batch of chunkValues(participantIds, ENRICHMENT_BATCH_SIZE)) {
    const result = await client.from('participants').select('id, display_name, participant_type').in('id', batch);
    for (const row of ((result.data ?? []) as Array<JsonObject>)) {
      const id = readTrimmedString(row['id']);
      if (id) participantMap.set(id, { id, display_name: readTrimmedString(row['display_name']), participant_type: readTrimmedString(row['participant_type']) });
    }
  }

  const eventIds = [...new Set(rows.map((row) => {
    const metadata = readJsonObject(row['metadata']);
    const submissionId = readTrimmedString(row['submission_id']);
    const submissionPayload = submissionId ? submissionMap.get(submissionId)?.payload ?? null : null;
    return readEventId(metadata, submissionPayload);
  }).filter((v): v is string => v !== null))];

  const eventMap = new Map<string, { id: string; event_name: string | null; event_date: string | null }>();
  for (const batch of chunkValues(eventIds, ENRICHMENT_BATCH_SIZE)) {
    const result = await client.from('events').select('id, event_name, event_date').in('id', batch);
    for (const row of ((result.data ?? []) as Array<JsonObject>)) {
      const id = readTrimmedString(row['id']);
      if (id) eventMap.set(id, { id, event_name: readTrimmedString(row['event_name']), event_date: readTrimmedString(row['event_date']) });
    }
  }

  return rows.map((row) => {
    const metadata = readJsonObject(row['metadata']);
    const submissionId = readTrimmedString(row['submission_id']);
    const participantId = readTrimmedString(row['participant_id']);
    const submission = submissionId ? submissionMap.get(submissionId) ?? null : null;
    const submissionPayload = submission?.payload ?? null;
    const submissionMetadata = readJsonObject(submissionPayload?.['metadata']);
    const participant = participantId ? participantMap.get(participantId) ?? null : null;
    const eventId = readEventId(metadata, submissionPayload);
    const event = eventId ? eventMap.get(eventId) ?? null : null;

    const eventName = readTrimmedString(metadata?.['eventName'], submissionPayload?.['eventName'], submissionMetadata?.['eventName'], event?.event_name);
    const eventStartTime = readTrimmedString(metadata?.['eventTime'], metadata?.['eventStartTime'], submissionPayload?.['eventTime'], submissionPayload?.['eventStartTime'], submissionMetadata?.['eventTime'], submissionMetadata?.['eventStartTime'], event?.event_date);
    const submittedBy = readTrimmedString(row['submitted_by'], submission?.submitted_by, metadata?.['capper'], metadata?.['submittedBy'], submissionPayload?.['submittedBy'], submissionMetadata?.['submittedBy']);
    const sport = readTrimmedString(row['sport_display_name'], row['sport_id'], metadata?.['sport'], submissionPayload?.['sport'], submissionMetadata?.['sport'], submissionMetadata?.['league']);
    const existingPlayer = readTrimmedString(metadata?.['player'], submissionPayload?.['player'], submissionMetadata?.['player']);
    const existingTeam = readTrimmedString(metadata?.['team'], submissionPayload?.['team'], submissionMetadata?.['team']);
    const player = participant?.participant_type === 'player' ? readTrimmedString(existingPlayer, participant.display_name) : existingPlayer;
    const team = participant?.participant_type === 'team' ? readTrimmedString(existingTeam, participant.display_name) : existingTeam;

    return {
      ...row,
      metadata: mergeMetadata(metadata, { eventName, eventTime: eventStartTime, eventStartTime, submittedBy, sport, player, team }),
      eventName,
      eventStartTime,
      matchup: eventName,
      submittedBy,
      submitter: readTrimmedString(row['submitter'], submittedBy),
      capper_display_name: readTrimmedString(row['capper_display_name'], submittedBy),
      sport_display_name: readTrimmedString(row['sport_display_name'], sport),
      participant_display_name: participant?.display_name ?? null,
      participant_type: participant?.participant_type ?? null,
    };
  });
}

function isFixtureLikePick(row: JsonObject) {
  const metadata = readJsonObject(row['metadata']);
  return Boolean(typeof metadata?.['proof_fixture_id'] === 'string' || typeof metadata?.['proof_script'] === 'string' || typeof metadata?.['test_key'] === 'string');
}

function splitProviderBookKey(providerKey: string) {
  const [provider, bookKey] = providerKey.includes(':') ? providerKey.split(':', 2) as [string, string] : [providerKey, providerKey];
  return { provider, bookKey };
}

function latestIso(current: string | null, candidate: string | null) {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function compareIsoDesc(left: string | null, right: string | null) {
  return (right ? Date.parse(right) : 0) - (left ? Date.parse(left) : 0);
}

export async function getExceptionQueues(filter?: { includeFixtures?: boolean }): Promise<{ ok: true; data: unknown }> {
  const client: Client = getDataClient();
  const includeFixtures = filter?.includeFixtures ?? false;

  const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const awaitingApprovalStaleMs = 4 * 60 * 60 * 1000;

  const [failedResult, deadLetterResult, manualReviewResult, stalePicksResult, awaitingApprovalResult, rerunCandidatesResult, providerOffersResult, bookAliasesResult, marketAliasesResult] = await Promise.all([
    client.from('distribution_outbox').select('id, pick_id, target, status, attempt_count, last_error, created_at, updated_at').eq('status', 'failed').order('updated_at', { ascending: false }).limit(50),
    client.from('distribution_outbox').select('id, pick_id, target, status, attempt_count, last_error, created_at, updated_at').eq('status', 'dead_letter').order('updated_at', { ascending: false }).limit(50),
    client.from('settlement_records').select('id, pick_id, result, status, review_reason, settled_by, created_at').eq('status', 'manual_review').order('created_at', { ascending: false }).limit(50),
    client.from('picks').select('id, submission_id, participant_id, status, source, market, selection, line, odds, sport_id, metadata, promotion_score, created_at').eq('status', 'validated').lte('created_at', staleThreshold).order('created_at', { ascending: true }).limit(50),
    client.from('picks').select('id, submission_id, participant_id, status, source, market, selection, line, odds, sport_id, metadata, created_at').eq('status', 'awaiting_approval').order('created_at', { ascending: true }).limit(50),
    client.from('picks').select('id, submission_id, participant_id, status, source, market, selection, line, odds, sport_id, metadata, approval_status, promotion_status, promotion_score, promotion_target, created_at').eq('approval_status', 'approved').in('promotion_status', ['not_eligible', 'suppressed']).order('created_at', { ascending: false }).limit(50),
    client.from('provider_offer_current').select('provider_key, provider_market_key, created_at'),
    client.from('provider_book_aliases').select('provider, provider_book_key'),
    client.from('provider_market_aliases').select('provider, provider_market_key, sport_id'),
  ]);

  const failed = (failedResult.data ?? []) as Array<JsonObject>;
  const deadLetter = (deadLetterResult.data ?? []) as Array<JsonObject>;
  const manualReview = (manualReviewResult.data ?? []) as Array<JsonObject>;

  const stale = (await enrichPickRowsWithIdentity(client, (stalePicksResult.data ?? []) as Array<JsonObject>))
    .filter((row) => includeFixtures || !isFixtureLikePick(row));
  const awaitingApproval = (await enrichPickRowsWithIdentity(client, (awaitingApprovalResult.data ?? []) as Array<JsonObject>))
    .filter((row) => includeFixtures || !isFixtureLikePick(row));
  const rerun = (await enrichPickRowsWithIdentity(client, (rerunCandidatesResult.data ?? []) as Array<JsonObject>))
    .filter((row) => includeFixtures || !isFixtureLikePick(row));

  const providerOffers = (providerOffersResult.data ?? []) as Array<JsonObject>;
  const bookAliases = (bookAliasesResult.data ?? []) as Array<JsonObject>;
  const marketAliases = (marketAliasesResult.data ?? []) as Array<JsonObject>;

  // Enrich outbox rows with pick context
  const allOutboxPickIds = [...new Set([...failed, ...deadLetter].map((r) => r['pick_id'] as string))];
  const pickMap = new Map<string, JsonObject>();
  if (allOutboxPickIds.length > 0) {
    const { data: picks } = await client.from('picks').select('id, submission_id, participant_id, market, selection, source, status, line, odds, sport_id, metadata').in('id', allOutboxPickIds);
    const enrichedPicks = (await enrichPickRowsWithIdentity(client, (picks ?? []) as Array<JsonObject>))
      .filter((row) => includeFixtures || !isFixtureLikePick(row));
    for (const p of enrichedPicks) pickMap.set(p['id'] as string, p);
  }

  const enrichOutbox = (rows: Array<JsonObject>) =>
    rows.map((r) => {
      const pick = pickMap.get(r['pick_id'] as string);
      const age = Math.floor((Date.now() - new Date(r['updated_at'] as string).getTime()) / 3600000);
      let pickContext: JsonObject | null = null;
      if (pick) {
        const pm = (pick['metadata'] ?? {}) as JsonObject;
        pickContext = {
          market: pick['market'], selection: pick['selection'], source: pick['source'], status: pick['status'],
          line: pick['line'] ?? null, odds: pick['odds'] ?? null, sportId: pick['sport_id'] ?? null,
          eventName: typeof pm['eventName'] === 'string' ? pm['eventName'] : null,
          eventStartTime: typeof pm['eventTime'] === 'string' ? pm['eventTime'] : typeof pm['eventStartTime'] === 'string' ? pm['eventStartTime'] : null,
        };
      }
      return { ...r, ageHours: age, pick: pickContext };
    });

  const enrichStale = (rows: Array<JsonObject>) =>
    rows.map((r) => {
      const age = Math.floor((Date.now() - new Date(r['created_at'] as string).getTime()) / 3600000);
      const md = (r['metadata'] ?? {}) as JsonObject;
      const eventName = typeof md['eventName'] === 'string' ? md['eventName'] : null;
      const eventStartTime = typeof md['eventTime'] === 'string' ? md['eventTime'] : typeof md['eventStartTime'] === 'string' ? md['eventStartTime'] : null;
      return { ...r, ageHours: age, eventName, eventStartTime };
    });

  // Awaiting approval drift detection
  const awaitingApprovalIds = [...new Set(awaitingApproval.map((row) => row['id']).filter((v): v is string => typeof v === 'string'))];
  const lifecycleByPick = new Map<string, Array<JsonObject>>();
  if (awaitingApprovalIds.length > 0) {
    const { data: lifecycleRows } = await client.from('pick_lifecycle').select('id, pick_id, from_state, to_state, created_at').in('pick_id', awaitingApprovalIds).order('created_at', { ascending: false });
    for (const row of ((lifecycleRows ?? []) as Array<JsonObject>)) {
      const pickId = row['pick_id'];
      if (typeof pickId !== 'string') continue;
      const existing = lifecycleByPick.get(pickId);
      if (existing) { existing.push(row); } else { lifecycleByPick.set(pickId, [row]); }
    }
  }

  const awaitingApprovalDrift = awaitingApproval.map((row) => {
    const pickId = typeof row['id'] === 'string' ? row['id'] : null;
    const lifecycleRows = pickId ? lifecycleByPick.get(pickId) ?? [] : [];
    const latestLifecycle = lifecycleRows[0] ?? null;
    const hasValidatedToAwaiting = lifecycleRows.some((lr) => lr['from_state'] === 'validated' && lr['to_state'] === 'awaiting_approval');
    const createdAt = String(row['created_at'] ?? '');
    const ageHours = Math.floor((Date.now() - new Date(createdAt).getTime()) / 3600000);
    const stale = Date.now() - new Date(createdAt).getTime() >= awaitingApprovalStaleMs;
    const latestLifecycleToState = typeof latestLifecycle?.['to_state'] === 'string' ? latestLifecycle['to_state'] : null;
    const missingLifecycleEvidence = !hasValidatedToAwaiting;
    const lifecycleMismatch = latestLifecycleToState !== 'awaiting_approval';
    const md = (row['metadata'] ?? {}) as JsonObject;
    const eventName = typeof md['eventName'] === 'string' ? md['eventName'] : null;
    const eventStartTime = typeof md['eventTime'] === 'string' ? md['eventTime'] : typeof md['eventStartTime'] === 'string' ? md['eventStartTime'] : null;
    return { ...row, ageHours, stale, eventName, eventStartTime, missingLifecycleEvidence, lifecycleMismatch, hasValidatedToAwaiting, latestLifecycleToState, latestLifecycleAt: typeof latestLifecycle?.['created_at'] === 'string' ? latestLifecycle['created_at'] : null };
  }).filter((row) => row.missingLifecycleEvidence || row.lifecycleMismatch || row.stale);

  // Missing alias detection
  const knownBookAliases = new Set(bookAliases.map((row) => `${String(row['provider'] ?? '')}:${String(row['provider_book_key'] ?? '')}`));
  const knownMarketAliases = new Set(marketAliases.map((row) => `${String(row['provider'] ?? '')}:${String(row['provider_market_key'] ?? '')}:${String(row['sport_id'] ?? '')}`));
  const missingBookAliases = new Map<string, { provider: string; providerBookKey: string; occurrences: number; latestSeenAt: string | null }>();
  const missingMarketAliases = new Map<string, { provider: string; providerMarketKey: string; occurrences: number; latestSeenAt: string | null }>();

  for (const row of providerOffers) {
    const providerKey = String(row['provider_key'] ?? '');
    const providerMarketKey = String(row['provider_market_key'] ?? '');
    const createdAt = typeof row['created_at'] === 'string' ? row['created_at'] : null;
    const { provider, bookKey } = splitProviderBookKey(providerKey);
    const bookLookupKey = `${provider}:${bookKey}`;
    if (provider && bookKey && !knownBookAliases.has(bookLookupKey)) {
      const existing = missingBookAliases.get(bookLookupKey) ?? { provider, providerBookKey: bookKey, occurrences: 0, latestSeenAt: null };
      existing.occurrences += 1;
      existing.latestSeenAt = latestIso(existing.latestSeenAt, createdAt);
      missingBookAliases.set(bookLookupKey, existing);
    }
    const marketLookupKey = `${provider}:${providerMarketKey}:`;
    const hasMarketAlias = Array.from(knownMarketAliases).some((key) => key.startsWith(marketLookupKey));
    if (provider && providerMarketKey && !hasMarketAlias) {
      const existing = missingMarketAliases.get(`${provider}:${providerMarketKey}`) ?? { provider, providerMarketKey, occurrences: 0, latestSeenAt: null };
      existing.occurrences += 1;
      existing.latestSeenAt = latestIso(existing.latestSeenAt, createdAt);
      missingMarketAliases.set(`${provider}:${providerMarketKey}`, existing);
    }
  }

  const missingBookRows = Array.from(missingBookAliases.values()).sort((a, b) => compareIsoDesc(a.latestSeenAt, b.latestSeenAt)).slice(0, 50);
  const missingMarketRows = Array.from(missingMarketAliases.values()).sort((a, b) => compareIsoDesc(a.latestSeenAt, b.latestSeenAt)).slice(0, 50);

  return {
    ok: true,
    data: {
      counts: {
        failedDelivery: failed.length,
        deadLetter: deadLetter.length,
        pendingManualReview: manualReview.length,
        staleValidated: stale.length,
        awaitingApprovalDrift: awaitingApprovalDrift.length,
        awaitingApprovalStale: awaitingApprovalDrift.filter((row) => row.stale).length,
        rerunCandidates: rerun.length,
        missingBookAliases: missingBookRows.length,
        missingMarketAliases: missingMarketRows.length,
      },
      failedDelivery: enrichOutbox(failed),
      deadLetter: enrichOutbox(deadLetter),
      pendingManualReview: manualReview,
      staleValidated: enrichStale(stale),
      awaitingApprovalDrift,
      rerunCandidates: rerun.map((r) => {
        const rm = (r['metadata'] ?? {}) as JsonObject;
        return { ...r, eventName: typeof rm['eventName'] === 'string' ? rm['eventName'] : null, eventStartTime: typeof rm['eventTime'] === 'string' ? rm['eventTime'] : typeof rm['eventStartTime'] === 'string' ? rm['eventStartTime'] : null };
      }),
      missingBookAliases: missingBookRows,
      missingMarketAliases: missingMarketRows,
    },
  };
}
