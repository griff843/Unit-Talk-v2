import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SIGNED_DECIMAL_PATTERN,
  SIGNED_INTEGER_PATTERN,
  SignedNumberInput,
  nextSignedInputValue,
} from '../components/SignedNumberInput.tsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = [
  path.join(ROOT, 'app'),
  path.join(ROOT, 'components'),
  path.join(ROOT, 'lib'),
];
const FORBIDDEN_PATTERNS = [
  /provider_offer_current/i,
  /provider_offer_history/i,
  /provider_offers/i,
  /raw_provider_payload/i,
  /raw-provider-payload/i,
  /from\(\s*['"]provider_/i,
  /@supabase\/supabase-js/,
];

function readText(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

function walkFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(fullPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

test('smart-form submit client writes through the canonical submissions endpoint', () => {
  const source = readText(path.join(ROOT, 'lib', 'api-client.ts'));
  assert.match(source, /fetch\(`\$\{API\}\/api\/submissions`/);
  assert.doesNotMatch(source, /\/rest\/v1\//);
});

test('smart-form browse client only uses API reference-data and submissions surfaces', () => {
  const source = readText(path.join(ROOT, 'lib', 'api-client.ts'));
  const endpointMatches = [...source.matchAll(/fetch\(`\$\{API\}(\/api\/[^`]+)`/g)].map((match) => match[1]);

  assert.ok(endpointMatches.length > 0, 'expected fetch endpoints in api-client');
  for (const endpoint of endpointMatches) {
    assert.ok(
      endpoint.startsWith('/api/reference-data/') || endpoint === '/api/submissions',
      `unexpected smart-form endpoint: ${endpoint}`,
    );
  }
});

test('smart-form source tree does not import ingestion storage or direct Supabase clients', () => {
  const files = SOURCE_DIRS.flatMap((dirPath) => walkFiles(dirPath));
  assert.ok(files.length > 0, 'expected smart-form source files');

  for (const filePath of files) {
    const source = readText(filePath);
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path.relative(ROOT, filePath)} matched ${pattern}`);
    }
  }
});

test('signed odds render as a text-keyboard input with an integer sign pattern', () => {
  const markup = renderToStaticMarkup(createElement(SignedNumberInput, {
    integerOnly: true,
    name: 'odds',
    value: -110,
    onValueChange: () => undefined,
  }));

  assert.match(markup, /type="text"/);
  assert.match(markup, /inputmode="text"/i);
  assert.ok(markup.includes(`pattern="${SIGNED_INTEGER_PATTERN}"`));
  assert.doesNotMatch(markup, /inputmode="(?:numeric|decimal)"/i);
  assert.match(markup, /value="-110"/);
});

test('signed lines render as a text-keyboard input with a decimal sign pattern', () => {
  const markup = renderToStaticMarkup(createElement(SignedNumberInput, {
    name: 'line',
    value: -3.5,
    onValueChange: () => undefined,
  }));

  assert.match(markup, /type="text"/);
  assert.match(markup, /inputmode="text"/i);
  assert.ok(markup.includes(`pattern="${SIGNED_DECIMAL_PATTERN}"`));
  assert.doesNotMatch(markup, /inputmode="(?:numeric|decimal)"/i);
  assert.match(markup, /value="-3.5"/);
});

test('a signed decimal stays enterable one keystroke at a time', () => {
  // Typing -3.5. Coercing each keystroke to a number drops the decimal point, because
  // Number('-3.') is -3 and re-renders as "-3" -- so the next digit lands as -35, and a spread
  // line becomes unenterable. Each intermediate state must survive verbatim.
  assert.equal(nextSignedInputValue('-'), '-');
  assert.equal(nextSignedInputValue('-3'), -3);
  assert.equal(nextSignedInputValue('-3.'), '-3.');
  assert.equal(nextSignedInputValue('-3.5'), -3.5);
});

test('a signed field preserves a leading minus that Number() would erase', () => {
  // Number('-0') is -0, which String()s to "0" -- typing -0.5 would lose the sign at the second
  // keystroke.
  assert.equal(nextSignedInputValue('-0'), '-0');
  assert.equal(nextSignedInputValue('-0.'), '-0.');
  assert.equal(nextSignedInputValue('-0.5'), -0.5);
});

test('a signed field clears on empty and rejects input that is not a number', () => {
  assert.equal(nextSignedInputValue(''), undefined);
  for (const junk of ['abc', '-1-2', '1.2.3', '--5']) {
    assert.equal(nextSignedInputValue(junk), null, junk);
  }
});

test('a fully typed signed number is handed on as a number, not a string', () => {
  // The inverse of the tests above: preserving intermediate states must not turn every value into
  // a string, or downstream numeric handling silently changes shape.
  assert.equal(nextSignedInputValue('-110'), -110);
  assert.equal(nextSignedInputValue('110'), 110);
  assert.equal(nextSignedInputValue('2.5'), 2.5);
});
