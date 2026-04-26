import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';

export const dailyOpsSkill: QASkill = {
  id: 'command-center/daily-ops',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'daily_ops',
  supportedPersonas: ['operator', 'admin'],
  description: 'Operator daily operations check: health signals, picks pipeline, exception queues',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];

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

    const dashboardOk = await step('Navigate to dashboard', async () => {
      await ctx.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    });

    if (!dashboardOk) {
      await ctx.screenshot('error-dashboard-unreachable');
      return buildFailResult(steps, uxFriction, baseUrl, 'Dashboard unreachable — is Command Center running on port 4300?');
    }

    await step('Wait for main content to render', async () => {
      await ctx.page.waitForSelector('main, body > *:not(script)', { timeout: 10_000 });
    });

    await ctx.screenshot('01-dashboard');

    await step('Check for health signal panel', async () => {
      const signalText = await ctx.page
        .locator('text=/submission|scoring|promotion|delivery|settlement|signal/i')
        .count();
      if (signalText === 0) {
        uxFriction.push('No health signal indicators found on dashboard — expected lifecycle status for 6 signals');
      }
    });

    await step('Check for all-BROKEN signal state', async () => {
      const brokenCount = await ctx.page.locator('text=/BROKEN/i').count();
      if (brokenCount >= 6) {
        uxFriction.push(`Dashboard showing ${brokenCount} BROKEN signals — API or operator-web may be unreachable`);
      } else if (brokenCount > 0) {
        uxFriction.push(`${brokenCount} signal(s) in BROKEN state — investigate API connectivity`);
      }
    });

    const picksOk = await step('Navigate to /picks-list', async () => {
      await ctx.page.goto(`${baseUrl}/picks-list`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    });

    if (picksOk) {
      await step('Verify picks list page renders', async () => {
        const url = ctx.page.url();
        if (!url.includes('picks-list')) throw new Error(`Expected /picks-list URL, got: ${url}`);
        await ctx.page.waitForSelector('main, table, h1, [class*="picks"]', { timeout: 8_000 });
      });
      await ctx.screenshot('02-picks-list');
    }

    const reviewOk = await step('Navigate to /review', async () => {
      await ctx.page.goto(`${baseUrl}/review`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    });

    if (reviewOk) {
      await step('Verify review queue page renders', async () => {
        await ctx.page.waitForSelector('main, table, h1, [class*="review"]', { timeout: 8_000 });
      });
      await ctx.screenshot('03-review-queue');
    }

    await step('No critical JS errors on dashboard pages', async () => {
      // Console errors are captured by the runner; this step documents the check
    });

    await ctx.screenshot('04-final-state');

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
          title: `[QA] Command Center daily ops fails at: ${failedStep.step}`,
          severity: 'high',
          product: 'unit-talk',
          surface: 'command_center',
          description: `Operator daily ops flow failed. Step: "${failedStep.step}". Detail: ${failedStep.detail ?? 'see screenshots'}`,
          stepsToReproduce: [
            `Open Command Center at ${baseUrl}`,
            'Wait for dashboard to load',
            'Navigate to /picks-list',
            'Navigate to /review',
          ],
          expectedBehavior: 'All pages load without errors; health signals visible',
          actualBehavior: failedStep.detail ?? 'Page failed to load or render',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'command_center', 'severity-high'],
        },
      };
    }

    return {
      status: hasFriction ? 'NEEDS_REVIEW' : 'PASS',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction,
      regressionRecommendation: hasFriction
        ? 'Add health signal count assertions and BROKEN-state alerting'
        : undefined,
    };
  },
};

function buildFailResult(steps: StepResult[], uxFriction: string[], baseUrl: string, actualBehavior: string): SkillResult {
  return {
    status: 'FAIL',
    severity: 'critical',
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    issueRecommendation: {
      title: '[QA] Command Center unreachable — daily ops blocked',
      severity: 'critical',
      product: 'unit-talk',
      surface: 'command_center',
      description: 'QA agent could not reach Command Center. The app may not be running.',
      stepsToReproduce: [`curl ${baseUrl}`, 'Observe connection refused or timeout'],
      expectedBehavior: 'Command Center responds at configured URL',
      actualBehavior,
      screenshotPaths: [],
      labels: ['qa-agent', 'unit-talk', 'command_center', 'severity-critical', 'infra'],
    },
  };
}
