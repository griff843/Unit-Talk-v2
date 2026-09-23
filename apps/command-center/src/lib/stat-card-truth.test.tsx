import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatCard } from '../components/ui/StatCard';

test('summary cards render the persisted number before JavaScript hydrates', () => {
  for (const [value, expected] of [[7307, '7,307'], [1, '1'], [0, '0'], [-3.5, '-3.5']] as const) {
    const html = renderToStaticMarkup(<StatCard label="Measured value" value={value} />);
    assert.match(html, new RegExp(`>${expected.replace('.', '\\.')}<`));
    assert.doesNotMatch(html, /aria-label="0"/);
  }
});

test('an unavailable summary is not replaced with a reassuring zero', () => {
  const html = renderToStaticMarkup(<StatCard label="Unknown" value={null} />);
  assert.match(html, /not measurable for this cohort/);
  assert.doesNotMatch(html, />0</);
});
