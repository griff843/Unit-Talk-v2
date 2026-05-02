import type { Locator } from 'playwright';
import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

const smartFormUrl = 'http://localhost:4100/submit';
const commandCenterUrl = 'http://localhost:4300';
const reviewQueueUrl = `${commandCenterUrl}/review`;
const qaPlayerName = 'QA TestPlayer';
const validStatuses = ['validated', 'queued', 'posted', 'pending_review'] as const;
const invalidStatuses = ['rejected', 'error'] as const;

type LifecycleObservation = {
  pickId?: string;
  finalStatus?: string;
  elapsed_ms: number;
};

export const lifecycleE2eSkill: QASkill = {
  id: 'smart-form/lifecycle-e2e',
  product: 'unit-talk',
  surface: 'smart_form',
  flow: 'lifecycle_e2e',
  supportedPersonas: ['vip', 'vip_user', 'operator'],
  description: 'Smart Form to Command Center lifecycle E2E: submit synthetic VIP pick and verify it reaches the review queue',
  requiresAuth: true,
  selectors: {
    sportSelect: {
      preferred: '[data-testid="smart-form-sport-select"]',
      fallbacks: ['[name="sport"]', '[aria-label*="sport" i]', 'text=/NBA|Sport/i'],
    },
    marketSelect: {
      preferred: '[data-testid="smart-form-market-select"]',
      fallbacks: ['[name="marketType"]', '[name="market"]', '[aria-label*="market" i]', 'text=/Player Prop|Market/i'],
    },
    playerInput: {
      preferred: '[data-testid="smart-form-player-input"]',
      fallbacks: ['[name*="player" i]', '[aria-label*="player" i]', 'input[placeholder*="player" i]'],
    },
    oddsInput: {
      preferred: '[data-testid="smart-form-odds-input"]',
      fallbacks: ['[name*="odds" i]', '[name*="price" i]', '[aria-label*="odds" i]', 'input[placeholder*="odds" i]'],
    },
    submitButton: {
      preferred: '[data-testid="smart-form-submit-button"]',
      fallbacks: ['button:has-text("Submit")', 'button:has-text("Post Pick")', '[data-testid*="submit"]'],
    },
  },
  preflightChecks: [
    {
      id: 'smart_form_reachable',
      description: 'Smart Form submit route is reachable.',
      required: true,
      run: async () => httpPreflight(
        'smart_form_reachable',
        smartFormUrl,
        'Smart Form /submit',
        true,
      ),
    },
    {
      id: 'command_center_reachable',
      description: 'Command Center route is reachable.',
      required: true,
      run: async () => httpPreflight(
        'command_center_reachable',
        commandCenterUrl,
        'Command Center',
        true,
      ),
    },
  ],
  expectations: [
    {
      id: 'lifecycle_pick_submitted',
      description: 'Synthetic QA pick submission step succeeded.',
      severity: 'critical',
      hard: true,
      evaluate: ({ skillResult }) => {
        const submitted = skillResult.steps.some((step) => (
          step.step === 'Submit synthetic pick' && step.status === 'pass'
        ));
        return {
          id: 'lifecycle_pick_submitted',
          status: submitted ? 'passed' : 'failed',
          severity: 'critical',
          message: submitted ? 'Synthetic QA pick was submitted.' : 'Synthetic QA pick submission did not complete.',
        };
      },
    },
    {
      id: 'lifecycle_pick_visible_in_queue',
      description: 'Submitted pick appeared in Command Center review queue.',
      severity: 'high',
      hard: true,
      evaluate: ({ skillResult }) => {
        const visible = skillResult.steps.some((step) => (
          step.step === 'Poll Command Center review queue' && step.status === 'pass'
        ));
        return {
          id: 'lifecycle_pick_visible_in_queue',
          status: visible ? 'passed' : 'failed',
          severity: 'high',
          message: visible ? 'Submitted pick appeared in the review queue.' : 'Submitted pick did not appear in the review queue.',
        };
      },
    },
    {
      id: 'lifecycle_pick_status_valid',
      description: 'Submitted pick status is not rejected or error.',
      severity: 'critical',
      hard: true,
      evaluate: ({ skillResult }) => {
        const observation = parseLifecycleObservation(skillResult.observations ?? []);
        const finalStatus = observation?.finalStatus?.toLowerCase();
        const valid = finalStatus !== undefined && isValidLifecycleStatus(finalStatus);
        return {
          id: 'lifecycle_pick_status_valid',
          status: valid ? 'passed' : 'failed',
          severity: 'critical',
          message: valid
            ? `Submitted pick reached valid status ${finalStatus}.`
            : `Submitted pick status was ${finalStatus ?? 'unknown'}.`,
          evidence: observation,
        };
      },
    },
  ],

  async run(ctx: SkillContext): Promise<SkillResult> {
    const startedAt = Date.now();
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const observations: string[] = [];
    let pickId: string | undefined;
    let finalStatus: string | undefined;

    async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
      const start = Date.now();
      ctx.log(name);
      try {
        await fn();
        steps.push({ step: name, status: 'pass', timestamp: new Date().toISOString(), durationMs: Date.now() - start });
        return true;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        steps.push({ step: name, status: 'fail', detail, timestamp: new Date().toISOString(), durationMs: Date.now() - start });
        return false;
      }
    }

    try {
      const navigateOk = await step('Navigate to Smart Form as VIP', async () => {
        await ctx.page.goto(smartFormUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await ctx.page.waitForSelector('form, [role="form"], main', { timeout: 10_000 });
      });

      if (!navigateOk) {
        return buildFailResult(steps, uxFriction, observations, 'Smart Form did not load for VIP persona.', 'critical');
      }

      await step('Fill synthetic pick', async () => {
        await chooseValue(ctx.page, ['[data-testid="smart-form-sport-select"]', '[name="sport"]', '[aria-label*="sport" i]'], 'NBA');
        await chooseValue(ctx.page, ['[data-testid="smart-form-market-select"]', '[name="marketType"]', '[name="market"]', '[aria-label*="market" i]'], 'player_prop');
        await fillValue(ctx.page, ['[data-testid="smart-form-player-input"]', '[name*="player" i]', '[aria-label*="player" i]', 'input[placeholder*="player" i]'], qaPlayerName);
        await fillValue(ctx.page, ['[data-testid="smart-form-odds-input"]', '[name*="odds" i]', '[name*="price" i]', '[aria-label*="odds" i]', 'input[placeholder*="odds" i]'], '+120');

        await fillOptionalValue(ctx.page, ['[name*="selection" i]', '[aria-label*="selection" i]', 'input[placeholder*="selection" i]'], `${qaPlayerName} over 20.5 points`);
        await fillOptionalValue(ctx.page, ['[name*="line" i]', '[aria-label*="line" i]', 'input[placeholder*="line" i]'], '20.5');
        await fillOptionalValue(ctx.page, ['[name*="book" i]', '[name*="sportsbook" i]', '[aria-label*="sportsbook" i]'], 'DraftKings');
        await fillOptionalValue(ctx.page, ['[name*="note" i]', '[aria-label*="note" i]', 'textarea'], '{"qa_test":true}');
      });

      const submitOk = await step('Submit synthetic pick', async () => {
        const responsePromise = ctx.page.waitForResponse((response) => (
          /\/api\/.*submission|\/api\/submissions|\/submit/i.test(response.url())
          && response.request().method() !== 'GET'
        ), { timeout: 15_000 }).catch(() => undefined);

        await clickFirst(ctx.page, [
          '[data-testid="smart-form-submit-button"]',
          'button:has-text("Submit")',
          'button:has-text("Post Pick")',
          '[data-testid*="submit"]',
        ]);

        const response = await responsePromise;
        if (response) {
          if (response.status() < 200 || response.status() >= 300) {
            throw new Error(`Submission returned HTTP ${response.status()}.`);
          }
          pickId = extractPickId(await response.json().catch(() => undefined));
        }

        const successVisible = await ctx.page.locator([
          '[data-testid="smart-form-success-state"]',
          'text=/submitted|success|queued|validated/i',
        ].join(', ')).first().isVisible({ timeout: 5_000 }).catch(() => false);

        if (!response && !successVisible) {
          throw new Error('Submission did not produce a success UI or matching network 2xx response.');
        }

        if (!pickId) {
          pickId = await extractPickIdFromPage(ctx.page);
        }
      });

      if (!submitOk) {
        return buildFailResult(steps, uxFriction, observations, 'Synthetic pick submission failed.', 'critical');
      }

      const commandCenterPage = await ctx.page.context().newPage();
      try {
        await step('Open Command Center review queue as operator', async () => {
          await commandCenterPage.goto(reviewQueueUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await commandCenterPage.waitForSelector('main, body > *:not(script)', { timeout: 10_000 });
        });

        const pollOk = await step('Poll Command Center review queue', async () => {
          const result = await pollForPick(commandCenterPage, startedAt, pickId);
          pickId = result.pickId ?? pickId;
          finalStatus = result.finalStatus;
        });

        const elapsedMs = Date.now() - startedAt;
        observations.push(`lifecycle_e2e=${JSON.stringify({ pickId, finalStatus, elapsed_ms: elapsedMs })}`);

        if (!pollOk) {
          return {
            status: 'FAIL',
            severity: 'high',
            steps,
            consoleErrors: [],
            networkErrors: [],
            uxFriction,
            observations,
            issueRecommendation: buildIssueRecommendation(
              'Pick did not appear in review queue within 15s',
              'Submitted pick should appear in the review queue within 15 seconds.',
              'Pick did not appear in review queue within 15s',
            ),
          };
        }

        if (!finalStatus || !isValidLifecycleStatus(finalStatus)) {
          return {
            status: 'FAIL',
            severity: 'critical',
            steps,
            consoleErrors: [],
            networkErrors: [],
            uxFriction,
            observations,
            issueRecommendation: buildIssueRecommendation(
              '[QA] Smart Form lifecycle E2E invalid pick status',
              'Submitted pick should remain in validated, queued, posted, or pending_review status.',
              `Observed status ${finalStatus ?? 'unknown'} for ${pickId ?? qaPlayerName}.`,
            ),
          };
        }

        return {
          status: 'PASS',
          steps,
          consoleErrors: [],
          networkErrors: [],
          uxFriction,
          observations,
        };
      } finally {
        await commandCenterPage.close().catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - startedAt;
      observations.push(`lifecycle_e2e=${JSON.stringify({ pickId, finalStatus, elapsed_ms: elapsedMs })}`);
      return {
        status: 'ERROR',
        severity: 'critical',
        steps,
        consoleErrors: [message],
        networkErrors: [],
        uxFriction,
        observations,
        issueRecommendation: buildIssueRecommendation(
          '[QA] Smart Form lifecycle E2E errored',
          'Lifecycle E2E skill should handle Smart Form submission and review queue polling without uncaught exceptions.',
          message,
        ),
      };
    }
  },
};

async function chooseValue(page: SkillContext['page'], selectors: readonly string[], value: string): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) continue;

    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
    if (tagName === 'select') {
      await locator.selectOption([
        { value },
        { label: value },
        { value: value.toLowerCase() },
        { label: value.replace(/_/g, ' ') },
      ]).catch(async () => {
        await locator.selectOption({ label: titleCase(value.replace(/_/g, ' ')) });
      });
      return;
    }

    await locator.click({ timeout: 3_000 });
    const option = page.getByRole('option', { name: valueRegex(value) }).first();
    if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await option.click();
      return;
    }
    await page.getByText(valueRegex(value)).first().click({ timeout: 3_000 });
    return;
  }

  throw new Error(`Could not find control for ${value}.`);
}

async function fillValue(page: SkillContext['page'], selectors: readonly string[], value: string): Promise<void> {
  const filled = await fillOptionalValue(page, selectors, value);
  if (!filled) {
    throw new Error(`Could not find input for ${value}.`);
  }
}

async function fillOptionalValue(page: SkillContext['page'], selectors: readonly string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;

    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
    if (tagName === 'select') {
      await locator.selectOption({ label: value }).catch(async () => {
        await locator.selectOption({ value });
      });
      return true;
    }

    await locator.fill(value, { timeout: 3_000 });
    return true;
  }
  return false;
}

async function clickFirst(page: SkillContext['page'], selectors: readonly string[]): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click({ timeout: 5_000 });
    return;
  }
  throw new Error('Submit button not found.');
}

async function pollForPick(
  page: SkillContext['page'],
  startedAt: number,
  pickId: string | undefined,
): Promise<{ pickId?: string; finalStatus: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);

    const row = await findPickRow(page, pickId);
    if (row) {
      const rowText = await row.innerText({ timeout: 3_000 });
      const finalStatus = extractStatus(rowText);
      const resolvedPickId = pickId ?? extractPickIdFromText(rowText);
      if (!finalStatus) {
        throw new Error(`Pick appeared but status could not be determined after ${Date.now() - startedAt}ms.`);
      }
      return { pickId: resolvedPickId, finalStatus };
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error('Pick did not appear in review queue within 15s');
}

async function findPickRow(page: SkillContext['page'], pickId: string | undefined): Promise<Locator | undefined> {
  const matchText = pickId ?? qaPlayerName;
  const selectors = [
    `[data-testid="review-queue-row"]:has-text("${matchText}")`,
    `tr:has-text("${matchText}")`,
    `li:has-text("${matchText}")`,
    `[role="row"]:has-text("${matchText}")`,
    `text="${matchText}"`,
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      return locator;
    }
  }
  return undefined;
}

function extractStatus(text: string): string | undefined {
  const lowered = text.toLowerCase();
  return [...validStatuses, ...invalidStatuses].find((status) => lowered.includes(status));
}

function isValidLifecycleStatus(status: string): boolean {
  return validStatuses.includes(status.toLowerCase() as typeof validStatuses[number]);
}

function valueRegex(value: string): RegExp {
  return new RegExp(value.replace(/_/g, '[ _-]'), 'i');
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractPickId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record.id ?? record.pickId ?? record.pick_id;
  if (typeof direct === 'string') return direct;
  const pick = record.pick;
  if (pick && typeof pick === 'object') {
    const pickRecord = pick as Record<string, unknown>;
    const nested = pickRecord.id ?? pickRecord.pickId ?? pickRecord.pick_id;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

async function extractPickIdFromPage(page: SkillContext['page']): Promise<string | undefined> {
  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
  return extractPickIdFromText(bodyText);
}

function extractPickIdFromText(text: string): string | undefined {
  return text.match(/\b(?:pick[_\s-]?id|id)[:#\s]+([a-z0-9-]{8,})\b/i)?.[1];
}

function parseLifecycleObservation(observations: readonly string[]): LifecycleObservation | undefined {
  const line = observations.find((observation) => observation.startsWith('lifecycle_e2e='));
  if (!line) return undefined;
  const parsed: unknown = JSON.parse(line.slice('lifecycle_e2e='.length));
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  return {
    pickId: typeof record.pickId === 'string' ? record.pickId : undefined,
    finalStatus: typeof record.finalStatus === 'string' ? record.finalStatus : undefined,
    elapsed_ms: typeof record.elapsed_ms === 'number' ? record.elapsed_ms : 0,
  };
}

function buildFailResult(
  steps: StepResult[],
  uxFriction: string[],
  observations: string[],
  actualBehavior: string,
  severity: 'critical' | 'high',
): SkillResult {
  return {
    status: 'FAIL',
    severity,
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    observations,
    issueRecommendation: buildIssueRecommendation(
      '[QA] Smart Form lifecycle E2E failed',
      'Smart Form should submit a synthetic VIP pick and Command Center should show it in the review queue.',
      actualBehavior,
    ),
  };
}

function buildIssueRecommendation(title: string, expectedBehavior: string, actualBehavior: string) {
  return {
    title,
    severity: 'critical' as const,
    product: 'unit-talk',
    surface: 'smart_form',
    description: 'Pick lifecycle E2E QA detected a Smart Form to Command Center regression.',
    stepsToReproduce: [
      `Open Smart Form at ${smartFormUrl} as a VIP persona`,
      `Submit a synthetic NBA player_prop pick for ${qaPlayerName}`,
      `Open Command Center review queue at ${reviewQueueUrl} as an operator persona`,
      'Poll for the submitted pick for 15 seconds',
    ],
    expectedBehavior,
    actualBehavior,
    screenshotPaths: [],
    labels: ['qa-agent', 'unit-talk', 'smart_form', 'lifecycle_e2e', 'severity-critical'],
  };
}
