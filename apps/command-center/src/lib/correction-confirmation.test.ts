import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { correctionConfirmation, correctionOutcomeFeedback } from './correction-confirmation';

test('correction confirmation requires a known, different result', () => {
  assert.equal(correctionConfirmation(null, 'win').allowed, false);
  assert.equal(correctionConfirmation('WIN', 'win').allowed, false);
  assert.deepEqual(correctionConfirmation('win', 'loss'), { allowed: true, message: 'Current: win → Proposed: loss' });
});

const recordMessage = 'Correction recorded. Record ID: correction-123';

test('a posted correction recap has its own success panel alongside persistence', () => {
  const html = renderToStaticMarkup(correctionOutcomeFeedback(recordMessage, { posted: true }));
  assert.match(html, /Record ID: correction-123/);
  assert.match(html, /Recap posted — members were told\./);
  assert.equal((html.match(/border-emerald-700/g) ?? []).length, 2);
  assert.doesNotMatch(html, /border-amber|NOT posted|unresolved/);
});

test('a suppressed correction recap stays amber and exposes the refusal reason', () => {
  const html = renderToStaticMarkup(correctionOutcomeFeedback(recordMessage, { posted: false, reason: 'kill-switch-engaged' }));
  assert.match(html, /Correction recorded\./);
  assert.equal((html.match(/border-emerald-700/g) ?? []).length, 1, 'only persistence is successful');
  assert.match(html, /border-amber-600/);
  assert.match(html, /Recap NOT posted — members were not told\./);
  assert.match(html, /kill switch is engaged/);
  assert.match(html, /reason: kill-switch-engaged/);
  assert.doesNotMatch(html, /Recap posted —/);
});

test('an unresolved correction recap warns about checking before retrying', () => {
  const html = renderToStaticMarkup(correctionOutcomeFeedback(recordMessage, { posted: false, reason: 'recap_request_outcome_unknown' }));
  assert.match(html, /Record ID: correction-123/);
  assert.match(html, /border-amber-600/);
  assert.match(html, /Recap outcome unresolved/);
  assert.match(html, /Check Discord before retrying/);
  assert.match(html, /reason: recap_request_outcome_unknown/);
  assert.doesNotMatch(html, /members were not told|Recap posted —/);
});

test('an absent correction recap renders persistence without inventing suppression', () => {
  const html = renderToStaticMarkup(correctionOutcomeFeedback(recordMessage));
  assert.match(html, /Record ID: correction-123/);
  assert.equal((html.match(/border-emerald-700/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Recap|border-amber|reason:/);
});

test('an unknown failed correction recap preserves the returned reason', () => {
  const html = renderToStaticMarkup(correctionOutcomeFeedback(recordMessage, { posted: false, reason: 'discord-http-503' }));
  assert.match(html, /border-amber-600/);
  assert.match(html, /The API refused the recap with: discord-http-503/);
  assert.match(html, /reason: discord-http-503/);
});
