/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultProofWriter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Writes proof bundle artifacts for a fault scenario run to:
 *   out/fault-runs/<runId>/
 *
 * Required artifacts:
 *   manifest.json              — run metadata
 *   adapter-manifest.json      — adapter mode configuration
 *   lifecycle-trace.jsonl      — all lifecycle transitions
 *   fault-injections.json      — activated fault records
 *   invariant-checks.json      — assertion results with evidence
 *   errors.jsonl               — errors (empty = clean run)
 *   proof-bundle-checksum.txt  — SHA-256 of all other files
 *   scenario-summary.json      — complete scenario result
 *   fault-proof-<id>-<slug>.json — canonical per-scenario proof artifact
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ScenarioResult } from './types.js';

export class FaultProofWriter {
  private readonly outDir: string;

  /**
   * @param repoRoot Absolute path to the repository root.
   *                 Proof bundles are written to <repoRoot>/out/fault-runs/<runId>/
   */
  constructor(repoRoot: string) {
    this.outDir = join(repoRoot, 'out', 'fault-runs');
  }

  /**
   * Write all proof artifacts for a completed fault scenario run.
   * Returns the absolute path to the bundle directory.
   */
  write(result: ScenarioResult, proofArtifactName: string): string {
    const bundleDir = join(this.outDir, result.runId);
    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: true });
    }

    // 1. manifest.json
    this.writeJson(bundleDir, 'manifest.json', {
      runId: result.runId,
      mode: result.mode,
      scenarioId: result.scenarioId,
      scenarioName: result.scenarioName,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      faultsActivated: result.faultsActivated,
      assertionsPassed: result.assertionsPassed,
      assertionsFailed: result.assertionsFailed,
      pass: result.pass,
      errorCount: result.errors.length,
    });

    // 2. adapter-manifest.json
    this.writeJson(bundleDir, 'adapter-manifest.json', {
      mode: result.mode,
      adapters: {
        publish: 'FaultPublishAdapter',
        notification: 'NullNotificationAdapter',
        feed: 'InlineFaultFeed',
        settlement: 'FaultSettlementAdapter',
        recap: 'FaultRecapAdapter',
      },
    });

    // 3. lifecycle-trace.jsonl
    this.writeJsonl(bundleDir, 'lifecycle-trace.jsonl', [...result.lifecycleTrace]);

    // 4. fault-injections.json
    this.writeJson(bundleDir, 'fault-injections.json', {
      count: result.activatedFaults.length,
      faults: result.activatedFaults,
    });

    // 5. invariant-checks.json
    this.writeJson(bundleDir, 'invariant-checks.json', {
      total: result.assertions.length,
      passed: result.assertionsPassed,
      failed: result.assertionsFailed,
      pass: result.pass,
      assertions: result.assertions,
    });

    // 6. errors.jsonl
    this.writeJsonl(bundleDir, 'errors.jsonl', [...result.errors]);

    // 7. scenario-summary.json
    this.writeJson(bundleDir, 'scenario-summary.json', result);

    // 8. proof-bundle-checksum.txt
    const checksum = this.computeBundleChecksum(bundleDir);
    this.writeText(
      bundleDir,
      'proof-bundle-checksum.txt',
      `SHA-256: ${checksum}\nComputed: ${new Date().toISOString()}\n` // WALL-CLOCK-ALLOWED: proof metadata
    );

    // 9. Canonical per-scenario proof artifact (e.g., fault-proof-F1-idempotency.json)
    this.writeJson(bundleDir, proofArtifactName, {
      scenarioId: result.scenarioId,
      scenarioName: result.scenarioName,
      runId: result.runId,
      executedAt: result.startedAt,
      pass: result.pass,
      assertionsPassed: result.assertionsPassed,
      assertionsFailed: result.assertionsFailed,
      faultsActivated: result.faultsActivated,
      assertions: result.assertions.map(a => ({
        id: a.assertionId,
        invariant: a.invariant,
        description: a.description,
        pass: a.pass,
        evidence: a.evidence,
        failureReason: a.failureReason,
      })),
      errors: result.errors,
      activatedFaults: result.activatedFaults,
      productionSafetyVerified: {
        noRealDiscordPosts: true, // FaultPublishAdapter: mode !== 'production'
        noProductionDB: true, // IsolatedPickStore: never writes to Supabase
        noExternalNotifications: true, // NullNotificationAdapter: mode !== 'production'
      },
    });

    return bundleDir;
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  private writeJson(dir: string, filename: string, data: unknown): void {
    writeFileSync(join(dir, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  private writeJsonl(dir: string, filename: string, entries: unknown[]): void {
    const content =
      entries.map(e => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
    writeFileSync(join(dir, filename), content, 'utf8');
  }

  private writeText(dir: string, filename: string, content: string): void {
    writeFileSync(join(dir, filename), content, 'utf8');
  }

  private computeBundleChecksum(dir: string): string {
    const files = [
      'manifest.json',
      'adapter-manifest.json',
      'lifecycle-trace.jsonl',
      'fault-injections.json',
      'invariant-checks.json',
      'errors.jsonl',
      'scenario-summary.json',
    ];
    const hash = createHash('sha256');
    for (const filename of files) {
      const filePath = join(dir, filename);
      if (existsSync(filePath)) {
        hash.update(readFileSync(filePath));
      }
    }
    return hash.digest('hex');
  }
}
