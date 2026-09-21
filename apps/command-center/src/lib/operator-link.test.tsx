import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OperatorLink from '../components/OperatorLink';

test('operator links preserve accessible anchor destinations and query strings', () => {
  const html = renderToStaticMarkup(<OperatorLink href="/picks?q=Lions" aria-label="Find Lions">Find</OperatorLink>);
  assert.match(html, /href="\/picks\?q=Lions"/);
  assert.match(html, /aria-label="Find Lions"/);
  assert.match(html, />Find<\/a>/);
});
