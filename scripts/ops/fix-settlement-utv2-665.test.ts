import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemorySettlementRepository } from '@unit-talk/db';
import {
  appendUtv2SettlementCorrections,
  CORRECT_EVENT_ID,
  CORRECTION_ACTOR,
  CORRECTION_SOURCE,
  UTV2_665_SETTLEMENT_TARGETS,
  WRONG_EVENT_ID,
} from './fix-settlement-utv2-665.js';

const SETTLED_AT = '2026-04-21T12:00:00.000Z';

test('appendUtv2SettlementCorrections inserts additive correction rows and is idempotent', async () => {
  const settlements = new InMemorySettlementRepository();

  await settlements.record({
    pickId: UTV2_665_SETTLEMENT_TARGETS[0].pickId,
    status: 'settled',
    result: 'win',
    source: 'grading',
    confidence: 'confirmed',
    evidenceRef: WRONG_EVENT_ID,
    settledBy: 'grading-run',
    settledAt: '2026-04-18T18:41:00.000Z',
    payload: {
      event_id: WRONG_EVENT_ID,
    },
  });
  await settlements.record({
    pickId: UTV2_665_SETTLEMENT_TARGETS[1].pickId,
    status: 'settled',
    result: 'loss',
    source: 'grading',
    confidence: 'confirmed',
    evidenceRef: WRONG_EVENT_ID,
    settledBy: 'grading-run',
    settledAt: '2026-04-18T18:41:00.000Z',
    payload: {
      event_id: WRONG_EVENT_ID,
    },
  });

  const firstRun = await appendUtv2SettlementCorrections(settlements, {
    now: SETTLED_AT,
  });

  assert.equal(firstRun.inserted.length, 2);
  assert.equal(firstRun.skipped.length, 0);

  const guiSettlements = await settlements.listByPick(UTV2_665_SETTLEMENT_TARGETS[0].pickId);
  const guiCorrection = guiSettlements.find((row) => row.corrects_id !== null);
  assert.ok(guiCorrection);
  assert.equal(guiCorrection.result, 'loss');
  assert.equal(guiCorrection.evidence_ref, CORRECT_EVENT_ID);
  assert.equal(guiCorrection.source, CORRECTION_SOURCE);
  assert.equal(guiCorrection.settled_by, CORRECTION_ACTOR);
  assert.deepStrictEqual(guiCorrection.payload, {
    issue: 'UTV2-665',
    correctionReason: 'Feb 6 Warriors-Suns ghost settlement corrected to Apr 17 event.',
    wrongEventId: WRONG_EVENT_ID,
    correctEventId: CORRECT_EVENT_ID,
    originalSettlementId: 'settlement_1',
    originalResult: 'win',
    correctedResult: 'loss',
    selection: 'Gui Santos Points O 12.5',
  });

  const jalenSettlements = await settlements.listByPick(UTV2_665_SETTLEMENT_TARGETS[1].pickId);
  const jalenCorrection = jalenSettlements.find((row) => row.corrects_id !== null);
  assert.ok(jalenCorrection);
  assert.equal(jalenCorrection.result, 'win');
  assert.equal(jalenCorrection.evidence_ref, CORRECT_EVENT_ID);
  assert.equal(jalenCorrection.source, CORRECTION_SOURCE);
  assert.equal(jalenCorrection.settled_by, CORRECTION_ACTOR);
  assert.deepStrictEqual(jalenCorrection.payload, {
    issue: 'UTV2-665',
    correctionReason: 'Feb 6 Warriors-Suns ghost settlement corrected to Apr 17 event.',
    wrongEventId: WRONG_EVENT_ID,
    correctEventId: CORRECT_EVENT_ID,
    originalSettlementId: 'settlement_2',
    originalResult: 'loss',
    correctedResult: 'win',
    selection: 'Jalen Green Points O 20.5',
  });

  const secondRun = await appendUtv2SettlementCorrections(settlements, {
    now: '2026-04-21T13:00:00.000Z',
  });

  assert.equal(secondRun.inserted.length, 0);
  assert.equal(secondRun.skipped.length, 2);
  assert.equal((await settlements.listByPick(UTV2_665_SETTLEMENT_TARGETS[0].pickId)).length, 2);
  assert.equal((await settlements.listByPick(UTV2_665_SETTLEMENT_TARGETS[1].pickId)).length, 2);
});
