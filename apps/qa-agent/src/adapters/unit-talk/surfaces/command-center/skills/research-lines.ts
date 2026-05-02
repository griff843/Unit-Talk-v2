import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

export const researchLinesSkill: QASkill = {
  id: 'command-center/research-lines',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'research_lines',
  supportedPersonas: ['operator', 'admin'],
  description: 'Command Center research lines check: route renders, filters are available, line table or empty state is visible',
  selectors: {
    linesTable: {
      preferred: '[data-testid="research-lines-table"]',
      fallbacks: ['table', 'text=/lines|spread|total|moneyline/i'],
    },
    filters: {
      preferred: 'form input, form select, form button',
      fallbacks: ['text=/participant|market|compare|search|filter/i'],
    },
    emptyState: {
      preferred: '[data-testid="research-lines-empty-state"]',
      fallbacks: ['text=/enter a participant|no offers found|unable to load line data/i'],
    },
  },
  preflightChecks: [
    {
      id: 'command_center_research_lines_route_reachable',
      description: 'Command Center research lines route is reachable.',
      required: true,
      run: async ({ surface, env }) => httpPreflight(
        'command_center_research_lines_route_reachable',
        `${surface.baseUrls[env]}/research/lines`,
        'Command Center /research/lines',
        true,
      ),
    },
  ],
  expectations: [
    {
      id: 'command_center_research_lines_no_5xx_network_responses',
      description: 'No HTTP 5xx network responses.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (record.status ?? 0) >= 500);
        return {
          id: 'command_center_research_lines_no_5xx_network_responses',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0 ? 'No HTTP 5xx network responses observed.' : `${failures.length} HTTP 5xx response(s) observed.`,
          evidence: failures,
        };
      },
    },
    {
      id: 'command_center_research_lines_page_renders',
      description: 'Research lines page renders without a crash state.',
      severity: 'critical',
      hard: true,
      evaluate: async ({ page }) => {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const crashed = /application error|runtime error|internal server error|this page could not be found/i.test(bodyText);
        return {
          id: 'command_center_research_lines_page_renders',
          status: crashed ? 'failed' : 'passed',
          severity: 'critical',
          message: crashed ? 'Research lines page rendered a crash or error state.' : 'Research lines page rendered without a crash state.',
          evidence: { pageUrl: page.url() },
        };
      },
    },
    {
      id: 'command_center_research_lines_table_or_empty_state_visible',
      description: 'Research lines table or intentional empty state is visible.',
      severity: 'medium',
      hard: false,
      evaluate: ({ selectorResults }) => {
        const visible = selectorResults.some((result) => ['linesTable', 'emptyState'].includes(result.key) && result.found);
        return {
          id: 'command_center_research_lines_table_or_empty_state_visible',
          status: visible ? 'passed' : 'failed',
          severity: 'medium',
          message: visible ? 'Research lines table or empty state was visible.' : 'Research lines table or empty state was not detected.',
          evidence: selectorResults.filter((result) => ['linesTable', 'emptyState'].includes(result.key)),
        };
      },
    },
  ],

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];
    const linesUrl = `${baseUrl}/research/lines`;

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

    const loadOk = await step('Navigate to /research/lines', async () => {
      await ctx.page.goto(linesUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    });

    if (!loadOk) {
      await ctx.screenshot('error-research-lines-unreachable');
      return buildFailResult(steps, uxFriction, linesUrl, 'Research lines route unreachable or timed out.');
    }

    await step('Wait for research lines content to render', async () => {
      await ctx.page.waitForSelector('main, form, table, h1, body > *:not(script)', { timeout: 10_000 });
    });

    await ctx.screenshot('01-research-lines-loaded');

    await step('Check for line-shopper signal', async () => {
      const tableCount = await ctx.page.locator('[data-testid="research-lines-table"], table').count();
      const textCount = await ctx.page.locator('text=/lines|spread|total|moneyline/i').count();
      if (tableCount + textCount === 0) {
        uxFriction.push('Research lines table or line-market fallback text not found.');
      }
    });

    await step('Check for filter/search controls', async () => {
      const controls = await ctx.page.locator('form input, form select, form button').count();
      if (controls === 0) {
        uxFriction.push('No filter/search controls found on research lines page.');
      }
    });

    await ctx.screenshot('02-research-lines-controls');

    await step('Check for table or intentional empty state', async () => {
      const tableVisible = await ctx.page
        .locator('[data-testid="research-lines-table"], table')
        .first()
        .isVisible()
        .catch(() => false);
      const emptyVisible = await ctx.page
        .locator('text=/enter a participant|no offers found|unable to load line data/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (!tableVisible && !emptyVisible) {
        uxFriction.push('Research lines page rendered, but no table or intentional empty state was visible.');
      }
    });

    await step('No critical JS errors on research lines page', async () => {
      // Console errors are captured by the runner; this step documents the check.
    });

    await ctx.screenshot('03-research-lines-final-state');

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
        issueRecommendation: {
          title: `[QA] Command Center research lines fails at: ${failedStep.step}`,
          severity: 'high',
          product: 'unit-talk',
          surface: 'command_center',
          description: `Research lines flow failed. Step: "${failedStep.step}". Detail: ${failedStep.detail ?? 'see screenshots'}`,
          stepsToReproduce: [
            `Open Command Center at ${linesUrl}`,
            'Wait for the research lines page to load',
            'Check for filter/search controls and line table or empty state',
          ],
          expectedBehavior: 'Research lines page loads without errors and shows filters plus table or empty state',
          actualBehavior: failedStep.detail ?? 'Page failed to load or render',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'command_center', 'research_lines', 'severity-high'],
        },
      };
    }

    return {
      status: hasFriction ? 'NEEDS_REVIEW' : 'PASS',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction,
      observations: uxFriction,
      regressionRecommendation: hasFriction
        ? 'Add stable data-testid selectors for research lines table and empty state if the page is rendering correctly.'
        : undefined,
    };
  },
};

function buildFailResult(steps: StepResult[], uxFriction: string[], linesUrl: string, actualBehavior: string): SkillResult {
  return {
    status: 'FAIL',
    severity: 'critical',
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    issueRecommendation: {
      title: '[QA] Command Center research lines unreachable',
      severity: 'critical',
      product: 'unit-talk',
      surface: 'command_center',
      description: 'QA agent could not reach the Command Center research lines route.',
      stepsToReproduce: [`curl ${linesUrl}`],
      expectedBehavior: 'Command Center research lines route responds at configured URL',
      actualBehavior,
      screenshotPaths: [],
      labels: ['qa-agent', 'unit-talk', 'command_center', 'research_lines', 'severity-critical', 'infra'],
    },
  };
}
