import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { DegradedState } from '../components/ui/DegradedState.js';
import { ProviderHealthCard } from '../components/ui/ProviderHealthCard.js';

test('degraded state states the blind spot without implying a measured zero', () => {
  const html = renderToStaticMarkup(React.createElement(DegradedState, {
    severity: 'critical',
    title: 'Review queue unavailable',
    causes: ['The governed review queue could not be loaded. No queue count was inferred.'],
  }));

  assert.match(html, /Review queue unavailable/);
  assert.match(html, /No queue count was inferred/);
  assert.doesNotMatch(html, />0</);
});

test('provider cards render unknown measurements as unavailable', () => {
  const html = renderToStaticMarkup(React.createElement(ProviderHealthCard, {
    provider: 'SGO',
    status: 'unknown',
    responseMs: null,
    quotaPct: null,
    callsToday: null,
    lastCheckedAt: null,
    sparkline: [],
  }));

  assert.match(html, /unknown/);
  assert.match(html, /Unavailable/);
  assert.match(html, /No recent check/);
  assert.doesNotMatch(html, /0%/);
});
