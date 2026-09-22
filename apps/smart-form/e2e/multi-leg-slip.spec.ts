import { expect, test, type Page } from '@playwright/test';

// UTV2-1915 — browser proof for the multi-leg bet slip.
//
// SYNTHETIC OFFLINE UI PROOF ONLY, never staging/persistence evidence. Every
// fixture name and identity is fictional and every nonlocal request is refused,
// so nothing here can be mistaken for live odds, a real game, or a persisted
// pick. The harness follows offline-offer-slip.spec.ts.
//
// What this proves, and why each assertion is here rather than in the unit
// suite: the unit suite (test/bet-slip.test.ts) owns the slip's rules; this
// spec owns the claim that an operator can actually reach them — that adding,
// removing and reordering legs happen in the browser, that a refused leg does
// not discard the legs already in the slip, and, decisively, that a multi-leg
// slip issues NO submission request. The last one cannot be proven by a unit
// test at all: it is an assertion about the network.
test.use({ serviceWorkers: 'block' });

const fixture = {
  label: 'SYNTHETIC OFFLINE FIXTURE — NOT LIVE ODDS OR A REAL GAME',
  clock: '2026-09-15T20:05:00.000Z',
  eventDate: '2026-09-15',
} as const;

type Submission = { source: string; market: string; odds: number };

async function installOfflineFixture(page: Page) {
  const submitted: Submission[] = [];
  const denied: string[] = [];
  await page.clock.setFixedTime(new Date(fixture.clock));
  await page.addInitScript(() => {
    const encode = (value: Record<string, unknown>) =>
      btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    localStorage.setItem(
      'ut_capper_token',
      `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: 'griff843',
        capperId: 'griff843',
        displayName: 'Griff Test',
        role: 'capper',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.test-signature`,
    );
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      denied.push(url.origin);
      return route.abort('blockedbyclient');
    }
    const fulfill = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/session') {
      return fulfill({
        user: { name: 'Griff Test' },
        capperId: 'griff843',
        expires: '2026-09-16T20:05:00.000Z',
      });
    }
    if (url.pathname === '/api/reference-data/catalog') {
      return fulfill({
        data: {
          sports: [
            {
              id: 'NFL',
              name: 'NFL',
              marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'],
              statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards'],
              teams: [],
            },
          ],
          sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }],
          ticketTypes: [],
          cappers: [{ id: 'griff843', displayName: 'Griff Test' }],
        },
      });
    }
    if (url.pathname === '/api/reference-data/availability') {
      return fulfill({ data: { sportId: 'NFL', teamsAvailable: true, playersAvailable: true } });
    }
    if (url.pathname === '/api/submissions' && route.request().method() === 'POST') {
      submitted.push(route.request().postDataJSON() as Submission);
      return fulfill({
        data: {
          submissionId: 'STAGING-FIXTURE-SIMULATED-SUBMISSION',
          pickId: 'STAGING-FIXTURE-SIMULATED-PICK',
          lifecycleState: 'validated',
        },
      });
    }
    if (url.pathname.startsWith('/api/reference-data/')) {
      // Team and player search answer 200-with-nothing rather than an error.
      // That is what puts the form on its honest manual-entry path, which is
      // the path the contained pilot actually uses: NFL has 32 team rows and
      // zero players, and NCAAF nothing at all, so canonical resolution is
      // absent rather than broken.
      return fulfill({ data: [] });
    }
    if (url.pathname.startsWith('/api/')) {
      return fulfill({ error: { message: 'Offline fixture endpoint unavailable' } }, 501);
    }
    return route.continue(); // Local document/static assets only; no API passthrough.
  });
  return { submitted, denied };
}

const AWAY = 'Fixture Away Football';
const HOME = 'Fixture Home Football';

/**
 * Reach the manual NFL moneyline form with both sides entered.
 *
 * The manual path is the one the contained pilot actually uses: with no
 * canonical NFL team rows reachable, team search resolves nothing and the form
 * offers "No teams found? Enter both manually". Driving that path rather than
 * the live-offer browse keeps this spec independent of reference-data coverage.
 */
async function openManualMoneyline(page: Page) {
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NFL', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill(fixture.eventDate);
  await page.getByRole('button', { name: /ML\s*Moneyline/i }).first().click();
  await page.getByLabel('Away Team').fill(AWAY);
  await page.getByLabel('Home Team').fill(HOME);
  await page.getByRole('button', { name: /Enter both manually/i }).click();
  await expect(page.getByLabel('Matchup')).toHaveValue(`${AWAY} @ ${HOME}`);
  await page.getByRole('button', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: '1u', exact: true }).click();
}

/** Fill the one leg the form is currently editing. */
async function fillLeg(page: Page, team: string, odds: string) {
  await page.getByRole('group', { name: 'Team to Win' }).getByRole('button', { name: team, exact: true }).click();
  await page.getByLabel('Odds', { exact: true }).fill(odds);
}

test('an operator builds, reorders and trims a multi-leg slip, and it never submits', async ({ page }) => {
  const { submitted, denied } = await installOfflineFixture(page);
  await openManualMoneyline(page);

  const addLeg = page.getByTestId('add-leg-button');
  const legs = page.getByTestId('slip-leg');

  // A slip starts empty and the single-pick path is untouched.
  await expect(legs).toHaveCount(0);

  await fillLeg(page, 'Fixture Away Football', '-110');
  await addLeg.click();
  await expect(legs).toHaveCount(1);
  await expect(legs.first()).toContainText('Fixture Away Football');

  // A refused leg must not discard the leg already in the slip. Clearing the
  // odds makes the candidate incomplete; the refusal names the field.
  await page.getByLabel('Odds', { exact: true }).fill('');
  await addLeg.click();
  await expect(page.getByTestId('slip-refusal')).toContainText('Odds');
  await expect(legs).toHaveCount(1);

  await fillLeg(page, 'Fixture Home Football', '+135');
  await addLeg.click();
  await expect(legs).toHaveCount(2);
  await expect(legs.nth(0)).toContainText('Fixture Away Football');
  await expect(legs.nth(1)).toContainText('Fixture Home Football');

  // Reorder: the second leg moves to the front and nothing else changes.
  await legs.nth(1).getByRole('button', { name: 'Move leg 2 up' }).click();
  await expect(legs.nth(0)).toContainText('Fixture Home Football');
  await expect(legs.nth(1)).toContainText('Fixture Away Football');
  await expect(legs).toHaveCount(2);

  // Two legs make this a multi-leg ticket, which has no submission path yet.
  // The reason is rendered rather than the button silently disappearing.
  await expect(page.getByTestId('multi-leg-refusal')).toContainText('cannot be submitted yet');
  await page.getByTestId('smart-form-submit-button').first().click();
  await expect(page.getByTestId('multi-leg-refusal')).toBeVisible();
  expect(submitted, 'a multi-leg slip must not reach the submission endpoint').toEqual([]);

  // Removing a leg returns the slip to a submittable single pick.
  await legs.nth(0).getByRole('button', { name: 'Remove leg 1' }).click();
  await expect(legs).toHaveCount(1);
  await expect(page.getByTestId('multi-leg-refusal')).toHaveCount(0);

  expect(denied, 'No nonlocal request should be attempted').toEqual([]);
});

test('the slip never displays a combined parlay price', async ({ page }) => {
  // Pricing a parlay is @unit-talk/contracts' job (priceParlay, UTV2-1906).
  // If the UI ever grows its own copy of that rule, the displayed price and the
  // persisted price can disagree; this assertion is what makes that a failure
  // rather than a discovery.
  const { denied } = await installOfflineFixture(page);
  await openManualMoneyline(page);

  await fillLeg(page, 'Fixture Away Football', '-110');
  await page.getByTestId('add-leg-button').click();
  await fillLeg(page, 'Fixture Home Football', '+135');
  await page.getByTestId('add-leg-button').click();
  await expect(page.getByTestId('slip-leg')).toHaveCount(2);

  const slip = page.getByTestId('slip-legs');
  await expect(slip).not.toContainText(/combined/i);
  await expect(slip).not.toContainText(/parlay odds/i);
  await expect(slip).not.toContainText(/total payout/i);
  expect(denied).toEqual([]);
});

// UTV2-1916 — a refusal is rendered where it belongs, in a slip big enough for
// "where" to matter.
//
// UTV2-1915 rendered every refusal into one region above the leg list. With one
// leg that is unambiguous; with three it is not, and nothing in the value said
// which row a message meant. The refusal now carries a scope — draft, leg, or
// slip — and the panel renders a leg-scoped one inside its own <li>, associated
// by `aria-describedby` rather than by proximity.
//
// What this test can and cannot reach, stated plainly rather than worked
// around: the *negative* half is operator-reachable today and is asserted here
// at both widths — a refusal that names no leg must not appear at any row. The
// *positive* half has no operator-reachable producer yet, because `addLeg`
// refuses to admit a leg that fails validation, so no committed leg can be
// incomplete. Weakening that guard to manufacture one would delete the
// guarantee UTV2-1915 exists for. The producer arrives with the parlay ticket
// API (UTV2-1912's API third), which returns per-leg refusals the server
// derived; `legRefusalMessages` is the channel it renders through, and the unit
// suite proves the keying. That gap is recorded in the proof bundle, not hidden.
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`a refusal that names no leg is not attributed to a row (${viewport.name})`, async ({ page }) => {
    const { submitted, denied } = await installOfflineFixture(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openManualMoneyline(page);

    const addLeg = page.getByTestId('add-leg-button');
    const legs = page.getByTestId('slip-leg');

    await fillLeg(page, 'Fixture Away Football', '-110');
    await addLeg.click();
    await fillLeg(page, 'Fixture Home Football', '+135');
    await addLeg.click();
    await fillLeg(page, 'Fixture Away Football', '-125');
    await addLeg.click();
    await expect(legs).toHaveCount(3);

    // Every committed leg validated on entry, so no row carries a refusal.
    await expect(page.getByTestId('slip-leg-refusal')).toHaveCount(0);
    for (let i = 0; i < 3; i += 1) {
      await expect(legs.nth(i)).not.toHaveAttribute('aria-describedby', /.+/);
    }

    // Now refuse the *candidate* leg. It is draft-scoped: it never entered the
    // slip, so there is no row that holds it. Before UTV2-1916 this message and
    // a leg-scoped one were indistinguishable to the operator.
    await page.getByLabel('Odds', { exact: true }).fill('');
    await addLeg.click();
    await expect(page.getByTestId('slip-refusal')).toContainText('Odds');
    await expect(legs).toHaveCount(3);
    await expect(
      page.getByTestId('slip-leg-refusal'),
      'a refusal that names no leg must not be rendered at a row',
    ).toHaveCount(0);
    for (let i = 0; i < 3; i += 1) {
      await expect(legs.nth(i)).not.toHaveAttribute('aria-describedby', /.+/);
    }

    // The three-leg slip still refuses submission and still reaches nothing.
    await expect(page.getByTestId('multi-leg-refusal')).toContainText('cannot be submitted yet');
    // Two submit controls carry this id — the desktop panel button (`hidden
    // lg:flex`) and the mobile sticky bar (`lg:hidden`) — and exactly one is
    // visible at a given width. `.first()` picks by DOM order, not by what the
    // operator can actually reach, so at 390px it selects the hidden desktop
    // one and the click never happens. Select the visible control instead, so
    // this assertion exercises the button the operator would press at each
    // width rather than whichever happens to come first in the markup.
    await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
    expect(submitted, 'a multi-leg slip must not reach the submission endpoint').toEqual([]);

    expect(denied, 'No nonlocal request should be attempted').toEqual([]);
  });
}
