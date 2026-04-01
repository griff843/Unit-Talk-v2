import assert from 'node:assert/strict';
import test from 'node:test';

import * as probability from './index.js';

test('probability public surface does not export calibration helpers', () => {
  assert.equal('calibrate' in probability, false);
  assert.equal('calibrateBatch' in probability, false);
  assert.equal('computeCalibrationMetrics' in probability, false);
  assert.equal('compareCalibration' in probability, false);
});
