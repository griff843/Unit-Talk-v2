import assert from 'node:assert/strict';
import test from 'node:test';

import * as domain from './index.js';

test('top-level domain public surface does not export calibration helpers', () => {
  assert.equal('calibrate' in domain, false);
  assert.equal('calibrateBatch' in domain, false);
  assert.equal('computeCalibrationMetrics' in domain, false);
  assert.equal('compareCalibration' in domain, false);
});
