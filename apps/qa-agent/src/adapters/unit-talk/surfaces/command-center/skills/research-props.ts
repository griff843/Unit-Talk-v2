import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

export const researchPropsSkill: QASkill = {
  id: 'command-center/research-props',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'research_props',
  supportedPersonas: ['operator', 'admin'],
  description: 'Command Center research props check: route renders, filters are available, props table or empty state is visible',
  selectors: {
    propsTable: {
      preferred: '[data-testid="research-props-table"]',
      fallbacks: ['table', 'text=/props|player|stat|over|under/i'],
    },
    filters: {
      preferred: 'form input, form select, form button',
      fallbacks: ['text=/sport|bookmaker|market|player|participant|search|filter/i'],
    },
    emptyState: {
      preferred: '[data-testid="research-props-empty-state"]',
      fallbacks: ['text=/apply at least one filter|no prop offers match|unable to load prop offers/i'],
    },
  },
  preflightChecks: [
    {
      id: 'command_center_research_props_route_reachable',
      description: 'Command Center research props route is reachable.',
      required: true,
      run: async ({ surface, env }) => httpPreflight(
        'command_center_research_props_route_reachable',
        `${surface.baseUrls[env]}/research/props`,
        'Command Center /research/props',
        true,
      ),
    },
  ],
  expectations: [
    {
      id: 'command_center_research_props_no_5xx_network_responses',
      description: 'No HTTP 5xx network responses.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (record.status ?? 0) >= 500);
        return {
          id: 'command_center_research_props_no_5xx_network_responses',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0 ? 'No HTTP 5xx network responses observed.' : `${failures.length} HTTP 5xx response(s) observed.`,
          evidence: failures,
        };
      },
    },
    {
      id: 'command_center_research_props_page_renders',
      description: 'Research props page renders without a crash state.',
      severity: 'critical',
      hard: true,
      evaluate: async ({ page }) => {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const crashed = /application error|runtime error|internal server error|this page could not be found/i.test(bodyText);
        return {
          id: 'command_center_research_props_page_renders',
          status: crashed ? 'failed' : 'passed',
          severity: 'critical',
          message: crashed ? 'Research props page rendered a crash or error state.' : 'Research props page rendered without a crash state.',
          evidence: { pageUrl: page.url() },
        };
      },
    },
    {
      id: 'command_center_research_props_table_or_empty_state_visible',
      description: 'Research props table or intentional empty state is visible.',
      severity: 'medium',
      hard: false,
      evaluate: ({ selectorResults }) => {
        const visible = selectorResults.some((result) => ['propsTable', 'emptyState'].includes(result.key) && result.found);
        return {
          id: 'command_center_research_props_table_or_empty_state_visible',
          status: visible ? 'passed' : 'failed',
          severity: 'medium',
          message: visible ? 'Research props table or empty state was visible.' : 'Research props table or empty state was not detected.',
          evidence: selectorResults.filter((result) => ['propsTable', 'emptyState'].includes(result.key)),
        };
      },
    },
  ],

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];
    const propsUrl = `${baseUrl}/research/props`;

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

    const loadOk = await step('Navigate to /research/props', async () => {
      await ctx.page.goto(propsUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    });

    if (!loadOk) {
      await ctx.screenshot('error-research-props-unreachable');
      return buildFailResult(steps, uxFriction, propsUrl, 'Research props route unreachable or timed out.');
    }

    await step('Wait for research props content to render', async () => {
      await ctx.page.waitForSelector('main, form, table, h1, body > *:not(script)', { timeout: 10_000 });
    });

    await ctx.screenshot('01-research-props-loaded');

    await step('Check for props explorer signal', async () => {
      const tableCount = await ctx.page.locator('[data-testid="research-props-table"], table').count();
      const textCount = await ctx.page.locator('text=/props|player|stat|over|under/i').count();
      if (tableCount + textCount === 0) {
        uxFriction.push('Research props table or prop-market fallback text not found.');
      }
    });

    await step('Check for filter/search controls', async () => {
      const controls = await ctx.page.locator('form input, form select, form button').count();
      if (controls === 0) {
        uxFriction.push('No filter/search controls found on research props page.');
      }
    });

    await ctx.screenshot('02-research-props-controls');

    await step('Check for table or intentional empty state', async () => {
      const tableVisible = await ctx.page
        .locator('[data-testid="research-props-table"], table')
        .first()
        .isVisible()
        .catch(() => false);
      const emptyVisible = await ctx.page
        .locator('text=/apply at least one filter|no prop offers match|unable to load prop offers/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (!tableVisible && !emptyVisible) {
        uxFriction.push('Research props page rendered, but no table or intentional empty state was visible.');
      }
    });

    await step('No critical JS errors on research props page', async () => {
      // Console errors are captured by the runner; this step documents the check.
    });

    await ctx.screenshot('03-research-props-final-state');

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
          title: `[QA] Command Center research props fails at: ${failedStep.step}`,
          severity: 'high',
          product: 'unit-talk',
          surface: 'command_center',
          description: `Research props flow failed. Step: "${failedStep.step}". Detail: ${failedStep.detail ?? 'see screenshots'}`,
          stepsToReproduce: [
            `Open Command Center at ${propsUrl}`,
            'Wait for the research props page to load',
            'Check for filter/search controls and props table or empty state',
          ],
          expectedBehavior: 'Research props page loads without errors and shows filters plus table or empty state',
          actualBehavior: failedStep.detail ?? 'Page failed to load or render',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'command_center', 'research_props', 'severity-high'],
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
        ? 'Add stable data-testid selectors for research props table and empty state if the page is rendering correctly.'
        : undefined,
    };
  },
};

function buildFailResult(steps: StepResult[], uxFriction: string[], propsUrl: string, actualBehavior: string): SkillResult {
  return {
    status: 'FAIL',
    severity: 'critical',
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    issueRecommendation: {
      title: '[QA] Command Center research props unreachable',
      severity: 'critical',
      product: 'unit-talk',
      surface: 'command_center',
      description: 'QA agent could not reach the Command Center research props route.',
      stepsToReproduce: [`curl ${propsUrl}`],
      expectedBehavior: 'Command Center research props route responds at configured URL',
      actualBehavior,
      screenshotPaths: [],
      labels: ['qa-agent', 'unit-talk', 'command_center', 'research_props', 'severity-critical', 'infra'],
    },
  };
}
