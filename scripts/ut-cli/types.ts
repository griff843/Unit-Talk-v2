export type Tier = 'T1' | 'T2' | 'T3';

export interface VerificationCommand {
  name: string;
  cmd: string;
}

export interface IssueMetadata {
  id: string;
  title: string;
  tier: Tier;
  phase: string | null;
  upstream_dependencies: string[];
  allowed_files: string[];
  forbidden_files: string[];
  expected_collateral: string[];
  requires_migration: boolean;
  requires_sql_review: boolean;
  requires_status_sync: boolean;
  pm_review_required: boolean;
  rollback_plan: string | null;
  verification_commands: VerificationCommand[];
  sql_review_criteria: string[] | null;
  downstream_unlocks: string[];
  branch_prefix?: string;
  pr_template?: string | null;
  notes?: string | null;
  pre_existing_failures?: string | null;
}

export interface CliConfig {
  defaultBranchPrefix: string;
  baseBranch: string;
  remote: string;
  commitMessageRegex: string;
  coAuthorRequired: string | null;
  programStatusPath: string;
  lifecycleSpineFiles: string[];
}

export interface StartedState {
  timestamp: string;
  branch: string;
  startingSha: string;
  metadataHash: string;
}

export interface GateResult {
  name: string;
  type: 'scope' | 'migration' | 'command' | 'sanity';
  pass: boolean;
  exitCode: number | null;
  stderrTail?: string[];
  message: string;
}

export interface MigrationRecord {
  path: string;
  sha256: string;
}

export interface VerifyState {
  timestamp: string;
  verifier: string | null;
  verdict: 'pass' | 'block';
  branch: string;
  startingSha: string;
  diffSummary: {
    files: string[];
    stats: Array<{ path: string; additions: number; deletions: number }>;
    acknowledgedUntracked: string[];
    warnings: string[];
  };
  migrations: {
    detected: boolean;
    paths: MigrationRecord[];
  };
  gateResults: GateResult[];
  skippedGates: Array<{ name: string; reason: string }>;
}

export interface SqlReviewState {
  timestamp: string;
  reviewer: string;
  reviewedAgainst: string | null;
  migrations: MigrationRecord[];
}

export interface PrState {
  timestamp: string;
  number: number;
  url: string;
  branch: string;
}

export interface LiveApplyState {
  timestamp: string;
  appliedBy: string;
  migrationPaths: string[];
  liveMigrationHash: string;
  proofQueryResult: string | null;
}

export interface ClosedState {
  timestamp: string;
  tier: Tier;
  mergeCommitSha: string;
  verifyHashChain: {
    verify: string[];
    sqlReview: string[];
    liveApply: string[];
  } | null;
  downstreamUnlocks: string[];
}

export interface ShellResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ShellAdapter {
  run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      allowNonZero?: boolean;
      shell?: boolean;
    },
  ): ShellResult;
}

export interface CommandContext {
  cwd: string;
  shell: ShellAdapter;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
  bools: Set<string>;
}

export type JsonLike = unknown;
