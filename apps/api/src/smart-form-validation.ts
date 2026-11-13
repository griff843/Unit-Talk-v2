import {
  isHumanCapperDeliveryAuthorized,
  manualPlayerConfirmationRequiredCode,
  manualPlayerMaxCandidates,
  legacyManualPlayerReason,
  manualPlayerProvenance,
  manualPlayerReason,
  resolveSmartFormPlayerPropMarketKey,
  smartFormPlayerPropMarketKeysForSport,
} from '@unit-talk/contracts';
import type {
  CanonicalParticipantIdentity,
  ManualPlayerCandidate,
  ManualPlayerReview,
  SmartFormParticipantResolution,
  SubmissionPayload,
} from '@unit-talk/contracts';
import type { EventBrowseResult, ReferenceDataRepository } from '@unit-talk/db';
import { ApiError } from './errors.js';

const TEAM_SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'WNBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER']);

// UTV2-1842 SMART_FORM_OUTCOME_START
// The event-existence gate in submission-service.ts refuses any human-source pick whose
// eventName matches no row once the events repository is populated. Under containment the
// canonical event catalog is deliberately not being filled, so a Smart Form submission that
// legitimately took a fallback path -- an explicit manual coverage-gap override, or the
// structured team fallback for a team sport with no canonical event -- is refused by a gate
// that is asking a question the fallback has already answered a different way.
//
// This validator is the only place that knows *which* path admitted the submission, and it
// knows it only after the full server-side check for that path has passed. Returning that
// decision lets the gate waive itself for exactly those two outcomes and for nothing else.
// The waiver is therefore gated on server-validated fallback eligibility, never on a bare
// null eventId.
//
// The outcome carries the submission's `distributionMode` because the waiver must not admit
// a pick naming no canonical event into member delivery on the strength of its fallback kind
// alone. An operator or service-role caller reaches this same validator with
// `delivery-eligible` and is *not* pinned by handlers/submit-pick.ts, and a qualified
// delivery-eligible result proceeds to the controller's outbox-enqueue path. The mode travels
// with the outcome rather than being re-read at the gate so the gate cannot disagree with the
// validator about which submission it is looking at.
//
// UTV2-1938 CORRECTION -- this paragraph used to end "the waiver is only authorized for Track
// Only. An authenticated capper is server-pinned to `track-only` by handlers/submit-pick.ts".
// That second sentence stopped being true when UTV2-1923 merged: an ALLOW-LISTED capper is now
// server-pinned to `delivery-eligible` instead, so the Track-Only-only rule silently excluded
// the one caller this whole path exists to serve. The concern above is real and is preserved;
// what changed is that the server's own authorization, not the distribution mode, is what now
// distinguishes the two callers. See `waivesEventExistenceGate`.
export type SmartFormDistributionMode = 'track-only' | 'delivery-eligible';

// UTV2-1938: the outcome also carries whether the SERVER authorized this pick for human
// capper delivery. It is a second, independent fact about the same submission, and it is
// read from the same place -- and by the same predicate -- that the delivery path itself
// reads it: `isHumanCapperDeliveryAuthorized`. See `waivesEventExistenceGate` below for why
// this exists at all; see `validateSmartFormRelationships` for why reading it from metadata
// is not a client-trust hole.
export type SmartFormValidationOutcome =
  | { kind: 'not-smart-form' }
  | {
      kind: 'manual-coverage-gap';
      distributionMode: SmartFormDistributionMode;
      serverAuthorizedHumanDelivery: boolean;
    }
  | {
      kind: 'structured-team-fallback';
      distributionMode: SmartFormDistributionMode;
      serverAuthorizedHumanDelivery: boolean;
    }
  | {
      kind: 'canonical-event';
      eventId: string;
      distributionMode: SmartFormDistributionMode;
      serverAuthorizedHumanDelivery: boolean;
    };

/**
 * The single predicate the event-existence gate consults.
 *
 * The kind half is unchanged and still load-bearing: it must be one of the two paths that
 * were fully server-validated *without* a canonical event. An absent outcome is `undefined`
 * and satisfies nothing, so the gate stays enforcing by default for every caller that does
 * not pass one.
 *
 * UTV2-1938 corrects the second half. It used to require `distributionMode === 'track-only'`,
 * and that clause was written as a PROXY for "this pick cannot reach members" -- accurate when
 * UTV2-1842 landed, because at that time nothing but Track Only could keep a fallback pick out
 * of the outbox-enqueue path.
 *
 * UTV2-1923 then made the server itself decide delivery, from an allow-list the client cannot
 * reach, and pin `distributionMode` accordingly in `handlers/submit-pick.ts`. From that merge
 * onward an allow-listed human capper arrived here as `delivery-eligible` ALWAYS -- so the
 * proxy excluded precisely the capper the human-capper path exists for, and every such
 * submission was refused 422 EVENT_NOT_FOUND against a catalog containment deliberately keeps
 * unpopulated. Measured in production 2026-09-18: zero picks persisted, zero outbox rows, and
 * 178 expired rows in the window that arms the gate.
 *
 * So the proxy is replaced by the thing it was standing in for. The question the gate needs
 * answered is "may this pick reach members, and did anything other than the caller decide
 * that?", and `serverAuthorizedHumanDelivery` answers it directly.
 *
 * What is deliberately NOT relaxed: a `delivery-eligible` submission carrying NO server
 * authorization -- an operator or service-role caller, which `handlers/submit-pick.ts` does
 * not pin -- still fails both halves and is still refused. That is the exact case UTV2-1842's
 * own comment named, and it keeps its live-DB control in
 * `t1-proof-utv2-1842-fallback-event-gate.test.ts`.
 */
export function waivesEventExistenceGate(outcome: SmartFormValidationOutcome | undefined): boolean {
  if (!outcome) return false;
  if (outcome.kind !== 'manual-coverage-gap' && outcome.kind !== 'structured-team-fallback') {
    return false;
  }
  if (outcome.distributionMode === 'track-only') return true;
  return outcome.serverAuthorizedHumanDelivery;
}
// UTV2-1842 SMART_FORM_OUTCOME_END

export interface SmartFormValidationOptions {
  /** WORK-2026110802: bound on each manual-player coverage search. Tests shorten it. */
  manualPlayerSearchTimeoutMs?: number;
  /** WORK-2026110802: bound on ALL manual-player coverage searches together. Tests shorten it. */
  manualPlayerSearchBudgetMs?: number;
}

export async function validateSmartFormRelationships(
  payload: SubmissionPayload,
  referenceData: ReferenceDataRepository,
  options: SmartFormValidationOptions = {},
): Promise<SmartFormValidationOutcome> {
  if (payload.source !== 'smart-form') {
    assertNoManualPlayerMarkers(payload);
    return { kind: 'not-smart-form' };
  }

  // UTV2-1672 SMART_FORM_TRIGGER_SCOPE_START
  // `smart-form` predates this product as a generic submission source, and
  // service-role callers still use it as a plain label with none of the Smart
  // Form fields. Applying the strict contract to that shape would refuse
  // submissions this lane never intended to govern. Anything the Smart Form
  // itself sends carries a distributionMode -- the capper pin in
  // handlers/submit-pick.ts guarantees it -- or a participantResolution, so
  // keying on the presence of either covers all real Smart Form traffic
  // without retrofitting the contract onto the legacy label.
  if (!carriesSmartFormFields(payload)) {
    assertNoManualPlayerMarkers(payload);
    return { kind: 'not-smart-form' };
  }
  // UTV2-1672 SMART_FORM_TRIGGER_SCOPE_END

  // UTV2-1853 SMART_FORM_NUMERIC_BOUNDS_CALL_START
  // Placed after the trigger-scope guard above, so it governs exactly the
  // traffic the Smart Form itself produces and leaves the legacy `smart-form`
  // service-role label untouched.
  assertSmartFormNumericBounds(payload);
  // UTV2-1853 SMART_FORM_NUMERIC_BOUNDS_CALL_END

  const metadata = payload.metadata;
  const rawDistributionMode = metadata?.['distributionMode'];
  if (rawDistributionMode !== 'track-only' && rawDistributionMode !== 'delivery-eligible') {
    fail('distributionMode must be track-only or delivery-eligible');
  }
  const distributionMode: SmartFormDistributionMode = rawDistributionMode;

  // UTV2-1938. Read with `isHumanCapperDeliveryAuthorized`, which is the ONLY predicate any
  // delivery path is permitted to use for this question (packages/contracts/src/smart-form.ts).
  // Using it here rather than inventing a second shape is the point: the gate and the delivery
  // path now answer "is this authorized?" from one implementation, so they cannot drift into
  // disagreeing about the same pick.
  //
  // Reading it off `metadata` is not a client-trust hole, and the reason is mechanical rather
  // than conventional. `handlers/submit-pick.ts:108` DELETES the authorization key from client
  // input unconditionally, on every branch including the ones that throw, before any decision
  // is made -- and re-authors it only from `evaluateCapperDeliveryAuthorization`, which reads
  // the server allow-list env and the authenticated identity and nothing else. So over HTTP the
  // record present here is always the server's own, or absent.
  //
  // An in-process service-role caller can still construct any metadata it likes, but that was
  // already true of `distributionMode: 'track-only'`, which has waived this gate since
  // UTV2-1842. This adds no reachable bypass that the previous predicate did not also have.
  const serverAuthorizedHumanDelivery = isHumanCapperDeliveryAuthorized(metadata);

  const resolution = readResolution(metadata?.['participantResolution']);
  if (!resolution) fail('participantResolution must use the typed canonical or manual contract');

  const sportId = readRequiredString(resolution.sportId, 'participantResolution.sportId');
  const metadataSport = readOptionalString(metadata?.['sport']);
  if (metadataSport && normalize(metadataSport) !== normalize(sportId)) {
    fail('participantResolution sport does not match metadata sport');
  }

  // UTV2-1672 CANONICAL_SPORT_ID_GUARD_START
  // Every reference-data lookup below filters on `sportId` with a
  // case-sensitive equality (`.eq('sport_id', ...)` for teams, and a current
  // assignment's `sportId` for players). An unrecognised or wrong-case sport
  // therefore returns no rows and makes every downstream proof vacuous rather
  // than failing. The sport has to be canonical before it can be trusted as a
  // search key.
  const catalog = await referenceData.getCatalog();
  const canonicalSport = catalog.sports.find((sport) => sport.id === sportId);
  if (!canonicalSport) {
    const known = catalog.sports.map((sport) => sport.id).join(', ');
    fail(`participantResolution.sportId "${sportId}" is not a canonical sport (known: ${known})`);
  }
  // UTV2-1672 CANONICAL_SPORT_ID_GUARD_END

  // WORK-2026110802: the manual-player rung is checked before any path is chosen, so a
  // `manualPlayer` riding on a shape that cannot admit it is refused by name rather than
  // ignored by whichever validator happens to run.
  assertManualPlayerAdmissible(payload, resolution, sportId, distributionMode);
  if (resolution.resolution === 'canonical' && resolution.manualPlayer) {
    assertManualPlayerBoundToPick(
      payload,
      manualPlayerName(resolution.manualPlayer.displayName),
      sportId,
      canonicalSport.statTypes,
    );
  }

  if (resolution.resolution === 'manual') {
    await validateManualResolution(payload, resolution, sportId, referenceData);
    return { kind: 'manual-coverage-gap', distributionMode, serverAuthorizedHumanDelivery };
  }

  const eventId = readOptionalString(resolution.eventId);
  if (!eventId) {
    assertFlatMetadataIdentity(payload, resolution);
    if (!TEAM_SPORTS.has(sportId.toUpperCase())) {
      fail('canonical participant resolution without an event is not verifiable; use explicit manual override');
    }
    // WORK-2026110802 review (BLOCKER): on this path the player is opt-in no longer. A
    // player-prop pick names a player, and the server must have resolved that player itself:
    // exactly one of a canonical, search-backed `player` or a proved `manualPlayer` (both at
    // once is refused by `assertManualPlayerAdmissible`). Without either, the pick's selection
    // and `playerName` named a player no check ever looked at, with no provenance stamp.
    if (isPlayerPropSubmission(payload, sportId)) {
      if (!resolution.player && !resolution.manualPlayer) {
        fail(
          'a player-prop pick on the structured team fallback requires participantResolution.player (a canonical player) or participantResolution.manualPlayer (a manually entered, unverified player)',
        );
      }
      if (resolution.player) {
        assertCanonicalPlayerBoundToPick(
          payload,
          readRequiredString(resolution.player.displayName, 'participantResolution.player.displayName'),
          sportId,
          canonicalSport.statTypes,
        );
      }
    }
    const rejectedCandidates = await validateStructuredTeamFallback(payload, resolution, sportId, referenceData, {
      perSearchTimeoutMs: options.manualPlayerSearchTimeoutMs ?? MANUAL_PLAYER_SEARCH_TIMEOUT_MS,
      totalBudgetMs: options.manualPlayerSearchBudgetMs ?? MANUAL_PLAYER_SEARCH_BUDGET_MS,
    });
    // WORK-2026110802: only after every check above passed does the server write the
    // provenance labels -- whatever the client sent for them is overwritten, never trusted.
    if (resolution.manualPlayer) {
      stampManualPlayerProvenance(
        payload,
        manualPlayerName(resolution.manualPlayer.displayName),
        rejectedCandidates,
      );
    }
    return { kind: 'structured-team-fallback', distributionMode, serverAuthorizedHumanDelivery };
  }

  const event = await referenceData.getEventBrowse(eventId);
  if (!event) fail(`canonical event was not found: ${eventId}`);
  validateCanonicalEvent(payload, resolution, sportId, event);
  return { kind: 'canonical-event', eventId, distributionMode, serverAuthorizedHumanDelivery };
}

async function validateManualResolution(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'manual' }>,
  sportId: string,
  referenceData: ReferenceDataRepository,
) {
  if (resolution.eventId !== null || resolution.manualOverride !== true) {
    fail('manual participant resolution cannot include a canonical event ID');
  }
  if (resolution.reason !== 'canonical-coverage-gap') {
    fail('manual participant resolution must state canonical-coverage-gap provenance');
  }
  if (!readOptionalString(resolution.enteredEventName)) {
    fail('manual participant resolution requires enteredEventName');
  }
  if (!Array.isArray(resolution.enteredParticipants)) {
    fail('manual participant resolution requires enteredParticipants');
  }
  for (const participant of resolution.enteredParticipants) {
    if (!participant || participant.canonicalParticipantId !== null) {
      fail('manual participants must have canonicalParticipantId=null');
    }
    readRequiredString(participant.displayName, 'manual participant displayName');
  }
  for (const key of ['eventId', 'teamId', 'playerId', 'participantId']) {
    if (readOptionalString(payload.metadata?.[key])) {
      fail(`manual participant resolution cannot carry canonical ${key}`);
    }
  }
  if (payload.eventName && normalize(payload.eventName) !== normalize(resolution.enteredEventName)) {
    fail('manual enteredEventName does not match submission eventName');
  }
  // UTV2-1842: the flat metadata copy is bound too. This outcome now waives the
  // event-existence gate, and an unchecked `metadata.eventName` is the same fabrication
  // surface the structured path was flagged for -- a different field carrying a name the
  // server never agreed to.
  const flatManualEventName = readOptionalString(payload.metadata?.['eventName']);
  if (flatManualEventName && normalize(flatManualEventName) !== normalize(resolution.enteredEventName)) {
    fail('manual enteredEventName does not match metadata eventName');
  }

  // UTV2-1672 MANUAL_COVERAGE_GAP_PROOF_GUARD_START
  // Without this block `resolution: 'manual'` is a caller-declared opt-out of
  // every canonical check: an empty participant list satisfies the loop above
  // vacuously, and a fabricated event reaches distribution. A manual override
  // is only legitimate when the canonical gap it names is real, so the claim is
  // verified against reference data rather than taken on trust.
  //
  // The proof has to be at least as strong as the canonical path it replaces,
  // which means it must survive the four ways a caller can dodge a naive
  // equality check: entering one side instead of two, spelling a canonical name
  // with a homoglyph, spelling it with a city prefix the catalog omits (or
  // omitting one the catalog carries), and picking a sport whose participants
  // are players rather than teams.
  if (resolution.enteredParticipants.length === 0) {
    fail('manual participant resolution requires at least one entered participant');
  }
  if (TEAM_SPORTS.has(sportId.toUpperCase()) && resolution.enteredParticipants.length < 2) {
    // Only for team sports. `validateStructuredTeamFallback` requires both an
    // away and a home side, so a one-sided manual entry would be strictly
    // weaker than the canonical path it substitutes for. Individual sports have
    // no such fallback and legitimately have one-participant markets (golf
    // outrights, futures on a single competitor), so the same rule there would
    // refuse real submissions.
    fail(
      'manual participant resolution requires both sides of the entered matchup; the canonical path it replaces requires two participants',
    );
  }

  for (const participant of resolution.enteredParticipants) {
    if (hasNonAscii(foldConfusables(participant.displayName))) {
      // Confusable folding covers the Cyrillic and Greek look-alike blocks, but
      // Unicode has many more. Rather than pretend an enumerated table is
      // complete, anything that still holds a non-ASCII letter after folding is
      // refused outright: the alias comparison below cannot honestly establish
      // that such a name is uncovered.
      fail(
        `manual participant "${participant.displayName}" must use Latin characters so the canonical-coverage claim can be verified`,
      );
    }
  }

  const seen = new Map<string, string>();
  for (const participant of resolution.enteredParticipants) {
    const key = aliasKey(participant.displayName);
    const priorRole = seen.get(key);
    if (priorRole !== undefined) {
      fail(
        `manual participants must be distinct: "${participant.displayName}" is entered as both ${priorRole} and ${participant.role}`,
      );
    }
    seen.set(key, participant.role);
  }

  const matches = await Promise.all(
    resolution.enteredParticipants.map(async (participant) => {
      const canonical = await findCanonicalCoverage(participant.displayName, sportId, referenceData);
      return canonical ? { entered: participant.displayName, canonical } : null;
    }),
  );
  const covered = matches.find((match) => match !== null);
  if (covered) {
    fail(
      `manual override claims a canonical coverage gap, but "${covered.entered}" resolves to canonical participant ${covered.canonical.participantId ?? covered.canonical.displayName}; use the canonical selection`,
    );
  }
  // UTV2-1672 MANUAL_COVERAGE_GAP_PROOF_GUARD_END
}

async function validateStructuredTeamFallback(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
  sportId: string,
  referenceData: ReferenceDataRepository,
  manualPlayerSearchBounds: ManualPlayerSearchBounds,
): Promise<ManualPlayerCandidate[]> {
  if (!resolution.away || !resolution.home) {
    fail('team-sport canonical fallback requires distinct away and home participants');
  }
  validateDistinctSides(resolution.away, resolution.home);
  await Promise.all([
    validateSearchBackedTeam(resolution.away, sportId, referenceData),
    validateSearchBackedTeam(resolution.home, sportId, referenceData),
  ]);

  if (resolution.team) {
    await validateSearchBackedTeam(resolution.team, sportId, referenceData);
    const sideIds = new Set([resolution.away.participantId, resolution.home.participantId]);
    if (!sideIds.has(resolution.team.participantId)) {
      fail(`selected team ${resolution.team.participantId} is not part of the structured matchup`);
    }
  }

  // UTV2-1856 STRUCTURED_FALLBACK_PLAYER_START
  // This used to refuse outright: "canonical player selection requires a canonical event so
  // team membership can be verified". That premise was true when it was written and is no
  // longer. Team membership was then derivable only from the canonical
  // `player_team_assignments` table, which an event browse read; with provider ingestion
  // parked that table is empty, so an event was the only place a relationship could come
  // from. `searchPlayers` now resolves each player's team from the provider observation edge
  // (`participants.metadata->>'team_external_id'` matched against a team participant's
  // `external_id`) and answers with a team `participants.id` -- the same id space the two
  // structured sides are expressed in. So membership is verifiable here, against the same
  // authority, with no event row involved.
  //
  // The refusal is kept for the one case where it is still true: a player whose team
  // relationship the database cannot establish. That is a genuine coverage gap and the
  // explicit manual path is where it belongs -- inventing a relationship to admit the pick
  // would be exactly the fabricated provenance the manual path exists to avoid.
  if (resolution.player) {
    await validateSearchBackedPlayer(
      resolution.player,
      resolution.away,
      resolution.home,
      resolution.team ?? null,
      sportId,
      referenceData,
    );
  }
  // UTV2-1856 STRUCTURED_FALLBACK_PLAYER_END

  // WORK-2026110802: the sides and the selected team above are verified exactly as for every
  // structured fallback; only the player differs, and its claimed gap is proved here.
  let rejectedCandidates: ManualPlayerCandidate[] = [];
  if (resolution.manualPlayer) {
    const candidates = await verifyManualPlayerCoverageGap(
      manualPlayerName(resolution.manualPlayer.displayName),
      sportId,
      referenceData,
      manualPlayerSearchBounds,
      [resolution.away, resolution.home],
    );
    assertCandidatesConfirmed(
      manualPlayerName(resolution.manualPlayer.displayName),
      candidates,
      readConfirmedNotCandidates(resolution.manualPlayer),
    );
    rejectedCandidates = candidates;
  }

  // UTV2-1842 STRUCTURED_FALLBACK_MATCHUP_NAME_START
  // The checks above verify the two *identities*. They say nothing about the name the
  // submission carries, and the name is what is persisted and later read by a human. Without
  // this block a payload with genuine DB-backed away/home IDs and an arbitrary
  // `eventName: "Fake Finals"` passes every identity check, and -- now that this outcome
  // waives the event-existence gate -- the fabricated name is persisted with provenance
  // claiming it was server-validated. It was not.
  //
  // So the name is bound to the sides that *were* verified: it must name exactly those two
  // teams, away first, using the canonical display names `validateSearchBackedTeam` has
  // already pinned to the reference-data rows. The Smart Form derives the field this way
  // itself (`setDerivedMatchupName`, "Away @ Home"), so this refuses fabrication without
  // refusing anything the form can produce.
  validateStructuredMatchupName(payload, resolution);
  // UTV2-1842 STRUCTURED_FALLBACK_MATCHUP_NAME_END
  return rejectedCandidates;
}

/**
 * Separators a matchup name may use between its two sides. Each requires surrounding
 * whitespace, so a team name that merely contains one of these letter sequences -- "Atlanta"
 * for `at`, for instance -- is never split.
 */
const MATCHUP_SEPARATOR = /\s+(?:@|vs\.?|v\.?|at)\s+/iu;

function validateStructuredMatchupName(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
) {
  const away = resolution.away;
  const home = resolution.home;
  // Narrowing only; validateStructuredTeamFallback has already failed without both sides.
  if (!away || !home) return;

  // All three places a matchup name can travel. They are checked against the same verified
  // sides rather than against each other, so agreeing on a fabricated name is not a way past
  // this: consistency between the payload and the resolution metadata is a consequence of
  // both binding to the teams, not a substitute for it.
  const named: Array<{ field: string; value: string }> = [];
  const push = (field: string, value: unknown) => {
    const text = readOptionalString(value);
    if (text) named.push({ field, value: text });
  };
  push('eventName', payload.eventName);
  push('metadata.eventName', payload.metadata?.['eventName']);
  push('participantResolution.eventName', resolution.eventName);

  for (const { field, value } of named) {
    const sides = splitMatchupSides(value);
    if (!sides) {
      fail(
        `${field} "${value}" does not name a matchup; a structured fallback without a canonical event must name its two verified sides as "${away.displayName} @ ${home.displayName}"`,
      );
    }
    if (normalize(sides.away) !== normalize(away.displayName) || normalize(sides.home) !== normalize(home.displayName)) {
      fail(
        `${field} "${value}" does not match the verified structured matchup "${away.displayName} @ ${home.displayName}"`,
      );
    }
  }
}

function splitMatchupSides(value: string): { away: string; home: string } | null {
  // Canonical event names carry a "· Game N" disambiguator for doubleheaders;
  // matchesCanonicalEventName strips it on the canonical path and the same name can reach
  // the fallback path, so it is stripped here rather than treated as a mismatch.
  const withoutGameNumber = value.trim().replace(/\s*·\s*game\s+\d+$/iu, '');
  const parts = withoutGameNumber.split(MATCHUP_SEPARATOR);
  if (parts.length !== 2) return null;
  const away = parts[0]?.trim() ?? '';
  const home = parts[1]?.trim() ?? '';
  if (!away || !home) return null;
  return { away, home };
}

async function validateSearchBackedTeam(
  identity: CanonicalParticipantIdentity,
  sportId: string,
  referenceData: ReferenceDataRepository,
) {
  if (identity.participantType !== 'team') fail('structured event sides must be canonical teams');
  const results = await referenceData.searchTeams(sportId, identity.displayName, 25);
  const match = results.find((row) => row.participantId === identity.participantId);
  if (!match) fail(`participant ${identity.participantId} is not canonical for sport ${sportId}`);
  if (normalize(match.displayName) !== normalize(identity.displayName)) {
    fail(`participant ID/display mismatch for ${identity.participantId}`);
  }
}

/**
 * Verifies a structured-fallback player selection without a canonical event.
 *
 * Every check here is an identity check against reference data the server read itself. The
 * caller-supplied `identity.teamId` is never trusted as the source of the relationship -- it
 * is only compared against the relationship the server resolved, so a client that sends the
 * wrong team is refused rather than believed.
 */
async function validateSearchBackedPlayer(
  identity: CanonicalParticipantIdentity,
  away: CanonicalParticipantIdentity,
  home: CanonicalParticipantIdentity,
  selectedTeam: CanonicalParticipantIdentity | null,
  sportId: string,
  referenceData: ReferenceDataRepository,
) {
  if (identity.participantType !== 'player') {
    fail('structured player selection must be a canonical player');
  }

  const results = await referenceData.searchPlayers(sportId, identity.displayName, 25);
  const match = results.find((row) => row.participantId === identity.participantId);
  if (!match) fail(`participant ${identity.participantId} is not canonical for sport ${sportId}`);
  if (normalize(match.displayName) !== normalize(identity.displayName)) {
    fail(`participant ID/display mismatch for ${identity.participantId}`);
  }

  if (!match.teamId) {
    fail(
      `player ${identity.participantId} has no verifiable team relationship without a canonical event; use explicit manual override`,
    );
  }

  const sideIds = new Set([away.participantId, home.participantId]);
  if (!sideIds.has(match.teamId)) {
    fail(`player ${identity.participantId} is not on either side of the structured matchup`);
  }

  if (selectedTeam && match.teamId !== selectedTeam.participantId) {
    fail(`player ${identity.participantId} is not assigned to team ${selectedTeam.participantId}`);
  }

  if (identity.teamId && identity.teamId !== match.teamId) {
    fail(`participant team relationship mismatch for ${identity.participantId}`);
  }
}

function validateCanonicalEvent(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
  sportId: string,
  event: EventBrowseResult,
) {
  if (normalize(event.sportId) !== normalize(sportId)) {
    fail(`event ${event.eventId} belongs to ${event.sportId}, not ${sportId}`);
  }
  if (resolution.eventName && !matchesCanonicalEventName(resolution.eventName, event.eventName)) {
    fail(`event ID/display mismatch for ${event.eventId}`);
  }
  if (payload.eventName && !matchesCanonicalEventName(payload.eventName, event.eventName)) {
    fail(`submission eventName does not match canonical event ${event.eventId}`);
  }
  assertFlatMetadataIdentity(payload, resolution);

  const away = resolution.away ? validateEventParticipant(resolution.away, event) : null;
  const home = resolution.home ? validateEventParticipant(resolution.home, event) : null;
  const team = resolution.team ? validateEventParticipant(resolution.team, event) : null;
  const player = resolution.player ? validateEventParticipant(resolution.player, event) : null;
  // Codex review (CRITICAL): a player prop on the event path must name an event player, and the
  // pick's player-name fields must be that player. Team markets are untouched, including one
  // carrying an incidental `playerName` (PM decision): `isPlayerPropSubmission` reads the market.
  if (isPlayerPropSubmission(payload, sportId)) {
    if (!player) {
      fail('a player-prop pick on a canonical event requires participantResolution.player, a player of that event');
    }
    if (player.participantType === 'player') {
      assertEventPlayerBoundToPick(payload, player.displayName, sportId);
    }
  }

  if (away && home && canonicalParticipantKey(away) === canonicalParticipantKey(home)) {
    fail('away and home participants must be different');
  }

  const teamSport = TEAM_SPORTS.has(sportId.toUpperCase());
  if (teamSport && away && away.participantType !== 'team') fail('away participant must be a team');
  if (teamSport && home && home.participantType !== 'team') fail('home participant must be a team');
  if (team && team.participantType !== 'team') fail('selected team identity is not a team');
  if (player && player.participantType !== 'player') fail('selected player identity is not a player');

  if (teamSport) {
    if (away && hasCanonicalHomeAwayRole(away) && away.role !== 'away') {
      fail(`away participant ${away.participantId} does not have canonical away role`);
    }
    if (home && hasCanonicalHomeAwayRole(home) && home.role !== 'home') {
      fail(`home participant ${home.participantId} does not have canonical home role`);
    }
  }

  if (team && player) {
    const teamIds = new Set([team.participantId, team.canonicalId, team.teamId].filter((value): value is string => Boolean(value)));
    if (!player.teamId || !teamIds.has(player.teamId)) {
      fail(`player ${player.participantId} is not assigned to team ${team.participantId}`);
    }
  }
}

function hasCanonicalHomeAwayRole(participant: EventBrowseResult['participants'][number]) {
  return participant.role === 'away' || participant.role === 'home';
}

function assertFlatMetadataIdentity(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
) {
  const metadata = payload.metadata;
  assertMatchingValue(metadata?.['eventId'], resolution.eventId, 'eventId');
  assertMatchingValue(metadata?.['teamId'], resolution.team?.participantId, 'teamId');
  assertMatchingValue(metadata?.['playerId'], resolution.player?.participantId, 'playerId');
  assertMatchingValue(metadata?.['participantId'], resolution.player?.participantId, 'participantId');
  assertMatchingDisplay(metadata?.['team'], resolution.team?.displayName, 'team');
  // WORK-2026110802: a manual player is the resolved player display for this check. Its
  // canonical ids stay unresolved, so a flat `playerId`/`participantId` beside it is refused
  // by the two `assertMatchingValue` calls above.
  assertMatchingDisplay(
    metadata?.['player'],
    resolution.player?.displayName ?? resolution.manualPlayer?.displayName,
    'player',
  );
}

function assertMatchingValue(flatValue: unknown, resolvedValue: unknown, field: string) {
  const flat = readOptionalString(flatValue);
  const resolved = readOptionalString(resolvedValue);
  if (flat && flat !== resolved) fail(`${field} does not match participantResolution`);
}

function assertMatchingDisplay(flatValue: unknown, resolvedValue: unknown, field: string) {
  const flat = readOptionalString(flatValue);
  const resolved = readOptionalString(resolvedValue);
  if (flat && (!resolved || normalize(flat) !== normalize(resolved))) {
    fail(`${field} display does not match participantResolution`);
  }
}

function validateEventParticipant(identity: CanonicalParticipantIdentity, event: EventBrowseResult) {
  const row = event.participants.find((participant) =>
    participant.participantId === identity.participantId ||
    participant.canonicalId === identity.participantId,
  );
  if (!row) fail(`participant ${identity.participantId} does not belong to event ${event.eventId}`);
  if (row.participantType !== identity.participantType) fail(`participant type mismatch for ${identity.participantId}`);
  if (normalize(row.displayName) !== normalize(identity.displayName)) fail(`participant ID/display mismatch for ${identity.participantId}`);
  if (identity.teamId && row.teamId !== identity.teamId) fail(`participant team relationship mismatch for ${identity.participantId}`);
  return row;
}

function canonicalParticipantKey(
  participant: EventBrowseResult['participants'][number],
): string {
  return participant.canonicalId ?? participant.participantId;
}

function validateDistinctSides(
  away: CanonicalParticipantIdentity | null | undefined,
  home: CanonicalParticipantIdentity | null | undefined,
) {
  if (away && home && away.participantId === home.participantId) fail('away and home participants must be different');
}

function readResolution(value: unknown): SmartFormParticipantResolution | null {
  if (!isRecord(value)) return null;
  return value['resolution'] === 'canonical' || value['resolution'] === 'manual'
    ? value as unknown as SmartFormParticipantResolution
    : null;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, field: string) {
  const result = readOptionalString(value);
  if (!result) fail(`${field} is required`);
  return result;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

/**
 * Latin look-alikes drawn from the Cyrillic and Greek blocks. `aliasKey` strips
 * everything outside `[a-z0-9]`, so without this table a single Cyrillic "\u0441"
 * inside "Knicks" is *deleted* rather than compared, and the alias key no longer
 * equals the canonical one -- which is exactly what a caller wants when the goal
 * is to claim a canonical entity does not exist.
 */
const CONFUSABLE_LATIN: ReadonlyMap<string, string> = new Map(
  Object.entries({
    '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u0437': '3', '\u0438': 'u', '\u043a': 'k',
    '\u043c': 'm', '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't',
    '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j', '\u04bb': 'h',
    '\u0501': 'd', '\u051b': 'q', '\u051d': 'w', '\u0261': 'g',
    '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b5': 'e', '\u03b7': 'n', '\u03b9': 'i',
    '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o', '\u03c1': 'p', '\u03c3': 'o', '\u03c4': 't',
    '\u03c5': 'u', '\u03c7': 'x', '\u03c9': 'w',
  }),
);

/**
 * A deliberately aggressive key used only to decide whether two names refer to
 * the same entity. `normalize` stays strict because it backs mismatch
 * refusals, where collapsing more strings would let a mismatch through; this
 * collapses more so an alias spelling cannot be used to claim a canonical
 * entity does not exist.
 */
function aliasKey(value: string) {
  return foldConfusables(value).replace(/[^a-z0-9]+/gu, '');
}

/**
 * Lower-case, strip diacritics and map Latin look-alikes back to ASCII, but
 * keep word boundaries. `searchTeams`/`searchPlayers` match on the raw query
 * string, so a homoglyph spelling finds nothing at all and never reaches the
 * alias comparison -- the folded spelling has to be searched too.
 */
function foldConfusables(value: string) {
  return Array.from(
    value
      // NFKD, not NFD: it also decomposes compatibility forms, so a fullwidth
      // "\uff2b" folds to "K" rather than surviving as a look-alike.
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase(),
  )
    // Zero-width and other default-ignorable characters are invisible in the
    // form and are deleted by the alias key anyway; dropping them here means
    // they are also gone from the search queries, where leaving them in made
    // every ILIKE match nothing. Expressed as a code-point predicate rather
    // than a character class: several of these are combining or variation
    // selectors, which a regex class cannot carry unambiguously.
    .filter((character) => !isDefaultIgnorable(character))
    .map(
      (character) =>
        CONFUSABLE_LATIN.get(character) ?? LATIN_EXPANSION.get(character) ?? character,
    )
    .join('');
}

/**
 * Latin letters that NFKD does not decompose.
 *
 * NFKD strips diacritics ("Munchen" from "M\u00fcnchen"), but a handful of real
 * Latin letters are atomic under it: \u00f8, \u00df, \u00e6, \u00fe, \u0111, \u0142, \u0131. Without an
 * explicit expansion the non-ASCII refusal below rejects legitimate club names
 * -- Br\u00f8ndby IF, Bod\u00f8/Glimt, Preu\u00dfen M\u00fcnster, Kas\u0131mpa\u015fa, \u0141KS \u0141\u00f3d\u017a -- and the
 * manual path becomes unusable for top-flight Soccer.
 */
const LATIN_EXPANSION: ReadonlyMap<string, string> = new Map([
  ['\u00f8', 'o'],
  ['\u0153', 'oe'],
  ['\u00e6', 'ae'],
  ['\u00df', 'ss'],
  ['\u1e9e', 'ss'],
  ['\u00fe', 'th'],
  ['\u00f0', 'd'],
  ['\u0111', 'd'],
  ['\u0110', 'd'],
  ['\u0142', 'l'],
  ['\u0141', 'l'],
  ['\u0131', 'i'],
  ['\u0127', 'h'],
  ['\u014b', 'n'],
  ['\u0294', ''],
]);

/** Invisible formatting characters that must not survive into a search query. */
function isDefaultIgnorable(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x061c ||
    code === 0xfeff ||
    (code >= 0x180b && code <= 0x180e) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x206f) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  );
}

/** True when any code point falls outside ASCII. */
function hasNonAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
}

/** Alias-folded word tokens, used for name-boundary comparison. */
function aliasTokens(value: string): string[] {
  return foldConfusables(value).split(/[^a-z0-9]+/u).filter(Boolean);
}

/**
 * True when two names denote the same entity.
 *
 * Equality is not enough, because the catalog and the caller can disagree about
 * a city prefix in either direction ("Knicks" vs "New York Knicks"). Substring
 * containment is too much: it refuses "Alex Pereira Junior" because "Alex
 * Pereira" is canonical, and "Manchester" because "Manchester United" is. The
 * honest rule is a *suffix* match on word tokens -- a name may carry extra
 * leading words the other omits, and nothing else.
 */
function isSameEntityName(entered: string[], canonical: string[]): boolean {
  if (entered.length === 0 || canonical.length === 0) return false;
  // Collapsed-key equality first: it catches spellings that tokenize
  // differently but denote one name ("L.A. Lakers" -> [l, a, lakers] against a
  // catalog's [la, lakers]).
  if (entered.join('') === canonical.join('')) return true;
  const [short, long] =
    entered.length <= canonical.length ? [entered, canonical] : [canonical, entered];
  const offset = long.length - short.length;
  return short.every((token, index) => token === long[offset + index]);
}

/**
 * Resolve whether an entered name is already covered by reference data.
 *
 * Two asymmetries make exact alias equality insufficient. The catalog may store
 * "Knicks" while the form sends "New York Knicks", or the reverse, so the match
 * is containment in either direction rather than equality. And `searchTeams` /
 * `searchPlayers` match on substrings, so a city-prefixed query finds nothing at
 * all -- each significant word is therefore queried on its own as well.
 *
 * The catalog to search follows the sport: team sports resolve to teams, and
 * everything else (MMA, tennis, golf, ...) resolves to players. Skipping the
 * non-team case, as an earlier revision did, left the manual override entirely
 * unverified for precisely the sports whose only supported route is manual.
 */
async function findCanonicalCoverage(
  displayName: string,
  sportId: string,
  referenceData: ReferenceDataRepository,
): Promise<{ participantId: string | null; displayName: string } | null> {
  const enteredTokens = aliasTokens(displayName);
  if (enteredTokens.length === 0) return null;

  // The catalog first, and not only as an optimisation. All three reference-data
  // reads now agree on one populated source: `getCatalog`, `searchTeams` and
  // `searchPlayers` all read `participants` (UTV2-1854). Before that, `searchTeams`
  // read the canonical `teams` table and `searchPlayers` joined
  // `player_team_assignments`, both of which are empty under parked provider
  // ingestion -- so a search-only proof returned null for every name in every sport
  // and this guard degraded to accepting whatever it was told. The catalog is still
  // tried first because it is one read of the whole sport and an exact alias match
  // over the same rows the searches then rank.
  const catalog = await referenceData.getCatalog();
  const sport = catalog.sports.find((candidate) => candidate.id === sportId);
  for (const team of sport?.teams ?? []) {
    if (isSameEntityName(enteredTokens, aliasTokens(team))) {
      return { participantId: null, displayName: team };
    }
  }

  const queries = coverageQueries(displayName);

  const search = TEAM_SPORTS.has(sportId.toUpperCase())
    ? (query: string) => referenceData.searchTeams(sportId, query, 25)
    : (query: string) => referenceData.searchPlayers(sportId, query, 25);

  for (const query of queries) {
    const rows = await search(query);
    for (const row of rows) {
      if (isSameEntityName(enteredTokens, aliasTokens(row.displayName))) {
        return { participantId: row.participantId, displayName: row.displayName };
      }
    }
  }
  return null;
}

/**
 * The queries that prove or disprove coverage of one entered name, most specific first.
 *
 * Words are the alias tokens -- split on EVERY non-alphanumeric run after confusable
 * folding -- not whitespace words. Splitting on whitespace alone let "Jayson.Tatum",
 * "Jayson-Tatum", "Jayson,Tatum" and "Jayson/Tatum" reach the searches only as one
 * unsplit word, which ILIKE matches against nothing, so a covered player read as a gap.
 *
 * Order matters because the reference searches are `ORDER BY display_name LIMIT n`:
 *   1. the whole name with punctuation folded to single spaces ("jayson tatum") -- a true
 *      full-name match is found before any one-word query can be truncated;
 *   2. the name as typed, folded, and alias-keyed (catalog spellings with punctuation);
 *   3. the decisive query (`decisiveCoverageQuery`): every suffix match (`isSameEntityName`)
 *      contains it, so it is the query whose truncation could hide a true match;
 *   4. every other token of three or more characters.
 */
function coreCoverageQueries(displayName: string): string[] {
  const trimmed = displayName.trim();
  const tokens = aliasTokens(trimmed);
  const decisive = decisiveCoverageQuery(trimmed);
  return dedupeQueries([
    tokens.join(' '),
    trimmed,
    foldConfusables(trimmed),
    aliasKey(trimmed),
    ...(decisive ? [decisive] : []),
    ...tokens.filter((token) => token.length >= 3),
  ]);
}

/**
 * The query every true match must contain. A suffix match ends with the entered name's last
 * token, so that token is it -- unless it is a short suffix ("Jr", "II") that would match a
 * large share of the catalog, in which case the last two tokens together.
 */
function decisiveCoverageQuery(displayName: string): string | null {
  const tokens = aliasTokens(displayName.trim());
  const last = tokens[tokens.length - 1];
  if (last === undefined) return null;
  if (last.length >= 3 || tokens.length < 2) return last;
  return tokens.slice(-2).join(' ');
}

/**
 * Every query the manual-team coverage proof runs: the core queries plus, for continuity with
 * earlier revisions, each whitespace word as typed and alias-keyed.
 */
function coverageQueries(displayName: string): string[] {
  const trimmed = displayName.trim();
  const legacyWords: string[] = [];
  for (const word of [...trimmed.split(/\s+/u), ...foldConfusables(trimmed).split(/\s+/u)]) {
    if (aliasKey(word).length >= 3) {
      // The alias key drops punctuation. Without it, "Knicks." is only ever
      // searched verbatim, ILIKE '%knicks.%' matches nothing, and a name the
      // catalog plainly carries is reported as an uncovered gap.
      legacyWords.push(word, aliasKey(word));
    }
  }
  return dedupeQueries([...coreCoverageQueries(displayName), ...legacyWords]);
}

/** Drops empties and case-only duplicates (the searches are case-insensitive ILIKE). */
function dedupeQueries(candidates: string[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const query = candidate.trim();
    const key = query.toLowerCase();
    if (query.length === 0 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

// WORK-2026110802 MANUAL_PLAYER_COVERAGE_GAP_START
// The rung of the participant-resolution ladder between the structured team fallback and the
// all-manual tier: canonical teams (`eventId: null`, team sports only) plus ONE manually
// entered player the operator could not find in the reference catalog. Before it existed no contract admitted
// that shape -- the manual tier is all-or-nothing and refuses canonical team names, and the
// structured tier requires a canonical player -- so a pick on Herro, Burries or Dulcich in a
// covered matchup had no truthful path at all.
//
// The sides and the selected team pass the unchanged structured checks. The player is checked
// against `searchPlayers` with the alias and confusable folding the manual tier uses, and a name
// that resolves to, or may be, a retrievable canonical player is refused. What that bounded
// search establishes is only "no canonical match found", NOT that the catalog lacks the player
// (the database ILIKE does not fold accents: "L Doncix" never retrieves "Luka Dončić"). So the
// pick is stamped `manual-unverified-identity`, never a proved coverage gap. A failed search is
// a retryable error, never an unverified player (apps/smart-form/CLAUDE.md).
//
// It is Track Only only. A pick whose player no reference data backs carries no provider
// verification, no CLV and no automatic grading, so it must not reach members on the strength
// of an allow-list. The legacy `manual-coverage-gap` stamp is treated identically everywhere.

/** Bound on ONE coverage search, so a hung reference read surfaces as a retryable error. */
export const MANUAL_PLAYER_SEARCH_TIMEOUT_MS = 4_000;

/**
 * Bound on ALL coverage searches for one manual player together. Exhausting it is a
 * retryable 503, never an accepted manual player: an unfinished search checks nothing.
 */
export const MANUAL_PLAYER_SEARCH_BUDGET_MS = 8_000;

/**
 * Longest accepted manual player name, in UTF-16 code units, checked before any folding.
 * 80 holds every real multi-part name with room to spare and bounds every query built from it.
 */
export const MANUAL_PLAYER_DISPLAY_NAME_MAX_LENGTH = 80;

/** Most alias tokens a manual player name may fold to. Real names have at most five or so. */
export const MANUAL_PLAYER_MAX_NAME_TOKENS = 6;

/**
 * Most coverage searches one manual player may cost. `manualPlayerCoverageQueries` yields at
 * most 2 (whole name, both orders) + 6 * MANUAL_PLAYER_MAX_NAME_TOKENS (plain, three
 * accent-tolerant and two transliteration forms per token) + 4 * MANUAL_PLAYER_MAX_NAME_TOKENS
 * (concatenation probes) + 4 * MANUAL_PLAYER_MAX_NAME_TOKENS (near-miss probes, at most four
 * per word: `nearMissProbes`) = 86 queries for an admitted name. Raised from 64 by the Codex
 * review fix: the near-miss probes are what make a one-typo spelling of a covered player
 * retrievable at all. The time bounds (`MANUAL_PLAYER_SEARCH_TIMEOUT_MS`,
 * `MANUAL_PLAYER_SEARCH_BUDGET_MS`) are unchanged and still end any slow proof as a retryable 503.
 * The cap is an explicit fail-closed ceiling, never a truncation -- skipping a query would
 * accept a gap the server never checked.
 */
export const MANUAL_PLAYER_MAX_SEARCHES = 86;

/**
 * Rows read per coverage search. Far larger than the form's 25 because a search that comes back
 * full may have cut off a true match (`ORDER BY display_name LIMIT n`), and the accent-tolerant
 * patterns are deliberately loose. ANY search that comes back full without a covering match
 * makes the gap unprovable and fails closed (`verifyManualPlayerCoverageGap`).
 */
export const MANUAL_PLAYER_SEARCH_ROW_LIMIT = 500;

/** Longest accepted `statType` beside a manual player. */
const MANUAL_PLAYER_STAT_TYPE_MAX_LENGTH = 40;

/** The only keys a `manualPlayer` object may carry (contract `ManualPlayerCoverageGap`). */
const MANUAL_PLAYER_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'displayName',
  'canonicalParticipantId',
  'reason',
  'confirmedNotCandidates',
]);

/** Longest participant id accepted in `manualPlayer.confirmedNotCandidates`. */
const MANUAL_PLAYER_CANDIDATE_ID_MAX_LENGTH = 128;

interface ManualPlayerSearchBounds {
  perSearchTimeoutMs: number;
  totalBudgetMs: number;
}

function assertManualPlayerAdmissible(
  payload: SubmissionPayload,
  resolution: SmartFormParticipantResolution,
  sportId: string,
  distributionMode: SmartFormDistributionMode,
) {
  const metadata = payload.metadata;
  const rawManualPlayer = (resolution as unknown as Record<string, unknown>)['manualPlayer'];
  const declaredProvenance = metadata?.['playerProvenance'];

  if (rawManualPlayer === undefined || rawManualPlayer === null) {
    // Provenance is server-stamped, never accepted from a client. A pick without a manual
    // player that claims the label would mislabel a canonical pick and silently forfeit CLV.
    if (declaredProvenance !== undefined && declaredProvenance !== null) {
      fail('metadata.playerProvenance is only valid beside participantResolution.manualPlayer');
    }
    // The review is a server-written audit record of a proved manual player; a pick without
    // one cannot carry it.
    if (metadata?.['manualPlayerReview'] !== undefined && metadata?.['manualPlayerReview'] !== null) {
      fail('metadata.manualPlayerReview is only valid beside participantResolution.manualPlayer');
    }
    return;
  }

  if (resolution.resolution !== 'canonical') {
    fail('manualPlayer is only valid on a structured team fallback with canonical teams');
  }
  if (readOptionalString(resolution.eventId)) {
    fail('manualPlayer cannot be combined with a canonical event; select the canonical player from the event');
  }
  if (!TEAM_SPORTS.has(sportId.toUpperCase())) {
    fail('manualPlayer requires a team-sport structured fallback');
  }
  if (resolution.player) {
    fail('manualPlayer and a canonical player selection are mutually exclusive');
  }
  if (!isRecord(rawManualPlayer)) {
    fail('manualPlayer must be an object');
  }
  const unknownKeys = Object.keys(rawManualPlayer).filter((key) => !MANUAL_PLAYER_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    fail(`manualPlayer carries unsupported field(s): ${unknownKeys.sort().join(', ')}`);
  }
  if (rawManualPlayer['canonicalParticipantId'] !== null) {
    fail('manualPlayer must have canonicalParticipantId=null');
  }
  // The current reason, or the legacy spelling a form built before the rewording still sends.
  // Either way the server persists `manualPlayerReason` (see `stampManualPlayerProvenance`).
  if (rawManualPlayer['reason'] !== manualPlayerReason && rawManualPlayer['reason'] !== legacyManualPlayerReason) {
    fail(`manualPlayer must state ${manualPlayerReason} provenance`);
  }
  readConfirmedNotCandidates(rawManualPlayer);
  // Length first, on the raw value: nothing below folds or searches an unbounded string.
  const rawDisplayName = rawManualPlayer['displayName'];
  if (typeof rawDisplayName === 'string' && rawDisplayName.length > MANUAL_PLAYER_DISPLAY_NAME_MAX_LENGTH) {
    fail(`manualPlayer.displayName must be at most ${MANUAL_PLAYER_DISPLAY_NAME_MAX_LENGTH} characters`);
  }
  const displayName = readRequiredString(rawDisplayName, 'manualPlayer.displayName');
  assertManualPlayerNameCharacters(displayName);
  // The typographic apostrophe (iOS smart punctuation) is an allowed separator, like "'".
  if (hasNonAscii(foldConfusables(displayName.replace(/\u2019/gu, "'")))) {
    fail(
      `manual player "${displayName}" must use Latin characters so the catalog search can check it`,
    );
  }
  const tokenCount = aliasTokens(displayName).length;
  if (tokenCount === 0) fail('manualPlayer.displayName must name a player');
  if (tokenCount > MANUAL_PLAYER_MAX_NAME_TOKENS) {
    fail(`manualPlayer.displayName must have at most ${MANUAL_PLAYER_MAX_NAME_TOKENS} words`);
  }

  // The fail-closed delivery rule. It sits here, in validation, because the capper pin in
  // handlers/submit-pick.ts lets an allow-listed capper's `delivery-eligible` request through
  // and an operator or service-role caller is not pinned at all; both reach this line before
  // anything is written. Neither the allow-list nor a server authorization record widens it.
  if (distributionMode !== 'track-only') {
    throw new ApiError(
      422,
      'SMART_FORM_MANUAL_PLAYER_TRACK_ONLY_REQUIRED',
      'a manually entered player is accepted only as Track Only; delivery-eligible is refused whatever the delivery allow-list says',
    );
  }

  // A provider offer is a provider-verified claim about the selection. A manual player has none.
  if (metadata?.['selectedOffer'] !== undefined && metadata?.['selectedOffer'] !== null) {
    fail('manualPlayer cannot carry a provider offer; a manual player makes no provider-verified claim');
  }
}

/**
 * The characters a manual player name may contain, checked on the raw value so nothing
 * invisible or look-alike is ever persisted: Latin-script letters (accented letters included,
 * in composed NFC form), ASCII digits, the space, and the punctuation real names and the
 * Smart Form use -- . , ' ’ - / ( ) " #. Everything else is refused outright, including
 * control and format characters (zero-width, bidi, tag characters), combining marks left
 * uncomposed, other scripts (Cyrillic/Greek homoglyphs), compatibility forms (fullwidth
 * letters, ligatures -- NFKC differs from NFC) and other whitespace.
 */
const MANUAL_PLAYER_NAME_CHARACTERS = /^[\p{Script=Latin}0-9 .,'’\-/()"#]+$/u;

function assertManualPlayerNameCharacters(displayName: string) {
  if (displayName.normalize('NFC') !== displayName) {
    fail('manualPlayer.displayName must use composed (NFC) characters');
  }
  if (displayName.normalize('NFKC') !== displayName || !MANUAL_PLAYER_NAME_CHARACTERS.test(displayName)) {
    fail(
      'manualPlayer.displayName contains unsupported characters; use Latin letters, digits, spaces and . , \' - / ( ) " #',
    );
  }
}

/**
 * Manual-player provenance is a Smart Form label the server checks and stamps. Any other
 * traffic that carries it -- another source, or the legacy `smart-form` label without Smart
 * Form fields -- is refused, so no pick can opt itself out of CLV by declaring a manual player.
 * Refused rather than stripped: no existing caller sends either marker, so refusing breaks no
 * contract, and a silent strip would persist a pick whose request said something else.
 */
function assertNoManualPlayerMarkers(payload: SubmissionPayload) {
  const metadata = payload.metadata;
  if (!metadata) return;
  const provenance = metadata['playerProvenance'];
  const review = metadata['manualPlayerReview'];
  const resolution = metadata['participantResolution'];
  const manualPlayer = isRecord(resolution) ? resolution['manualPlayer'] : undefined;
  if (
    (provenance !== undefined && provenance !== null) ||
    (review !== undefined && review !== null) ||
    (manualPlayer !== undefined && manualPlayer !== null)
  ) {
    fail(
      'playerProvenance, manualPlayerReview and participantResolution.manualPlayer are accepted only on a Smart Form submission',
    );
  }
}

/** Ordered, folded word tokens of a free-text field. */
function foldedTokens(value: unknown): string[] {
  return typeof value === 'string' ? aliasTokens(value) : [];
}

function sameTokens(left: string[], right: string[]) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

/**
 * The manual player name as validated and persisted: trimmed (`readRequiredString` already
 * trims leading/trailing whitespace and BOMs before the character check) with runs of spaces
 * collapsed. Raw edge whitespace never reaches the pick (review round 3, P3).
 */
function manualPlayerName(rawDisplayName: string): string {
  return rawDisplayName.trim().replace(/ {2,}/gu, ' ');
}

/** Flat metadata fields that name the pick's player (grading-service.ts and clv-service.ts read them). */
const PLAYER_NAME_FIELDS = ['player', 'playerName', 'participantName'] as const;
/** Flat metadata fields that would tie the pick to a canonical or provider player id. */
const PLAYER_ID_FIELDS = ['playerId', 'participantId', 'providerParticipantId'] as const;

/**
 * Binds the manual-player label to the pick it rides on. Without this a `manualPlayer` could be
 * attached to a moneyline, or to a selection or flat field naming a different -- canonical --
 * player, and the provenance stamp and CLV exclusion would describe the wrong pick; grading
 * resolves a player by `player` / `playerName` / `participantName` and by id fields, so every
 * one of them is bound.
 *
 * - The market is EXACTLY the Smart Form player-prop key for the sport and `metadata.statType`
 *   (`resolveSmartFormPlayerPropMarketKey`), or, without a stat type, one of the sport's
 *   player-prop keys; `metadata.marketType`, if any, is `player-prop`.
 * - `metadata.statType`, if any, is one of the sport's catalog stat types (the list the form
 *   offers, from the catalog the sport guard already loaded).
 * - The selection is exactly what the form builds -- player, stat type, O/U, line -- compared on
 *   folded tokens, so it references the manual player and nobody else.
 * - `player`, `playerName` and `participantName`, if present, are the manual player.
 * - `playerId`, `participantId` and `providerParticipantId` are absent (or null).
 */
function assertManualPlayerBoundToPick(
  payload: SubmissionPayload,
  displayName: string,
  sportId: string,
  catalogStatTypes: readonly string[],
) {
  assertPlayerBoundToPick(payload, displayName, sportId, catalogStatTypes, 'manual');
}

/**
 * Codex review (CRITICAL): the canonical-event path accepted a player prop with no
 * `participantResolution.player` at all -- an allow-listed capper's pick reached the official
 * outbox naming a player no check had resolved. A player prop on that path now names a player
 * of the event (`validateEventParticipant`), and its selection and flat name fields are bound to
 * that player's event display name.
 *
 * Deliberately NOT bound here: the exact Smart Form market key and the catalog stat type. A
 * live-offer pick sends the offer's `canonicalMarketTypeId` as its market and a stat type
 * inferred from it (apps/smart-form lib/form-utils.ts `resolveSubmissionMarketKey`,
 * `inferStatTypeFromMarketTypeId`), neither of which need match the form's own key table, and
 * refusing them would refuse a legitimate form flow. The selection is still checked against the
 * submitted stat type, direction and line, exactly as the form builds it.
 */
function assertEventPlayerBoundToPick(payload: SubmissionPayload, displayName: string, sportId: string) {
  assertPlayerBoundToPick(payload, displayName, sportId, [], 'event-canonical');
}

/**
 * WORK-2026110802 review (BLOCKER): the same binding for a canonical, search-backed player on
 * the structured fallback. Before this, a player-prop pick on that path could name any player
 * in its selection, `playerName` or `participantName` while `participantResolution.player`
 * (and so every server check) was absent or named somebody else. The canonical player's id
 * fields are bound to the resolution by `assertFlatMetadataIdentity`; everything else -- the
 * market, the stat type, the selection and every flat name field -- is bound here exactly as
 * for a manual player.
 */
function assertCanonicalPlayerBoundToPick(
  payload: SubmissionPayload,
  displayName: string,
  sportId: string,
  catalogStatTypes: readonly string[],
) {
  assertPlayerBoundToPick(payload, displayName, sportId, catalogStatTypes, 'fallback-canonical');
}

/**
 * True when the submission is a player prop: the Smart Form's declared `marketType`, or a
 * market key that is one of the sport's Smart Form player-prop keys or carries the `player.` /
 * `player_` prefix every player-prop key uses (packages/contracts smart-form.ts). Team markets
 * (moneyline, spread, total, team total) match none of these.
 */
function isPlayerPropSubmission(payload: SubmissionPayload, sportId: string): boolean {
  if (payload.metadata?.['marketType'] === 'player-prop') return true;
  const market = typeof payload.market === 'string' ? payload.market.trim() : '';
  if (!market) return false;
  return smartFormPlayerPropMarketKeysForSport(sportId).includes(market) || /^player[._]/iu.test(market);
}

/**
 * A game-line or team market key, as the Smart Form builds them (apps/smart-form
 * lib/market-types.ts `getMarketTypeFamily`, lib/form-utils.ts `resolveSubmissionMarketKey`):
 * moneyline and spread (and their period forms, `1h_spread`), game and team totals. The event
 * path cannot require the form's own player-prop key -- a live offer sends its provider market id
 * -- but it can refuse a player prop whose market is plainly a team market.
 */
function isTeamMarketKey(market: string): boolean {
  const key = market.trim().toLowerCase();
  return (
    key === '' ||
    /(^|_)(moneyline|spread)$/u.test(key) ||
    /(^|_)total_ou$/u.test(key) ||
    key === 'total' ||
    key === 'team-total'
  );
}

function assertPlayerBoundToPick(
  payload: SubmissionPayload,
  displayName: string,
  sportId: string,
  catalogStatTypes: readonly string[],
  source: 'manual' | 'fallback-canonical' | 'event-canonical',
) {
  const manual = source === 'manual';
  const exactMarket = source !== 'event-canonical';
  const subject = manual
    ? 'manualPlayer'
    : source === 'fallback-canonical'
      ? 'a canonical player on the structured team fallback'
      : 'a canonical event player';
  const theirs = manual ? 'the manual player' : 'the canonical player';
  const metadata = payload.metadata ?? {};
  const declaredMarketType = metadata['marketType'];
  if (declaredMarketType !== undefined && declaredMarketType !== null && declaredMarketType !== 'player-prop') {
    fail(`${subject} is accepted only on a player-prop market`);
  }

  const nameTokens = aliasTokens(displayName);
  for (const field of PLAYER_NAME_FIELDS) {
    const value = metadata[field];
    if (value !== undefined && value !== null && !sameTokens(foldedTokens(value), nameTokens)) {
      fail(`metadata.${field} must be ${theirs}`);
    }
  }
  if (manual) {
    for (const field of PLAYER_ID_FIELDS) {
      const value = metadata[field];
      if (value !== undefined && value !== null) {
        fail(`metadata.${field} must be absent beside a manual player; a manual player has no canonical or provider id`);
      }
    }
  }

  const rawStatType = metadata['statType'];
  let statType: string | null = null;
  if (rawStatType !== undefined && rawStatType !== null) {
    if (typeof rawStatType !== 'string' || rawStatType.length > MANUAL_PLAYER_STAT_TYPE_MAX_LENGTH) {
      fail(`metadata.statType beside ${manual ? 'a manual player' : 'a canonical player'} must be a catalog stat type`);
    }
    statType = rawStatType.trim();
  }
  if (statType && exactMarket) {
    const wanted = aliasTokens(statType);
    if (!catalogStatTypes.some((candidate) => sameTokens(aliasTokens(candidate), wanted))) {
      fail(`metadata.statType "${statType}" is not a ${sportId} stat type`);
    }
  }

  const market = typeof payload.market === 'string' ? payload.market : '';
  const expectedMarket = statType ? resolveSmartFormPlayerPropMarketKey(sportId, statType) : null;
  if (
    exactMarket
      ? statType
        ? market !== expectedMarket
        : !smartFormPlayerPropMarketKeysForSport(sportId).includes(market)
      : isTeamMarketKey(market)
  ) {
    fail(
      statType && expectedMarket
        ? `${subject} is accepted only on a player-prop market; the ${sportId} ${statType} market is "${expectedMarket}"`
        : `${subject} is accepted only on a player-prop market`,
    );
  }

  const overUnder = metadata['overUnder'];
  const direction = overUnder === 'over' ? 'O' : overUnder === 'under' ? 'U' : '';
  const expected = [
    displayName,
    statType ?? '',
    direction,
    typeof payload.line === 'number' && Number.isFinite(payload.line) ? String(payload.line) : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!sameTokens(foldedTokens(payload.selection), aliasTokens(expected))) {
    fail(
      `selection must be ${theirs}'s prop ("${expected}"); a selection naming anyone else is refused`,
    );
  }
}

/** Generational suffixes, ignored on both sides of a player-name comparison. */
const GENERATIONAL_SUFFIXES: ReadonlySet<string> = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** Name tokens without generational suffixes or bare numbers (jersey numbers). */
function playerNameCore(tokens: string[]): string[] {
  return tokens.filter((token) => !GENERATIONAL_SUFFIXES.has(token) && !/^\d+$/u.test(token));
}

/** Every concatenation of one or more consecutive tokens. */
function contiguousRuns(tokens: string[]): Set<string> {
  const runs = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) runs.add(tokens.slice(start, end).join(''));
  }
  return runs;
}

/** True when `left` and `right` differ by at most one insertion, deletion or substitution. */
function withinOneEdit(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index += 1;
  return shorter.length === longer.length
    ? shorter.slice(index + 1) === longer.slice(index + 1)
    : shorter.slice(index) === longer.slice(index + 1);
}

/**
 * True when `left` and `right` are one typo apart: within one insertion, deletion or
 * substitution, or one swap of two adjacent letters ("tautm" / "tatum") -- a transposition is
 * two Levenshtein edits but one keystroke slip, and was the review's 409-then-accepted bypass.
 */
function isNearMissSpelling(left: string, right: string): boolean {
  if (withinOneEdit(left, right)) return true;
  if (left.length !== right.length) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  return (
    index + 1 < left.length &&
    left[index] === right[index + 1] &&
    left[index + 1] === right[index] &&
    left.slice(index + 2) === right.slice(index + 2)
  );
}

/**
 * An entered token that may stand for the catalog given name `name`: the name itself, its
 * initial, a 3+ letter prefix pair ("Jay"), a near-miss spelling ("Jason", "Jaysen") or a near
 * miss of a 3+ letter prefix ("Nick" for "Nicolas").
 */
function isGivenNameNearMiss(token: string, name: string): boolean {
  if (token === name) return true;
  if (token.length === 1) return token === name[0];
  return (
    token.length >= 3 &&
    (isPrefixPair(token, name, 3) || isNearMissSpelling(token, name) || withinOneEditOfPrefix(token, name))
  );
}

/** `token` is within one edit of a 3+ letter prefix of `name` ("nick" / "nic" of "nicolas"). */
function withinOneEditOfPrefix(token: string, name: string): boolean {
  for (const length of [token.length - 1, token.length, token.length + 1]) {
    if (length >= 3 && length < name.length && withinOneEdit(token, name.slice(0, length))) return true;
  }
  return false;
}

/** One name is a prefix of the other, and the shorter has at least `minimum` letters. */
function isPrefixPair(left: string, right: string, minimum: number): boolean {
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= minimum && longer.startsWith(shorter);
}

/**
 * How a catalog player matches the entered name: `resolves` when the entry denotes that player
 * (same tokens, reordered, concatenated or decorated), `plausible` when it is only CLOSE to that
 * player -- a near-miss spelling, a shortened name, initials or a bare surname -- and null when
 * neither. Both refuse the gap claim; they differ only in the refusal message, which must not
 * say a near miss "resolves to" anyone. Deliberately broader than `isSameEntityName` (which
 * still governs teams): a false refusal costs a retype, a false acceptance records an
 * unverified pick against a covered player. On folded tokens, with generational suffixes
 * (Jr/Sr/II/III/IV) and bare numbers dropped on BOTH sides, catalog C = given... surname,
 * entered E:
 *
 * resolves when
 *   1. the legacy suffix/collapsed rule (`isSameEntityName`) holds;
 *   2. E joined equals C joined reversed ("TatumJayson") or ANY contiguous run of C's tokens
 *      ("JaysonTatum", "DeAaron" for "De'Aaron Fox", a lone given name "Jayson"), or one E token
 *      equals C joined in either order;
 *   3. the surname is one of E's tokens and E's other tokens include every given name
 *      ("Tatum, Jayson", "Jayson Tatum BOS"), or the given names concatenated ("TJ McConnell"),
 *      or are all tokens C also carries ("Gilgeous-Alexander"), or C is a single name E contains;
 * plausible when
 *   4. the surname is one of E's tokens and E has no other token ("Tatum");
 *   5. the surname is one of E's tokens and another E token of 3+ letters is a near miss of a
 *      given name: one is a prefix of the other with 3+ letters ("Steph", "Cam", "Nic", "Matt",
 *      "Herb", "Jay"), they are within one edit ("Jason", "ayson"), or the token is within one
 *      edit of a 3+ letter prefix of it ("Nick" / "Stef" against "Nicolas" / "Stephen");
 *   6. the surname is one of E's tokens and E's single-letter tokens are initials: one initial
 *      equal to the first given name's ("J. Tatum"), or several equal to ALL the given names'
 *      initials in order ("T J McConnell"), or a two-letter token equal to all of them ("HS Kim"
 *      for "Ha-Seong Kim"). Several initials that only share the first one ("A.J. Johnson"
 *      against "Andre Johnson") are a different player and are NOT refused;
 *   7. every given name is one of E's tokens and another E token is a near miss of the
 *      surname: within one edit ("Tatem", "Tatumm", "Tatums", "Antetokoumpo") or one adjacent
 *      swap ("Tautm"), a 4+ letter prefix of it ("Tatu"), or its initial ("Jayson T.", "Giannis A");
 *   8. (WORK-2026110802 review) an E token is a near-miss spelling of the surname (one edit or
 *      one adjacent swap) and either it is E's only token and the surname has 4+ letters
 *      ("Tatem"), or another E token may stand for a given name (`isGivenNameNearMiss`: the
 *      initial, a 3+ letter prefix pair, a near-miss spelling -- "J Tatem", "Jay Tatem",
 *      "Jason Tatem", "Jaysen Tatem");
 *   9. the surname is one of E's tokens and another E token is the initials of the whole
 *      catalog name ("JT Tatum");
 *  10. E joined, or one E token, of 6+ letters is a near-miss spelling of C joined in either
 *      order ("JaysonTatem").
 * Rules 5 and 7 also accept one adjacent swap as a near miss ("Jaysno Tatum").
 * A different surname (more than one typo away) never triggers 8-10, so "Jayson Williams" and
 * "Jaylen Tatum" stay gaps that only need the operator's confirmation.
 * Each rule is also tried with German transliterations undone ("oe"/"ue"/"ae" -> o/u/a), so
 * "Schroeder" matches "Schröder" (folded "schroder").
 * Not handled (left to the PM): nicknames and initialisms that share no prefix with the
 * catalog name ("Mike" for "Michael", "Wardell", "SGA", "MPJ", "KAT", "King James").
 */
function catalogPlayerMatch(enteredTokens: string[], catalogTokens: string[]): 'resolves' | 'plausible' | null {
  const direct = matchPlayerTokens(enteredTokens, catalogTokens);
  if (direct === 'resolves') return direct;
  // German transliteration typed for an umlaut ("Schroeder" for "Schröder", folded "schroder").
  const transliterated = enteredTokens.map((token) => token.replace(/oe/gu, 'o').replace(/ue/gu, 'u').replace(/ae/gu, 'a'));
  if (transliterated.some((token, index) => token !== enteredTokens[index])) {
    return matchPlayerTokens(transliterated, catalogTokens) ?? direct;
  }
  return direct;
}

function matchPlayerTokens(enteredTokens: string[], catalogTokens: string[]): 'resolves' | 'plausible' | null {
  const entered = playerNameCore(enteredTokens);
  const catalog = playerNameCore(catalogTokens);
  if (entered.length === 0 || catalog.length === 0) return null;
  if (isSameEntityName(entered, catalog)) return 'resolves';

  const catalogJoined = catalog.join('');
  const catalogReversed = [...catalog].reverse().join('');
  const enteredJoined = entered.join('');
  if (enteredJoined === catalogReversed || contiguousRuns(catalog).has(enteredJoined)) return 'resolves';
  if (entered.some((token) => token === catalogJoined || token === catalogReversed)) return 'resolves';

  const surname = catalog[catalog.length - 1] as string;
  const given = catalog.slice(0, -1);

  if (entered.includes(surname)) {
    if (given.length === 0) return 'resolves';
    const others = entered.filter((token) => token !== surname);
    if (others.length === 0) return 'plausible';
    if (given.every((name) => entered.includes(name))) return 'resolves';
    if (others.includes(given.join(''))) return 'resolves';
    if (others.every((token) => catalog.includes(token))) return 'resolves';
    // A 3+ letter surname is searched on its own, so the row is always retrieved. A shorter
    // one is not: then only a given-name token the searches themselves reach counts -- a prefix
    // of it (searched plain) or a 5+ letter near miss (`nearMissProbes`).
    const surnameSearched = surname.length >= 3;
    if (
      others.some(
        (token) =>
          token.length >= 3 &&
          given.some((name) =>
            surnameSearched
              ? isPrefixPair(token, name, 3) || isNearMissSpelling(token, name) || withinOneEditOfPrefix(token, name)
              : (token.length <= name.length && isPrefixPair(token, name, 3)) ||
                (token.length >= 5 && isNearMissSpelling(token, name)),
          ),
      )
    ) {
      return 'plausible';
    }
    const initials = others.filter((token) => token.length === 1).join('');
    const givenInitials = given.map((name) => name[0]).join('');
    if (initials.length === 1 ? initials === givenInitials[0] : initials.length > 1 && initials === givenInitials) {
      return 'plausible';
    }
    if (givenInitials.length > 1 && others.some((token) => token.length === 2 && token === givenInitials)) {
      return 'plausible';
    }
    const catalogInitials = catalog.map((name) => name[0]).join('');
    if (surnameSearched && others.some((token) => token === catalogInitials)) return 'plausible';
    return null;
  }

  if (given.length > 0 && given.every((name) => entered.includes(name))) {
    // The row is retrieved by a given name's own search when one has 3+ letters; otherwise only
    // by the surname-side token: a 4+ letter prefix (searched plain) or a 5+ letter near miss.
    const givenSearched = given.some((name) => name.length >= 3);
    const rest = entered.filter((token) => !given.includes(token));
    if (
      rest.some(
        (token) =>
          ((givenSearched || token.length >= 5) && isNearMissSpelling(token, surname)) ||
          (token.length >= 4 && surname.startsWith(token)) ||
          // An initial is reached by the whole-name search, in either order ("Bo B": "bo%b").
          (token.length === 1 && token === surname[0]),
      )
    ) {
      return 'plausible';
    }
  }

  // Rule 8: a near-miss surname, alone or beside something that may stand for a given name.
  // 5+ letters only: that is what `nearMissProbes` can retrieve without a two-letter query.
  for (let index = 0; index < entered.length; index += 1) {
    const token = entered[index] as string;
    if (token.length < 5 || !isNearMissSpelling(token, surname)) continue;
    const others = entered.filter((_, otherIndex) => otherIndex !== index);
    if (others.length === 0) return 'plausible';
    if (others.some((other) => given.some((name) => isGivenNameNearMiss(other, name)))) return 'plausible';
  }

  // Rule 10: one entered token is a near-miss concatenation of the whole catalog name, in either
  // order. Only when the concatenation probes reach the row: its first (or last) four letters
  // are intact and lie inside the catalog's first (or last) word, which has 4+ letters -- the
  // catalog display separates the words, so a probe spanning them would match nothing.
  if (catalog.length > 1) {
    const first = catalog[0] as string;
    const reachable = (value: string, joined: string, head: string, tail: string) =>
      (head.length >= 4 && value.slice(0, 4) === joined.slice(0, 4)) ||
      (tail.length >= 4 && value.slice(-4) === joined.slice(-4));
    const nearJoined = (value: string) =>
      value.length >= 6 &&
      ((isNearMissSpelling(value, catalogJoined) && reachable(value, catalogJoined, first, surname)) ||
        (isNearMissSpelling(value, catalogReversed) && reachable(value, catalogReversed, surname, first)));
    if (entered.some(nearJoined)) return 'plausible';
  }
  return null;
}

/**
 * Letters with common diacritic variants in player names (á é í ó ú ý ü ö ä ā; ñ ń ņ ç č ć š ś ş
 * ž ź ż ğ ģ ł ļ ľ ř ŗ ď đ ť ţ ķ). In an accent-tolerant pattern they become the ILIKE single-character wildcard `_`, so
 * the ASCII spelling "Munoz" finds the catalog's "Muñoz". The reference search applies the
 * pattern as `ILIKE '%<pattern>%'` and does not fold accents (packages/db
 * runtime-repositories.ts searchPlayers), so the tolerance has to live in the pattern. Patterns
 * are built only from folded [a-z0-9] tokens, so no literal `%`, `_` or `\` ever reaches them.
 */
const DIACRITIC_VOWELS: ReadonlySet<string> = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const DIACRITIC_CONSONANTS: ReadonlySet<string> = new Set(['c', 'n', 's', 'z', 'g', 'l', 'r', 'd', 't', 'k']);
const DIACRITIC_LETTERS: ReadonlySet<string> = new Set([...DIACRITIC_VOWELS, ...DIACRITIC_CONSONANTS]);

/**
 * `token` with every letter in `wildcards` replaced by `_` -- or null when that keeps fewer
 * than two literal letters ("ian" -> "___"): such a pattern matches nearly every row, would
 * saturate on every request and so refuse every gap.
 */
function wildcardPattern(token: string, wildcards: ReadonlySet<string>): string | null {
  const pattern = [...token].map((character) => (wildcards.has(character) ? '_' : character)).join('');
  return pattern.replace(/_/gu, '').length >= 2 ? pattern : null;
}

/**
 * The accent-tolerant ILIKE patterns for one folded token. Wildcarding vowels and consonants
 * together often leaves too few literal letters ("munoz" -> "m____"), so each class is also
 * wildcarded alone: vowels ("r_m_r_z" finds "Ramírez") and consonants ("mu_o_" finds "Muñoz",
 * "do__i_" finds "Dončić"). German "oe"/"ue"/"ae" transliterations get their own patterns.
 * Known limits: a token accented in BOTH a vowel and a consonant whose combined pattern keeps
 * under two literals ("Núñez" typed "Nunez", "Jiří" typed "Jiri") is missed, as is "ss" for "ß".
 */
function accentTolerantPatterns(token: string): string[] {
  const patterns = [DIACRITIC_LETTERS, DIACRITIC_VOWELS, DIACRITIC_CONSONANTS].map((wildcards) =>
    wildcardPattern(token, wildcards),
  );
  // German transliteration: "oe" / "ue" / "ae" typed for ö / ü / ä ("Schroeder", "Poeltl",
  // "Mueller", "Oezil") is one catalog letter, so the digraph becomes one `_`.
  const transliterated = token.replace(/oe|ue|ae/gu, '_');
  if (transliterated !== token) {
    patterns.push(wildcardPattern(transliterated, new Set()), wildcardPattern(transliterated, DIACRITIC_VOWELS));
  }
  return patterns.filter((pattern): pattern is string => pattern !== null && pattern !== token);
}

/** The single accent-tolerant form used inside the combined full-name query. */
function accentTolerantPattern(token: string): string {
  return wildcardPattern(token, DIACRITIC_LETTERS) ?? token;
}

/**
 * Every search one manual-player gap proof runs. Each row `catalogPlayerMatch` can accept
 * contains, as a substring, an entered core token of three or more letters (its surname or its
 * single name, possibly accented), or -- when the entry is a concatenation ("JaysonTatum") --
 * the first or last letters of that long token. So the searches are:
 *   1. the whole name, accent-tolerant tokens joined by `%` -- the specific query, first -- and
 *      the same in reverse token order;
 *   2. each core token of 3+ letters, plain (the in-memory repository has no ILIKE) and in
 *      its accent-tolerant forms (`accentTolerantPatterns`: "munoz" -> "mu_o_" finds "Muñoz");
 *   3. for each core token of 5+ letters (a possible concatenation, including across a
 *      catalog apostrophe: "deaaron" -> "aron" finds "De'Aaron Fox"), its first and last four
 *      letters plain and first and last five accent-tolerant ("jays" finds "Jayson Tatum").
 * Any search coming back full without a covering row fails closed. Queries carry only
 * [a-z0-9], `_` and `%`; the entered name cannot add a wildcard because `%`, `_` and `\` are
 * refused characters (`assertManualPlayerNameCharacters`).
 */
function manualPlayerCoverageQueries(displayName: string): string[] {
  const core = playerNameCore(aliasTokens(displayName));
  const searchable = core.filter((token) => token.length >= 3);
  const queries = [core.map(accentTolerantPattern).join('%')];
  // The whole name in reverse order too: "Wu A" finds "Andrew Wu" even though neither token is
  // long enough for its own search (two-letter tokens are not searched alone -- "li" or "bo"
  // would saturate every request).
  if (core.length > 1) queries.push([...core].reverse().map(accentTolerantPattern).join('%'));
  for (const token of searchable) {
    queries.push(token, ...accentTolerantPatterns(token));
  }
  for (const token of searchable.filter((candidate) => candidate.length >= 5)) {
    queries.push(
      token.slice(0, 4),
      token.slice(-4),
      accentTolerantPattern(token.slice(0, 5)),
      accentTolerantPattern(token.slice(-5)),
    );
  }
  for (const token of searchable) queries.push(...nearMissProbes(token));
  return dedupeQueries(queries);
}

/**
 * Codex review (MAJOR): searches that retrieve every catalog word one typo away from `token`
 * (`isNearMissSpelling`: one insertion, deletion, substitution or adjacent swap), so the
 * near-miss rules of `catalogPlayerMatch` always get to see the row. "J Tautm" used to search
 * only `j%tautm`, `tautm` and its accent and concatenation forms, none of which contain "Tatum",
 * so the near miss was never examined and the gap was accepted.
 *
 * One typo changes letters only inside one window of two adjacent positions (i, i+1), so
 * `token[:i] % token[i+2:]` -- the rest of the word, in order, anything between -- is in the
 * catalog word. The existing probes already cover two ranges: `token[:4]` survives a window
 * with i >= 4, and `token[-4:]` one with i + 1 <= n - 5. Only the windows between them get a
 * probe of their own: four for a 5-letter word, three for 6, two for 7, one for 8 and none from
 * 9 on. Each keeps n - 2 >= 3 literal letters, the floor every plain token search already uses.
 * Words under 5 letters get none (their windows would leave two-letter probes, which saturate),
 * and the matcher's near-miss rules do not rely on retrieving them.
 */
function nearMissProbes(token: string): string[] {
  const probes: string[] = [];
  if (token.length < 5) return probes;
  for (let index = 0; index + 1 < token.length; index += 1) {
    const coveredByPrefixProbe = index >= 4;
    const coveredBySuffixProbe = index + 1 <= token.length - 5;
    if (coveredByPrefixProbe || coveredBySuffixProbe) continue;
    const before = token.slice(0, index);
    const after = token.slice(index + 2);
    probes.push(before && after ? `${before}%${after}` : before || after);
  }
  return probes;
}

/**
 * Writes the manual-player labels onto the pick metadata. Server-authoritative: the client's
 * `playerProvenance`, `manualEntry` and `manualOverrideFields` are overwritten, so the
 * persisted pick says "manual player, unverified identity" exactly when this validator's
 * bounded search found no canonical match (never proof of catalog absence) -- the
 * provenance CLV exclusion (clv-service.ts) and the receipt read -- and never because a
 * client said so. Other manual fields the client declared (e.g. `sportsbook`) are kept.
 */
function stampManualPlayerProvenance(
  payload: SubmissionPayload,
  displayName: string,
  rejectedCandidates: readonly ManualPlayerCandidate[],
) {
  const metadata = payload.metadata ?? {};
  // Persist the validated name, not the raw request value, wherever the pick names its player.
  const resolution = isRecord(metadata['participantResolution']) ? metadata['participantResolution'] : {};
  const { confirmedNotCandidates: _clientConfirmation, ...manualPlayer } = isRecord(resolution['manualPlayer'])
    ? resolution['manualPlayer']
    : {};
  // The audit trail: which catalog candidates the operator ruled out. Server-written from the
  // candidate set it recomputed and matched; any client `manualPlayerReview` is overwritten.
  // `searchedName` and `identity` say what the evidence is: a bounded name search that found
  // no canonical match. That is not proof the catalog lacks the player (ILIKE does not fold
  // accents, so "L Doncix" never retrieves "Luka Dončić"), so the pick is labeled unverified.
  const manualPlayerReview: ManualPlayerReview = {
    operatorConfirmed: rejectedCandidates.length > 0,
    rejectedCandidates: rejectedCandidates.map((candidate) => ({
      participantId: candidate.participantId,
      displayName: candidate.displayName,
    })),
    searchedName: displayName,
    identity: 'unverified-no-canonical-match',
  };
  const confirmation =
    rejectedCandidates.length > 0
      ? { confirmedNotCandidates: rejectedCandidates.map((candidate) => candidate.participantId) }
      : {};
  const nameFields: Record<string, string> = {};
  for (const field of PLAYER_NAME_FIELDS) {
    if (typeof metadata[field] === 'string') nameFields[field] = displayName;
  }
  const declaredFields = Array.isArray(metadata['manualOverrideFields'])
    ? metadata['manualOverrideFields'].filter(
        (field): field is string => typeof field === 'string' && field !== 'player',
      )
    : [];
  payload.metadata = {
    ...metadata,
    ...nameFields,
    participantResolution: {
      ...resolution,
      manualPlayer: { ...manualPlayer, displayName, reason: manualPlayerReason, ...confirmation },
    },
    manualPlayerReview,
    playerProvenance: manualPlayerProvenance,
    manualEntry: true,
    manualOverrideFields: [...new Set(declaredFields), 'player'],
  };
}

async function verifyManualPlayerCoverageGap(
  displayName: string,
  sportId: string,
  referenceData: ReferenceDataRepository,
  bounds: ManualPlayerSearchBounds,
  matchupSides: ReadonlyArray<{ participantId?: string | null; displayName?: string | null }>,
): Promise<ManualPlayerCandidate[]> {
  const enteredTokens = aliasTokens(displayName);
  // Rows the searches returned that are not refused outright but are similar enough that the
  // operator must rule them out (see `rankManualPlayerCandidates`). Built from the searches
  // already issued -- no extra query, same cap and budget.
  const similarRows = new Map<string, { participantId: string; displayName: string; teamId: string | null; score: number }>();
  if (playerNameCore(enteredTokens).length === 0) fail('manualPlayer.displayName must name a player');

  const queries = manualPlayerCoverageQueries(displayName);
  if (queries.length > MANUAL_PLAYER_MAX_SEARCHES) {
    fail(`manual player "${displayName}" needs more than ${MANUAL_PLAYER_MAX_SEARCHES} coverage searches to verify`);
  }
  const deadline = Date.now() + bounds.totalBudgetMs;
  let saturatedQuery: string | null = null;

  for (const query of queries) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw searchUnavailable(displayName, `search budget of ${bounds.totalBudgetMs}ms exhausted`);
    }
    let rows: Awaited<ReturnType<ReferenceDataRepository['searchPlayers']>>;
    try {
      rows = await withTimeout(
        referenceData.searchPlayers(sportId, query, MANUAL_PLAYER_SEARCH_ROW_LIMIT),
        Math.min(bounds.perSearchTimeoutMs, remainingMs),
      );
    } catch (error) {
      throw searchUnavailable(displayName, error instanceof Error ? error.message : String(error));
    }
    if (!Array.isArray(rows)) {
      throw searchUnavailable(displayName, 'player search returned no row list');
    }
    for (const row of rows as unknown[]) {
      if (!isRecord(row) || typeof row['displayName'] !== 'string' || typeof row['participantId'] !== 'string') {
        throw searchUnavailable(displayName, 'player search returned a malformed row');
      }
      const match = catalogPlayerMatch(enteredTokens, aliasTokens(row['displayName']));
      if (match === 'resolves') {
        fail(
          `manual player "${displayName}" resolves to canonical player ${row['participantId']} (${row['displayName']}); use the canonical selection`,
        );
      }
      if (match === 'plausible') {
        fail(
          `manual player "${displayName}" may be canonical player ${row['participantId']} (${row['displayName']}); a name this close to a covered player is refused -- select the canonical player`,
        );
      }
      const score = candidateSimilarity(enteredTokens, aliasTokens(row['displayName']));
      if (score > 0 && !similarRows.has(row['participantId'])) {
        similarRows.set(row['participantId'], {
          participantId: row['participantId'],
          displayName: row['displayName'],
          teamId: typeof row['teamId'] === 'string' ? row['teamId'] : null,
          score,
        });
      }
    }
    if (rows.length >= MANUAL_PLAYER_SEARCH_ROW_LIMIT && saturatedQuery === null) {
      saturatedQuery = query;
    }
  }

  // A search came back full: a covering row may sit past the row limit, so the gap is not
  // proved. Fail closed rather than record it.
  if (saturatedQuery !== null) {
    throw new ApiError(
      422,
      'SMART_FORM_MANUAL_PLAYER_UNVERIFIABLE',
      `manual player "${displayName}" cannot be checked against the catalog: at least ${MANUAL_PLAYER_SEARCH_ROW_LIMIT} catalog players match "${saturatedQuery}"; enter the full name or select the canonical player`,
    );
  }
  return rankManualPlayerCandidates([...similarRows.values()], matchupSides);
}

/**
 * How similar a catalog player's name is to the entered one, on folded core tokens; 0 means
 * not similar enough to list. Each entered token scores its best pairing with a catalog token:
 * the same token 4 (6 when it is the catalog surname), within one edit 3, a 3+ letter prefix
 * pair 2, within two edits (both 4+ letters) 1. Only rows `catalogPlayerMatch` did not refuse
 * reach here, so this never decides acceptance: it only decides what the operator is asked to
 * rule out ("Tyler Herro" lists the catalog's other Tylers).
 */
function candidateSimilarity(enteredTokens: string[], catalogTokens: string[]): number {
  const entered = playerNameCore(enteredTokens);
  const catalog = playerNameCore(catalogTokens);
  if (entered.length === 0 || catalog.length === 0) return 0;
  const surname = catalog[catalog.length - 1];
  let score = 0;
  for (const token of entered) {
    let best = 0;
    for (const name of catalog) {
      if (token === name) best = Math.max(best, name === surname ? 6 : 4);
      else if (token.length >= 3 && name.length >= 3 && withinOneEdit(token, name)) best = Math.max(best, 3);
      else if (isPrefixPair(token, name, 3)) best = Math.max(best, 2);
      else if (Math.min(token.length, name.length) >= 4 && editDistanceAtMost(token, name, 2)) best = Math.max(best, 1);
    }
    score += best;
  }
  return score;
}

/** True when the Levenshtein distance between `left` and `right` is at most `limit`. */
function editDistanceAtMost(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]! <= limit;
}

/** Code-point order, so the candidate order never depends on the server's locale. */
function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The candidates the operator must rule out: at most `manualPlayerMaxCandidates`, by
 * similarity (highest first), then display name, then participant id -- a total, deterministic
 * order, so the same catalog always yields the same list and the confirmation can be bound.
 */
function rankManualPlayerCandidates(
  rows: Array<{ participantId: string; displayName: string; teamId: string | null; score: number }>,
  matchupSides: ReadonlyArray<{ participantId?: string | null; displayName?: string | null }>,
): ManualPlayerCandidate[] {
  return [...rows]
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareCodePoints(left.displayName, right.displayName) ||
        compareCodePoints(left.participantId, right.participantId),
    )
    .slice(0, manualPlayerMaxCandidates)
    .map((row) => {
      const side = row.teamId ? matchupSides.find((candidate) => candidate.participantId === row.teamId) : undefined;
      return {
        participantId: row.participantId,
        displayName: row.displayName,
        teamId: row.teamId,
        teamName: side?.displayName ?? null,
      };
    });
}

/**
 * `manualPlayer.confirmedNotCandidates`, validated: absent (undefined/null) -> null; otherwise
 * an array of at most `manualPlayerMaxCandidates` distinct, non-empty, bounded strings.
 */
function readConfirmedNotCandidates(manualPlayer: unknown): string[] | null {
  const raw = isRecord(manualPlayer) ? manualPlayer['confirmedNotCandidates'] : undefined;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > manualPlayerMaxCandidates) {
    fail(`manualPlayer.confirmedNotCandidates must be a list of at most ${manualPlayerMaxCandidates} participant ids`);
  }
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0 || id.length > MANUAL_PLAYER_CANDIDATE_ID_MAX_LENGTH) {
      fail('manualPlayer.confirmedNotCandidates must hold participant ids');
    }
  }
  if (new Set(raw).size !== raw.length) fail('manualPlayer.confirmedNotCandidates must not repeat an id');
  return raw as string[];
}

/**
 * The operator's confirmation is bound to the candidate set the server just recomputed: it is
 * accepted only when it names exactly those participant ids (any order). No candidates and no
 * confirmation is today's path. Anything else -- no confirmation while candidates exist, or a
 * partial, extra, stale or forged list -- is a 409 carrying the current candidates, and nothing
 * is written. An exact or near match never gets here: it was refused above, confirmed or not.
 */
function assertCandidatesConfirmed(
  displayName: string,
  candidates: readonly ManualPlayerCandidate[],
  confirmed: readonly string[] | null,
) {
  const confirmedIds = confirmed ?? [];
  const expectedIds = new Set(candidates.map((candidate) => candidate.participantId));
  if (confirmedIds.length === expectedIds.size && confirmedIds.every((id) => expectedIds.has(id))) return;
  throw new ApiError(
    409,
    manualPlayerConfirmationRequiredCode,
    confirmed === null
      ? `manual player "${displayName}" is similar to ${candidates.length} catalog player(s); confirm it is none of them, or select the canonical player`
      : `manualPlayer.confirmedNotCandidates does not match the current catalog candidates for "${displayName}"; review the ${candidates.length} candidate(s) again`,
    { candidates: candidates.map((candidate) => ({ ...candidate })) },
  );
}

function searchUnavailable(displayName: string, reason: string): ApiError {
  return new ApiError(
    503,
    'SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE',
    `player search failed while verifying the manual player "${displayName}"; retry the submission -- a failed search is never recorded as an unverified manual player (${reason})`,
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
// WORK-2026110802 MANUAL_PLAYER_COVERAGE_GAP_END

/** True when the payload carries anything the Smart Form itself would send. */
function carriesSmartFormFields(payload: SubmissionPayload): boolean {
  const metadata = payload.metadata;
  return (
    metadata?.['distributionMode'] !== undefined ||
    metadata?.['participantResolution'] !== undefined
  );
}

function matchesCanonicalEventName(submitted: string, canonical: string) {
  const stripGameNumber = (value: string) => normalize(value).replace(/\s*·\s*game\s+\d+$/u, '');
  return stripGameNumber(submitted) === stripGameNumber(canonical);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// UTV2-1853 SMART_FORM_NUMERIC_BOUNDS_START
// SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md fixes these bounds and states, under
// "Server-Side Enforcement", that a value the form rejects must also be rejected by the
// API. Today only the browser enforces them, so a modified client, a replayed request, or
// a direct POST carrying source:'smart-form' persists values the product contract forbids.
//
// The literals are duplicated from apps/smart-form/lib/form-schema.ts rather than shared:
// packages never import from apps and apps never import from apps (root CLAUDE.md core
// invariant 8), so no module may legally hold the single copy. The duplication is made
// self-policing instead -- smart-form-validation.test.ts reads form-schema.ts and asserts
// each literal below still appears in it, the same drift-test shape UTV2-1688 used for the
// executor-result regexes.
export const SMART_FORM_ODDS_MIN_MAGNITUDE = 100;
export const SMART_FORM_ODDS_MAX_MAGNITUDE = 50000;
export const SMART_FORM_UNITS_MIN = 0.5;
export const SMART_FORM_UNITS_MAX = 5;
export const SMART_FORM_UNITS_STEP = 0.5;
export const SMART_FORM_LINE_MAX_MAGNITUDE = 999.5;
export const SMART_FORM_CONVICTION_MIN = 1;
export const SMART_FORM_CONVICTION_MAX = 10;

/**
 * A numeric bound violation is not a relationship failure. Reusing
 * SMART_FORM_RELATIONSHIP_INVALID would report "this selection does not resolve to a
 * canonical participant" for a submission whose participants resolved perfectly and whose
 * odds were 7 -- a misdiagnosis an operator would act on.
 */
function failBound(message: string): never {
  throw new ApiError(422, 'SMART_FORM_GUARDRAIL_INVALID', message);
}

function assertSmartFormNumericBounds(payload: SubmissionPayload): void {
  const { odds, stakeUnits, line } = payload;

  // Presence is deliberately NOT asserted. `odds` and `stakeUnits` are optional in
  // SubmissionPayload (packages/contracts/src/submission.ts:21-22) and submit-pick.ts reads
  // both through readOptionalNumber. This guard bounds the values a submission does carry;
  // making either mandatory would be a field-presence contract change, which belongs with
  // that contract rather than in a bounds guard.
  if (odds !== undefined) {
    if (!Number.isFinite(odds)) {
      failBound('odds must be a finite number when provided');
    }
    if (!Number.isInteger(odds)) {
      failBound(`odds must be a whole number in American format (received ${odds})`);
    }
    const oddsMagnitude = Math.abs(odds);
    if (
      oddsMagnitude < SMART_FORM_ODDS_MIN_MAGNITUDE ||
      oddsMagnitude > SMART_FORM_ODDS_MAX_MAGNITUDE
    ) {
      failBound(
        `odds must be American format between ${SMART_FORM_ODDS_MIN_MAGNITUDE} and ` +
          `${SMART_FORM_ODDS_MAX_MAGNITUDE} in magnitude (received ${odds})`,
      );
    }
  }

  if (stakeUnits !== undefined) {
    if (!Number.isFinite(stakeUnits)) {
      failBound('stakeUnits must be a finite number when provided');
    }
    if (stakeUnits < SMART_FORM_UNITS_MIN || stakeUnits > SMART_FORM_UNITS_MAX) {
      failBound(
        `stakeUnits must be between ${SMART_FORM_UNITS_MIN} and ${SMART_FORM_UNITS_MAX} ` +
          `(received ${stakeUnits})`,
      );
    }
    // Compared as a quotient of the step so 1.5 is exact rather than a float remainder.
    if (!Number.isInteger(stakeUnits / SMART_FORM_UNITS_STEP)) {
      failBound(
        `stakeUnits must be a multiple of ${SMART_FORM_UNITS_STEP} (received ${stakeUnits})`,
      );
    }
  }

  // `line` is deliberately not required: a moneyline pick legitimately carries none, which
  // is what the contract's "where required" qualifier means.
  if (line !== undefined) {
    if (!Number.isFinite(line)) failBound('line must be a finite number when provided');
    if (Math.abs(line) > SMART_FORM_LINE_MAX_MAGNITUDE) {
      failBound(
        `line must be within +/-${SMART_FORM_LINE_MAX_MAGNITUDE} in magnitude (received ${line})`,
      );
    }
  }

  const conviction = payload.metadata?.['capperConviction'];
  if (conviction !== undefined) {
    if (typeof conviction !== 'number' || !Number.isInteger(conviction)) {
      failBound('capperConviction must be a whole number when provided');
    }
    if (conviction < SMART_FORM_CONVICTION_MIN || conviction > SMART_FORM_CONVICTION_MAX) {
      failBound(
        `capperConviction must be between ${SMART_FORM_CONVICTION_MIN} and ` +
          `${SMART_FORM_CONVICTION_MAX} (received ${conviction})`,
      );
    }
  }
}
// UTV2-1853 SMART_FORM_NUMERIC_BOUNDS_END

function fail(message: string): never {
  throw new ApiError(422, 'SMART_FORM_RELATIONSHIP_INVALID', message);
}
