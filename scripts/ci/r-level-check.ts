#!/usr/bin/env tsx
/**
 * R-level artifact compliance check for PR diffs.
 *
 * Usage:
 *   tsx scripts/ci/r-level-check.ts [--base <ref>] [--head <ref>] [--output-json <path>] [--pr-body-file <path>]
 *
 * Exit codes:
 *   0 — all required (non-pmGated) artifacts present, or no rules matched
 *   1 — one or more required non-pmGated artifacts missing
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ScopeAnnotationDef {
  description: string;
  allowedForRules: string[];
  downgradesRequired: string[];
  retains: string[];
  pmGated: boolean;
}

interface RulesFile {
  artifactPaths: Record<string, string>;
  rules: RuleEntry[];
  scopeAnnotations?: Record<string, ScopeAnnotationDef>;
}

interface RuleEntry {
  id: string;
  paths: string[];
  required: string[];
  advisory: string[];
  pmGated: string[];
  artifactRequirements: string[];
}

interface ArtifactStatus {
  required: boolean;
  pmGated: boolean;
  found: boolean;
  path: string | null;
  downgradedByAnnotation?: boolean;
}

interface RuleMatchSummary {
  id: string;
  required: string[];
  advisory: string[];
  pmGated: string[];
  annotationApplied?: boolean;
}

interface Report {
  verdict: 'PASS' | 'FAIL';
  changedFiles: string[];
  rulesMatched: RuleMatchSummary[];
  required: string[];
  advisory: string[];
  pmGated: string[];
  artifacts: Record<string, ArtifactStatus>;
  missingArtifacts: string[];
  advisoryMissing: string[];
  nextActions: string[];
  annotation_applied: boolean;
  annotation_type: string | null;
}

// Maps artifact key → corresponding R-level identifier used in rule required/pmGated arrays
const ARTIFACT_RLEVEL: Record<string, string> = {
  'r2-determinism': 'R2',
  'r3-shadow-report': 'R3',
  'r4-fault-report': 'R4',
  'r5-strategy-proof': 'R5',
  'qa-experience-report': 'qa-experience',
};

// Commands to produce each missing artifact (pmGated artifacts are excluded from nextActions)
const NEXT_ACTION_COMMANDS: Record<string, string> = {
  'r2-determinism': 'tsx scripts/live-data-lab-runner.ts',
  'r3-shadow-report':
    'tsx scripts/shadow-scoring-runner.ts --mode ci --output artifacts/shadow-report.json',
  'qa-experience-report': 'pnpm qa:experience --regression --mode fast',
};

const REGEX_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

function matchesGlob(filePath: string, pattern: string): boolean {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && i + 1 < pattern.length && pattern[i + 1] === '*') {
      // ** matches any path including slashes
      regexStr += '.*';
      i += 2;
      if (i < pattern.length && pattern[i] === '/') i++;
    } else if (c === '*') {
      // * matches anything within a single path segment
      regexStr += '[^/]*';
      i++;
    } else if (REGEX_SPECIAL.has(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`).test(filePath);
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

function findArtifact(repoRoot: string, globPattern: string): string | null {
  const firstWildcard = globPattern.search(/[*?]/);
  if (firstWildcard === -1) {
    const fullPath = path.join(repoRoot, globPattern);
    return fs.existsSync(fullPath) ? globPattern : null;
  }

  const lastSlash = globPattern.lastIndexOf('/', firstWildcard);
  const baseDir = lastSlash >= 0 ? globPattern.slice(0, lastSlash) : '';
  const basePath = baseDir ? path.join(repoRoot, baseDir) : repoRoot;

  if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    return null;
  }

  const hasDoublestar = globPattern.includes('**');
  let candidates: string[];

  if (hasDoublestar) {
    candidates = walkDir(basePath).map((abs) =>
      path.relative(repoRoot, abs).replace(/\\/g, '/'),
    );
  } else {
    candidates = fs.readdirSync(basePath).map((f) =>
      (baseDir ? `${baseDir}/${f}` : f),
    );
  }

  for (const candidate of candidates) {
    if (matchesGlob(candidate, globPattern)) {
      return candidate;
    }
  }
  return null;
}

function parseArgs(argv: string[]): {
  base: string;
  head: string;
  outputJson: string | null;
  prBodyFile: string | null;
} {
  const args = argv.slice(2);
  let base = 'origin/main';
  let head = 'HEAD';
  let outputJson: string | null = null;
  let prBodyFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base') base = args[++i] ?? base;
    else if (arg === '--head') head = args[++i] ?? head;
    else if (arg === '--output-json') outputJson = args[++i] ?? null;
    else if (arg === '--pr-body-file') prBodyFile = args[++i] ?? null;
  }
  return { base, head, outputJson, prBodyFile };
}

/**
 * Parse the PR body file and detect scope annotations.
 * Returns the annotation type if found (e.g. "additive-guard"), or null.
 */
function detectAnnotation(prBodyFile: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(prBodyFile, 'utf8');
  } catch {
    return null;
  }
  for (const line of content.split('\n')) {
    const match = /^r-scope:\s*(\S+)\s*$/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Apply a scope annotation to a matched rule, returning the effective
 * required/advisory/pmGated arrays after downgrade.
 *
 * Fail-closed: if the rule id is NOT in allowedForRules, returns null (no effect).
 */
function applyAnnotation(
  rule: RuleEntry,
  annotationDef: ScopeAnnotationDef,
): { required: string[]; advisory: string[]; pmGated: string[]; applied: boolean } | null {
  if (!annotationDef.allowedForRules.includes(rule.id)) {
    return null;
  }

  const downgradeSet = new Set(annotationDef.downgradesRequired);
  const retainSet = new Set(annotationDef.retains);

  // Move downgraded R-levels from required → advisory (unless in retains)
  const newRequired = rule.required.filter((r) => retainSet.has(r) || !downgradeSet.has(r));
  const downgradedLevels = rule.required.filter(
    (r) => downgradeSet.has(r) && !retainSet.has(r),
  );
  const newAdvisory = [...rule.advisory, ...downgradedLevels];
  // pmGated remains unchanged
  return { required: newRequired, advisory: newAdvisory, pmGated: rule.pmGated, applied: true };
}

function main(): void {
  const { base, head, outputJson, prBodyFile } = parseArgs(process.argv);

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), '../..');

  // Get changed files
  let changedFiles: string[];
  try {
    const raw = execSync(`git diff --name-only ${base}..${head}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    changedFiles = raw.trim().split('\n').filter(Boolean);
  } catch {
    changedFiles = [];
  }

  // Load rule matrix
  const rulesPath = path.join(repoRoot, 'docs/05_operations/r1-r5-rules.json');
  const rulesFile: RulesFile = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

  // Detect scope annotation from PR body file
  let annotationType: string | null = null;
  let annotationDef: ScopeAnnotationDef | null = null;
  if (prBodyFile) {
    annotationType = detectAnnotation(prBodyFile);
    if (annotationType && rulesFile.scopeAnnotations) {
      annotationDef = rulesFile.scopeAnnotations[annotationType] ?? null;
    }
  }

  // Match rules against changed files
  const matchedRules: RuleEntry[] = rulesFile.rules.filter((rule) =>
    changedFiles.some((file) => rule.paths.some((p) => matchesGlob(file, p))),
  );

  // Union required / advisory / pmGated and artifact keys across matched rules
  // Apply annotation overrides per-rule (fail-closed: only allowed rules are downgraded)
  const allRequired = new Set<string>();
  const allAdvisory = new Set<string>();
  const allPmGated = new Set<string>();
  const allArtifactKeys = new Set<string>();

  let annotationAppliedGlobal = false;
  const ruleMatchSummaries: RuleMatchSummary[] = [];

  for (const rule of matchedRules) {
    let effectiveRequired = rule.required;
    let effectiveAdvisory = rule.advisory;
    let effectivePmGated = rule.pmGated;
    let ruleAnnotationApplied = false;

    if (annotationDef) {
      const result = applyAnnotation(rule, annotationDef);
      if (result !== null && result.applied) {
        effectiveRequired = result.required;
        effectiveAdvisory = result.advisory;
        effectivePmGated = result.pmGated;
        ruleAnnotationApplied = true;
        annotationAppliedGlobal = true;
      }
    }

    effectiveRequired.forEach((r) => allRequired.add(r));
    effectiveAdvisory.forEach((r) => allAdvisory.add(r));
    effectivePmGated.forEach((r) => allPmGated.add(r));
    rule.artifactRequirements.forEach((a) => allArtifactKeys.add(a));

    ruleMatchSummaries.push({
      id: rule.id,
      required: effectiveRequired,
      advisory: effectiveAdvisory,
      pmGated: effectivePmGated,
      ...(ruleAnnotationApplied ? { annotationApplied: true } : {}),
    });
  }

  // Evaluate each artifact
  const artifacts: Record<string, ArtifactStatus> = {};
  const missingArtifacts: string[] = [];
  const advisoryMissing: string[] = [];
  const nextActions: string[] = [];

  for (const key of allArtifactKeys) {
    const rlevel = ARTIFACT_RLEVEL[key];
    const isPmGated = rlevel != null ? allPmGated.has(rlevel) : false;
    const isRequired = rlevel != null ? allRequired.has(rlevel) && !isPmGated : false;

    // Check if this artifact was downgraded by annotation
    let downgradedByAnnotation = false;
    if (annotationAppliedGlobal && annotationDef && rlevel) {
      const wasOriginallyRequired = matchedRules.some((r) => r.required.includes(rlevel));
      if (wasOriginallyRequired && !isRequired) {
        downgradedByAnnotation = true;
      }
    }

    const globPattern = rulesFile.artifactPaths[key];
    const foundPath = globPattern != null ? findArtifact(repoRoot, globPattern) : null;

    artifacts[key] = {
      required: isRequired,
      pmGated: isPmGated,
      found: foundPath !== null,
      path: foundPath,
      ...(downgradedByAnnotation ? { downgradedByAnnotation: true } : {}),
    };

    if (foundPath === null) {
      if (isPmGated) {
        advisoryMissing.push(key);
      } else if (isRequired) {
        missingArtifacts.push(key);
        const cmd = NEXT_ACTION_COMMANDS[key];
        if (cmd) nextActions.push(`Run \`${cmd}\` to produce ${key}`);
      }
    }
  }

  const report: Report = {
    verdict: missingArtifacts.length > 0 ? 'FAIL' : 'PASS',
    changedFiles,
    rulesMatched: ruleMatchSummaries,
    required: [...allRequired],
    advisory: [...allAdvisory],
    pmGated: [...allPmGated],
    artifacts,
    missingArtifacts,
    advisoryMissing,
    nextActions,
    annotation_applied: annotationAppliedGlobal,
    annotation_type: annotationAppliedGlobal ? annotationType : null,
  };

  const json = JSON.stringify(report, null, 2);

  if (outputJson) {
    fs.mkdirSync(path.dirname(path.resolve(repoRoot, outputJson)), { recursive: true });
    fs.writeFileSync(path.resolve(repoRoot, outputJson), json, 'utf8');
    console.log(`R-level check report written to ${outputJson}`);
  }

  // Summary to stdout
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Changed files: ${changedFiles.length}`);
  if (matchedRules.length > 0) {
    console.log(`Rules matched: ${matchedRules.map((r) => r.id).join(', ')}`);
  } else {
    console.log('Rules matched: (none) — no R-level artifacts required for this diff');
  }

  if (annotationAppliedGlobal) {
    console.log(`\nAnnotation: r-scope: ${annotationType} — applied`);
    const downgradedRules = ruleMatchSummaries.filter((r) => r.annotationApplied);
    if (downgradedRules.length > 0) {
      console.log(
        `  Downgraded R2/R3/R4 to advisory for rules: ${downgradedRules.map((r) => r.id).join(', ')}`,
      );
    }
    const skippedRules = ruleMatchSummaries.filter((r) => !r.annotationApplied);
    if (skippedRules.length > 0) {
      console.log(
        `  Annotation NOT applied (rule not in allowedForRules): ${skippedRules.map((r) => r.id).join(', ')}`,
      );
    }
  } else if (annotationType && !annotationDef) {
    console.log(`\nAnnotation: r-scope: ${annotationType} — unknown annotation type, ignored`);
  }

  if (missingArtifacts.length > 0) {
    process.stderr.write('\nMissing required artifacts:\n');
    missingArtifacts.forEach((k) => process.stderr.write(`  - ${k}\n`));
    process.stderr.write('\nNext actions:\n');
    nextActions.forEach((a) => process.stderr.write(`  ${a}\n`));
  }

  if (advisoryMissing.length > 0) {
    process.stderr.write('\nAdvisory (PM-gated) artifacts missing:\n');
    advisoryMissing.forEach((k) => process.stderr.write(`  - ${k} [PM-gated]\n`));
  }

  process.exit(missingArtifacts.length > 0 ? 1 : 0);
}

main();
