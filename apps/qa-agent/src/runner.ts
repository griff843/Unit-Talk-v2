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
} from './core/types.js';

export interface RunSkillOptions {
  skill: QASkill;
  persona: Persona;
  adapter: ProductAdapter;
  env: Environment;
  mode: RunMode;
  artifactsBaseDir: string;
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

  const browser = await chromium.launch({
    headless: !isObserve,
    slowMo: isObserve ? 300 : 0,
    args: isObserve ? ['--start-maximized'] : [],
  });

  const context = await browser.newContext({
    recordVideo: isObserve ? { dir: runDir, size: { width: 1280, height: 800 } } : undefined,
    viewport: { width: 1280, height: 800 },
    ...(persona.credentials?.storageStatePath
      ? { storageState: persona.credentials.storageStatePath }
      : {}),
  });

  if (isObserve) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }

  const page = await context.newPage();

  // ── Collect browser-level errors ───────────────────────────────────────────
  const capturedConsoleErrors: string[] = [];
  const capturedNetworkErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') capturedConsoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    capturedConsoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith('chrome-extension://') || url.startsWith('data:')) return;
    capturedNetworkErrors.push(`${req.method()} ${url} — ${req.failure()?.errorText ?? 'failed'}`);
  });

  // ── Build skill context ────────────────────────────────────────────────────
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
      process.stdout.write(`  [${++stepCounter}] ${step}${detail ? ` — ${detail}` : ''}\n`);
    },

    async screenshot(name: string): Promise<string> {
      const screenshotPath = join(runDir, `${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      capturedScreenshots.push(screenshotPath);
      return screenshotPath;
    },
  };

  // ── Run skill ──────────────────────────────────────────────────────────────
  let skillResult;
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
      status: 'ERROR' as const,
      severity: 'critical' as const,
      steps: [errorStep],
      consoleErrors: [message],
      networkErrors: [],
      uxFriction: [],
    };
  }

  // ── Collect trace + video ──────────────────────────────────────────────────
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
    status: skillResult.status,
    severity: skillResult.severity,
    steps: skillResult.steps,
    screenshots: allScreenshots,
    videoPath,
    tracePath,
    consoleErrors: [...capturedConsoleErrors, ...skillResult.consoleErrors],
    networkErrors: [...capturedNetworkErrors, ...skillResult.networkErrors],
    uxFriction: skillResult.uxFriction,
    issueRecommendation: skillResult.issueRecommendation,
    regressionRecommendation: skillResult.regressionRecommendation,
    durationMs: Date.now() - startTime,
  };
}
