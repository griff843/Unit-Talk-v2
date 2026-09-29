/**
 * WORK-2026092901: the official-pick presentation a paying member sees.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { OutboxRecord } from '@unit-talk/db';
import { buildDiscordMessagePayload } from './delivery-adapters.js';

function officialOutbox(payloadOverrides: Record<string, unknown> = {}): OutboxRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pick_id: randomUUID(),
    target: 'discord:official-picks',
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: {
      market: 'Moneyline',
      selection: 'Yankees ML',
      odds: -143,
      stakeUnits: 3,
      confidence: 0.81,
      source: 'smart-form',
      lifecycleState: 'queued',
      metadata: {
        sport: 'MLB',
        eventName: 'Yankees vs Red Sox',
        capper: 'griff843',
        capperRecord: '12-4',
        capperClvPct: 2.4,
        hasRealEdge: true,
        realEdge: 0.05,
        realEdgeSource: 'sgo',
        domainAnalysis: { impliedProbability: 0.58 },
        thesis: 'Bullpen edge.',
      },
      ...payloadOverrides,
    },
    claimed_at: null,
    claimed_by: null,
    idempotency_key: 'discord:official-picks:idempotent',
    created_at: now,
    updated_at: now,
  };
}

type Embed = {
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string }>;
  footer?: { text?: string };
};

function embedOf(outbox: OutboxRecord) {
  const payload = buildDiscordMessagePayload(outbox) as { embeds?: Embed[] };
  const embed = payload.embeds?.[0];
  assert.ok(embed);
  return { payload, embed };
}

function field(embed: Embed, name: string) {
  return embed.fields?.find((f) => f.name === name)?.value;
}

test('official picks carry the Official Picks footer and never the Canary footer', () => {
  const { payload, embed } = embedOf(officialOutbox());
  assert.equal(embed.footer?.text, 'Unit Talk | Official Picks');
  assert.doesNotMatch(JSON.stringify(payload), /canary/iu);
});

test('official picks show Market, Odds, Units and Capper', () => {
  const { embed } = embedOf(officialOutbox());
  assert.equal(embed.title, 'Yankees ML');
  assert.equal(field(embed, 'Market'), 'Moneyline');
  assert.equal(field(embed, 'Odds'), '-143');
  assert.equal(field(embed, 'Units'), '3u');
  assert.equal(field(embed, 'Capper'), 'griff843');
  assert.equal(field(embed, 'Thesis'), 'Bullpen edge.');
});

test('units read a numeric string, and show a dash when absent', () => {
  assert.equal(field(embedOf(officialOutbox({ stakeUnits: '3' })).embed, 'Units'), '3u');
  assert.equal(field(embedOf(officialOutbox({ stakeUnits: 1.5 })).embed, 'Units'), '1.5u');
  assert.equal(field(embedOf(officialOutbox({ stakeUnits: undefined })).embed, 'Units'), '—');
  assert.equal(field(embedOf(officialOutbox({ stakeUnits: 'lots' })).embed, 'Units'), '—');
});

test('odds render as a bare American price', () => {
  assert.equal(field(embedOf(officialOutbox({ odds: 120 })).embed, 'Odds'), '+120');
  assert.equal(field(embedOf(officialOutbox({ odds: undefined })).embed, 'Odds'), '—');
});

test('official picks show no confidence, edge, implied probability, record or CLV', () => {
  const { payload, embed } = embedOf(officialOutbox());
  const names = (embed.fields ?? []).map((f) => f.name.toLowerCase());
  for (const banned of ['confidence', 'edge', 'implied', 'clv', 'record']) {
    assert.ok(!names.some((n) => n.includes(banned)), `field containing "${banned}" must not render`);
  }
  assert.doesNotMatch(JSON.stringify(payload), /12-4|sgo/u);
});

test('the official pick message carries its outbox nonce', () => {
  const outbox = officialOutbox();
  const payload = buildDiscordMessagePayload(outbox) as { nonce?: string; enforce_nonce?: boolean };
  assert.equal(payload.enforce_nonce, true);
  assert.equal(typeof payload.nonce, 'string');
  assert.ok((payload.nonce ?? '').length <= 25);
});

test('the canary lane keeps its own footer (the change is scoped to official picks)', () => {
  const outbox = { ...officialOutbox(), target: 'discord:canary' };
  const { embed } = embedOf(outbox);
  assert.equal(embed.footer?.text, 'Unit Talk | Canary');
});
