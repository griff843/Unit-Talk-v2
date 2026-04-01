/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowProofWriter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R3
 *
 * Writes proof bundle artifacts for a shadow run to:
 *   out/shadow-runs/<runId>/
 *
 * Artifacts:
 *   manifest.json              — run metadata (reference + shadow stats)
 *   adapter-manifest.json      — RunController manifest
 *   lifecycle-trace.jsonl      — shadow lifecycle trace
 *   divergence-report.json     — full DivergenceReport
 *   events-processed.json      — reference + shadow event counts
 *   errors.jsonl               — reference + shadow errors combined
 *   proof-bundle-checksum.txt  — SHA-256 of all other files
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ShadowResult } from './shadow-orchestrator.js';

// ─────────────────────────────────────────────────────────────
// WRITER
// ─────────────────────────────────────────────────────────────

export class ShadowProofWriter {
  private readonly outDir: string;

  /**
   * @param repoRoot Absolute path to the repository root.
   *                 Proof bundles are written to <repoRoot>/out/shadow-runs/<runId>/
   */
  constructor(repoRoot: string) {
    this.outDir = join(repoRoot, 'out', 'shadow-runs');
  }

  /**
   * Write all proof artifacts for a completed shadow run.
   * Returns the absolute path to the bundle directory.
   */
  write(result: ShadowResult): string {
    const bundleDir = join(this.outDir, result.runId);
    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: true });
    }

    // 1. manifest.json
    this.writeJson(bundleDir, 'manifest.json', {
      runId: result.runId,
      mode: result.mode,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      referenceEventsProcessed: result.referenceEventsProcessed,
      shadowEventsProcessed: result.shadowEventsProcessed,
      referencePicksCreated: result.referencePicksCreated,
      shadowPicksCreated: result.shadowPicksCreated,
      referenceErrorCount: result.referenceErrors.length,
      shadowErrorCount: result.shadowErrors.length,
      totalDivergences: result.divergenceReport.totalDivergences,
      verdict: result.divergenceReport.verdict,
      passed: result.divergenceReport.passed,
    });

    // 2. adapter-manifest.json
    this.writeJson(bundleDir, 'adapter-manifest.json', result.runManifest);

    // 3. lifecycle-trace.jsonl (shadow trace for inspection)
    this.writeJsonl(bundleDir, 'lifecycle-trace.jsonl', [...result.shadowTrace]);

    // 4. divergence-report.json
    this.writeJson(bundleDir, 'divergence-report.json', result.divergenceReport);

    // 5. events-processed.json
    this.writeJson(bundleDir, 'events-processed.json', {
      reference: {
        eventsProcessed: result.referenceEventsProcessed,
        errorCount: result.referenceErrors.length,
      },
      shadow: {
        eventsProcessed: result.shadowEventsProcessed,
        errorCount: result.shadowErrors.length,
      },
    });

    // 6. errors.jsonl (reference + shadow combined)
    const allErrors = [
      ...result.referenceErrors.map(e => ({ lane: 'reference', ...e })),
      ...result.shadowErrors.map(e => ({ lane: 'shadow', ...e })),
    ];
    this.writeJsonl(bundleDir, 'errors.jsonl', allErrors);

    // 7. proof-bundle-checksum.txt (computed over all other files)
    const checksum = this.computeBundleChecksum(bundleDir);
    this.writeText(
      bundleDir,
      'proof-bundle-checksum.txt',
      `SHA-256: ${checksum}\nComputed: ${new Date().toISOString()}\n` // WALL-CLOCK-ALLOWED: proof bundle metadata
    );

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
      'divergence-report.json',
      'events-processed.json',
      'errors.jsonl',
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
