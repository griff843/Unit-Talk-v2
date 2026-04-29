/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplayProofWriter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Writes proof bundle artifacts for a replay run to:
 *   out/replay-runs/<runId>/
 *
 * Required artifacts:
 *   manifest.json              — run metadata
 *   adapter-manifest.json      — RunController.getManifest()
 *   clock-log.jsonl            — VirtualEventClock advancement log
 *   lifecycle-trace.jsonl      — all lifecycle transitions
 *   events-processed.json      — ordered event list with processing status
 *   determinism-hash.txt        — hash + verification result
 *   errors.jsonl               — errors (empty = clean run)
 *   proof-bundle-checksum.txt  — SHA-256 of all other files
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ReplayEvent } from './event-store.js';
import type { ReplayResult } from './replay-orchestrator.js';

export interface ReplayProofArtifact {
  filename: string;
  format: 'json' | 'jsonl' | 'text';
  content: unknown;
}

// ─────────────────────────────────────────────────────────────
// WRITER
// ─────────────────────────────────────────────────────────────

export class ReplayProofWriter {
  private readonly outDir: string;

  /**
   * @param repoRoot Absolute path to the repository root.
   *                 Proof bundles are written to <repoRoot>/out/replay-runs/<runId>/
   */
  constructor(repoRoot: string) {
    this.outDir = join(repoRoot, 'out', 'replay-runs');
  }

  /**
   * Write all proof artifacts for a completed replay run.
   * Returns the absolute path to the bundle directory.
   */
  write(
    result: ReplayResult,
    events: ReadonlyArray<ReplayEvent>,
    secondRunHash?: string,
    artifacts: ReadonlyArray<ReplayProofArtifact> = []
  ): string {
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
      eventsProcessed: result.eventsProcessed,
      eventsSkipped: result.eventsSkipped,
      picksCreated: result.picksCreated,
      errorCount: result.errors.length,
      determinismHash: result.determinismHash,
    });

    // 2. adapter-manifest.json
    this.writeJson(bundleDir, 'adapter-manifest.json', result.runManifest);

    // 3. clock-log.jsonl
    this.writeJsonl(bundleDir, 'clock-log.jsonl', [...result.clockLog]);

    // 4. lifecycle-trace.jsonl
    this.writeJsonl(bundleDir, 'lifecycle-trace.jsonl', [...result.lifecycleTrace]);

    // 5. events-processed.json
    this.writeJson(bundleDir, 'events-processed.json', {
      total: events.length,
      processed: result.eventsProcessed,
      skipped: result.eventsSkipped,
      events: events.map(e => ({
        eventId: e.eventId,
        eventType: e.eventType,
        pickId: e.pickId,
        timestamp: e.timestamp,
        sequenceNumber: e.sequenceNumber,
      })),
    });

    // 6. determinism-hash.txt
    let hashContent = `Replay Run: ${result.runId}\n`;
    hashContent += `SHA-256: ${result.determinismHash}\n`;
    if (secondRunHash !== undefined) {
      const verified = secondRunHash === result.determinismHash;
      hashContent += `Second Run SHA-256: ${secondRunHash}\n`;
      hashContent += `Verification: ${verified ? 'VERIFIED — hashes match' : 'MISMATCH — replay is nondeterministic'}\n`;
    }
    this.writeText(bundleDir, 'determinism-hash.txt', hashContent);

    // 7. errors.jsonl
    this.writeJsonl(bundleDir, 'errors.jsonl', result.errors);

    for (const artifact of artifacts) {
      this.writeArtifact(bundleDir, artifact);
    }

    // 8. proof-bundle-checksum.txt (computed over all other files)
    const checksum = this.computeBundleChecksum(
      bundleDir,
      artifacts.map(artifact => artifact.filename)
    );
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

  private writeArtifact(dir: string, artifact: ReplayProofArtifact): void {
    if (artifact.format === 'json') {
      this.writeJson(dir, artifact.filename, artifact.content);
      return;
    }

    if (artifact.format === 'jsonl') {
      if (!Array.isArray(artifact.content)) {
        throw new Error(`ReplayProofWriter: jsonl artifact '${artifact.filename}' must be an array`);
      }
      this.writeJsonl(dir, artifact.filename, [...artifact.content]);
      return;
    }

    this.writeText(dir, artifact.filename, String(artifact.content));
  }

  private computeBundleChecksum(dir: string, artifactFiles: ReadonlyArray<string>): string {
    const files = [
      'manifest.json',
      'adapter-manifest.json',
      'clock-log.jsonl',
      'lifecycle-trace.jsonl',
      'events-processed.json',
      'determinism-hash.txt',
      'errors.jsonl',
      ...artifactFiles,
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
