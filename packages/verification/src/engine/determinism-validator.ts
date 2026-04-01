/**
 * VERIFICATION & SIMULATION CONTROL PLANE — DeterminismValidator
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Computes a deterministic SHA-256 hash over a replay run's output.
 *
 * Two replay runs using the same event stream and the same clock advancement
 * sequence MUST produce the same hash. If they diverge, the replay is not
 * deterministic and the sprint gate fails.
 *
 * Hash inputs (all sorted for determinism):
 *   - runId
 *   - eventCount (number of events processed)
 *   - picks: sorted by id, projected to key stable fields
 *   - trace: sorted by timestamp + pickId, projected to key fields
 *
 * Fields excluded from the hash:
 *   - updated_at (may vary on concurrent modification retries)
 *   - producedAt (wall-clock, varies between runs)
 *   - traceId (generated with timestamps)
 */

import { createHash } from 'crypto';

import type { LifecycleTrace } from './replay-lifecycle-runner.js';

// ─────────────────────────────────────────────────────────────
// CANONICAL PROJECTIONS
// ─────────────────────────────────────────────────────────────

interface CanonicalPick {
  id: string;
  status: string | null;
  promotion_status: string | null;
  settlement_status: string | null;
  settlement_result: string | null;
  posted_to_discord: boolean | null;
}

interface CanonicalTrace {
  pickId: string;
  from: string | null;
  to: string;
  timestamp: string;
  writerRole: string;
}

interface CanonicalPayload {
  eventCount: number;
  picks: CanonicalPick[];
  trace: CanonicalTrace[];
}

// ─────────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────────

export class DeterminismValidator {
  /**
   * Compute a deterministic SHA-256 hex string over the replay run output.
   *
   * The hash is stable across:
   *   - Different process instances
   *   - Different wall-clock times
   *   - Different runId values (runId is NOT hashed — only observable output state is)
   *
   * Same event stream + same clock → same hash.
   */
  static computeHash(
    eventCount: number,
    picks: Map<string, Record<string, unknown>>,
    trace: LifecycleTrace[]
  ): string {
    const payload = DeterminismValidator.buildCanonicalPayload(eventCount, picks, trace);
    const json = JSON.stringify(payload);
    return createHash('sha256').update(json, 'utf8').digest('hex');
  }

  /**
   * Verify that two hashes match.
   * Returns true if they match (deterministic), false if they diverge.
   */
  static verify(hash1: string, hash2: string): boolean {
    return hash1 === hash2;
  }

  /**
   * Compute the canonical payload for inspection.
   * Useful for debugging hash divergence.
   */
  static buildCanonicalPayload(
    eventCount: number,
    picks: Map<string, Record<string, unknown>>,
    trace: LifecycleTrace[]
  ): CanonicalPayload {
    const canonicalPicks: CanonicalPick[] = [...picks.values()]
      .sort((a, b) => String(a['id'] ?? '').localeCompare(String(b['id'] ?? '')))
      .map(p => ({
        id: String(p['id'] ?? ''),
        status: (p['status'] as string | undefined) ?? null,
        promotion_status: (p['promotion_status'] as string | undefined) ?? null,
        settlement_status: (p['settlement_status'] as string | undefined) ?? null,
        settlement_result: (p['settlement_result'] as string | undefined) ?? null,
        posted_to_discord: (p['posted_to_discord'] as boolean | undefined) ?? null,
      }));

    const canonicalTrace: CanonicalTrace[] = [...trace]
      .sort((a, b) => {
        const t = a.timestamp.localeCompare(b.timestamp);
        if (t !== 0) return t;
        return a.pickId.localeCompare(b.pickId);
      })
      .map(t => ({
        pickId: t.pickId,
        from: t.from,
        to: t.to,
        timestamp: t.timestamp,
        writerRole: t.writerRole,
      }));

    return {
      eventCount,
      picks: canonicalPicks,
      trace: canonicalTrace,
    };
  }
}
