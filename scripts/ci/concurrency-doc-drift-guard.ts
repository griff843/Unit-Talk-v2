#!/usr/bin/env tsx
/**
 * Concurrency-doc drift guard (the concurrency ramp follow-up).
 *
 * Agent-facing instruction surfaces (AGENTS.md, .claude/commands/*.md,
 * .claude/agents/*.md) sometimes hard-code the executor/total lane
 * concurrency ceiling in prose instead of deferring to
 * `docs/governance/CONCURRENCY_CONFIG.json`. When the config changes (as it
 * did when the ceiling moved from 6 total / 2 Claude / 4 Codex to 10 total /
 * 4 Claude / 6 Codex), any instruction doc that still embeds the old numbers
 * silently tells an agent to keep refusing lanes the mechanical gate
 * (`ops:lane-start`) now actually allows.
 *
 * This guard runs two independent checks against a narrow, explicit
 * allowlist of "current instruction" files — never a repo-wide scan, so it
 * never touches historical proof (`docs/06_status/proof/**`), lane
 * manifests (`docs/06_status/lanes/**`), incident records
 * (`docs/06_status/INCIDENTS/**`), or any other dated/superseded record that
 * accurately reports a past ceiling:
 *
 *   1. Static stale-literal check — a fixed list of exact phrasings known to
 *      describe a *previous* ceiling (6-lane/2-Claude/4-Codex base, the
 *      even older 5-lane/2-Claude/3-Codex trial baseline, and the bare
 *      "2/4/6" shorthand). These fire regardless of the live config, so
 *      they catch someone re-pasting old prose verbatim.
 *
 *   2. Config-driven claim check — recognizes a small set of table-row /
 *      "current total cap" phrasings that make an explicit numeric claim,
 *      extracts the claimed number, and compares it against the live base
 *      values in `docs/governance/CONCURRENCY_CONFIG.json` (via
 *      `loadConcurrencyConfig()` — the *base* config, not an active trial,
 *      since these docs describe the ratified default). This is
 *      self-updating: it does not need editing when the config next
 *      changes, only the instruction docs do.
 *
 * Usage:
 *   tsx scripts/ci/concurrency-doc-drift-guard.ts [--json] [--output <path>]
 *
 * Exit codes:
 *   0 — PASS (no stale literals, no mismatched numeric claims)
 *   1 — FAIL
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConcurrencyConfig, type ConcurrencyConfig } from '../ops/concurrency-config.js';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── Allowlist ────────────────────────────────────────────────────────────
//
// Deliberately narrow and explicit. Do NOT widen this to a repo-wide walk —
// that is exactly the noisy failure mode this guard is designed to avoid
// (see docs/06_status/proof/**, docs/06_status/lanes/**, and other dated
// records that correctly cite a past ceiling and must never be flagged).

const STATIC_ALLOWLIST: string[] = ['AGENTS.md', '.claude/agents/lane-governor.md'];

/** `.claude/commands/*.md` — every dispatch/lane-management skill doc. */
export function resolveCommandDocs(root = SCRIPT_ROOT): string[] {
  const dir = path.join(root, '.claude', 'commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => path.posix.join('.claude', 'commands', entry))
    .sort();
}

export function resolveAllowlist(root = SCRIPT_ROOT): string[] {
  return [...STATIC_ALLOWLIST, ...resolveCommandDocs(root)];
}

// ── Static stale-literal patterns ───────────────────────────────────────

interface StalePattern {
  code: string;
  pattern: RegExp;
  detail: string;
}

export const STALE_PATTERNS: StalePattern[] = [
  {
    code: 'DRIFT_STALE_CLAUDE_2',
    pattern: /Claude Code\s*\|\s*\*{0,2}2\*{0,2}\s*active lanes?/i,
    detail: 'describes Claude Code as having 2 active lanes (pre-UTV2-1533 ceiling)',
  },
  {
    code: 'DRIFT_STALE_CODEX_4',
    pattern: /Codex CLI\s*\|\s*\*{0,2}4\*{0,2}\s*active lanes?/i,
    detail: 'describes Codex CLI as having 4 active lanes (pre-UTV2-1533 ceiling)',
  },
  {
    code: 'DRIFT_STALE_CODEX_3',
    pattern: /Codex CLI\s*\|\s*\*{0,2}3\*{0,2}\s*active lanes?/i,
    detail: 'describes Codex CLI as having 3 active lanes (older pre-6-lane trial baseline)',
  },
  {
    code: 'DRIFT_STALE_TOTAL_5',
    pattern: /\btotal (?:active lanes|hard cap)\b[^\n]{0,20}?\b5\b/i,
    detail: 'describes total lane cap as 5 (older pre-6-lane trial baseline)',
  },
  {
    // Deliberately anchored to "total"/"execution lanes" phrasing, not a
    // bare "6 ... lanes" match — Codex CLI's own *current* ratified
    // executor cap is 6, so an unanchored pattern would false-positive on
    // a correct "Codex CLI | 6 active lanes" row. Only a claim about the
    // TOTAL cap being 6 is stale.
    code: 'DRIFT_STALE_TOTAL_6',
    pattern: /(?:current total cap\D{0,10}6\b|\b6\s+active execution lanes\b|\b6\s+lanes\s+total\b)/i,
    detail: 'describes total cap as 6 lanes (pre-UTV2-1533 ceiling)',
  },
  {
    code: 'DRIFT_STALE_246',
    pattern: /\b2\/4\/6\b/,
    detail: 'bare 2/4/6 shorthand for the pre-UTV2-1533 ceiling used as if still current',
  },
  {
    code: 'DRIFT_STALE_COMBO_2_4',
    pattern: /\b2\s*Claude\b[^\n]{0,15}\b4\s*Codex\b/i,
    detail: '"2 Claude + 4 Codex" combo stated as if still current',
  },
  {
    code: 'DRIFT_STALE_COMBO_1_2',
    pattern: /\b1\s*Claude\b[^\n]{0,15}\b2\s*Codex\b/i,
    detail: '"1 Claude + 2 Codex" combo stated as if still current',
  },
  {
    code: 'DRIFT_STALE_MAX_PHRASING',
    pattern: /\b(?:max|up to)\s*2\s*Claude\b|\b(?:max|up to)\s*4\s*Codex\b/i,
    detail: '"max/up to 2 Claude" or "max/up to 4 Codex" stated as if still current',
  },
];

/**
 * A line is exempt from the static patterns if it is itself the historical
 * provenance note explaining what the OLD ceiling used to be (clear "prior"/
 * "superseding"/"pre-"/"legacy" framing). These allowlisted files are
 * current-instruction surfaces, but they are allowed to *narrate* history in
 * prose as long as it is unambiguously framed as no-longer-current.
 */
const HISTORICAL_FRAMING_PATTERN =
  /\b(?:prior|superseded|superseding|legacy|pre-UTV2-1533|stabilization-era|used to be|previously)\b/i;

// ── Config-driven claim extractors ──────────────────────────────────────

interface ClaimExtractor {
  code: string;
  pattern: RegExp;
  role: 'claude' | 'codex' | 'total';
}

export const CLAIM_EXTRACTORS: ClaimExtractor[] = [
  {
    code: 'DRIFT_CONFIG_MISMATCH_CLAUDE',
    pattern: /Claude Code\s*\|\s*\*{0,2}(\d+)\*{0,2}\s*active lanes?/gi,
    role: 'claude',
  },
  {
    code: 'DRIFT_CONFIG_MISMATCH_CODEX',
    pattern: /Codex CLI\s*\|\s*\*{0,2}(\d+)\*{0,2}\s*active lanes?/gi,
    role: 'codex',
  },
  {
    code: 'DRIFT_CONFIG_MISMATCH_TOTAL',
    pattern: /current total cap:?\**\s*(\d+)\s*active (?:execution )?lanes?/gi,
    role: 'total',
  },
  {
    code: 'DRIFT_CONFIG_MISMATCH_TOTAL',
    pattern: /total hard cap\s*\|\s*\*{0,2}(\d+)\*{0,2}/gi,
    role: 'total',
  },
];

// ── Findings ─────────────────────────────────────────────────────────────

export interface DriftFinding {
  severity: 'fail';
  code: string;
  file: string;
  line: number;
  detail: string;
}

export interface DriftReport {
  verdict: 'PASS' | 'FAIL';
  checked_at: string;
  files_checked: string[];
  config_source: string;
  live_base_config: { total: number; claude: number; codex: number };
  findings: DriftFinding[];
}

export function checkFileContent(
  file: string,
  content: string,
  liveConfig: { total: number; claude: number; codex: number },
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (HISTORICAL_FRAMING_PATTERN.test(line)) continue;

    for (const rule of STALE_PATTERNS) {
      if (rule.pattern.test(line)) {
        findings.push({
          severity: 'fail',
          code: rule.code,
          file,
          line: index + 1,
          detail: `${rule.detail}: ${line.trim()}`,
        });
      }
    }

    for (const extractor of CLAIM_EXTRACTORS) {
      extractor.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = extractor.pattern.exec(line)) !== null) {
        const claimed = Number.parseInt(match[1], 10);
        const expected = liveConfig[extractor.role];
        if (claimed !== expected) {
          findings.push({
            severity: 'fail',
            code: extractor.code,
            file,
            line: index + 1,
            detail: `claims ${extractor.role}=${claimed} but docs/governance/CONCURRENCY_CONFIG.json currently has ${extractor.role}=${expected}: ${line.trim()}`,
          });
        }
      }
    }
  }

  return findings;
}

export function buildDriftReport(root = SCRIPT_ROOT, files: string[] = resolveAllowlist(root)): DriftReport {
  const config: ConcurrencyConfig = loadConcurrencyConfig();
  const liveConfig = { total: config.total, claude: config.executors.claude, codex: config.executors.codex };

  const findings: DriftFinding[] = [];
  const filesChecked: string[] = [];

  for (const relativeFile of files) {
    const absolutePath = path.isAbsolute(relativeFile) ? relativeFile : path.resolve(root, relativeFile);
    if (!existsSync(absolutePath)) continue;
    filesChecked.push(relativeFile);
    const content = readFileSync(absolutePath, 'utf8');
    findings.push(...checkFileContent(relativeFile, content, liveConfig));
  }

  return {
    verdict: findings.length === 0 ? 'PASS' : 'FAIL',
    checked_at: new Date().toISOString(),
    files_checked: filesChecked,
    config_source: 'docs/governance/CONCURRENCY_CONFIG.json',
    live_base_config: liveConfig,
    findings,
  };
}

function parseArgs(argv: string[]): { json: boolean; output: string | null } {
  let json = false;
  let output: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--output') {
      output = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return { json, output };
}

function printText(report: DriftReport): void {
  console.log(
    `[concurrency-doc-drift-guard] verdict=${report.verdict} files_checked=${report.files_checked.length} findings=${report.findings.length}`,
  );
  console.log(
    `[concurrency-doc-drift-guard] live base config: total=${report.live_base_config.total} claude=${report.live_base_config.claude} codex=${report.live_base_config.codex}`,
  );
  for (const finding of report.findings) {
    console.log(`[FAIL] ${finding.code} ${finding.file}:${finding.line} — ${finding.detail}`);
  }
}

const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('concurrency-doc-drift-guard.ts') ||
  invokedPath.endsWith('concurrency-doc-drift-guard.js')
) {
  const args = parseArgs(process.argv.slice(2));
  const report = buildDriftReport();

  if (args.output) {
    mkdirSync(path.dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }

  if (report.verdict !== 'PASS') {
    process.exitCode = 1;
  }
}
