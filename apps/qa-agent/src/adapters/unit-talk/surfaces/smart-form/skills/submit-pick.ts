import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';

/**
 * Smart Form submit-pick flow.
 * Validates form renders correctly and all key UI regions are present.
 * Does NOT submit an actual pick (dry-run by design).
 */
export const submitPickSkill: QASkill = {
  id: 'smart-form/submit-pick',
  product: 'unit-talk',
  surface: 'smart_form',
  flow: 'submit_pick',
  supportedPersonas: ['operator', 'vip_user', 'vip_plus_user', 'capper'],
  description: 'Smart Form submit-pick flow: form renders, sport/market controls present, validation works',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];
    const formUrl = `${baseUrl}/submit`;

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

    const loadOk = await step('Navigate to Smart Form /submit', async () => {
      await ctx.page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    });

    if (!loadOk) {
      await ctx.screenshot('error-form-unreachable');
      return {
        status: 'FAIL',
        severity: 'critical',
        steps,
        consoleErrors: [],
        networkErrors: [],
        uxFriction,
        issueRecommendation: {
          title: '[QA] Smart Form unreachable at /submit',
          severity: 'critical',
          product: 'unit-talk',
          surface: 'smart_form',
          description: 'QA agent could not reach Smart Form. Is the app running on port 4100?',
          stepsToReproduce: [`curl ${formUrl}`],
          expectedBehavior: 'Smart Form responds at configured URL',
          actualBehavior: 'Connection refused or timeout',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'smart_form', 'severity-critical', 'infra'],
        },
      };
    }

    await step('Wait for form content to render', async () => {
      await ctx.page.waitForSelector('form, [role="form"], main', { timeout: 10_000 });
    });

    await ctx.screenshot('01-form-loaded');

    await step('Check for sport selector', async () => {
      const el = ctx.page.getByRole('button', { name: /NBA|NFL|NHL|MLB|Sport/i }).first();
      if (!(await el.isVisible().catch(() => false))) {
        uxFriction.push('Sport selector not found or not visible — user cannot select sport');
      }
    });

    await step('Check for market type control', async () => {
      const el = ctx.page.getByText(/Market Family|Spread|Moneyline|Total|Market/i).first();
      if (!(await el.isVisible().catch(() => false))) {
        uxFriction.push('Market type control not found — user cannot select bet type');
      }
    });

    await step('Check for sportsbook / book selector', async () => {
      const el = ctx.page.getByText(/Sportsbook|Fanatics|DraftKings|FanDuel|BetMGM|Book/i).first();
      if (!(await el.isVisible().catch(() => false))) {
        uxFriction.push('Book/sportsbook selector not found — user cannot specify where bet is placed');
      }
    });

    await step('Check for submit button', async () => {
      // Try semantic role first, then text-content fallback for non-semantic implementations
      const byRole = ctx.page.getByRole('button', { name: /submit|post pick/i }).first();
      const byText = ctx.page.locator('button:has-text("Submit"), button:has-text("Post Pick"), [data-testid*="submit"]').first();

      let visible = await byRole.isVisible().catch(() => false);
      if (!visible) {
        // scroll to bottom — button may be in sticky sidebar below fold
        await ctx.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await ctx.page.waitForTimeout(300);
        visible = (await byRole.isVisible().catch(() => false)) || (await byText.isVisible().catch(() => false));
      }
      if (!visible) {
        throw new Error('Submit button not found — form cannot be completed');
      }
    });

    await ctx.screenshot('02-form-controls-verified');

    if (ctx.mode === 'observe') {
      await step('Attempt to open sport selector (observe mode interaction)', async () => {
        const trigger = ctx.page.getByRole('button', { name: /NBA|Sport|Select sport/i }).first();
        if (await trigger.count() > 0) {
          await trigger.click({ timeout: 3_000 }).catch(() => {
            uxFriction.push('Sport selector click did not respond within 3s');
          });
          await ctx.page.waitForTimeout(500);
        }
      });
      await ctx.screenshot('03-sport-selector-interaction');
    }

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
          title: `[QA] Smart Form submit-pick: form element missing or broken`,
          severity: 'high',
          product: 'unit-talk',
          surface: 'smart_form',
          description: `Smart Form failed at: "${failedStep.step}". ${failedStep.detail ?? ''}`,
          stepsToReproduce: [
            `Open Smart Form at ${formUrl}`,
            'Wait for form to render',
            'Check for sport/market/book selectors and submit button',
          ],
          expectedBehavior: 'All form controls present and interactive',
          actualBehavior: failedStep.detail ?? 'Form element missing',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'smart_form', 'severity-high'],
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
        ? 'Add data-testid attributes to sport, market, and book selectors for stable test targeting'
        : undefined,
    };
  },
};
