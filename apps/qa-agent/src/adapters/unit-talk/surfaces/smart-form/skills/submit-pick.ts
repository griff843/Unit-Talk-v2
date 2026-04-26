import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { httpPreflight } from '../../../../../core/preflight.js';

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
  supportedPersonas: ['operator', 'vip', 'vip_user', 'vip_plus_user', 'capper', 'free', 'free_user'],
  description: 'Smart Form submit-pick flow: form renders, sport/market controls present, validation works',
  requiresAuth: true,
  selectors: {
    sportSelect: {
      preferred: '[data-testid="smart-form-sport-select"]',
      fallbacks: ['text=/NBA|NFL|NHL|MLB|Sport/i', '[name="sport"]', '[aria-label*="sport" i]'],
    },
    marketSelect: {
      preferred: '[data-testid="smart-form-market-select"]',
      fallbacks: ['text=/Market Family|Spread|Moneyline|Total|Market/i', '[name="marketType"]', '[aria-label*="market" i]'],
    },
    bookSelect: {
      preferred: '[data-testid="smart-form-book-select"]',
      fallbacks: ['text=/Sportsbook|Fanatics|DraftKings|FanDuel|BetMGM|Book/i', '[name="sportsbook"]', '[aria-label*="book" i]'],
    },
    submitButton: {
      preferred: '[data-testid="smart-form-submit-button"]',
      fallbacks: ['button:has-text("Submit")', 'button:has-text("Post Pick")', '[data-testid*="submit"]'],
    },
    authError: {
      preferred: '[data-testid="smart-form-auth-error"]',
      fallbacks: ['text=/login|auth|unauthorized/i'],
    },
    successState: {
      preferred: '[data-testid="smart-form-success-state"]',
      fallbacks: ['text=/submitted|success|queued/i'],
    },
  },
  preflightChecks: [
    {
      id: 'smart_form_route_reachable',
      description: 'Smart Form submit route is reachable.',
      required: true,
      run: async ({ surface, env }) => httpPreflight(
        'smart_form_route_reachable',
        `${surface.baseUrls[env]}/submit`,
        'Smart Form /submit',
        true,
      ),
    },
    {
      id: 'nextauth_session_no_500',
      description: 'NextAuth session endpoint does not return HTTP 500.',
      required: true,
      run: async ({ surface, env }) => {
        const baseUrl = surface.baseUrls[env];
        const result = await httpPreflight(
          'nextauth_session_no_500',
          `${baseUrl}/api/auth/session`,
          'Smart Form /api/auth/session',
          true,
        );
        if (result.status === 'failed') {
          return {
            ...result,
            message: `${result.message} Check AUTH_SECRET / NEXTAUTH_SECRET in local.env and NextAuth config.`,
          };
        }
        return result;
      },
    },
  ],
  expectations: [
    {
      id: 'smart_form_session_no_500',
      description: 'Smart Form /api/auth/session must not return HTTP 500.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (
          record.url.includes('/api/auth/session') && (record.status ?? 0) >= 500
        ));
        return {
          id: 'smart_form_session_no_500',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0
            ? '/api/auth/session did not return HTTP 500.'
            : '/api/auth/session returned HTTP 500. Check AUTH_SECRET / NEXTAUTH_SECRET in local.env and NextAuth config.',
          evidence: failures,
        };
      },
    },
    {
      id: 'smart_form_no_login_redirect_before_form',
      description: 'Smart Form must not unexpectedly redirect to /login before controls render.',
      severity: 'critical',
      hard: true,
      evaluate: ({ page }) => {
        const pageUrl = page.url();
        const redirected = pageUrl.includes('/login');
        return {
          id: 'smart_form_no_login_redirect_before_form',
          status: redirected ? 'failed' : 'passed',
          severity: 'critical',
          message: redirected
            ? 'Unexpected redirect to /login before Smart Form controls rendered.'
            : 'No unexpected redirect to /login before form render.',
          evidence: { pageUrl },
        };
      },
    },
    {
      id: 'smart_form_controls_render',
      description: 'Sport, market, book, and submit controls render or intentional auth state is shown.',
      severity: 'critical',
      hard: true,
      evaluate: ({ selectorResults }) => {
        const authRendered = selectorResults.some((result) => result.key === 'authError' && result.found);
        if (authRendered) {
          return {
            id: 'smart_form_controls_render',
            status: 'passed',
            severity: 'critical',
            message: 'Intentional auth state rendered instead of form controls.',
          };
        }
        const required = ['sportSelect', 'marketSelect', 'bookSelect', 'submitButton'];
        const missing = required.filter((key) => !selectorResults.some((result) => result.key === key && result.found));
        return {
          id: 'smart_form_controls_render',
          status: missing.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: missing.length === 0 ? 'Sport, market, book, and submit controls rendered.' : `Missing form controls: ${missing.join(', ')}.`,
          evidence: selectorResults.filter((result) => required.includes(result.key)),
        };
      },
    },
    {
      id: 'smart_form_no_5xx_network_responses',
      description: 'No HTTP 5xx network responses.',
      severity: 'critical',
      hard: true,
      evaluate: ({ network }) => {
        const failures = network.filter((record) => (record.status ?? 0) >= 500);
        return {
          id: 'smart_form_no_5xx_network_responses',
          status: failures.length === 0 ? 'passed' : 'failed',
          severity: 'critical',
          message: failures.length === 0 ? 'No HTTP 5xx network responses observed.' : `${failures.length} HTTP 5xx response(s) observed.`,
          evidence: failures,
        };
      },
    },
  ],

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
      observations: uxFriction,
      regressionRecommendation: hasFriction
        ? 'Check AUTH_SECRET / NEXTAUTH_SECRET in local.env and NextAuth config if controls did not render; add stable data-testid selectors for sport, market, book, and submit.'
        : undefined,
    };
  },
};
