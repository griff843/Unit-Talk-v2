import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparklinePath, sparklineAreaPath, miniBars } from './microchart-model.js';

const OPTS = { width: 100, height: 32, pad: 2 };

test('sparklinePath returns null for fewer than 2 points', () => {
  assert.equal(sparklinePath([], OPTS), null);
  assert.equal(sparklinePath([5], OPTS), null);
});

test('sparklinePath returns null when any value is non-finite', () => {
  assert.equal(sparklinePath([1, Number.NaN, 3], OPTS), null);
  assert.equal(sparklinePath([1, Infinity], OPTS), null);
});

test('sparklinePath spans the padded box and starts with M', () => {
  const path = sparklinePath([0, 10], OPTS);
  assert.ok(path);
  assert.ok(path.startsWith('M 2 '));
  // last x = width - pad
  assert.ok(path.includes('L 98 '));
});

test('sparklinePath maps min to bottom and max to top', () => {
  const path = sparklinePath([0, 10], OPTS)!;
  // min (0) at y = height - pad = 30; max (10) at y = pad = 2
  assert.equal(path, 'M 2 30 L 98 2');
});

test('sparklinePath handles a flat series without dividing by zero', () => {
  const path = sparklinePath([5, 5, 5], OPTS);
  assert.ok(path);
  assert.ok(!path.includes('NaN'));
});

test('sparklineAreaPath closes to the bottom edge', () => {
  const area = sparklineAreaPath([0, 10], OPTS);
  assert.ok(area);
  assert.ok(area.endsWith('Z'));
  assert.ok(area.includes('L 98 30 L 2 30 Z'));
});

test('sparklineAreaPath is null when the line is null', () => {
  assert.equal(sparklineAreaPath([1], OPTS), null);
});

test('miniBars returns [] for empty, non-finite, or all-zero series', () => {
  assert.deepEqual(miniBars([], OPTS), []);
  assert.deepEqual(miniBars([0, 0, 0], OPTS), []);
  assert.deepEqual(miniBars([1, Number.NaN], OPTS), []);
});

test('miniBars scales bars to the max value, bottom-anchored', () => {
  const bars = miniBars([5, 10], { ...OPTS, gap: 2 });
  assert.equal(bars.length, 2);
  const [half, full] = bars;
  assert.equal(full!.height, 28); // height - 2*pad
  assert.equal(half!.height, 14);
  assert.equal(full!.y + full!.height, 30); // bottom anchored at height - pad
  assert.equal(half!.y + half!.height, 30);
});

test('miniBars renders zero and negative values as zero-height', () => {
  const bars = miniBars([0, -3, 6], OPTS);
  assert.equal(bars.length, 3);
  assert.equal(bars[0]!.height, 0);
  assert.equal(bars[1]!.height, 0);
  assert.ok(bars[2]!.height > 0);
});

test('miniBars bars do not overlap and stay inside the box', () => {
  const bars = miniBars([1, 2, 3, 4], { ...OPTS, gap: 2 });
  for (let i = 1; i < bars.length; i += 1) {
    assert.ok(bars[i]!.x >= bars[i - 1]!.x + bars[i - 1]!.width);
  }
  const last = bars[bars.length - 1]!;
  assert.ok(last.x + last.width <= OPTS.width - 2 + 0.01);
});
