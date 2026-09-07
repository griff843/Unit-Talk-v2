import type {
  CanonicalParticipantIdentity,
  SmartFormParticipantResolution,
  SubmissionPayload,
} from '@unit-talk/contracts';
import type { EventBrowseResult, ReferenceDataRepository } from '@unit-talk/db';
import { ApiError } from './errors.js';

const TEAM_SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER']);

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
// The outcome carries the submission's `distributionMode` because the waiver is only
// authorized for Track Only. An authenticated capper is server-pinned to `track-only` by
// handlers/submit-pick.ts, but an operator or service-role caller reaches this same validator
// with `delivery-eligible` and is *not* pinned, and a qualified delivery-eligible result
// proceeds to the controller's outbox-enqueue path. Waiving on the fallback kind alone would
// therefore admit a pick naming no canonical event into member delivery -- the opposite of
// what this contained repair is for. The mode travels with the outcome rather than being
// re-read at the gate so the gate cannot disagree with the validator about which submission
// it is looking at.
export type SmartFormDistributionMode = 'track-only' | 'delivery-eligible';

export type SmartFormValidationOutcome =
  | { kind: 'not-smart-form' }
  | { kind: 'manual-coverage-gap'; distributionMode: SmartFormDistributionMode }
  | { kind: 'structured-team-fallback'; distributionMode: SmartFormDistributionMode }
  | { kind: 'canonical-event'; eventId: string; distributionMode: SmartFormDistributionMode };

/**
 * The single predicate the event-existence gate consults.
 *
 * Both halves are load-bearing and both are affirmative. The kind must be one of the two
 * paths that were fully server-validated *without* a canonical event, and the submission
 * must be Track Only. An absent outcome is `undefined` and satisfies neither, so the gate
 * stays enforcing by default for every caller that does not pass one.
 */
export function waivesEventExistenceGate(outcome: SmartFormValidationOutcome | undefined): boolean {
  if (!outcome) return false;
  if (outcome.kind !== 'manual-coverage-gap' && outcome.kind !== 'structured-team-fallback') {
    return false;
  }
  return outcome.distributionMode === 'track-only';
}
// UTV2-1842 SMART_FORM_OUTCOME_END

export async function validateSmartFormRelationships(
  payload: SubmissionPayload,
  referenceData: ReferenceDataRepository,
): Promise<SmartFormValidationOutcome> {
  if (payload.source !== 'smart-form') return { kind: 'not-smart-form' };

  // UTV2-1672 SMART_FORM_TRIGGER_SCOPE_START
  // `smart-form` predates this product as a generic submission source, and
  // service-role callers still use it as a plain label with none of the Smart
  // Form fields. Applying the strict contract to that shape would refuse
  // submissions this lane never intended to govern. Anything the Smart Form
  // itself sends carries a distributionMode -- the capper pin in
  // handlers/submit-pick.ts guarantees it -- or a participantResolution, so
  // keying on the presence of either covers all real Smart Form traffic
  // without retrofitting the contract onto the legacy label.
  if (!carriesSmartFormFields(payload)) return { kind: 'not-smart-form' };
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

  if (resolution.resolution === 'manual') {
    await validateManualResolution(payload, resolution, sportId, referenceData);
    return { kind: 'manual-coverage-gap', distributionMode };
  }

  const eventId = readOptionalString(resolution.eventId);
  if (!eventId) {
    assertFlatMetadataIdentity(payload, resolution);
    if (!TEAM_SPORTS.has(sportId.toUpperCase())) {
      fail('canonical participant resolution without an event is not verifiable; use explicit manual override');
    }
    await validateStructuredTeamFallback(payload, resolution, sportId, referenceData);
    return { kind: 'structured-team-fallback', distributionMode };
  }

  const event = await referenceData.getEventBrowse(eventId);
  if (!event) fail(`canonical event was not found: ${eventId}`);
  validateCanonicalEvent(payload, resolution, sportId, event);
  return { kind: 'canonical-event', eventId, distributionMode };
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
) {
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

  if (resolution.player) {
    fail('canonical player selection requires a canonical event so team membership can be verified');
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
  assertMatchingDisplay(metadata?.['player'], resolution.player?.displayName, 'player');
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

  const trimmed = displayName.trim();
  const queries = new Set<string>([trimmed, foldConfusables(trimmed), aliasKey(trimmed)]);
  for (const word of [...trimmed.split(/\s+/u), ...foldConfusables(trimmed).split(/\s+/u)]) {
    if (aliasKey(word).length >= 3) {
      queries.add(word);
      // The alias key drops punctuation. Without it, "Knicks." is only ever
      // searched verbatim, ILIKE '%knicks.%' matches nothing, and a name the
      // catalog plainly carries is reported as an uncovered gap.
      queries.add(aliasKey(word));
    }
  }
  queries.delete('');

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
