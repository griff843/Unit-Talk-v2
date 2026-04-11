#!/usr/bin/env node
/**
 * Generate a new evidence bundle from the canonical template.
 *
 * Usage:
 *   node scripts/evidence-bundle/new-bundle.mjs UTV2-532
 *   node scripts/evidence-bundle/new-bundle.mjs UTV2-532 --force
 *
 * - Validates the issue id matches /^UTV2-\d+$/.
 * - Fails with non-zero exit if target file already exists, unless --force.
 * - Creates docs/06_status/evidence/<ISSUE-ID>/.gitkeep for sibling artifacts.
 * - Sets Verifier Identity from EVIDENCE_VERIFIER env var.
 *
 * ESM pure-stdlib — no external deps.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const ISSUE_ID_RE = /^UTV2-\d+$/;

function parseArgv(argv) {
  const args = argv.slice(2);
  let issueId = null;
  let force = false;
  for (const a of args) {
    if (a === '--force') force = true;
    else if (!issueId) issueId = a;
  }
  return { issueId, force };
}

function fail(msg, code = 1) {
  process.stderr.write(`[new-bundle] ${msg}\n`);
  process.exit(code);
}

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function today() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildBundleSkeleton(issueId, verifier, date) {
  return `# ${issueId} — Evidence Bundle

> Generated from \`docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md\` on ${date}.
> Fill in every section. Run \`pnpm evidence:validate docs/06_status/${issueId}-EVIDENCE-BUNDLE.md\` before requesting PM acceptance.

---

## Metadata

| Field | Value |
|---|---|
| Issue ID | ${issueId} |
| Tier | T? |
| Phase / Gate | Phase ? — <short name> |
| Owner | <lane or human> |
| Date | ${date} |
| Verifier Identity | ${verifier} |
| Commit SHA(s) | <short sha> |
| Related PRs | #NNN |

---

## Scope

**Claims:**
- <concrete claim 1>

**Does NOT claim:**
- <out-of-scope item>

---

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | <assertion text> | db-query | live DB \`feownrheeefbcsehtsiw\` | PASS | [E1](#e1-first-assertion) |

---

## Evidence Blocks

### E1 First assertion

**DB-query evidence**
Project ref: \`feownrheeefbcsehtsiw\`
Run at: ${date}T00:00:00Z
Query:
\`\`\`sql
-- fill in
\`\`\`
Result:
| col | col |
|---|---|
| ... | ... |

---

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| <verbatim criterion> | 1 |

---

## Stop Conditions Encountered

None

---

## Sign-off

**Verifier:** ${verifier} — ${date}
**PM acceptance:** pending
`;
}

async function main() {
  const { issueId, force } = parseArgv(process.argv);
  if (!issueId) fail('missing issue id. usage: node scripts/evidence-bundle/new-bundle.mjs UTV2-XXX');
  if (!ISSUE_ID_RE.test(issueId)) fail(`invalid issue id "${issueId}". must match /^UTV2-\\d+$/`);

  const verifier =
    process.env.EVIDENCE_VERIFIER ?? 'UNSET — set EVIDENCE_VERIFIER before running';
  const date = today();

  const bundlePath = join(REPO_ROOT, 'docs', '06_status', `${issueId}-EVIDENCE-BUNDLE.md`);
  const evidenceDir = join(REPO_ROOT, 'docs', '06_status', 'evidence', issueId);
  const gitkeep = join(evidenceDir, '.gitkeep');

  if (await exists(bundlePath)) {
    if (!force) fail(`target already exists: ${bundlePath}. pass --force to overwrite.`, 2);
  }

  await mkdir(evidenceDir, { recursive: true });
  if (!(await exists(gitkeep))) {
    await writeFile(gitkeep, '', 'utf8');
  }

  const content = buildBundleSkeleton(issueId, verifier, date);
  await writeFile(bundlePath, content, 'utf8');

  process.stdout.write(`${bundlePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`[new-bundle] unexpected error: ${err?.stack ?? err}\n`);
  process.exit(3);
});
