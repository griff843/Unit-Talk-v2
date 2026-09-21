import type { RepositoryBundle } from '@unit-talk/db';

export type SettlementRecapOutcome = { posted: true } | { posted: false; reason: string };
export type ObservedRecapOutcome = SettlementRecapOutcome & {
  channel?: string;
  messageId?: string;
  failed?: boolean;
};

/** Persist per-pick provenance before attempting member delivery. */
export async function observeSettlementRecap(
  pickId: string,
  settlementRecordId: string,
  runs: RepositoryBundle['runs'],
  attempt: () => Promise<ObservedRecapOutcome>,
  warn?: ((message: string) => void) | undefined,
): Promise<SettlementRecapOutcome> {
  const identity = { recapKind: 'settlement-pick', pickId, settlementRecordId, pickCount: 1 };
  let runId: string;
  try {
    const run = await runs.startRun({ runType: 'recap.post', actor: 'grading-service', details: identity });
    runId = run.id;
  } catch {
    warn?.(`Recap for pick ${pickId} was not attempted: provenance could not be recorded.`);
    return { posted: false, reason: 'recap_provenance_unavailable' };
  }

  let outcome: ObservedRecapOutcome;
  try {
    outcome = await attempt();
  } catch {
    // A network exception is not proof that Discord did not accept a request.
    // Preserve the uncertainty so readers must not label this a confirmed refusal.
    outcome = { posted: false, reason: 'recap_request_outcome_unknown', failed: true };
  }
  try {
    await runs.completeRun({
      runId,
      status: outcome.posted ? 'succeeded' : outcome.failed ? 'failed' : 'cancelled',
      details: { ...identity, ...outcome },
    });
  } catch {
    // Do not relabel an accepted Discord post as a failed post. A running record
    // with no terminal evidence deliberately remains unresolved for the operator.
    warn?.(`Recap outcome for pick ${pickId} could not be persisted; run ${runId} remains unresolved.`);
  }
  return outcome.posted ? { posted: true } : { posted: false, reason: outcome.reason };
}
