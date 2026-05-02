import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';
import { assertStorageState } from '../../../../../core/auth-state.js';
import { httpPreflight } from '../../../../../core/preflight.js';

type MatrixPersona = {
  id: string;
  label: string;
};

type MatrixRoute = {
  path: string;
  label: string;
  authorizedPersonas: readonly string[];
};

type MatrixResult = {
  persona: string;
  route: string;
  expected: 'allow' | 'deny';
  observed: 'loaded' | 'redirected' | 'forbidden' | 'error';
  status: 'PASS' | 'FAIL';
  detail: string;
};

const matrixPersonas: readonly MatrixPersona[] = [
  { id: 'free', label: 'Free' },
  { id: 'trial_user', label: 'Trial' },
  { id: 'vip', label: 'VIP' },
  { id: 'vip_plus_user', label: 'VIP+' },
  { id: 'operator', label: 'Operator' },
];

const matrixRoutes: readonly MatrixRoute[] = [
  { path: '/picks', label: 'Picks', authorizedPersonas: ['free', 'trial_user', 'vip', 'vip_plus_user', 'operator'] },
  { path: '/admin', label: 'Admin', authorizedPersonas: ['operator'] },
  { path: '/vip', label: 'VIP', authorizedPersonas: ['vip', 'vip_plus_user', 'operator'] },
];

export const accessMatrixSkill: QASkill = {
  id: 'command-center/access-matrix',
  product: 'unit-talk',
  surface: 'command_center',
  flow: 'access_matrix',
  supportedPersonas: ['operator', 'admin'],
  description: 'Command Center access matrix check: protected route authorization by persona storage state',
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
  ],

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];
    const results: MatrixResult[] = [];
    const baseUrl = ctx.surface.baseUrls[ctx.env];
    const browser = ctx.page.context().browser();

    if (!browser) {
      return buildFailResult(steps, uxFriction, 'Playwright browser was unavailable for access matrix contexts.');
    }

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

    for (const persona of matrixPersonas) {
      await step(`Load storage state for ${persona.label}`, async () => {
        await assertStorageState(ctx.product.id, persona.id);
      });

      const storageState = await assertStorageState(ctx.product.id, persona.id).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        for (const route of matrixRoutes) {
          results.push({
            persona: persona.label,
            route: route.path,
            expected: route.authorizedPersonas.includes(persona.id) ? 'allow' : 'deny',
            observed: 'error',
            status: 'FAIL',
            detail,
          });
        }
        return undefined;
      });

      if (!storageState) continue;

      const context = await browser.newContext({
        storageState,
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      try {
        for (const route of matrixRoutes) {
          await step(`${persona.label} visits ${route.path}`, async () => {
            results.push(await evaluateRoute(page, baseUrl, persona, route));
          });
        }
      } finally {
        await context.close();
      }
    }

    const table = renderMatrixTable(results);
    const failed = results.filter((result) => result.status === 'FAIL');

    if (failed.length > 0) {
      uxFriction.push(`${failed.length} access matrix combination(s) did not match expected authorization.`);
      return {
        status: 'FAIL',
        severity: 'high',
        steps,
        consoleErrors: [],
        networkErrors: [],
        uxFriction,
        observations: ['Access matrix results:', table],
        issueRecommendation: {
          title: '[QA] Command Center access matrix regression',
          severity: 'high',
          product: 'unit-talk',
          surface: 'command_center',
          description: 'One or more protected Command Center routes allowed or denied the wrong persona.',
          stepsToReproduce: [
            `Open Command Center at ${baseUrl}`,
            'Load each seeded persona storage state',
            'Visit /picks, /admin, and /vip',
          ],
          expectedBehavior: '/picks allows any authenticated persona; /admin allows operator; /vip allows VIP or above.',
          actualBehavior: failed.map((result) => `${result.persona} ${result.route}: ${result.detail}`).join('; '),
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'command_center', 'access_matrix', 'severity-high'],
        },
      };
    }

    return {
      status: 'PASS',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction,
      observations: ['Access matrix results:', table],
    };
  },
};

async function evaluateRoute(
  page: SkillContext['page'],
  baseUrl: string,
  persona: MatrixPersona,
  route: MatrixRoute,
): Promise<MatrixResult> {
  const expected = route.authorizedPersonas.includes(persona.id) ? 'allow' : 'deny';
  const targetUrl = new URL(route.path, baseUrl).toString();

  try {
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

    const url = page.url();
    const status = response?.status();
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    const redirectedToLogin = /\/login(?:[/?#]|$)/i.test(new URL(url).pathname);
    const forbidden = status === 401 || status === 403 || /\b(403|forbidden|unauthorized|access denied)\b/i.test(bodyText);
    const loaded = !redirectedToLogin && !forbidden && bodyText.trim().length > 0;
    const observed = redirectedToLogin ? 'redirected' : forbidden ? 'forbidden' : loaded ? 'loaded' : 'error';
    const passed = expected === 'allow' ? loaded : redirectedToLogin || forbidden;

    return {
      persona: persona.label,
      route: route.path,
      expected,
      observed,
      status: passed ? 'PASS' : 'FAIL',
      detail: passed
        ? `${route.label} authorization behaved as expected.`
        : `Expected ${expected}, observed ${observed} at ${url}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      persona: persona.label,
      route: route.path,
      expected,
      observed: 'error',
      status: 'FAIL',
      detail,
    };
  }
}

function renderMatrixTable(results: readonly MatrixResult[]): string {
  return [
    '| Persona | Route | Expected | Observed | Result | Detail |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map((result) => (
      `| ${result.persona} | ${result.route} | ${result.expected} | ${result.observed} | ${result.status} | ${result.detail.replace(/\|/g, '/')} |`
    )),
  ].join('\n');
}

function buildFailResult(steps: StepResult[], uxFriction: string[], actualBehavior: string): SkillResult {
  return {
    status: 'FAIL',
    severity: 'critical',
    steps,
    consoleErrors: [],
    networkErrors: [],
    uxFriction,
    issueRecommendation: {
      title: '[QA] Command Center access matrix blocked',
      severity: 'critical',
      product: 'unit-talk',
      surface: 'command_center',
      description: 'QA agent could not create isolated browser contexts for persona access checks.',
      stepsToReproduce: ['Run the command-center/access-matrix QA skill.'],
      expectedBehavior: 'QA agent can create a browser context per seeded persona storage state.',
      actualBehavior,
      screenshotPaths: [],
      labels: ['qa-agent', 'unit-talk', 'command_center', 'access_matrix', 'severity-critical', 'infra'],
    },
  };
}
