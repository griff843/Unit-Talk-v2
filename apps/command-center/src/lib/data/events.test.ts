import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVirtualWindow,
  filterEvents,
  mergeEventStreams,
  normalizePayload,
  summarizePayload,
  type EventStreamRecord,
} from '../events-feed';

const SAMPLE_EVENTS: EventStreamRecord[] = [
  {
    id: 'evt-3',
    timestamp: '2026-04-30T12:03:00.000Z',
    type: 'materialized',
    source: 'discord-bot',
    summary: 'status: materialized',
    payload: { status: 'materialized', market: 'Moneyline' },
    submissionId: 'sub-3',
  },
  {
    id: 'evt-2',
    timestamp: '2026-04-30T12:02:00.000Z',
    type: 'validated',
    source: 'smart-form',
    summary: 'status: validated',
    payload: { status: 'validated', capper: 'griff' },
    submissionId: 'sub-2',
  },
  {
    id: 'evt-1',
    timestamp: '2026-04-30T12:01:00.000Z',
    type: 'received',
    source: 'operator',
    summary: 'status: received',
    payload: { status: 'received', source: 'operator' },
    submissionId: 'sub-1',
  },
];

test('normalizePayload accepts plain objects only', () => {
  assert.deepEqual(normalizePayload({ ok: true }), { ok: true });
  assert.equal(normalizePayload(['nope']), null);
  assert.equal(normalizePayload(null), null);
});

test('summarizePayload produces a compact printable summary', () => {
  assert.equal(
    summarizePayload({ capper: 'griff', market: 'PTS', line: 28.5 }),
    'capper: griff · market: PTS · line: 28.5',
  );
});

test('filterEvents applies event type and text filters', () => {
  const filtered = filterEvents(SAMPLE_EVENTS, {
    selectedTypes: new Set(['validated']),
    query: 'griff',
  });

  assert.deepEqual(filtered.map((event) => event.id), ['evt-2']);
});

test('mergeEventStreams prepends new ids and keeps newest-first ordering', () => {
  const merged = mergeEventStreams(SAMPLE_EVENTS, [
    {
      id: 'evt-4',
      timestamp: '2026-04-30T12:04:00.000Z',
      type: 'posted',
      source: 'worker',
      summary: 'status: posted',
      payload: { status: 'posted' },
      submissionId: 'sub-4',
    },
    SAMPLE_EVENTS[1],
  ]);

  assert.deepEqual(merged.map((event) => event.id), ['evt-4', 'evt-3', 'evt-2', 'evt-1']);
});

test('buildVirtualWindow returns bounded slices and spacer heights', () => {
  const window = buildVirtualWindow({
    totalCount: 100,
    scrollTop: 420,
    viewportHeight: 240,
    rowHeight: 60,
    overscan: 2,
  });

  assert.equal(window.startIndex, 5);
  assert.equal(window.endIndex, 13);
  assert.equal(window.paddingTop, 300);
  assert.equal(window.paddingBottom, 5220);
});
