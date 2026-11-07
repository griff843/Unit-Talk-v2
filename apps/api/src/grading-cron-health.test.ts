import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isGradingCronFresh,
  refreshGradingCronLiveness,
} from './grading-cron-health.js';

test('liveness is unhealthy when missing, expired, malformed or future; healthy within three polls', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'grading-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'marker');
  assert.equal(await isGradingCronFresh(path, 100, 1_000), false);
  await refreshGradingCronLiveness(path, 1_000);
  assert.equal(await isGradingCronFresh(path, 100, 1_000), true);
  assert.equal(await isGradingCronFresh(path, 100, 1_300), true);
  assert.equal(await isGradingCronFresh(path, 100, 1_301), false);
  assert.equal(await isGradingCronFresh(path, 100, 999), false);
  for (const content of ['', 'garbage', 'Infinity']) {
    await writeFile(path, content);
    assert.equal(await isGradingCronFresh(path, 100, 1_000), false);
  }
  assert.equal(await isGradingCronFresh(path, 0), false);
});
