/**
 * audit-provider-scope.ts
 *
 * UTV2-403: Governance audit — surface stale Odds API references in active-work files.
 *
 * Scans scripts/, docs/05_operations/, docs/06_status/ for Odds API references.
 * Classifies each hit as:
 *   - allowed-historical: in reference/historical files (expected, no action needed)
 *   - active-work-drift: in active scripts, status docs, issue templates (governance violation)
 *
 * Exit 0: no active-work-drift found (clean)
 * Exit 1: active-work-drift found (governance violation, summary printed)
 *
 * Usage: tsx scripts/audit-provider-scope.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(process.argv[1]), '..');

const SCAN_DIRS = [
  'scripts',
  'docs/05_operations',
  'docs/06_status',
];

/** Patterns that indicate Odds API references */
const ODDS_API_PATTERNS: RegExp[] = [
  /odds[-_]api/i,
  /the\s+odds\s+api/i,
  /oddsApiKey/i,
  /theOddsApi/i,
  /odds-api\.com/i,
  /api\.the-odds-api\.com/i,
  /ODDS_API_KEY/i,
];

/**
 * Files and directories that are explicitly allowed to contain Odds API references.
 * Matched against the relative file path.
 *
 * Allowed categories:
 *   1. Files with "historical" or "backfill" in name — explicit historical scripts
 *   2. PROVIDER_KNOWLEDGE_BASE.md — reference doc retained by design
 *   3. PROVIDER_DATA_DECISION_RECORD.md — decision history, not active guidance
 *   4. PROVIDER_AUTHORITY_LOCK.md — this governance doc (references patterns for doc purposes)
 *   5. audit-provider-scope.ts — this script (defines the patterns)
 *   6. T1_CANONICAL_* contracts — DB schema contracts where odds-api is a valid provider_key
 *      value in the database. These describe schema truth, not active integration guidance.
 *   7. T1_COMMAND_CENTER_*, T1_REFERENCE_DATA_*, T1_CANONICAL_OPERATOR_* — same rationale
 *   8. EVENT_IDENTITY_CONTRACT — describes ingestor architecture history
 *   9. UTV2-prefixed scripts — issue-scoped artifacts, not active operational scripts
 *   10. PROGRAM_STATUS.md historical entries — sprint retrospective text is not active work
 */
const ALLOWED_HISTORICAL_PATTERNS: RegExp[] = [
  /historical/i,
  /backfill/i,
  /PROVIDER_KNOWLEDGE_BASE/i,
  /PROVIDER_DATA_DECISION_RECORD/i,
  /PROVIDER_AUTHORITY_LOCK/i,
  /audit-provider-scope/i,
  // T1 canonical contract docs describe schema design — odds-api:* is a valid provider_key
  // in the database. These are not active integration guidance.
  /T1_CANONICAL_/i,
  /T1_COMMAND_CENTER_/i,
  /T1_REFERENCE_DATA_/i,
  /T1_CANONICAL_OPERATOR_/i,
  /EVENT_IDENTITY_CONTRACT/i,
  // UTV2-prefixed scripts are issue-scoped historical artifacts (not operational scripts)
  /scripts\/utv2-/i,
  // PROGRAM_STATUS.md sprint retrospective entries reference historical state
  /PROGRAM_STATUS/i,
];

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditHit {
  filePath: string;
  lineNumber: number;
  matchedText: string;
  pattern: string;
  classification: 'allowed-historical' | 'active-work-drift';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAllowedHistorical(relPath: string): boolean {
  return ALLOWED_HISTORICAL_PATTERNS.some((p) => p.test(relPath));
}

function scanFile(absPath: string, relPath: string): AuditHit[] {
  const hits: AuditHit[] = [];

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    // unreadable file — skip silently
    return hits;
  }

  const lines = content.split('\n');
  const classification: AuditHit['classification'] = isAllowedHistorical(relPath)
    ? 'allowed-historical'
    : 'active-work-drift';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of ODDS_API_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({
          filePath: relPath,
          lineNumber: i + 1,
          matchedText: line.trim(),
          pattern: pattern.toString(),
          classification,
        });
        break; // one hit per line is enough
      }
    }
  }

  return hits;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile()) {
      // Only scan text files we care about
      const ext = path.extname(entry.name).toLowerCase();
      if (['.ts', '.md', '.mjs', '.js', '.json', '.sh', '.txt', ''].includes(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const allHits: AuditHit[] = [];

  for (const scanDir of SCAN_DIRS) {
    const absDir = path.join(REPO_ROOT, scanDir);
    const files = walkDir(absDir);

    for (const absPath of files) {
      const relPath = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
      const hits = scanFile(absPath, relPath);
      allHits.push(...hits);
    }
  }

  const driftHits = allHits.filter((h) => h.classification === 'active-work-drift');
  const historicalHits = allHits.filter((h) => h.classification === 'allowed-historical');

  // ── Report ──────────────────────────────────────────────────────────────

  console.log('\n=== Provider Scope Audit (UTV2-403) ===\n');
  console.log(`Scanned directories: ${SCAN_DIRS.join(', ')}`);
  console.log(`Total Odds API references found: ${allHits.length}`);
  console.log(`  allowed-historical: ${historicalHits.length}`);
  console.log(`  active-work-drift:  ${driftHits.length}`);
  console.log('');

  if (historicalHits.length > 0) {
    console.log('--- Allowed historical references (no action needed) ---');
    for (const hit of historicalHits) {
      console.log(`  [HISTORICAL] ${hit.filePath}:${hit.lineNumber}`);
      console.log(`               ${hit.matchedText}`);
    }
    console.log('');
  }

  if (driftHits.length > 0) {
    console.error('--- ACTIVE-WORK DRIFT DETECTED (governance violation) ---');
    for (const hit of driftHits) {
      console.error(`  [DRIFT] ${hit.filePath}:${hit.lineNumber}`);
      console.error(`          ${hit.matchedText}`);
    }
    console.error('');
    console.error(`FAIL: ${driftHits.length} active-work-drift reference(s) found.`);
    console.error('Rule: Active provider is SGO Pro. Odds API is suspended.');
    console.error('Authority: docs/05_operations/PROVIDER_AUTHORITY_LOCK.md');
    console.error('');
    process.exit(1);
  }

  console.log('PASS: No active-work-drift found. Provider scope is clean.');
  console.log('Active provider: SGO Pro (ref: docs/05_operations/PROVIDER_AUTHORITY_LOCK.md)');
  console.log('');
  process.exit(0);
}

main();
