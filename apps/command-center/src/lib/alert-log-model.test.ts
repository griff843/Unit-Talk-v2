import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlertLog, severityRank, type AlertLogInput } from './alert-log-model.js';

function alert(id: string, title: string, severity: AlertLogInput['severity'], detail = 'd'): AlertLogInput {
  return { id, title, detail, severity };
}

test('critical entries sort above larger low-severity clusters', () => {
  const inputs: AlertLogInput[] = [
    ...Array.from({ length: 19 }, (_, i) => alert(`low-${i}`, 'Missing promotion score', 'low')),
    alert('crit-1', 'Settled without result', 'critical'),
    alert('crit-2', 'Settled without result', 'critical'),
  ];
  const log = buildAlertLog(inputs);
  assert.equal(log[0]?.title, 'Settled without result');
  assert.equal(log[0]?.severity, 'critical');
  assert.equal(log[0]?.count, 2);
});

test('duplicates collapse into one entry with count and member ids', () => {
  const log = buildAlertLog([
    alert('a', 'Missing promotion score', 'low'),
    alert('b', 'Missing promotion score', 'low'),
    alert('c', 'Missing promotion score', 'low'),
  ]);
  assert.equal(log.length, 1);
  assert.equal(log[0]?.count, 3);
  assert.deepEqual(log[0]?.memberIds, ['a', 'b', 'c']);
});

test('same title with different severity stays separate', () => {
  const log = buildAlertLog([
    alert('a', 'Stuck in validated', 'critical'),
    alert('b', 'Stuck in validated', 'high'),
  ]);
  assert.equal(log.length, 2);
  assert.equal(log[0]?.severity, 'critical');
});

test('ties break by count then title', () => {
  const log = buildAlertLog([
    alert('a', 'B alert', 'high'),
    alert('b', 'A alert', 'high'),
    alert('c', 'A alert', 'high'),
  ]);
  assert.deepEqual(log.map((e) => e.title), ['A alert', 'B alert']);
});

test('severityRank is strictly ordered', () => {
  assert.ok(severityRank('critical') > severityRank('high'));
  assert.ok(severityRank('high') > severityRank('medium'));
  assert.ok(severityRank('medium') > severityRank('low'));
});
