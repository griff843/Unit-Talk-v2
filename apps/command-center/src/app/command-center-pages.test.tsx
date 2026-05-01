import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentsWorkspace } from '../components/AgentsWorkspace';
import { IntelligenceWorkspace, filterRequestLog, sortModelBreakdown } from '../components/IntelligenceWorkspace';
import { OpsWorkspace, filterAuditRows, normalizeRole } from '../components/OpsWorkspace';

test('agents page renders agent cards and log drawer surface', () => {
  const html = renderToStaticMarkup(<AgentsWorkspace />);

  assert.match(html, /CodexFrontend/);
  assert.match(html, /Open live log stream/);
  assert.match(html, /Agent Logs/);
});

test('intelligence page renders stat cards and sortable sections', () => {
  const html = renderToStaticMarkup(<IntelligenceWorkspace />);

  assert.match(html, /Total Tokens Today/);
  assert.match(html, /Model Breakdown/);
  assert.match(html, /Request Log/);
});

test('ops page gates emergency actions by role', () => {
  const viewerHtml = renderToStaticMarkup(<OpsWorkspace role="VIEWER" initialTab="emergency" />);
  const adminHtml = renderToStaticMarkup(<OpsWorkspace role="ADMIN" initialTab="emergency" />);

  assert.doesNotMatch(viewerHtml, /Enable Safe Mode/);
  assert.match(adminHtml, /Enable Safe Mode/);
  assert.match(adminHtml, /Freeze System/);
});

test('intelligence helpers sort and filter stable datasets', () => {
  const sorted = sortModelBreakdown([
    { model: 'b', requests: 10, tokens: 20, cost: 3, latency: 4, errorRate: 2 },
    { model: 'a', requests: 18, tokens: 12, cost: 7, latency: 1, errorRate: 1 },
  ], 'model', 'asc');
  const filtered = filterRequestLog([
    { id: '1', prompt: 'Alpha prompt', model: 'gpt-5.5', latency: 1, status: 'ok', requestedAt: '' },
    { id: '2', prompt: 'Beta prompt', model: 'gpt-5.4', latency: 1, status: 'error', requestedAt: '' },
  ], 'error');

  assert.equal(sorted[0]?.model, 'a');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, '2');
});

test('ops helpers normalize roles and filter audit rows', () => {
  const filtered = filterAuditRows([
    { id: '1', actor: 'QA', action: 'confirm', resource: 'ops.safe-mode', timestamp: '', outcome: 'success' },
    { id: '2', actor: 'guest', action: 'invoke', resource: 'ops.freeze-system', timestamp: '', outcome: 'denied' },
  ], 'guest');

  assert.equal(normalizeRole('ADMIN'), 'ADMIN');
  assert.equal(normalizeRole('something-else'), 'VIEWER');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, '2');
});
