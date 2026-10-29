import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionConfirmation } from './correction-confirmation';

test('correction confirmation requires a known, different result', () => {
  assert.equal(correctionConfirmation(null, 'win').allowed, false);
  assert.equal(correctionConfirmation('WIN', 'win').allowed, false);
  assert.deepEqual(correctionConfirmation('win', 'loss'), { allowed: true, message: 'Current: win → Proposed: loss' });
});
