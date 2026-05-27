/**
 * Shadow Inference — INIT-3.2.3
 *
 * A candidate model runs in parallel with the production model without
 * affecting production routing. Shadow outputs are independently recorded
 * and are never fed back into the production decision pipeline.
 *
 * Invariants:
 *  - Shadow inference never modifies production predictions.
 *  - Shadow results inform promotion decisions but never production routing.
 *  - Results are deterministic from the same inputs for replay.
 */

export type ShadowInferenceStatus = 'completed' | 'failed' | 'skipped';

export interface ShadowInferenceResult {
  readonly shadow_inference_id: string;
  readonly model_name: string;
  readonly model_version: string;
  /** SHA of the shadow model artifact — cross-referenced against registered artifact_sha */
  readonly artifact_sha: string | null;
  readonly input_hash: string;
  readonly shadow_score: number | null;
  readonly production_score: number | null;
  readonly status: ShadowInferenceStatus;
  /** Non-null when status is 'failed' */
  readonly error_message: string | null;
  readonly inferred_at_ms: number;
  /** True when shadow_score and production_score diverge beyond tolerance */
  readonly diverged: boolean;
  readonly divergence_delta: number | null;
}

export interface ShadowInferenceInput {
  readonly shadow_inference_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly artifact_sha: string | null | undefined;
  readonly input_hash: string;
  readonly shadow_score: number | null | undefined;
  readonly production_score: number | null | undefined;
  readonly error_message: string | null | undefined;
  readonly inferred_at_ms: number;
  /** Fractional divergence threshold: default 0.01 (1%) */
  readonly divergence_threshold?: number;
}

const DEFAULT_DIVERGENCE_THRESHOLD = 0.01;

/**
 * Builds a ShadowInferenceResult from raw inputs.
 *
 * Isolation guarantee: this function is pure and stateless. Callers are
 * responsible for persisting the result as append-only audit evidence.
 * The result is never routed back to the production scoring path.
 */
export function buildShadowInferenceResult(input: ShadowInferenceInput): ShadowInferenceResult {
  const shadowScore = input.shadow_score ?? null;
  const productionScore = input.production_score ?? null;
  const threshold = input.divergence_threshold ?? DEFAULT_DIVERGENCE_THRESHOLD;

  let diverged = false;
  let divergenceDelta: number | null = null;

  if (shadowScore !== null && productionScore !== null) {
    const delta = Math.abs(shadowScore - productionScore);
    divergenceDelta = delta;
    diverged = delta > threshold;
  }

  const status: ShadowInferenceStatus = input.error_message
    ? 'failed'
    : shadowScore === null && !input.error_message
      ? 'skipped'
      : 'completed';

  return {
    shadow_inference_id: input.shadow_inference_id,
    model_name: input.model_name,
    model_version: input.model_version,
    artifact_sha: input.artifact_sha ?? null,
    input_hash: input.input_hash,
    shadow_score: shadowScore,
    production_score: productionScore,
    status,
    error_message: input.error_message ?? null,
    inferred_at_ms: input.inferred_at_ms,
    diverged,
    divergence_delta: divergenceDelta,
  };
}
