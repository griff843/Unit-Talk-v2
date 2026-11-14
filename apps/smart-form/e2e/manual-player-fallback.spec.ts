import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// WORK-2026110802 -- canonical teams + one manually entered player.
//
// Operator-run evidence, like every spec in this directory: no CI workflow runs it.
// Connected, not mocked: the real catalog, the real team and player search, the real
// local API (in-memory persistence) and the persisted pick read back. Only the
// Auth.js session and the reference availability probe are fulfilled here, as in
// phase-one.spec.ts. The player-search ERROR case is the one deliberate exception:
// a failed search cannot be produced on demand from a healthy local API, so that
// one route is made to fail.
//
// The operator's 2026-11-08 failures were Herro (threes) and Burries (rebounds) in
// an NBA matchup and Dulcich (receptions) in an NFL matchup. The local QA catalog
// carries neither player -- the same coverage gap production has -- so each of
// those names reaches a definitive not-found here exactly as it did there.

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { name: 'Griff Test' },
      capperId: 'griff843',
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  }));
  await page.route('**/api/reference-data/availability?**', async (route) => {
    const sportId = new URL(route.request().url()).searchParams.get('sport') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { sportId, teamsAvailable: true, playersAvailable: true } }),
    });
  });
  await page.addInitScript(() => {
    const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    localStorage.setItem('ut_capper_token', `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: 'griff843', capperId: 'griff843', displayName: 'Griff Test', role: 'capper',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.test-signature`);
  });
});

async function assertIsolatedApiReady(request: APIRequestContext) {
  const response = await request.get(`${apiBaseUrl}/api/health/runtime`);
  expect(response.status(), 'The local API runtime endpoint must be reachable').toBe(200);
  expect(await response.json()).toMatchObject({ service: 'api', persistenceMode: 'in_memory' });
}

async function searchRows(
  request: APIRequestContext,
  kind: 'teams' | 'players',
  sportId: string,
  query: string,
  teamId?: string,
) {
  const response = await request.get(
    `${apiBaseUrl}/api/reference-data/search/${kind}?sport=${sportId}&q=${encodeURIComponent(query)}${
      teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
    }`,
  );
  expect(response.status(), `${kind} search must return HTTP 200`).toBe(200);
  const payload = await response.json() as { data?: Array<{ participantId: string; displayName: string }> };
  return payload.data ?? [];
}

async function readPersistedPick(request: APIRequestContext, pickId: string) {
  const response = await request.get(`${apiBaseUrl}/api/picks?status=validated&limit=200`);
  expect(response.status(), 'Persisted-pick lookup must return HTTP 200').toBe(200);
  const payload = await response.json() as { picks?: Array<Record<string, unknown>> };
  const pick = payload.picks?.find((candidate) => candidate['id'] === pickId);
  expect(pick, `Pick ${pickId} must be readable from the API repository after submission`).toBeTruthy();
  return pick as Record<string, unknown>;
}

async function assertTrackOnlyHasNoOutbox(request: APIRequestContext, pickId: string) {
  const response = await request.get(`${apiBaseUrl}/api/qa/pick-status/${pickId}`);
  expect(response.status(), 'Track Only delivery-state lookup must return HTTP 200').toBe(200);
  expect(await response.json()).toMatchObject({ pickId, status: 'validated', outboxId: null, outboxStatus: null });
}

type Shape = {
  label: string;
  sport: 'NBA' | 'NFL';
  awayQuery: string;
  homeQuery: string;
  teamQuery: string;
  player: string;
  statType: string;
  line: string;
};

async function openStructuredMatchup(page: Page, shape: Shape) {
  await page.goto('/submit');
  await page.getByRole('button', { name: shape.sport, exact: true }).click();
  await page.getByRole('button', { name: 'Manual entry' }).click();
  await page.getByLabel('Away Team').fill(shape.awayQuery);
  await page.getByRole('button', { name: new RegExp(`${shape.awayQuery}\\s+team`, 'i') }).first().click();
  await page.getByLabel('Home Team').fill(shape.homeQuery);
  await page.getByRole('button', { name: new RegExp(`${shape.homeQuery}\\s+team`, 'i') }).first().click();
  await page.getByRole('button', { name: /PROP\s*Player Prop/i }).first().click();
  // With both sides chosen, the team field is a choice between those two sides.
  await page.getByTestId('manual-matchup-team-choices')
    .getByRole('button', { name: new RegExp(shape.teamQuery, 'i') }).first().click();
}

async function fillLine(page: Page, shape: Shape) {
  await page.getByRole('combobox', { name: 'Stat Type' }).click();
  await page.getByRole('option', { name: shape.statType, exact: true }).click();
  await page.getByLabel('Over / Under').click();
  await page.getByRole('option', { name: 'Over', exact: true }).click();
  await page.locator('input[name="line"]').fill(shape.line);
  await page.locator('input[name="odds"]').fill('-110');
  await page.getByRole('button', { name: '1u', exact: true }).first().click();
  await page.getByRole('button', { name: '7', exact: true }).click();
}

async function submitAndWait(page: Page, trigger: () => Promise<void>) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/submissions');
  await trigger();
  return responsePromise;
}

const shapes: Shape[] = [
  { label: 'Herro (NBA threes)', sport: 'NBA', awayQuery: 'Celtics', homeQuery: 'Knicks', teamQuery: 'Knicks', player: 'Tyler Herro', statType: 'Threes', line: '2.5' },
  { label: 'Burries (NBA rebounds)', sport: 'NBA', awayQuery: 'Celtics', homeQuery: 'Knicks', teamQuery: 'Celtics', player: 'Burries', statType: 'Rebounds', line: '4.5' },
  { label: 'Dulcich (NFL receptions)', sport: 'NFL', awayQuery: 'Lions', homeQuery: 'Dolphins', teamQuery: 'Lions', player: 'Greg Dulcich', statType: 'Receptions', line: '3.5' },
];

for (const shape of shapes) {
  test(`WORK-2026110802: ${shape.label} saves as a Track Only manual player beside canonical teams`, async ({ page, request }) => {
    await assertIsolatedApiReady(request);
    // The precondition the whole case rests on: the player is genuinely absent locally.
    expect(await searchRows(request, 'players', shape.sport, shape.player)).toEqual([]);
    const [away] = await searchRows(request, 'teams', shape.sport, shape.awayQuery);
    const [home] = await searchRows(request, 'teams', shape.sport, shape.homeQuery);
    const [team] = await searchRows(request, 'teams', shape.sport, shape.teamQuery);
    test.skip(!away || !home || !team, `local ${shape.sport} team catalog lacks ${shape.awayQuery}/${shape.homeQuery}`);

    await openStructuredMatchup(page, shape);
    await page.getByLabel('Player', { exact: true }).fill(shape.player);

    // Not offered until the search has definitively found nothing; then offered with honest copy.
    const enterManually = page.getByTestId('manual-player-enter');
    await expect(enterManually).toBeVisible();
    await expect(page.getByTestId('manual-player-fallback')).toContainText('without provider verification');
    await enterManually.click();
    await expect(page.getByTestId('manual-player-fallback')).toHaveAttribute('data-manual-player-active', 'true');
    await expect(page.getByTestId('slip-manual-player').first()).toContainText('no CLV');

    await fillLine(page, shape);

    let response = await submitAndWait(page, () =>
      page.locator('[data-testid="smart-form-submit-button"]:visible').first().click());
    // If the local catalog holds a similar player, the API first asks the operator to rule
    // the suggestions out (409); confirming "none of these" resubmits.
    let rejectedCandidates: unknown[] = [];
    if (response.status() === 409) {
      rejectedCandidates = ((await response.json()) as { error: { details: { candidates: unknown[] } } }).error.details.candidates;
      await expect(page.getByTestId('manual-player-candidates')).toBeVisible();
      response = await submitAndWait(page, () => page.getByTestId('manual-player-none-of-these').click());
    }
    expect(response.status(), `submission must reach the real local API: ${await response.text()}`).toBe(201);
    const submission = await response.json() as { data: { pickId: string; lifecycleState: string; outboxEnqueued: boolean } };
    expect(submission.data).toMatchObject({ lifecycleState: 'validated', outboxEnqueued: false });

    await expect(page.getByRole('heading', { name: 'Saved as Track Only' })).toBeVisible();
    await expect(page.getByTestId('receipt-manual-player')).toContainText(`${shape.player} (manually entered, unverified)`);
    await expect(page.getByTestId('receipt-manual-player')).toContainText('no provider verification, no CLV');

    const pick = await readPersistedPick(request, submission.data.pickId);
    const metadata = pick['metadata'] as Record<string, unknown>;
    expect(metadata).toMatchObject({
      distributionMode: 'track-only',
      playerProvenance: 'manual-unverified-identity',
      // PM F3: server-stamped labels agree with the provenance.
      manualEntry: true,
      manualPlayerReview: {
        operatorConfirmed: rejectedCandidates.length > 0,
        rejectedCandidates: rejectedCandidates.map((candidate) => {
          const { participantId, displayName } = candidate as { participantId: string; displayName: string };
          return { participantId, displayName };
        }),
        // The evidence: a bounded name search that found no canonical match, nothing more.
        searchedName: shape.player,
        identity: 'unverified-no-canonical-match',
      },
      manualOverrideFields: expect.arrayContaining(['player']),
      eventId: null,
      playerId: null,
      participantId: null,
      player: shape.player,
      teamId: team!.participantId,
      selectedOffer: null,
      participantResolution: {
        resolution: 'canonical',
        sportId: shape.sport,
        eventId: null,
        away: { participantId: away!.participantId },
        home: { participantId: home!.participantId },
        team: { participantId: team!.participantId },
        player: null,
        manualPlayer: { displayName: shape.player, canonicalParticipantId: null, reason: 'unverified-identity' },
      },
    });
    await assertTrackOnlyHasNoOutbox(request, submission.data.pickId);
  });
}

test('WORK-2026110802: a failed player search never offers manual entry and the typed name is refused', async ({ page, request }) => {
  await assertIsolatedApiReady(request);
  const shape = shapes[0]!;
  const [away] = await searchRows(request, 'teams', shape.sport, shape.awayQuery);
  test.skip(!away, 'local NBA team catalog lacks the matchup teams');
  await page.route('**/api/reference-data/search/players?**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Participant search unavailable' } }),
  }));
  let submissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/submissions') submissions += 1;
  });

  await openStructuredMatchup(page, shape);
  await page.getByLabel('Player', { exact: true }).fill(shape.player);
  await expect(page.getByText('Participant search unavailable').first()).toBeVisible();
  await expect(page.getByTestId('manual-player-enter')).toHaveCount(0);
  // Leave the player field, as an operator would, so its search-error dropdown closes.
  await page.getByLabel('Player', { exact: true }).press('Escape');
  await page.getByLabel('Player', { exact: true }).blur();
  await fillLine(page, shape);
  await page.locator('[data-testid="smart-form-submit-button"]:visible').first().click();
  await expect(page.getByText('Select a player from the results').first()).toBeVisible();
  expect(submissions, 'an errored search must not produce a submission').toBe(0);
});

// PM decision (operator-confirmed unverified player). The fixture is derived from the real local
// catalog, not mocked: a catalog player's given name with an invented surname is absent from
// the catalog (so manual entry is offered) but similar to that player (so the API lists it).
async function similarNameFixture(request: APIRequestContext, teamId?: string) {
  for (const probe of ['an', 'er', 'ar', 'on']) {
    for (const row of await searchRows(request, 'players', 'NBA', probe, teamId)) {
      const given = row.displayName.split(/\s+/u)[0] ?? '';
      if (!/^[A-Za-z]{3,}$/u.test(given)) continue;
      const name = `${given} Qwyxzer`;
      if ((await searchRows(request, 'players', 'NBA', name)).length === 0) return { row, name };
    }
  }
  return null;
}

test('WORK-2026110802: a similar catalog player is offered, and "none of these" records an unverified player', async ({ page, request }) => {
  await assertIsolatedApiReady(request);
  const fixture = await similarNameFixture(request);
  test.skip(!fixture, 'local NBA player catalog has no usable player');
  const shape = { ...shapes[0]!, player: fixture!.name };
  const [team] = await searchRows(request, 'teams', shape.sport, shape.teamQuery);
  test.skip(!team, 'local NBA team catalog lacks the matchup teams');

  await openStructuredMatchup(page, shape);
  await page.getByLabel('Player', { exact: true }).fill(shape.player);
  await page.getByTestId('manual-player-enter').click();
  await fillLine(page, shape);

  const first = await submitAndWait(page, () =>
    page.locator('[data-testid="smart-form-submit-button"]:visible').first().click());
  expect(first.status(), await first.text()).toBe(409);
  const refusal = (await first.json()) as {
    error: { code: string; details: { candidates: Array<{ participantId: string; displayName: string }> } };
  };
  expect(refusal.error.code).toBe('SMART_FORM_MANUAL_PLAYER_CONFIRMATION_REQUIRED');
  const candidates = refusal.error.details.candidates;
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.length).toBeLessThanOrEqual(5);
  expect(candidates.map((candidate) => candidate.participantId)).toContain(fixture!.row.participantId);

  // The question is shown with exactly the API's candidates; nothing was saved.
  await expect(page.getByTestId('manual-player-candidates')).toContainText('Is this one of these players?');
  await expect(page.getByTestId('manual-player-candidate')).toHaveCount(candidates.length);
  await expect(page.getByRole('heading', { name: 'Saved as Track Only' })).toHaveCount(0);

  const second = await submitAndWait(page, () => page.getByTestId('manual-player-none-of-these').click());
  expect(second.status(), await second.text()).toBe(201);
  const sentManualPlayer = (second.request().postDataJSON() as {
    metadata: { participantResolution: { manualPlayer: Record<string, unknown> } };
  }).metadata.participantResolution.manualPlayer;
  expect(sentManualPlayer['confirmedNotCandidates']).toEqual(candidates.map((candidate) => candidate.participantId));

  const submission = (await second.json()) as { data: { pickId: string } };
  await expect(page.getByTestId('receipt-manual-player')).toContainText(`${shape.player} (manually entered, unverified)`);
  await expect(page.getByTestId('receipt-manual-player-confirmed')).toContainText(
    `none of the ${candidates.length} suggested catalog player`,
  );
  // The receipt never names a catalog player beside the unverified one.
  for (const candidate of candidates) {
    await expect(page.getByTestId('receipt-manual-player')).not.toContainText(candidate.displayName);
  }

  const metadata = (await readPersistedPick(request, submission.data.pickId))['metadata'] as Record<string, unknown>;
  expect(metadata).toMatchObject({
    distributionMode: 'track-only',
    playerProvenance: 'manual-unverified-identity',
    playerId: null,
    manualPlayerReview: {
      operatorConfirmed: true,
      rejectedCandidates: candidates.map(({ participantId, displayName }) => ({ participantId, displayName })),
    },
  });
  await assertTrackOnlyHasNoOutbox(request, submission.data.pickId);
});

test('WORK-2026110802: picking a suggested player switches the leg to that canonical player', async ({ page, request }) => {
  await assertIsolatedApiReady(request);
  // A player on the selected team (Celtics @ Knicks, team Celtics): picking it keeps the team.
  const [team] = await searchRows(request, 'teams', shapes[1]!.sport, shapes[1]!.teamQuery);
  test.skip(!team, 'local NBA team catalog lacks the matchup teams');
  const fixture = await similarNameFixture(request, team!.participantId);
  test.skip(!fixture, 'local NBA player catalog has no usable player on the selected team');
  const shape = { ...shapes[1]!, player: fixture!.name };
  let submissions = 0;
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/submissions') submissions += 1;
  });

  await openStructuredMatchup(page, shape);
  await page.getByLabel('Player', { exact: true }).fill(shape.player);
  await page.getByTestId('manual-player-enter').click();
  await fillLine(page, shape);
  const first = await submitAndWait(page, () =>
    page.locator('[data-testid="smart-form-submit-button"]:visible').first().click());
  expect(first.status()).toBe(409);

  await page.locator(`[data-testid="manual-player-candidate"][data-participant-id="${fixture!.row.participantId}"]`).click();
  // The manual entry is withdrawn and the field holds the canonical player's name.
  await expect(page.getByTestId('manual-player-candidates')).toHaveCount(0);
  await expect(page.getByTestId('manual-player-fallback')).toHaveCount(0);
  await expect(page.getByLabel('Player', { exact: true })).toHaveValue(fixture!.row.displayName);
  await expect(page.getByTestId('slip-manual-player')).toHaveCount(0);
  await expect(page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: new RegExp(shape.teamQuery, 'i') }))
    .toHaveAttribute('aria-pressed', 'true');
  expect(submissions, 'picking a candidate does not submit by itself').toBe(1);
});

// Codex P2 (#1841): candidates are gathered across the whole sport, so the picked player may be on
// the other side of the matchup. The leg's team must follow the player, or the API refuses it.
test('WORK-2026110802: picking a suggested player from the other side switches the team and saves', async ({ page, request }) => {
  await assertIsolatedApiReady(request);
  const shape0 = shapes[0]!; // Celtics @ Knicks, team Knicks
  const [away] = await searchRows(request, 'teams', shape0.sport, shape0.awayQuery);
  const [home] = await searchRows(request, 'teams', shape0.sport, shape0.homeQuery);
  test.skip(!away || !home, 'local NBA team catalog lacks the matchup teams');
  const fixture = await similarNameFixture(request, away!.participantId);
  test.skip(!fixture, 'local NBA player catalog has no usable player on the away team');
  const shape = { ...shape0, player: fixture!.name };

  await openStructuredMatchup(page, shape);
  await page.getByLabel('Player', { exact: true }).fill(shape.player);
  await page.getByTestId('manual-player-enter').click();
  await fillLine(page, shape);
  const first = await submitAndWait(page, () =>
    page.locator('[data-testid="smart-form-submit-button"]:visible').first().click());
  expect(first.status(), await first.text()).toBe(409);
  const candidates = ((await first.json()) as {
    error: { details: { candidates: Array<{ participantId: string; displayName: string; teamId: string | null }> } };
  }).error.details.candidates;
  const awayCandidate = candidates.find((candidate) => candidate.teamId === away!.participantId);
  test.skip(!awayCandidate, 'the away-team fixture player did not make the five candidates');

  // A candidate on neither matchup team is listed (it is still a duplicate risk) but cannot be picked.
  for (const candidate of candidates) {
    const button = page.locator(`[data-testid="manual-player-candidate"][data-participant-id="${candidate.participantId}"]`);
    const onSide = candidate.teamId === away!.participantId || candidate.teamId === home!.participantId;
    if (onSide) await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
  }

  await page.locator(`[data-testid="manual-player-candidate"][data-participant-id="${awayCandidate!.participantId}"]`).click();
  const choices = page.getByTestId('manual-matchup-team-choices');
  await expect(choices.getByRole('button', { name: new RegExp(shape0.awayQuery, 'i') })).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.getByRole('button', { name: new RegExp(shape0.homeQuery, 'i') })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Player', { exact: true })).toHaveValue(awayCandidate!.displayName);

  const second = await submitAndWait(page, () =>
    page.locator('[data-testid="smart-form-submit-button"]:visible').first().click());
  expect(second.status(), await second.text()).toBe(201);
  const submission = (await second.json()) as { data: { pickId: string } };
  const metadata = (await readPersistedPick(request, submission.data.pickId))['metadata'] as Record<string, unknown>;
  expect(metadata['playerProvenance']).toBeUndefined();
  expect(metadata['manualPlayerReview']).toBeUndefined();
  expect(metadata).toMatchObject({
    distributionMode: 'track-only',
    participantResolution: {
      team: { participantId: away!.participantId },
      player: { participantId: awayCandidate!.participantId },
    },
  });
  await assertTrackOnlyHasNoOutbox(request, submission.data.pickId);
});
