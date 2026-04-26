import type { Page } from 'playwright';

// ─── Domain enumerations ────────────────────────────────────────────────────

export type MemberTier =
  | 'free'
  | 'trial'
  | 'vip'
  | 'vip-plus'
  | 'capper'
  | 'operator'
  | 'admin';

export type RunMode = 'observe' | 'fast';
export type Environment = 'local' | 'staging' | 'production';
export type QAStatus = 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'SKIP' | 'ERROR';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

// ─── Persona ────────────────────────────────────────────────────────────────

export interface PersonaCredentials {
  email?: string;
  password?: string;
  apiKey?: string;
  discordToken?: string;
  /** Path to a JSON file with saved browser storage state (cookies, localStorage). */
  storageStatePath?: string;
}

export interface Persona {
  id: string;
  displayName: string;
  memberTier: MemberTier;
  /** Human-readable list of what this persona is allowed to do. */
  capabilities: string[];
  credentials?: PersonaCredentials;
  discordRoles?: string[];
}

// ─── Product & surface config ───────────────────────────────────────────────

export interface SurfaceConfig {
  id: string;
  displayName: string;
  baseUrls: Record<Environment, string>;
}

export interface ProductConfig {
  id: string;
  displayName: string;
  surfaces: Record<string, SurfaceConfig>;
}

// ─── Skill ──────────────────────────────────────────────────────────────────

export interface StepResult {
  step: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
  screenshotPath?: string;
  timestamp: string;
  durationMs: number;
}

export interface IssueRecommendation {
  title: string;
  severity: Severity;
  product: string;
  surface: string;
  description: string;
  stepsToReproduce: string[];
  expectedBehavior: string;
  actualBehavior: string;
  screenshotPaths: string[];
  labels: string[];
}

export interface SkillResult {
  status: QAStatus;
  severity?: Severity;
  steps: StepResult[];
  /** Errors the skill explicitly detected (API response errors, validation failures). */
  consoleErrors: string[];
  networkErrors: string[];
  uxFriction: string[];
  issueRecommendation?: IssueRecommendation;
  regressionRecommendation?: string;
}

/** Execution context injected into every skill's run() method. */
export interface SkillContext {
  page: Page;
  persona: Persona;
  surface: SurfaceConfig;
  product: ProductConfig;
  mode: RunMode;
  env: Environment;
  runId: string;
  artifactsDir: string;
  /** Print a human-readable step to stdout. */
  log(step: string, detail?: string): void;
  /** Capture a full-page screenshot and return its path. */
  screenshot(name: string): Promise<string>;
}

export interface QASkill {
  readonly id: string;
  readonly product: string;
  readonly surface: string;
  readonly flow: string;
  readonly supportedPersonas: readonly string[];
  readonly description: string;
  run(context: SkillContext): Promise<SkillResult>;
}

// ─── Product adapter ────────────────────────────────────────────────────────

export interface ProductAdapter {
  readonly config: ProductConfig;
  getSkill(surface: string, flow: string): QASkill | undefined;
  /** Set up browser-level auth for a persona before the skill runs. */
  authenticate(page: Page, persona: Persona, env: Environment): Promise<void>;
}

// ─── QA Result (the canonical artifact written to disk) ─────────────────────

export interface QAResult {
  schema: 'experience-qa/v1';
  runId: string;
  product: string;
  surface: string;
  persona: string;
  flow: string;
  environment: Environment;
  headSha: string;
  timestamp: string;
  mode: RunMode;
  status: QAStatus;
  severity?: Severity;
  steps: StepResult[];
  screenshots: string[];
  videoPath?: string;
  tracePath?: string;
  consoleErrors: string[];
  networkErrors: string[];
  uxFriction: string[];
  issueRecommendation?: IssueRecommendation;
  regressionRecommendation?: string;
  durationMs: number;
}

// ─── QA Ledger ──────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  product: string;
  surface: string;
  flow: string;
  persona: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: QAStatus;
  issueUrl?: string;
  /** True if a previously-passing flow started failing. */
  regression: boolean;
  notes?: string;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export interface CLIOptions {
  product: string;
  surface: string;
  persona: string;
  flow: string;
  mode: RunMode;
  env: Environment;
  outputDir: string;
  dryRun: boolean;
}
