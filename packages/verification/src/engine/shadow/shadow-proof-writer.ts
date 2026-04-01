/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Shadow Guardrails Proof Writer
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Writes 4-file proof bundle for a shadow guardrails run:
 *   shadow-trace.jsonl      — shadow pipeline lifecycle trace
 *   divergence-report.json  — R3 structural divergence report
 *   shadow-verdict.json     — classified divergences + PASS/FAIL verdict
 *   proof-checksum.txt      — SHA-256 of the 3 artifact files
 *
 * Output directory: <repoRoot>/out/shadow-runs/<runId>/
 *
 * wall-clock used only for proof bundle metadata (non-lifecycle).
 */

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import type { ShadowVerdictResult } from './types.js';
import type { LifecycleTrace } from '../replay-lifecycle-runner.js';
import type { DivergenceReport } from '../shadow-comparator.js';

// ─────────────────────────────────────────────────────────────
// PROOF WRITER
// ─────────────────────────────────────────────────────────────

export class ShadowGuardrailsProofWriter {
  private readonly outDir: string;

  constructor(runId: string, repoRoot?: string) {
    const root = repoRoot ?? process.cwd();
    this.outDir = resolve(root, 'out', 'shadow-runs', runId);
  }

  /**
   * Write the 4-file proof bundle to out/shadow-runs/<runId>/.
   * Returns the absolute path to the output directory.
   */
  write(
    shadowTrace: ReadonlyArray<LifecycleTrace>,
    divergenceReport: DivergenceReport,
    verdictResult: ShadowVerdictResult
  ): string {
    mkdirSync(this.outDir, { recursive: true });

    // 1. shadow-trace.jsonl
    const traceContent = shadowTrace.map(t => JSON.stringify(t)).join('\n');
    const tracePath = join(this.outDir, 'shadow-trace.jsonl');
    writeFileSync(tracePath, traceContent, 'utf8');

    // 2. divergence-report.json
    const divergenceContent = JSON.stringify(divergenceReport, null, 2);
    const divergencePath = join(this.outDir, 'divergence-report.json');
    writeFileSync(divergencePath, divergenceContent, 'utf8');

    // 3. shadow-verdict.json
    const verdictContent = JSON.stringify(verdictResult, null, 2);
    const verdictPath = join(this.outDir, 'shadow-verdict.json');
    writeFileSync(verdictPath, verdictContent, 'utf8');

    // 4. proof-checksum.txt — SHA-256 of the 3 artifact files
    const checksum = this.computeChecksum([traceContent, divergenceContent, verdictContent]);
    const checksumPath = join(this.outDir, 'proof-checksum.txt');
    writeFileSync(
      checksumPath,
      [
        `# Shadow Guardrails Proof Bundle Checksum`,
        `# Generated: ${new Date().toISOString()}`, // WALL-CLOCK-ALLOWED: proof metadata
        `# Run ID: ${divergenceReport.runId}`,
        `# Verdict: ${verdictResult.verdict}`,
        ``,
        `sha256(shadow-trace.jsonl + divergence-report.json + shadow-verdict.json):`,
        checksum,
      ].join('\n'),
      'utf8'
    );

    return this.outDir;
  }

  private computeChecksum(contents: string[]): string {
    const hash = createHash('sha256');
    for (const content of contents) {
      hash.update(content);
    }
    return hash.digest('hex');
  }
}
