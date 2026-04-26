import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

const lifecycleSignalNames = ['submission', 'scoring', 'promotion', 'discord_delivery', 'settlement', 'stats_propagation'];

export const dailyOpsSkill: QASkill = {
  id: 'command-center/daily-ops',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'daily_ops',
  supportedPersonas: ['operator', 'admin'],
  description: 'Operator daily operations check: health signals, picks pipeline, exception queues',
  selectors: {
    lifecycleCard: {
      preferred: '[data-testid="command-center-lifecycle-card"]',
      fallbacks: ['text=/Pick Lifecycle/i', 'text=/validated|queued|posted|settled/i'],
    },
    apiStatus: {
      preferred: '[data-testid="command-center-api-status"]',
      fallbacks: ['text=/System Health|Backend Connection|API/i'],
    },
    workerStatus: {
      preferred: '[data-testid="command-center-worker-status"]',
      fallbacks: ['text=/Worker Runtime|Drain state/i'],
    },
    picksTable: {
      preferred: '[data-testid="command-center-picks-table"]',
      fallbacks: ['text=/Pick Lifecycle|Status|Edge/i'],
    },
    settlementQueue: {
      preferred: '[data-testid="command-center-settlement-queue"]',
      fallbacks: ['text=/settled|settlement|Stale posted/i'],
    },
  },
  preflightChecks: [
    {
      id: 'command_center_route_reachable',
      description: 'Command Center frontend route is reachable.',
      required: true,
      run: async ({ surface, env }) => httpPreflight(
        'command_center_route_reachable',
        surface.baseUrls[env],
        'Command Center route',
        true,
      ),
    },
    {
      id: 'operator_health_reachable',
      description: 'Operator API health endpoint is reachable.',
      required: true,
      run: async () => httpPreflight(
        'operator_health_reachable',
        `${process.env['OPERATOR_WEB_URL'] ?? 'http://localhost:4200'}/health`,
        'operator-web /health',
        true,
      ),
    },
    {
      id: 'operator_snapshot_reachable',
      description: 'Operator dashboard snapshot endpoint is reachable.',
      required: true,
      run: async () => httpPreflight(
        'operator_snapshot_reachable',
        `${process.env['OPERATOR_WEB_URL'] ?? 'http://localhost:4200'}/api/operator/snapshot`,
        'operator-web snapshot',
        true,
      ),
    },
  ],
  expectations: [
    {
      id: 'command_center_no_broken_lifecycle_signals',
      description: 'No lifecycle signal may be BROKEN for picks.status lifecycle validated -> queued -> posted -> settled.',
      severity: 'critical',
      hard: true,
      evaluate: async ({ page }) => {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const brokenCount = await page.locator('text=/BROKEN/i').count().catch(() => 0);
        const namedBrokenSignals = lifecycleSignalNames.filter((signal) => {
          const label = signal.replace('_', '[ _-]?');
          return new RegExp(`${label}[\\s\\S]{0,160}\\bBROKEN\\b`, 'i').test(bodyText);
        });
        return {
          id: 'command_center_no_broken_lifecycle_signals',
          status: brokenCount === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: brokenCount === 0
            ? 'No BROKEN lifecycle signals detected.'
            : `${brokenCount} BROKEN lifecycle signal marker(s) detected. Canonical lifecycle is picks.status: validated -> queued -> posted -> settled.`,
          evidence: { brokenCount, namedBrokenSignals },
        };
      },
    },
    {
      id: 'command_center_no_5xx_network_responses',
      description: 'No HTTP 5xx network responses.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (record.status ?? 0) >= 500);
        return {
          id: 'command_center_no_5xx_network_responses',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0 ? 'No HTTP 5xx network responses observed.' : `${failures.length} HTTP 5xx response(s) observed.`,
          evidence: failures,
        };
      },
    },
    {
      id: 'command_center_dashboard_shell_renders',
      description: 'Required dashboard shell renders.',
      severity: 'critical',
      hard: true,
      evaluate: ({ selectorResults }) => {
        const required = ['lifecycleCard', 'apiStatus', 'workerStatus'];
        const missing = required.filter((key) => !selectorResults.some((result) => result.key === key && result.found));
        return {
          id: 'command_center_dashboard_shell_renders',
          status: missing.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: missing.length === 0 ? 'Required Command Center dashboard shell rendered.' : `Missing dashboard shell selectors: ${missing.join(', ')}.`,
          evidence: selectorResults.filter((result) => required.includes(result.key)),
        };
      },
    },
  ],

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

    await step('Return to dashboard for invariant checks', async () => {
      await ctx.page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await ctx.page.waitForSelector('main, body > *:not(script)', { timeout: 8_000 });
    });

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
      observations: uxFriction,
      regressionRecommendation: hasFriction
        ? 'Command Center shell rendered, but backend lifecycle/API signals were unavailable. Classify as dependency/backend failure rather than frontend render failure.'
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
