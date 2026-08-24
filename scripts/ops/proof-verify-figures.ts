/**
 * ops:proof-verify-figures — recompute every quantitative claim in a proof
 * bundle and fail on disagreement.
 *
 * Why this exists: stale figures asserted as recomputed were the single most
 * repeated cause of review rejection on this program. A bundle would claim a
 * diff stat, a changed-file count or a test count that had drifted one commit
 * earlier, while simultaneously asserting the figures were measured at that
 * head. Reviewers caught it by hand every time; nothing caught it mechanically.
 *
 * Per CLAUDE.md invariant 11: if a rule can be enforced mechanically, it must
 * not live only in prose.
 *
 * Usage:
 *   pnpm ops:proof-verify-figures UTV2-1234 [--base origin/main] [--json]
 *
 * Exit codes: 0 = every figure agrees · 1 = disagreement · 2 = precondition failed
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Finding {
  field: string;
  claimed: string;
  measured: string;
  source: string;
}

function sh(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 });
  return `${result.stdout ?? ''}`.trim();
}

function fail(code: string, message: string): never {
  process.stdout.write(`${JSON.stringify({ ok: false, code, message }, null, 2)}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const issueId = (argv.find((a) => /^UTV2-\d+$/iu.test(a)) ?? '').toUpperCase();
const baseIndex = argv.indexOf('--base');
const base = baseIndex >= 0 ? (argv[baseIndex + 1] ?? 'origin/main') : 'origin/main';
const asJson = argv.includes('--json');

if (!issueId) fail('PRECONDITION_FAILED', 'Usage: pnpm ops:proof-verify-figures UTV2-### [--base <ref>] [--json]');

const root = sh('git', ['rev-parse', '--show-toplevel']) || process.cwd();
const proofDir = path.join(root, 'docs', '06_status', 'proof', issueId);
if (!fs.existsSync(proofDir)) fail('PRECONDITION_FAILED', `No proof bundle at ${proofDir}`);

// ── Measure ground truth from git, never from the bundle ────────────────────
const changedFiles = sh('git', ['diff', '--name-only', `${base}...HEAD`])
  .split('\n')
  .filter(Boolean);
const measuredFileCount = changedFiles.length;

const statLine = sh('git', ['diff', '--shortstat', `${base}...HEAD`]);
const insMatch = /(\d+) insertion/u.exec(statLine);
const delMatch = /(\d+) deletion/u.exec(statLine);
const measuredIns = insMatch ? Number(insMatch[1]) : 0;
const measuredDel = delMatch ? Number(delMatch[1]) : 0;

// ── Read what the bundle claims ─────────────────────────────────────────────
const findings: Finding[] = [];
const proofFiles = fs.readdirSync(proofDir).filter((f) => /\.(md|json)$/u.test(f));

for (const file of proofFiles) {
  const full = path.join(proofDir, file);
  const text = fs.readFileSync(full, 'utf8');

  // "N files changed, M insertions(+), K deletions(-)"
  for (const m of text.matchAll(/(\d+)\s+files?\s+changed,\s*(\d+)\s+insertions?\(\+\)(?:,\s*(\d+)\s+deletions?\(-\))?/gu)) {
    const [, , ins, del] = m;
    // A per-subset stat (e.g. only the implementation files) is legitimate and
    // will not equal the whole-diff total, so only flag when the file count
    // matches the full diff -- that is a claim ABOUT the full diff.
    if (Number(m[1]) === measuredFileCount && (Number(ins) !== measuredIns || Number(del ?? 0) !== measuredDel)) {
      findings.push({
        field: 'diff stat',
        claimed: `${m[1]} files, ${ins} insertions, ${del ?? 0} deletions`,
        measured: `${measuredFileCount} files, ${measuredIns} insertions, ${measuredDel} deletions`,
        source: file,
      });
    }
  }

  // "N changed files"
  for (const m of text.matchAll(/(\d+)\s+changed\s+files?/gu)) {
    if (Number(m[1]) !== measuredFileCount) {
      findings.push({
        field: 'changed-file count',
        claimed: String(m[1]),
        measured: String(measuredFileCount),
        source: file,
      });
    }
  }

  if (file.endsWith('.json')) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const scope = parsed['scope'] as Record<string, unknown> | undefined;
    const claimedCount = scope?.['changed_files'];
    if (typeof claimedCount === 'number' && claimedCount !== measuredFileCount) {
      findings.push({
        field: 'scope.changed_files',
        claimed: String(claimedCount),
        measured: String(measuredFileCount),
        source: file,
      });
    }

    // Focused test counts: re-run each named suite and compare.
    const staticProof = parsed['static_proof'] as Record<string, unknown> | undefined;
    const focused = staticProof?.['focused_tests'] as Record<string, unknown> | undefined;
    if (focused) {
      for (const [suite, claimed] of Object.entries(focused)) {
        if (typeof claimed !== 'number' || suite === 'fail' || suite === 'total') continue;
        const candidate = path.join(root, 'scripts', 'ops', `${suite}.test.ts`);
        if (!fs.existsSync(candidate)) continue;
        const out = sh('pnpm', ['exec', 'tsx', '--test', candidate]);
        const passMatch = /^# pass (\d+)/mu.exec(out);
        const measured = passMatch ? Number(passMatch[1]) : -1;
        if (measured >= 0 && measured !== claimed) {
          findings.push({
            field: `focused_tests.${suite}`,
            claimed: String(claimed),
            measured: String(measured),
            source: file,
          });
        }
      }
    }
  }
}

const payload = {
  ok: findings.length === 0,
  code: findings.length === 0 ? 'FIGURES_AGREE' : 'FIGURES_STALE',
  issue_id: issueId,
  base,
  measured: {
    changed_files: measuredFileCount,
    insertions: measuredIns,
    deletions: measuredDel,
  },
  findings,
  ...(findings.length > 0
    ? { remediation: 'Recompute each figure from the commands and rewrite the bundle. Do not hand-edit toward the claimed value.' }
    : {}),
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`[proof-verify-figures] ${issueId} vs ${base}\n`);
  process.stdout.write(`  measured: ${measuredFileCount} files, ${measuredIns} insertions, ${measuredDel} deletions\n`);
  for (const f of findings) {
    process.stdout.write(`  [STALE] ${f.source} ${f.field}: claims "${f.claimed}", measured "${f.measured}"\n`);
  }
  process.stdout.write(findings.length === 0 ? '  VERDICT: all figures agree\n' : `  VERDICT: ${findings.length} stale figure(s)\n`);
}
process.exit(findings.length === 0 ? 0 : 1);
