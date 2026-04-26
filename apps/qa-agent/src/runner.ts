import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type {
  QASkill,
  QAResult,
  SkillContext,
  Persona,
  ProductAdapter,
  Environment,
  RunMode,
  StepResult,
  NetworkObservation,
  SkillResult,
  QAExpectationResult,
} from './core/types.js';
import { assertStorageState } from './core/auth-state.js';
import { runPreflightChecks } from './core/preflight.js';
import { calculateFinalVerdict, evaluateSelectorContracts, selectorRecommendations } from './core/trust.js';

export interface RunSkillOptions {
  skill: QASkill;
  persona: Persona;
  adapter: ProductAdapter;
  env: Environment;
  mode: RunMode;
  artifactsBaseDir: string;
  skipPreflight?: boolean;
  force?: boolean;
}

function getHeadSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}

function datePrefix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export async function runSkill(opts: RunSkillOptions): Promise<QAResult> {
  const { skill, persona, adapter, env, mode, artifactsBaseDir } = opts;

  const surface = adapter.config.surfaces[skill.surface];
  if (!surface) throw new Error(`Surface '${skill.surface}' not found in adapter '${adapter.config.id}'`);

  const runId = `${datePrefix()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = join(artifactsBaseDir, runId);
  await mkdir(runDir, { recursive: true });

  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const isObserve = mode === 'observe';

  const preflightResults = await runPreflightChecks(
    skill.preflightChecks,
    { product: adapter.config, surface, persona, env },
    opts.skipPreflight ?? false,
  );
  const requiredPreflightFailed = preflightResults.some((result) => (
    result.required && result.status === 'failed'
  ));

  if (requiredPreflightFailed && !opts.force) {
    const verdict = calculateFinalVerdict({
      stepStatus: 'SKIP',
      preflightResults,
      expectationResults: [],
      force: false,
    });

    return {
      schema: 'experience-qa/v1',
      runId,
      product: adapter.config.id,
      surface: surface.id,
      persona: persona.id,
      flow: skill.flow,
      environment: env,
      headSha: getHeadSha(),
      timestamp,
      mode,
      status: verdict.status,
      verdictReason: verdict.reason,
      preflightResults,
      steps: [{
        step: 'browser automation',
        status: 'skip',
        detail: 'Skipped after required preflight failure. Use --force to continue into browser steps.',
        timestamp: new Date().toISOString(),
        durationMs: 0,
      }],
      expectationResults: [],
      observations: ['Browser steps skipped because a required preflight failed.'],
      selectorResults: [],
      screenshots: [],
      consoleErrors: [],
      networkErrors: [],
      networkObservations: [],
      uxFriction: [],
      durationMs: Date.now() - startTime,
    };
  }

  const storageStatePath = skill.requiresAuth
    ? await assertStorageState(adapter.config.id, persona.id)
    : persona.credentials?.storageStatePath;

  const browser = await chromium.launch({
    headless: !isObserve,
    slowMo: isObserve ? 300 : 0,
    args: isObserve ? ['--start-maximized'] : [],
  });

  const context = await browser.newContext({
    recordVideo: isObserve ? { dir: runDir, size: { width: 1280, height: 800 } } : undefined,
    viewport: { width: 1280, height: 800 },
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });

  if (isObserve) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }

  const page = await context.newPage();
  const capturedConsoleErrors: string[] = [];
  const capturedNetworkErrors: string[] = [];
  const capturedNetworkObservations: NetworkObservation[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') capturedConsoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    capturedConsoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith('chrome-extension://') || url.startsWith('data:')) return;
    const failureText = req.failure()?.errorText ?? 'failed';
    capturedNetworkErrors.push(`${req.method()} ${url} - ${failureText}`);
    capturedNetworkObservations.push({ method: req.method(), url, failureText });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith('chrome-extension://') || url.startsWith('data:')) return;
    const observation = { method: res.request().method(), url, status: res.status() };
    capturedNetworkObservations.push(observation);
    if (res.status() >= 500) {
      capturedNetworkErrors.push(`${observation.method} ${url} - HTTP ${res.status()}`);
    }
  });

  const capturedScreenshots: string[] = [];
  let stepCounter = 0;

  const skillContext: SkillContext = {
    page,
    persona,
    surface,
    product: adapter.config,
    mode,
    env,
    runId,
    artifactsDir: runDir,

    log(step: string, detail?: string): void {
      process.stdout.write(`  [${++stepCounter}] ${step}${detail ? ` - ${detail}` : ''}\n`);
    },

    async screenshot(name: string): Promise<string> {
      const screenshotPath = join(runDir, `${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      capturedScreenshots.push(screenshotPath);
      return screenshotPath;
    },
  };

  let skillResult: SkillResult;
  try {
    await adapter.authenticate(page, persona, env);
    skillResult = await skill.run(skillContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorStep: StepResult = {
      step: 'uncaught error during skill execution',
      status: 'fail',
      detail: message,
      timestamp: new Date().toISOString(),
      durationMs: 0,
    };
    try {
      const errPath = join(runDir, 'error-state.png');
      await page.screenshot({ path: errPath, fullPage: true });
      capturedScreenshots.push(errPath);
    } catch { /* ignore */ }

    skillResult = {
      status: 'ERROR',
      severity: 'critical',
      steps: [errorStep],
      consoleErrors: [message],
      networkErrors: [],
      uxFriction: [],
      observations: [],
    };
  }

  const selectorResults = await evaluateSelectorContracts(page, skill.selectors);
  const expectationResults: QAExpectationResult[] = [];
  for (const expectation of skill.expectations ?? []) {
    try {
      const result = await expectation.evaluate({
        page,
        persona,
        surface,
        product: adapter.config,
        env,
        skillResult,
        preflightResults,
        selectorResults,
        consoleErrors: [...capturedConsoleErrors, ...skillResult.consoleErrors],
        network: capturedNetworkObservations,
      });
      expectationResults.push({ ...result, severity: expectation.severity, hard: expectation.hard });
    } catch (error) {
      expectationResults.push({
        id: expectation.id,
        status: 'failed',
        severity: expectation.severity,
        hard: expectation.hard,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const verdict = calculateFinalVerdict({
    stepStatus: skillResult.status,
    preflightResults,
    expectationResults,
    force: opts.force ?? false,
  });

  let tracePath: string | undefined;
  if (isObserve) {
    tracePath = join(runDir, 'trace.zip');
    await context.tracing.stop({ path: tracePath });
  }

  const videoRef = isObserve ? page.video() : null;
  await context.close();
  await browser.close();

  let videoPath: string | undefined;
  if (videoRef) {
    try { videoPath = await videoRef.path() ?? undefined; } catch { /* ignore */ }
  }

  const allScreenshots = [
    ...capturedScreenshots,
    ...skillResult.steps.flatMap((s) => (s.screenshotPath ? [s.screenshotPath] : [])),
  ];
  const regressionRecommendations = [
    ...selectorRecommendations(selectorResults),
    ...(skillResult.regressionRecommendation ? [skillResult.regressionRecommendation] : []),
  ];

  return {
    schema: 'experience-qa/v1',
    runId,
    product: adapter.config.id,
    surface: surface.id,
    persona: persona.id,
    flow: skill.flow,
    environment: env,
    headSha: getHeadSha(),
    timestamp,
    mode,
    status: verdict.status,
    verdictReason: verdict.reason,
    severity: skillResult.severity,
    preflightResults,
    steps: skillResult.steps,
    expectationResults,
    observations: skillResult.observations ?? [],
    selectorResults,
    screenshots: allScreenshots,
    videoPath,
    tracePath,
    consoleErrors: [...capturedConsoleErrors, ...skillResult.consoleErrors],
    networkErrors: [...capturedNetworkErrors, ...skillResult.networkErrors],
    networkObservations: capturedNetworkObservations,
    uxFriction: skillResult.uxFriction,
    issueRecommendation: skillResult.issueRecommendation,
    regressionRecommendation: regressionRecommendations[0],
    regressionRecommendations,
    durationMs: Date.now() - startTime,
  };
}
