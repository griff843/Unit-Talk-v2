#!/usr/bin/env node
/**
 * Validate an evidence bundle against docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md rules.
 *
 * Usage:
 *   node scripts/evidence-bundle/validate-bundle.mjs <path>
 *   node scripts/evidence-bundle/validate-bundle.mjs --all
 *   node scripts/evidence-bundle/validate-bundle.mjs --json <path>
 *   node scripts/evidence-bundle/validate-bundle.mjs --strict <path>
 *
 * Exit codes:
 *   0 — all bundles passed
 *   1 — one or more findings
 *   2 — usage error
 *
 * This is a mechanical doc-shape checker, not a semantic proof engine.
 * ESM pure-stdlib — no external deps.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const REQUIRED_SECTIONS = [
  'Metadata',
  'Scope',
  'Assertions',
  'Evidence Blocks',
  'Acceptance Criteria Mapping',
  'Stop Conditions Encountered',
  'Sign-off',
];

const REQUIRED_METADATA_FIELDS = [
  'Issue ID',
  'Tier',
  'Phase / Gate',
  'Owner',
  'Date',
  'Verifier Identity',
  'Commit SHA(s)',
  'Related PRs',
];

const PLACEHOLDER_TOKENS = ['TODO', 'TBD', '<fill-in>', 'FIXME'];
const ALLOWED_RESULTS = new Set(['PASS', 'FAIL', 'WAIVED']);

/**
 * Parse a bundle markdown file into an object with sections keyed by heading text.
 * Top-level sections are split on `## ` headings.
 */
export function parseBundle(source) {
  const lines = source.split(/\r?\n/);
  const sections = new Map();
  let currentName = null;
  let currentLines = [];

  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 && !line.startsWith('### ')) {
      if (currentName !== null) {
        sections.set(currentName, currentLines.join('\n'));
      }
      currentName = h2[1].trim();
      currentLines = [];
      continue;
    }
    if (currentName !== null) {
      currentLines.push(line);
    }
  }
  if (currentName !== null) {
    sections.set(currentName, currentLines.join('\n'));
  }

  return sections;
}

/**
 * Parse a simple pipe-delimited markdown table into array of row objects.
 * Header row's cells become keys. Separator row (---) is skipped.
 */
export function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2) return { headers: [], rows: [] };

  const splitRow = (line) => {
    // trim leading/trailing pipe then split
    const inner = line.replace(/^\|/, '').replace(/\|$/, '');
    return inner.split('|').map((c) => c.trim());
  };

  const headers = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitRow(lines[i]);
    // skip separator rows like |---|---|
    if (row.every((c) => /^:?-+:?$/.test(c))) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] ?? '';
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Parse a "field | value" two-column table into a Map<field, value>.
 */
export function parseFieldTable(text) {
  const { rows } = parseMarkdownTable(text);
  const map = new Map();
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length < 2) continue;
    const field = row[keys[0]];
    const value = row[keys[1]];
    if (field) map.set(field, value);
  }
  return map;
}

/**
 * Extract the text content of a specific evidence block (### E<num> ...) from
 * the Evidence Blocks section. Returns empty string if not found.
 */
function extractEvidenceBlockText(evidenceBlocksText, num) {
  const pattern = new RegExp(`^###\\s+E${num}\\b[^\\n]*\\n`, 'm');
  const match = pattern.exec(evidenceBlocksText);
  if (!match) return '';
  const start = match.index + match[0].length;
  // Find next ### heading or end of text
  const nextHeading = evidenceBlocksText.indexOf('\n### ', start);
  return nextHeading === -1
    ? evidenceBlocksText.slice(start)
    : evidenceBlocksText.slice(start, nextHeading);
}

/** Semantic checks keyed by evidence type. Each returns array of missing element names. */
const SEMANTIC_CHECKS = {
  'db-query': (text) => {
    const f = [];
    if (!/```(?:sql|SQL)/m.test(text)) f.push('sql-fence');
    if (!/feownrheeefbcsehtsiw|branch:/m.test(text)) f.push('project-ref');
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m.test(text)) f.push('timestamp');
    return f;
  },
  'test': (text) => {
    const f = [];
    if (!/\.test\.(?:ts|js)/m.test(text)) f.push('test-file-path');
    if (!/tsx --test|node --test/m.test(text)) f.push('test-command');
    if (!/ok \d+/m.test(text)) f.push('test-output');
    return f;
  },
  'fixture': (text) => {
    const f = [];
    if (!/[/\\]/.test(text)) f.push('file-path');
    if (!/sha256:|[a-f0-9]{64}/m.test(text)) f.push('content-hash');
    return f;
  },
  'http': (text) => {
    const f = [];
    if (!/curl|fetch|GET |POST /m.test(text)) f.push('http-method');
    if (!/HTTP \d{3}|\b\d{3}\b/m.test(text)) f.push('status-code');
    return f;
  },
  'repo-truth': (text) => {
    const f = [];
    if (!/git log|git show|grep|rg /m.test(text)) f.push('git-command');
    if (text.split(/\r?\n/).filter((l) => l.trim()).length < 2) f.push('output-excerpt');
    return f;
  },
};

/**
 * Core validator. Returns array of findings.
 * Each finding: { code, message, section? }
 * Options: { strict?: boolean } — enables semantic evidence-block checks.
 */
export function validateBundle(source, options = {}) {
  const { strict = false } = options;
  const findings = [];
  const sections = parseBundle(source);

  // Rule 1: all required sections present
  for (const name of REQUIRED_SECTIONS) {
    if (!sections.has(name)) {
      findings.push({
        code: 'missing-section',
        message: `required section missing: "## ${name}"`,
      });
    }
  }

  // Rule 2: metadata table has all required fields, non-empty
  const metaText = sections.get('Metadata') ?? '';
  const metaFields = parseFieldTable(metaText);
  for (const field of REQUIRED_METADATA_FIELDS) {
    const val = metaFields.get(field);
    if (val === undefined) {
      findings.push({
        code: 'metadata-field-missing',
        message: `metadata field missing: "${field}"`,
        section: 'Metadata',
      });
    } else if (!val || /^<.*>$/.test(val.trim())) {
      findings.push({
        code: 'metadata-field-blank',
        message: `metadata field blank or placeholder: "${field}"`,
        section: 'Metadata',
      });
    }
  }

  // Rule 8: verifier identity not blank, not literal "claude"
  const verifier = (metaFields.get('Verifier Identity') ?? '').trim();
  if (verifier === '' || /^<.*>$/.test(verifier)) {
    findings.push({
      code: 'verifier-blank',
      message: 'Verifier Identity is blank or placeholder',
      section: 'Metadata',
    });
  } else if (verifier.toLowerCase() === 'claude') {
    findings.push({
      code: 'verifier-too-generic',
      message:
        'Verifier Identity may not be literal "claude" — use claude/<session-id> or a qualified form',
      section: 'Metadata',
    });
  }

  // Rule 3/4/5/6/7: assertions table + result validation + evidence-block tie
  const assertionsText = sections.get('Assertions') ?? '';
  const assertionsTable = parseMarkdownTable(assertionsText);
  if (assertionsTable.rows.length === 0) {
    findings.push({
      code: 'assertions-empty',
      message: 'assertions table has no data rows',
      section: 'Assertions',
    });
  }

  const evidenceBlocksText = sections.get('Evidence Blocks') ?? '';

  for (const row of assertionsTable.rows) {
    const num = (row['#'] ?? '').trim();
    const result = (row['Result'] ?? '').trim().toUpperCase();
    const evidenceRef = (row['Evidence Ref'] ?? '').trim();

    // Rule 4: result must be one of PASS/FAIL/WAIVED
    if (!ALLOWED_RESULTS.has(result)) {
      findings.push({
        code: 'invalid-result',
        message: `assertion row ${num || '?'}: result "${result}" not in {PASS, FAIL, WAIVED}`,
        section: 'Assertions',
      });
    }

    // Rule 7: no placeholder text in evidence ref
    for (const token of PLACEHOLDER_TOKENS) {
      if (evidenceRef.includes(token)) {
        findings.push({
          code: 'placeholder-evidence-ref',
          message: `assertion row ${num || '?'}: evidence ref contains placeholder "${token}"`,
          section: 'Assertions',
        });
        break;
      }
    }

    // Rule 5: PASS rows must have a matching evidence block heading
    if (result === 'PASS') {
      const headingRe = new RegExp(`^###\\s+E${num}\\b`, 'm');
      if (!headingRe.test(evidenceBlocksText)) {
        findings.push({
          code: 'missing-evidence-block',
          message: `assertion row ${num || '?'} is PASS but no "### E${num}" block found under "## Evidence Blocks"`,
          section: 'Evidence Blocks',
        });
      }
    }

    // Rule 6: WAIVED rows must have "approved by: <name>" in the row
    if (result === 'WAIVED') {
      const rowText = Object.values(row).join(' ');
      if (!/approved by:\s*\S+/i.test(rowText)) {
        findings.push({
          code: 'waived-without-approver',
          message: `assertion row ${num || '?'} is WAIVED but row has no "approved by: <name>"`,
          section: 'Assertions',
        });
      }
    }
  }

  // Semantic checks (opt-in via --strict)
  if (strict) {
    for (const row of assertionsTable.rows) {
      const num = (row['#'] ?? '').trim();
      const result = (row['Result'] ?? '').trim().toUpperCase();
      const evidenceType = (row['Evidence Type'] ?? '').trim().toLowerCase();

      if (result !== 'PASS') continue;

      const checker = SEMANTIC_CHECKS[evidenceType];
      if (!checker) continue; // unknown type — skip

      const blockText = extractEvidenceBlockText(evidenceBlocksText, num);
      const failures = checker(blockText);
      for (const element of failures) {
        findings.push({
          code: `semantic-${evidenceType}-missing-${element}`,
          message: `assertion row ${num}: evidence block E${num} (${evidenceType}) missing required element: ${element}`,
          section: 'Evidence Blocks',
        });
      }
    }
  }

  // Rule 9: acceptance criteria mapping has at least 1 row
  const mappingText = sections.get('Acceptance Criteria Mapping') ?? '';
  const mappingTable = parseMarkdownTable(mappingText);
  if (mappingTable.rows.length === 0) {
    findings.push({
      code: 'acceptance-mapping-empty',
      message: 'acceptance criteria mapping has no rows',
      section: 'Acceptance Criteria Mapping',
    });
  }

  return findings;
}

async function collectAllBundles() {
  const dir = join(REPO_ROOT, 'docs', '06_status');
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (/^UTV2-\d+.*EVIDENCE.*\.md$/i.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out.sort();
}

/**
 * Read an allowlist file and return a Set of relative paths (from repo root).
 * Blank lines and lines starting with '#' are ignored.
 */
async function readAllowlist(filePath) {
  const content = await readFile(resolve(filePath), 'utf8');
  const entries = new Set();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Normalize to forward slashes for cross-platform consistency
    entries.add(line.replace(/\\/g, '/'));
  }
  return entries;
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  let all = false;
  let json = false;
  let strict = false;
  let allowlistFile = null;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--all') all = true;
    else if (a === '--json') json = true;
    else if (a === '--strict') strict = true;
    else if (a === '--allowlist-file') {
      allowlistFile = args[++i];
      if (!allowlistFile) {
        process.stderr.write('error: --allowlist-file requires a path argument\n');
        process.exit(2);
      }
    }
    else paths.push(a);
  }
  return { all, json, strict, allowlistFile, paths };
}

async function main() {
  const { all, json, strict, allowlistFile, paths } = parseCliArgs(process.argv);

  let targets = [];
  if (all) {
    targets = await collectAllBundles();
  } else if (paths.length > 0) {
    targets = paths.map((p) => resolve(process.cwd(), p));
  } else {
    process.stderr.write(
      'usage: node scripts/evidence-bundle/validate-bundle.mjs [--json] [--allowlist-file <path>] <path> | --all\n',
    );
    process.exit(2);
  }

  // Load allowlist if provided
  let allowlist = new Set();
  if (allowlistFile) {
    allowlist = await readAllowlist(allowlistFile);
  }

  const report = [];
  let totalFindings = 0;
  let skippedCount = 0;

  for (const target of targets) {
    const rel = relative(REPO_ROOT, target).replace(/\\/g, '/');

    // Check allowlist — skip if path is allowlisted
    if (allowlist.has(rel)) {
      report.push({
        path: target,
        ok: true,
        skipped: true,
        findings: [],
      });
      skippedCount++;
      continue;
    }

    let source;
    try {
      source = await readFile(target, 'utf8');
    } catch (err) {
      report.push({
        path: target,
        ok: false,
        skipped: false,
        findings: [{ code: 'read-error', message: String(err?.message ?? err) }],
      });
      totalFindings++;
      continue;
    }
    const findings = validateBundle(source, { strict });
    report.push({
      path: target,
      ok: findings.length === 0,
      skipped: false,
      findings,
    });
    totalFindings += findings.length;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ totalFindings, skippedCount, report }, null, 2) + '\n');
  } else {
    for (const r of report) {
      const rel = relative(REPO_ROOT, r.path).replace(/\\/g, '/') || r.path;
      if (r.skipped) {
        process.stdout.write(`SKIP  ${rel} (allowlisted)\n`);
      } else if (r.ok) {
        process.stdout.write(`PASS  ${rel}\n`);
      } else {
        process.stdout.write(`FAIL  ${rel} (${r.findings.length} finding${r.findings.length === 1 ? '' : 's'})\n`);
        for (const f of r.findings) {
          process.stdout.write(`  - [${f.code}] ${f.message}\n`);
        }
      }
    }
    const validated = report.length - skippedCount;
    process.stdout.write(
      `\n${report.length} bundle(s) found, ${validated} validated, ${skippedCount} skipped, ${totalFindings} finding(s) total.\n`,
    );
  }

  process.exit(totalFindings === 0 ? 0 : 1);
}

// Only run main if executed directly, not when imported by tests.
const entry = process.argv[1] ?? '';
const invokedDirectly = entry.endsWith('validate-bundle.mjs');

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[validate-bundle] unexpected error: ${err?.stack ?? err}\n`);
    process.exit(2);
  });
}
