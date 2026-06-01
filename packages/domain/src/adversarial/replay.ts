import type {
  AdversarialReplayResult,
  IndependentAdversarialRecord,
  ReplayableAdversarialFinding,
  ReplayedAdversarialFinding,
} from './independent-data-path.types.js';
import { verifyFindingAgainstRecord } from './independent-data-path.js';

export type {
  AdversarialReplayResult,
  IndependentAdversarialRecord,
  ReplayableAdversarialFinding,
  ReplayedAdversarialFinding,
} from './independent-data-path.types.js';

export interface ReplayAdversarialFindingsInput {
  readonly records: readonly IndependentAdversarialRecord[];
  readonly findings: readonly ReplayableAdversarialFinding[];
  readonly replayedAt: string;
}

export function replayAdversarialFindings(
  input: ReplayAdversarialFindingsInput,
): AdversarialReplayResult {
  const recordsByReplayKey = new Map<string, IndependentAdversarialRecord>();
  for (const record of input.records) {
    recordsByReplayKey.set(record.replayKey, record);
  }

  const verified: ReplayedAdversarialFinding[] = [];
  const rejected: ReplayableAdversarialFinding[] = [];

  for (const finding of input.findings) {
    const record = recordsByReplayKey.get(finding.replayKey);
    if (record && verifyFindingAgainstRecord(finding, record)) {
      verified.push(Object.freeze({
        finding,
        record,
        replayedAt: input.replayedAt,
        verified: true,
      }));
    } else {
      rejected.push(finding);
    }
  }

  return Object.freeze({
    replayedAt: input.replayedAt,
    verified: Object.freeze(verified),
    rejected: Object.freeze(rejected),
  });
}
