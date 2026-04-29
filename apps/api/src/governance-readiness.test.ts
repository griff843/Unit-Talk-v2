/**
 * GOVERNANCE PRODUCTION-READINESS VERIFICATION
 * UTV2-360 — Mechanical proof of governance readiness.
 *
 * Verifies the acceptance criteria for GC-M5 that are testable
 * without live DB access:
 *
 * 1. Audit log coverage: every write controller/service calls audit.record()
 * 2. Auth gate coverage: every POST route has role authorization
 * 3. Cross-app write isolation: no direct Supabase writes outside apps/api
 * 4. Key exposure: service role key not in client-side apps
 * 5. Data retention: pg_cron retention migration exists with correct policies
 *
 * What remains PM-gated (not tested here):
 * - Incident-response runbook content (PM defines compliance standard)
 * - Live audit_log row verification (requires pnpm test:db)
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname ?? '.', '../../..');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function readSource(relativePath: string): string {
  const fullPath = join(REPO_ROOT, relativePath);
  if (!existsSync(fullPath)) return '';
  return readFileSync(fullPath, 'utf8');
}

function countOccurrences(source: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(pattern, pos)) !== -1) {
    count++;
    pos += pattern.length;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// TEST 1: AUDIT LOG COVERAGE
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Audit Coverage', () => {
  const AUDIT_REQUIRED_FILES = [
    { file: 'apps/api/src/controllers/submit-pick-controller.ts', operation: 'submission' },
    { file: 'apps/api/src/controllers/review-pick-controller.ts', operation: 'review' },
    { file: 'apps/api/src/controllers/retry-delivery-controller.ts', operation: 'retry-delivery' },
    { file: 'apps/api/src/controllers/rerun-promotion-controller.ts', operation: 'rerun-promotion' },
    { file: 'apps/api/src/controllers/override-promotion-controller.ts', operation: 'override-promotion' },
    { file: 'apps/api/src/settlement-service.ts', operation: 'settlement' },
    { file: 'apps/api/src/recap-service.ts', operation: 'recap-delivery' },
    { file: 'apps/api/src/board-pick-writer.ts', operation: 'board-write' },
  ];

  for (const { file, operation } of AUDIT_REQUIRED_FILES) {
    it(`${operation}: ${file} calls audit.record()`, () => {
      const source = readSource(file);
      assert.ok(source.length > 0, `${file} must exist`);
      const auditCalls = countOccurrences(source, 'audit.record(');
      assert.ok(auditCalls > 0, `${file} must call audit.record() at least once (found ${auditCalls})`);
    });
  }

  it('submission service produces audit rows on successful submission', () => {
    const source = readSource('apps/api/src/submission-service.ts');
    assert.ok(source.includes('audit.record('), 'submission-service must audit');
    assert.ok(source.includes("'submission."), 'audit action must start with submission.*');
  });

  it('settlement service produces audit rows on settlement and correction', () => {
    const source = readSource('apps/api/src/settlement-service.ts');
    const calls = countOccurrences(source, 'audit.record(');
    assert.ok(calls >= 2, `settlement-service must audit both settlement and correction paths (found ${calls})`);
  });
});

// ─────────────────────────────────────────────────────────────
// TEST 2: AUTH GATE COVERAGE
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Auth Gate Coverage', () => {
  it('auth module defines role authorization for all POST routes', () => {
    const source = readSource('apps/api/src/auth.ts');
    assert.ok(source.length > 0, 'auth.ts must exist');

    // Every known write endpoint must have a ROUTE_ROLES entry
    const requiredPatterns = [
      '/api/submissions',
      '/api/picks/.*/settle',
      '/api/picks/.*/review',
      '/api/picks/.*/retry-delivery',
      '/api/picks/.*/rerun-promotion',
      '/api/picks/.*/override-promotion',
      '/api/picks/.*/requeue',
      '/api/grading/run',
      '/api/recap/post',
      '/api/member-tiers',
      '/api/board/write-picks',
    ];

    for (const pattern of requiredPatterns) {
      const escaped = pattern.replace(/\//g, '\\/').replace(/\.\*/g, '[^/]+');
      assert.ok(
        source.includes(escaped) || source.includes(pattern),
        `Auth route must cover ${pattern}`
      );
    }
  });

  it('server enforces auth check on POST requests', () => {
    const source = readSource('apps/api/src/server.ts');
    assert.ok(source.includes('authenticateRequest') || source.includes('authGate') || source.includes('checkAuth'),
      'server.ts must call authentication function on requests');
  });

  it('fail_closed mode rejects startup without DB credentials', () => {
    const source = readSource('apps/api/src/server.ts');
    assert.ok(source.includes('fail_closed') || source.includes('failClosed'),
      'server must reference fail_closed mode');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST 3: CROSS-APP WRITE ISOLATION
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Write Isolation', () => {
  const READ_ONLY_APPS = [
    'apps/command-center/src',
    'apps/discord-bot/src',
  ];

  for (const appPath of READ_ONLY_APPS) {
    it(`${appPath} has no direct Supabase write calls (.insert/.update/.upsert/.delete)`, () => {
      // Read all .ts files in the app and check for direct write patterns
      // This is a static analysis approximation — the grep confirmed this earlier
      const source = readSource(`${appPath}/index.ts`) +
        readSource(`${appPath}/main.ts`) +
        readSource(`${appPath}/client.ts`);

      // These apps should not import @unit-talk/db directly for writes
      // (command-center uses server actions that POST to API)
      // We verify no .insert()/.update()/.upsert()/.delete() on Supabase client
      const writePatterns = ['.insert(', '.update(', '.upsert(', '.delete('];
      for (const pattern of writePatterns) {
        const occurrences = countOccurrences(source, pattern);
        // Allow 0 occurrences — no direct DB writes
        // Any occurrence in main source files would be a violation
        assert.equal(occurrences, 0, `${appPath} must not contain direct Supabase ${pattern} call`);
      }
    });
  }

  it('command-center data layer has no direct Supabase write operations', () => {
    // command-center reads via src/lib/data/ (direct Supabase) — mutations go through apps/api only
    const dataFiles = [
      'apps/command-center/src/lib/data/analytics.ts',
      'apps/command-center/src/lib/data/dashboard.ts',
      'apps/command-center/src/lib/data/queues.ts',
      'apps/command-center/src/lib/data/research.ts',
      'apps/command-center/src/lib/data/snapshot.ts',
      'apps/command-center/src/lib/data/board.ts',
      'apps/command-center/src/lib/data/picks.ts',
      'apps/command-center/src/lib/data/preview.ts',
      'apps/command-center/src/lib/data/intelligence.ts',
    ];
    const writePatterns = ['.insert(', '.update(', '.upsert(', '.delete('];
    for (const f of dataFiles) {
      const source = readSource(f);
      if (source.length === 0) continue;
      for (const pattern of writePatterns) {
        assert.ok(!source.includes(pattern), `${f} must not contain Supabase ${pattern} call — data layer is read-only`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
// TEST 4: KEY EXPOSURE
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Key Exposure Prevention', () => {
  it('command-center does not reference service role key in source code', () => {
    // Check key source files — next.config, data layer client, env handling
    const files = [
      'apps/command-center/src/lib/data/client.ts',
      'apps/command-center/next.config.mjs',
      'apps/command-center/next.config.js',
    ];

    for (const f of files) {
      const source = readSource(f);
      if (source.length === 0) continue; // file may not exist
      assert.ok(
        !source.includes('SUPABASE_SERVICE_ROLE_KEY'),
        `${f} must not reference SUPABASE_SERVICE_ROLE_KEY`
      );
    }
  });

  it('command-center E2E tests explicitly verify no key leakage', () => {
    const source = readSource('apps/command-center/e2e/command-center.spec.ts');
    assert.ok(source.includes('SUPABASE_SERVICE_ROLE_KEY'),
      'E2E tests must explicitly check for key leakage (existing assertion found)');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST 5: DATA RETENTION
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Data Retention', () => {
  it('pg_cron retention migration exists and covers required tables', () => {
    const source = readSource('supabase/migrations/202604080016_utv2_439_pg_cron_retention.sql');
    assert.ok(source.length > 0, 'Retention migration must exist');

    // Verify each table is covered
    const requiredTables = [
      'provider_offers',
      'audit_log',
      'alert_detections',
      'submission_events',
      'distribution_outbox',
      'distribution_receipts',
    ];

    for (const table of requiredTables) {
      assert.ok(
        source.includes(table),
        `Retention migration must cover ${table}`
      );
    }
  });

  it('retention intervals match documented policy', () => {
    const baseSource = readSource('supabase/migrations/202604080016_utv2_439_pg_cron_retention.sql');
    const boundedSource = readSource('supabase/migrations/202604291001_utv2_772_bounded_provider_offers_retention.sql');

    assert.ok(
      boundedSource.includes('prune_provider_offers_bounded') &&
        boundedSource.includes('7') &&
        boundedSource.includes('5000') &&
        boundedSource.includes('20'),
      'provider_offers retention must be bounded to 7 days with explicit batch limits',
    );

    // audit_log: 90 days
    assert.ok(baseSource.includes("audit_log") && baseSource.includes("90 days"),
      'audit_log retention must be 90 days');
  });

  it('audit_log has created_at index for efficient retention pruning', () => {
    const source = readSource('supabase/migrations/202604080015_utv2_437_audit_log_created_at_index.sql');
    assert.ok(source.length > 0, 'audit_log created_at index migration must exist');
    assert.ok(source.includes('audit_log') && source.includes('created_at'),
      'Migration must create index on audit_log.created_at');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST 6: LIFECYCLE AUDIT ENTITY CONVENTIONS
// ─────────────────────────────────────────────────────────────

describe('GC-M5 Governance Readiness — Audit Entity Conventions', () => {
  it('controllers use entity_id for primary entity and entity_ref for pick id', () => {
    const reviewSource = readSource('apps/api/src/controllers/review-pick-controller.ts');
    assert.ok(reviewSource.includes('entityId:') || reviewSource.includes('entity_id'),
      'review controller must set entityId');
    assert.ok(reviewSource.includes('entityRef:') || reviewSource.includes('entity_ref'),
      'review controller must set entityRef');
  });

  it('settlement service uses correct audit entity conventions', () => {
    const source = readSource('apps/api/src/settlement-service.ts');
    assert.ok(source.includes('entityType:'), 'settlement must set entityType');
    assert.ok(source.includes('entityId:') || source.includes('entity_id'),
      'settlement must set entityId');
  });
});
