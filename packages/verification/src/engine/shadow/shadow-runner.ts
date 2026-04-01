/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowRunner
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Top-level orchestrator for the shadow divergence guardrail layer.
 *
 * Execution flow:
 *   1. Build ShadowOrchestrator (R3) and run both pipelines
 *   2. Extract reference + shadow pick states
 *   3. DivergenceClassifier.classify(r3Report, refState, shadowState)
 *   4. ShadowVerdictEngine.determine(classified)
 *   5. If freezeRecommended: emit critical alert via notificationAdapter
 *   6. Write 4-file proof bundle via ShadowGuardrailsProofWriter
 *   7. Return ShadowRunnerResult
 *
 * Design constraint:
 *   Autopilot freeze CANNOT call AutopilotEnforcement.setGlobalFreeze()
 *   (requires DB access, forbidden in the verification control plane).
 *   Freeze is signaled via notificationAdapter.alert({ severity: 'critical' })
 *   and ShadowVerdictResult.freezeRecommended = true.
 *
 * wall-clock used only for run metadata (startedAt/completedAt).
 */

import { ShadowOrchestrator } from '../shadow-orchestrator.js';

import { DivergenceClassifier } from './divergence-classifier.js';
import { ShadowGuardrailsProofWriter } from './shadow-proof-writer.js';
import { ShadowVerdictEngine } from './shadow-verdict.js';

import type { ShadowRunnerConfig, ShadowRunnerResult } from './types.js';

// ─────────────────────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────────────────────

export class ShadowRunner {
  private readonly config: ShadowRunnerConfig;

  constructor(config: ShadowRunnerConfig) {
    this.config = config;
  }

  /**
   * Execute the full shadow guardrails pipeline:
   * R3 orchestration → classification → verdict → alert → proof.
   */
  async run(): Promise<ShadowRunnerResult> {
    const startedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const startMs = Date.now(); // WALL-CLOCK-ALLOWED: run metadata

    const {
      runId,
      referenceStore,
      shadowStore,
      clock,
      referenceAdapters,
      shadowAdapters,
      notificationAdapter,
      repoRoot,
      from,
      to,
    } = this.config;

    // Step 1 — Run both pipelines via R3 ShadowOrchestrator
    const orchestrator = new ShadowOrchestrator({
      runId,
      referenceStore,
      shadowStore,
      clock,
      referenceAdapters,
      shadowAdapters,
      from,
      to,
    });

    const orchestratorResult = await orchestrator.run();

    // Step 2 — Extract pick states for score comparison
    // ShadowOrchestrator runs ShadowPipelineRunner internally; pick states are
    // surfaced via the divergenceReport and the pipeline results embedded in ShadowResult.
    // We re-use the R3 divergenceReport for structural divergences and extract
    // pick states from the finalPickState maps captured in the pipeline results.
    // Because ShadowResult does not directly expose finalPickState, we reconstruct
    // the maps from the shadow trace by using the R3 divergenceReport's pick ids
    // and the referencePublishes/shadowPublishes. However, to get the actual numeric
    // score fields we need the finalPickState maps.
    //
    // To access finalPickState cleanly, we run fresh ShadowPipelineRunners here.
    // This is safe: shadow runs are deterministic and isolated (IsolatedPickStore).
    const { ShadowPipelineRunner } = await import('../shadow-pipeline-runner.js');

    const refPipeline = new ShadowPipelineRunner(referenceAdapters);
    const shadowPipeline = new ShadowPipelineRunner(shadowAdapters);

    const [refPipelineResult, shadowPipelineResult] = await Promise.all([
      refPipeline.run(referenceStore, clock, `${runId}-ref-g`, from, to),
      shadowPipeline.run(shadowStore, clock, `${runId}-shadow-g`, from, to),
    ]);

    const referencePickState = refPipelineResult.finalPickState;
    const shadowPickState = shadowPipelineResult.finalPickState;

    // Step 3 — Classify divergences (structural from R3 + score-based)
    const classified = DivergenceClassifier.classify(
      orchestratorResult.divergenceReport,
      referencePickState,
      shadowPickState
    );

    // Step 4 — Determine verdict
    const verdictResult = ShadowVerdictEngine.determine(classified);

    // Step 5 — Emit critical alert if freeze recommended
    if (verdictResult.freezeRecommended) {
      await notificationAdapter.alert({
        severity: 'critical',
        message: `CRITICAL divergence in shadow run ${runId}: autopilot freeze recommended`,
        context: {
          runId,
          criticalCount: classified.bySeverity.CRITICAL,
          freezeRecommended: true,
          trigger: 'shadow_critical_divergence',
        },
        timestamp: new Date().toISOString(), // WALL-CLOCK-ALLOWED: alert timestamp, non-lifecycle
      });
    }

    // Step 6 — Write proof bundle
    const proofWriter = new ShadowGuardrailsProofWriter(runId, repoRoot);
    const proofBundlePath = proofWriter.write(
      orchestratorResult.shadowTrace,
      orchestratorResult.divergenceReport,
      verdictResult
    );

    const completedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const durationMs = Date.now() - startMs; // WALL-CLOCK-ALLOWED: run metadata

    return {
      runId,
      verdictResult,
      divergenceReport: orchestratorResult.divergenceReport,
      shadowTrace: orchestratorResult.shadowTrace,
      referenceTrace: orchestratorResult.referenceTrace,
      proofBundlePath,
      durationMs,
      startedAt,
      completedAt,
    };
  }
}
