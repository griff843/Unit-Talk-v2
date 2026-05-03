import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentCard } from './AgentCard';
import { ConfirmDialog, confirmTextMatches } from './ConfirmDialog';
import { CounterAnimation } from './CounterAnimation';
import { DetailPanel } from './DetailPanel';
import { LiveEventFeed } from './LiveEventFeed';
import { LogDrawer } from './LogDrawer';
import { PipelineFlow } from './PipelineFlow';
import { ProviderHealthCard, resolveQuotaTone } from './ProviderHealthCard';
import { Sparkline } from './Sparkline';
import { SkeletonShimmer } from './SkeletonShimmer';
import { StatCard } from './StatCard';

test('shared command center components render without throwing', () => {
  const html = renderToStaticMarkup(
    <div>
      <CounterAnimation value={42} />
      <StatCard label="Queued Picks" value={118} delta={4.2} unit="%" liveUpdate />
      <PipelineFlow stages={[
        { name: 'Validated', count: 18, status: 'healthy' },
        { name: 'Queued', count: 11, status: 'idle' },
        { name: 'Posted', count: 4, status: 'error' },
      ]} />
      <DetailPanel open onClose={() => undefined} title="Pick Detail">
        <p>Detail body</p>
      </DetailPanel>
      <LiveEventFeed
        events={[
          { id: 'evt-1', title: 'Outbox enqueue', detail: 'Queued to canary', timestamp: '1s ago', tone: 'info' },
          { id: 'evt-2', title: 'Receipt stored', detail: 'Discord acknowledged', timestamp: '3s ago', tone: 'success' },
        ]}
        paused={false}
        onTogglePause={() => undefined}
      />
      <ProviderHealthCard
        provider="Odds API"
        status="healthy"
        responseMs={182}
        quotaPct={44}
        callsToday={129}
        lastCheckedAt={new Date().toISOString()}
        sparkline={[120, 140, 182]}
      />
      <Sparkline points={[2, 4, 3, 5]} label="Pipeline sample" />
      <AgentCard
        agent={{
          id: 'qa-agent',
          name: 'VerificationLead',
          role: 'QA',
          status: 'busy',
          lastHeartbeat: new Date().toISOString(),
          currentTask: 'Verifying command center widgets',
          cpu: 41,
          memory: 62,
        }}
      />
      <LogDrawer agentId="qa-agent" open onClose={() => undefined} />
      <SkeletonShimmer width={160} height={48} />
      <ConfirmDialog action="delete" confirmText="Delete the selected record." onConfirm={() => undefined} />
    </div>,
  );

  assert.match(html, /Queued Picks/);
  assert.match(html, /Live Event Feed/);
  assert.match(html, /Confirm Destructive Action/);
  assert.match(html, /Calls Today/);
});

test('confirm dialog requires exact text match', () => {
  assert.equal(confirmTextMatches('delete', 'delete'), true);
  assert.equal(confirmTextMatches('delete', 'Delete'), false);
  assert.equal(confirmTextMatches('delete', ' delete '), false);
});

test('provider quota thresholds match the command center contract', () => {
  assert.equal(resolveQuotaTone(69), 'bg-emerald-400');
  assert.equal(resolveQuotaTone(70), 'bg-amber-400');
  assert.equal(resolveQuotaTone(90), 'bg-amber-400');
  assert.equal(resolveQuotaTone(91), 'bg-rose-400');
});
