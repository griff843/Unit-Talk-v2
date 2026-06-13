import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSchedulerLog,
  parseSchedulerConfig,
  resolveCurrentPollIntervalMs,
  type SchedulerEnv,
} from './scheduler.js';

// UTV2-1272: these tests pin the contract that the ingestor scheduler reads its
// configuration from plain env values (the same shape AppEnv now exposes) and
// resolves peak / off-peak / fixed intervals correctly.

test('parseSchedulerConfig reads enabled + peak/off-peak values from env', () => {
  const env: SchedulerEnv = {
    UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true',
    UNIT_TALK_INGESTOR_PEAK_POLL_MS: '15000',
    UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS: '120000',
    UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET: '18',
    UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET: '23',
  };

  const config = parseSchedulerConfig(env);

  assert.equal(config.enabled, true);
  assert.equal(config.peakPollMs, 15_000);
  assert.equal(config.offPeakPollMs, 120_000);
  assert.equal(config.peakStartHourEt, 18);
  assert.equal(config.peakEndHourEt, 23);
});

test('parseSchedulerConfig falls back to defaults and stays disabled when unset', () => {
  const config = parseSchedulerConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.peakPollMs, 30_000);
  assert.equal(config.offPeakPollMs, 300_000);
  assert.equal(config.peakStartHourEt, 12);
  assert.equal(config.peakEndHourEt, 24);
});

test('parseSchedulerConfig ignores invalid numeric values via defaults', () => {
  const config = parseSchedulerConfig({
    UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true',
    UNIT_TALK_INGESTOR_PEAK_POLL_MS: 'not-a-number',
    UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS: '-5',
    UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET: '99',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.peakPollMs, 30_000);
  assert.equal(config.offPeakPollMs, 300_000);
  assert.equal(config.peakStartHourEt, 12);
});

test('resolveCurrentPollIntervalMs returns fixed fallback when scheduling disabled', () => {
  const config = parseSchedulerConfig({ UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'false' });

  const resolution = resolveCurrentPollIntervalMs(config, 300_000);

  assert.equal(resolution.mode, 'fixed');
  assert.equal(resolution.intervalMs, 300_000);
  assert.equal(resolution.currentHourEt, null);
  assert.equal(formatSchedulerLog(resolution), 'scheduling=disabled interval=300000ms');
});

test('resolveCurrentPollIntervalMs picks peak interval inside the window', () => {
  const config = parseSchedulerConfig({
    UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true',
    UNIT_TALK_INGESTOR_PEAK_POLL_MS: '30000',
    UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS: '300000',
    UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET: '12',
    UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET: '24',
  });

  // 2026-06-13T20:00:00Z == 16:00 ET (EDT, UTC-4) → inside [12, 24)
  const peakUtc = Date.parse('2026-06-13T20:00:00Z');
  const resolution = resolveCurrentPollIntervalMs(config, 300_000, peakUtc);

  assert.equal(resolution.mode, 'peak');
  assert.equal(resolution.intervalMs, 30_000);
  assert.equal(resolution.currentHourEt, 16);
});

test('resolveCurrentPollIntervalMs picks off-peak interval outside the window', () => {
  const config = parseSchedulerConfig({
    UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true',
    UNIT_TALK_INGESTOR_PEAK_POLL_MS: '30000',
    UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS: '300000',
    UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET: '12',
    UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET: '24',
  });

  // 2026-06-13T12:00:00Z == 08:00 ET (EDT) → outside [12, 24)
  const offPeakUtc = Date.parse('2026-06-13T12:00:00Z');
  const resolution = resolveCurrentPollIntervalMs(config, 300_000, offPeakUtc);

  assert.equal(resolution.mode, 'off-peak');
  assert.equal(resolution.intervalMs, 300_000);
  assert.equal(resolution.currentHourEt, 8);
});
