import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentsWorkspace } from '../components/AgentsWorkspace';
import { IntelligenceWorkspace, filterRequestLog, sortModelBreakdown } from '../components/IntelligenceWorkspace';
import { OpsWorkspace, filterAuditRows, normalizeRole } from '../components/OpsWorkspace';
import { PicksExplorerClient } from '../components/PicksExplorerClient';
import { humanCapperDeliveryAuthorizationVersion } from '@unit-talk/contracts';
import { GovernedPickTruth } from '../components/GovernedPickTruth';

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

const authorization = (decision: 'authorized' | 'refused') => ({
  version: humanCapperDeliveryAuthorizationVersion,
  decision,
  capperId: 'capper-1',
  ...(decision === 'refused' ? { reason: 'track-only-requested' } : {}),
  authority: 'server-allowlist',
  allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
  decidedAt: '2026-09-28T20:30:00.000Z',
});

test('governed pick truth renders a refused Track Only authorization and its persisted provenance', () => {
  const html = renderToStaticMarkup(<GovernedPickTruth
    metadata={{
      distributionMode: 'track-only',
      deliveryAuthorization: authorization('refused'),
      participantResolution: {
        resolution: 'manual', reason: 'canonical-coverage-gap',
        enteredParticipants: [{ role: 'player', displayName: 'A. Player' }],
      },
      edgeProvenance: { fallbackReason: 'no-event-scope' },
    }}
    hasEventLink={false}
    voided={true}
  />);

  assert.match(html, /Voided pick/);
  assert.match(html, /Track Only/);
  assert.match(html, /track-only-requested/);
  assert.match(html, /Manual — canonical-coverage-gap: player: A\. Player/);
  assert.match(html, /no-event-scope/);
  assert.match(html, /event_link_not_found/);
  assert.doesNotMatch(html, /Decision[^<]*authorized/);
});

test('governed pick truth renders an authorized authorization record', () => {
  const html = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'delivery-eligible', deliveryAuthorization: authorization('authorized') }}
    hasEventLink={true}
    voided={false}
  />);

  assert.match(html, /Decision/);
  assert.match(html, /authorized/);
  assert.match(html, /server-allowlist/);
  assert.match(html, /2026-09-28T20:30:00\.000Z/);
});

test('delivery-eligible picks show a killed target and its recorded switch truth', () => {
  const html = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'delivery-eligible', deliveryAuthorization: authorization('authorized') }}
    hasEventLink={true}
    voided={false}
    deliveryKillSwitch={{ state: 'killed', target: 'official-picks', reason: 'maintenance', actor: 'operator-1', updatedAt: '2026-09-28T21:00:00.000Z' }}
  />);

  assert.match(html, /Delivery held:.*official-picks.*kill switch engaged/);
  assert.match(html, /maintenance/);
  assert.match(html, /operator-1/);
  assert.match(html, /2026-09-28T21:00:00\.000Z/);
});

test('delivery-eligible picks fail closed for missing and unavailable switch reads', () => {
  const missingHtml = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'delivery-eligible' }} hasEventLink={true} voided={false}
    deliveryKillSwitch={{ state: 'missing', target: 'official-picks' }}
  />);
  const unavailableHtml = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'delivery-eligible' }} hasEventLink={true} voided={false}
    deliveryKillSwitch={{ state: 'unavailable', target: 'official-picks' }}
  />);

  assert.match(missingHtml, /Delivery held: the worker fails closed/);
  assert.match(unavailableHtml, /Kill-switch state unavailable/);
  assert.doesNotMatch(unavailableHtml, /kill switch disengaged/);
});

test('Track Only picks do not render a delivery-held block', () => {
  const html = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'track-only' }} hasEventLink={true} voided={false}
  />);

  assert.doesNotMatch(html, /Delivery held|Kill-switch state unavailable/);
});

test('malformed delivery authorization never renders as authorized', () => {
  const html = renderToStaticMarkup(<GovernedPickTruth
    metadata={{ distributionMode: 'track-only', deliveryAuthorization: { decision: 'authorized' } }}
    hasEventLink={true}
    voided={false}
  />);

  assert.match(html, /No delivery authorization recorded/);
  assert.doesNotMatch(html, /Decision[^<]*authorized/);
});

test('governed list row replaces suppressed routing with capper, units, and Track Only badge', () => {
  const html = renderToStaticMarkup(<PicksExplorerClient picks={[{
    id: 'governed-pick', selection: 'Lions ML', status: 'validated', metadata: { distributionMode: 'track-only' },
    capper_display_name: 'Griff', stake_units: 2, promotion_status: 'suppressed', promotion_target: null,
  }]} sourceTotal={1} />);

  assert.match(html, /Griff/);
  assert.match(html, /2u/);
  assert.match(html, /Track Only/);
  assert.doesNotMatch(html, /unrouted/);
  assert.doesNotMatch(html, /suppressed/);
});

test('ungoverned list row retains routing presentation', () => {
  const html = renderToStaticMarkup(<PicksExplorerClient picks={[{
    id: 'ungoverned-pick', selection: 'Lions ML', status: 'validated', metadata: {},
    promotion_status: 'suppressed', promotion_target: null, promotion_reason: 'below threshold',
  }]} sourceTotal={1} />);

  assert.match(html, /unrouted/);
  assert.match(html, /suppressed/);
  assert.match(html, /below threshold/);
});
