/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowComparator
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R3
 *
 * Compares reference and shadow pipeline outputs and classifies divergences.
 *
 * Divergence levels:
 *   critical      — observable state mismatch (settlement, status, missing picks)
 *   warning       — model quality difference (tier, promotion_status, channel)
 *   informational — non-observable difference (timestamps, confidence scores)
 *
 * Verdict:
 *   CLEAN              — no divergences
 *   INFORMATIONAL_ONLY — only informational divergences
 *   WARNINGS_DETECTED  — warnings present, no criticals
 *   CRITICAL_DIVERGENCE— one or more critical divergences
 */

import type { RecordedPublish } from './adapters/recording-publish.js';
import type { LifecycleTrace } from './replay-lifecycle-runner.js';
import type { ShadowPipelineResult } from './shadow-pipeline-runner.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface DivergenceEntry {
  pickId?: string | undefined;
  category: 'pick_state' | 'lifecycle_trace' | 'publish' | 'settlement' | 'recap';
  field?: string | undefined;
  referenceValue: unknown;
  shadowValue: unknown;
  level: 'informational' | 'warning' | 'critical';
  description: string;
  detectedAt: string; // WALL-CLOCK-ALLOWED: comparison metadata, non-lifecycle
}

export interface DivergenceReport {
  runId: string;
  generatedAt: string; // WALL-CLOCK-ALLOWED: report generation timestamp, non-lifecycle
  referenceEventCount: number;
  shadowEventCount: number;
  totalDivergences: number;
  bySeverity: { critical: number; warning: number; informational: number };
  byCategory: {
    pick_state: number;
    lifecycle_trace: number;
    publish: number;
    settlement: number;
    recap: number;
  };
  divergences: DivergenceEntry[];
  passed: boolean;
  verdict: 'CLEAN' | 'INFORMATIONAL_ONLY' | 'WARNINGS_DETECTED' | 'CRITICAL_DIVERGENCE';
}

// ─────────────────────────────────────────────────────────────
// COMPARATOR
// ─────────────────────────────────────────────────────────────

export class ShadowComparator {
  /**
   * Compare reference and shadow pipeline outputs.
   * Returns a DivergenceReport classifying all detected divergences.
   */
  static compare(
    reference: ShadowPipelineResult,
    shadow: ShadowPipelineResult,
    runId: string
  ): DivergenceReport {
    const divergences: DivergenceEntry[] = [];
    const generatedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: report generation timestamp

    // 1. Pick state comparison
    divergences.push(
      ...ShadowComparator.comparePickStates(reference.finalPickState, shadow.finalPickState)
    );

    // 2. Lifecycle trace comparison
    divergences.push(...ShadowComparator.compareTraces(reference.trace, shadow.trace));

    // 3. Publish records comparison
    divergences.push(
      ...ShadowComparator.comparePublishes(reference.publishRecords, shadow.publishRecords)
    );

    // Build summary counts
    const bySeverity = { critical: 0, warning: 0, informational: 0 };
    const byCategory = {
      pick_state: 0,
      lifecycle_trace: 0,
      publish: 0,
      settlement: 0,
      recap: 0,
    };

    for (const d of divergences) {
      bySeverity[d.level]++;
      byCategory[d.category]++;
    }

    const verdict = ShadowComparator.computeVerdict(bySeverity);

    return {
      runId,
      generatedAt,
      referenceEventCount: reference.eventsProcessed,
      shadowEventCount: shadow.eventsProcessed,
      totalDivergences: divergences.length,
      bySeverity,
      byCategory,
      divergences,
      passed: bySeverity.critical === 0,
      verdict,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PICK STATE COMPARISON
  // ─────────────────────────────────────────────────────────────

  private static comparePickStates(
    refState: Map<string, Record<string, unknown>>,
    shadowState: Map<string, Record<string, unknown>>
  ): DivergenceEntry[] {
    const divergences: DivergenceEntry[] = [];
    const now = new Date().toISOString(); // WALL-CLOCK-ALLOWED: divergence detection timestamp

    const allPickIds = new Set([...refState.keys(), ...shadowState.keys()]);

    for (const pickId of allPickIds) {
      const refPick = refState.get(pickId);
      const shadowPick = shadowState.get(pickId);

      if (refPick && !shadowPick) {
        divergences.push({
          pickId,
          category: 'pick_state',
          referenceValue: refPick['id'],
          shadowValue: undefined,
          level: 'critical',
          description: `Pick ${pickId} present in reference but missing from shadow`,
          detectedAt: now,
        });
        continue;
      }

      if (!refPick && shadowPick) {
        divergences.push({
          pickId,
          category: 'pick_state',
          referenceValue: undefined,
          shadowValue: shadowPick['id'],
          level: 'warning',
          description: `Pick ${pickId} present in shadow but not in reference (spurious pick)`,
          detectedAt: now,
        });
        continue;
      }

      if (!refPick || !shadowPick) continue;

      // Compare canonical fields
      divergences.push(...ShadowComparator.comparePickFields(pickId, refPick, shadowPick, now));
    }

    return divergences;
  }

  private static comparePickFields(
    pickId: string,
    ref: Record<string, unknown>,
    shadow: Record<string, unknown>,
    now: string
  ): DivergenceEntry[] {
    const divergences: DivergenceEntry[] = [];

    // Critical fields — observable settlement and posting state
    const criticalFields = [
      'settlement_result',
      'settlement_status',
      'posted_to_discord',
      'status',
    ] as const;

    for (const field of criticalFields) {
      if (ref[field] !== shadow[field]) {
        divergences.push({
          pickId,
          category: 'pick_state',
          field,
          referenceValue: ref[field],
          shadowValue: shadow[field],
          level: 'critical',
          description: `Critical field mismatch on pick ${pickId}: ${field}`,
          detectedAt: now,
        });
      }
    }

    // Warning fields — model quality signals
    const warningFields = ['promotion_status', 'tier'] as const;
    for (const field of warningFields) {
      if (ref[field] !== shadow[field]) {
        divergences.push({
          pickId,
          category: 'pick_state',
          field,
          referenceValue: ref[field],
          shadowValue: shadow[field],
          level: 'warning',
          description: `Warning field mismatch on pick ${pickId}: ${field}`,
          detectedAt: now,
        });
      }
    }

    // Informational — nested meta fields
    const refMeta = ref['meta'] as Record<string, unknown> | undefined;
    const shadowMeta = shadow['meta'] as Record<string, unknown> | undefined;

    if (refMeta || shadowMeta) {
      const metaFields = [
        { field: 'tier', level: 'warning' as const },
        { field: 'confidence', level: 'informational' as const },
        { field: 'grade_score', level: 'informational' as const },
      ];

      for (const { field, level } of metaFields) {
        const refVal = refMeta?.[field];
        const shadowVal = shadowMeta?.[field];
        if (refVal !== shadowVal) {
          divergences.push({
            pickId,
            category: 'pick_state',
            field: `meta.${field}`,
            referenceValue: refVal,
            shadowValue: shadowVal,
            level,
            description: `Metadata mismatch on pick ${pickId}: meta.${field}`,
            detectedAt: now,
          });
        }
      }
    }

    return divergences;
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE TRACE COMPARISON
  // ─────────────────────────────────────────────────────────────

  private static compareTraces(
    refTrace: ReadonlyArray<LifecycleTrace>,
    shadowTrace: ReadonlyArray<LifecycleTrace>
  ): DivergenceEntry[] {
    const divergences: DivergenceEntry[] = [];
    const now = new Date().toISOString(); // WALL-CLOCK-ALLOWED: divergence detection timestamp

    const refByPick = groupTraceByPick(refTrace);
    const shadowByPick = groupTraceByPick(shadowTrace);

    const allPickIds = new Set([...refByPick.keys(), ...shadowByPick.keys()]);

    for (const pickId of allPickIds) {
      const refStages = refByPick.get(pickId) ?? [];
      const shadowStages = shadowByPick.get(pickId) ?? [];

      const refTerminal = refStages[refStages.length - 1]?.to;
      const shadowTerminal = shadowStages[shadowStages.length - 1]?.to;

      if (refTerminal !== shadowTerminal) {
        divergences.push({
          pickId,
          category: 'lifecycle_trace',
          field: 'terminal_stage',
          referenceValue: refTerminal,
          shadowValue: shadowTerminal,
          level: 'critical',
          description: `Terminal lifecycle stage mismatch for pick ${pickId}: reference=${String(refTerminal)} shadow=${String(shadowTerminal)}`,
          detectedAt: now,
        });
        continue;
      }

      // Same terminal — compare intermediate stage count
      if (refStages.length !== shadowStages.length) {
        divergences.push({
          pickId,
          category: 'lifecycle_trace',
          field: 'stage_count',
          referenceValue: refStages.length,
          shadowValue: shadowStages.length,
          level: 'warning',
          description: `Different number of lifecycle transitions for pick ${pickId}: reference=${refStages.length} shadow=${shadowStages.length}`,
          detectedAt: now,
        });
      }
    }

    return divergences;
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLISH RECORDS COMPARISON
  // ─────────────────────────────────────────────────────────────

  private static comparePublishes(
    refPublishes: ReadonlyArray<RecordedPublish>,
    shadowPublishes: ReadonlyArray<RecordedPublish>
  ): DivergenceEntry[] {
    const divergences: DivergenceEntry[] = [];
    const now = new Date().toISOString(); // WALL-CLOCK-ALLOWED: divergence detection timestamp

    const refByPickId = new Map(refPublishes.map(p => [p.pickId, p]));
    const shadowByPickId = new Map(shadowPublishes.map(p => [p.pickId, p]));

    const allPickIds = new Set([...refByPickId.keys(), ...shadowByPickId.keys()]);

    for (const pickId of allPickIds) {
      const refPub = refByPickId.get(pickId);
      const shadowPub = shadowByPickId.get(pickId);

      if (refPub && !shadowPub) {
        divergences.push({
          pickId,
          category: 'publish',
          referenceValue: refPub.payload,
          shadowValue: undefined,
          level: 'critical',
          description: `Pick ${pickId} published in reference but not in shadow`,
          detectedAt: now,
        });
        continue;
      }

      if (!refPub && shadowPub) {
        divergences.push({
          pickId,
          category: 'publish',
          referenceValue: undefined,
          shadowValue: shadowPub.payload,
          level: 'critical',
          description: `Pick ${pickId} published in shadow but not in reference`,
          detectedAt: now,
        });
        continue;
      }

      if (!refPub || !shadowPub) continue;

      // Same pick published in both — compare channel
      const refChannel = refPub.payload['channel'];
      const shadowChannel = shadowPub.payload['channel'];

      if (refChannel !== shadowChannel) {
        divergences.push({
          pickId,
          category: 'publish',
          field: 'channel',
          referenceValue: refChannel,
          shadowValue: shadowChannel,
          level: 'warning',
          description: `Pick ${pickId} published to different channel: reference=${String(refChannel)} shadow=${String(shadowChannel)}`,
          detectedAt: now,
        });
      }
    }

    return divergences;
  }

  // ─────────────────────────────────────────────────────────────
  // VERDICT
  // ─────────────────────────────────────────────────────────────

  private static computeVerdict(bySeverity: {
    critical: number;
    warning: number;
    informational: number;
  }): DivergenceReport['verdict'] {
    if (bySeverity.critical > 0) return 'CRITICAL_DIVERGENCE';
    if (bySeverity.warning > 0) return 'WARNINGS_DETECTED';
    if (bySeverity.informational > 0) return 'INFORMATIONAL_ONLY';
    return 'CLEAN';
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function groupTraceByPick(trace: ReadonlyArray<LifecycleTrace>): Map<string, LifecycleTrace[]> {
  const byPick = new Map<string, LifecycleTrace[]>();
  for (const entry of trace) {
    if (!byPick.has(entry.pickId)) byPick.set(entry.pickId, []);
    byPick.get(entry.pickId)!.push(entry);
  }
  return byPick;
}
