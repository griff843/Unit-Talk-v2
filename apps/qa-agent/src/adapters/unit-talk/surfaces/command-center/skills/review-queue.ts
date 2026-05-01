import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

export const reviewQueueSkill: QASkill = {
  id: 'command-center/review-queue',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'review_queue',
  supportedPersonas: ['operator', 'admin'],
  description: 'Command Center review queue check: queue route renders, filters are discoverable, rows or empty state are actionable',
  selectors: {
    reviewQueueTable: {
      preferred: '[data-testid="review-queue-table"]',
      fallbacks: ['table', 'text=/review|pending|exception/i'],
    },
    reviewQueueEmpty: {
      preferred: '[data-testid="review-queue-empty"]',
      fallbacks: ['text=/No picks awaiting review|empty|no .*review/i'],
    },
    reviewQueueFilters: {
      preferred: '[data-testid="review-queue-filters"]',
      fallbacks: [
        'input[type="search"]',
        'input[name*="filter" i]',
        'select',
        'button:has-text("Filter")',
        'text=/filter|pending|exception/i',
      ],
    },
    actionableRow: {
      preferred: '[data-testid="review-queue-row"]',
      fallbacks: [
        'button:has-text("Approve")',
        'button:has-text("Deny")',
        'button:has-text("Hold")',
        'text=/approve|deny|hold|pending/i',
      ],
    },
  },
  preflightChecks: [
    {
      id: 'command_center_review_route_reachable',
      description: 'Command Center review queue route is reachable.',
      required: true,
      run: async ({ surface, env }) => httpPreflight(
        'command_center_review_route_reachable',
        `${surface.baseUrls[env]}/review`,
        'Command Center /review',
        true,
      ),
    },
  ],
  expectations: [
    {
      id: 'command_center_review_no_5xx_network_responses',
      description: 'No HTTP 5xx network responses.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (record.status ?? 0) >= 500);
        return {
          id: 'command_center_review_no_5xx_network_responses',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0 ? 'No HTTP 5xx network responses observed.' : `${failures.length} HTTP 5xx response(s) observed.`,
          evidence: failures,
        };
      },
    },
    {
      id: 'command_center_review_page_renders',
      description: 'Review queue page renders without a crash and exposes main/body content.',
      severity: 'critical',
      hard: true,
      evaluate: async ({ page }) => {
        const mainCount = await page.locator('main').count().catch(() => 0);
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const crashMarkers = /application error|runtime error|unhandled error|500 internal server error/i.test(bodyText);
        const hasContent = mainCount > 0 && bodyText.trim().length > 0;
        return {
          id: 'command_center_review_page_renders',
          status: hasContent && !crashMarkers ? 'passed' : 'failed',
          severity: 'critical',
          message: hasContent && !crashMarkers
            ? 'Review queue page rendered main content without crash markers.'
            : 'Review queue page did not render usable main content or showed a crash marker.',
          evidence: { mainCount, bodyTextLength: bodyText.trim().length, crashMarkers },
        };
      },
    },
    {
      id: 'command_center_review_queue_content_renders',
      description: 'Review queue table/list or empty state renders.',
      severity: 'medium',
      hard: false,
      evaluate: ({ selectorResults }) => {
        const tableOrList = selectorResults.some((result) => result.key === 'reviewQueueTable' && result.found);
        const emptyState = selectorResults.some((result) => result.key === 'reviewQueueEmpty' && result.found);
        return {
          id: 'command_center_review_queue_content_renders',
          status: tableOrList || emptyState ? 'passed' : 'failed',
          severity: 'medium',
          message: tableOrList || emptyState
            ? 'Review queue content rendered as a table/list or intentional empty state.'
            : 'Review queue did not expose a recognizable table/list or empty state.',
          evidence: selectorResults.filter((result) => (
            result.key === 'reviewQueueTable' || result.key === 'reviewQueueEmpty'
          )),
        };
      },
    },
  ],

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const observations: string[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];
    const reviewUrl = `${baseUrl}/review`;

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

    const loadOk = await step('Navigate to review queue', async () => {
      await ctx.page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
        observations.push('Review queue did not reach networkidle within 10s; continuing after DOM content loaded.');
      });
    });

    if (!loadOk) {
      const screenshotPath = await ctx.screenshot('error-review-queue-unreachable');
      return buildFailResult(
        steps,
        uxFriction,
        reviewUrl,
        'Connection refused, timeout, or route navigation failed',
        [screenshotPath],
      );
    }

    await step('Wait for review queue shell to render', async () => {
      await ctx.page.waitForSelector('main, body > *:not(script)', { timeout: 10_000 });
    });

    const initialScreenshotPath = await ctx.screenshot('01-review-queue-loaded');

    await step('Check review queue table/list or empty state', async () => {
      const tableCount = await ctx.page.locator('[data-testid="review-queue-table"], table').count();
      const emptySelectorCount = await ctx.page.locator('[data-testid="review-queue-empty"]').count();
      const emptyTextCount = await ctx.page.locator('text=/No picks awaiting review|empty|no .*review/i').count();
      const emptyCount = emptySelectorCount + emptyTextCount;
      const fallbackCount = await ctx.page.locator('text=/review|pending|exception/i').count();

      if (tableCount === 0 && emptyCount === 0 && fallbackCount === 0) {
        throw new Error('Review queue did not render a table/list, empty state, or review/pending/exception text fallback.');
      }

      if (tableCount === 0 && emptyCount === 0) {
        uxFriction.push('Review queue rendered only through text fallback; add data-testid="review-queue-table" or data-testid="review-queue-empty" for stable QA coverage.');
      }
    });

    await step('Check filter controls when present', async () => {
      const filterCount = await ctx.page.locator([
        '[data-testid="review-queue-filters"]',
        'input[type="search"]',
        'input[name*="filter" i]',
        'select',
        'button:has-text("Filter")',
      ].join(', ')).count();
      const filterTextCount = await ctx.page.locator('text=/filter|pending|exception/i').count();

      if (filterCount > 0 || filterTextCount > 0) {
        observations.push('Review queue exposes filter/status controls or filter/status text.');
        return;
      }

      observations.push('No explicit review queue filter controls found.');
    });

    await step('Check actionable row or empty state', async () => {
      const actionCount = await ctx.page.locator([
        '[data-testid="review-queue-row"]',
        'button:has-text("Approve")',
        'button:has-text("Deny")',
        'button:has-text("Hold")',
      ].join(', ')).count();
      const pendingTextCount = await ctx.page.locator('text=/pending/i').count();
      const emptySelectorCount = await ctx.page.locator('[data-testid="review-queue-empty"]').count();
      const emptyTextCount = await ctx.page.locator('text=/No picks awaiting review|empty|no .*review/i').count();
      const emptyCount = emptySelectorCount + emptyTextCount;

      if (actionCount === 0 && pendingTextCount === 0 && emptyCount === 0) {
        throw new Error('Review queue showed neither an actionable row nor an empty state message.');
      }

      if (actionCount === 0 && emptyCount === 0) {
        uxFriction.push('Review queue has pending text but no visible Approve, Deny, or Hold action controls.');
      }
    });

    const finalScreenshotPath = await ctx.screenshot('02-review-queue-verified');
    observations.push(`Captured review queue screenshots: ${initialScreenshotPath}, ${finalScreenshotPath}`);

    const hasFailures = steps.some((s) => s.status === 'fail');
    const hasFriction = uxFriction.length > 0;

    if (hasFailures) {
      const failedStep = steps.find((s) => s.status === 'fail')!;
      return {
        status: 'FAIL',
        severity: 'high',
        steps,
        consoleErrors: [],
        networkErrors: [],
        uxFriction,
        observations,
        issueRecommendation: {
          title: `[QA] Command Center review queue fails at: ${failedStep.step}`,
          severity: 'high',
          product: 'unit-talk',
          surface: 'command_center',
          description: `Review queue flow failed. Step: "${failedStep.step}". Detail: ${failedStep.detail ?? 'see screenshots'}`,
          stepsToReproduce: [
            `Open Command Center review queue at ${reviewUrl}`,
            'Wait for the page shell to render',
            'Confirm a review queue table/list, actionable row, or empty state appears',
          ],
          expectedBehavior: 'Review queue loads without errors and shows either actionable picks or a clear empty state.',
          actualBehavior: failedStep.detail ?? 'Review queue failed to load or render expected content.',
          screenshotPaths: [initialScreenshotPath, finalScreenshotPath],
          labels: ['qa-agent', 'unit-talk', 'command_center', 'review_queue', 'severity-high'],
        },
      };
    }

    return {
      status: hasFriction ? 'NEEDS_REVIEW' : 'PASS',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction,
      observations,
      regressionRecommendation: hasFriction
        ? 'Add stable review queue data-testid selectors and verify action controls render for pending rows.'
        : undefined,
    };
  },
};

function buildFailResult(
  steps: StepResult[],
  uxFriction: string[],
  reviewUrl: string,
  actualBehavior: string,
  screenshotPaths: string[],
): SkillResult {
  return {
    status: 'FAIL',
    severity: 'critical',
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    issueRecommendation: {
      title: '[QA] Command Center review queue unreachable',
      severity: 'critical',
      product: 'unit-talk',
      surface: 'command_center',
      description: 'QA agent could not reach the Command Center review queue route.',
      stepsToReproduce: [`curl ${reviewUrl}`, `Open ${reviewUrl} in a browser`],
      expectedBehavior: 'Command Center /review responds and renders the review queue shell.',
      actualBehavior,
      screenshotPaths,
      labels: ['qa-agent', 'unit-talk', 'command_center', 'review_queue', 'severity-critical', 'infra'],
    },
  };
}
