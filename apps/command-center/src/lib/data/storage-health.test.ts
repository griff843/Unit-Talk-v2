import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { SRC } from '../test-support/source-walk';
import {
  MANAGEMENT_PLANE_GATE_ENV,
  getStorageHealth,
  isManagementPlaneEnabled,
  unavailableStorageHealth,
} from './storage-health.js';

/**
 * UTV2-1802 acceptance criterion 1 is "no Management-API request is issued —
 * assert on the absence of the request, not on the rendered output". So the
 * assertions below are on a recorded `fetch` call list and on the source of the
 * three functions that can reach the management plane, never on the field
 * values of the returned object. A test that inspected only the return value
 * would pass just as happily against an implementation that issued all seven
 * requests and then discarded the answers.
 *
 * `getStorageHealth` is a privileged boundary and calls
 * `assertPrivilegedRequestAuthenticated()` first, which fails closed outside a
 * Next request scope. A unit test therefore cannot drive its body end to end,
 * and `next/headers` cannot be module-mocked here (`node:test`'s `mock.module`
 * needs `--experimental-test-module-mocks`, which this runner does not set).
 * The gate is consequently proven two ways that together are stronger than a
 * single happy-path call: behaviourally, that a shut gate leaks no request even
 * as the call fails; and structurally, in the same idiom
 * `privileged-boundary-guard.test.ts` already uses for every privileged
 * boundary in this app — each chokepoint must own its own check. The mutation
 * proof recorded in this lane's bundle shows all of it failing when the gate is
 * removed.
 */

const SOURCE = readFileSync(join(SRC, 'lib/data/storage-health.ts'), 'utf8');

interface RecordedCall {
  url: string;
  method: string;
}

let calls: RecordedCall[] = [];
let originalFetch: typeof globalThis.fetch | undefined;
let originalGate: string | undefined;

function installFetchRecorder(): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    calls.push({ url, method: init?.method ?? 'GET' });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

function managementCalls(): RecordedCall[] {
  return calls.filter((call) => call.url.startsWith('https://api.supabase.com/'));
}

/** The body of a top-level function declaration, brace-matched. */
function functionBody(source: string, name: string): string {
  const declaration = new RegExp(
    `(?:export\\s+)?async\\s+function\\s+${name}\\s*(?:<[^>]*>)?\\s*\\(`,
  ).exec(source);
  assert.ok(declaration, `could not locate function declaration for ${name}`);
  let cursor = declaration.index + declaration[0].length;
  let parentheses = 1;
  while (cursor < source.length && parentheses > 0) {
    if (source[cursor] === '(') parentheses += 1;
    else if (source[cursor] === ')') parentheses -= 1;
    cursor += 1;
  }
  const open = source.indexOf('{', cursor);
  assert.notEqual(open, -1, `could not locate function body for ${name}`);
  let braces = 1;
  cursor = open + 1;
  while (cursor < source.length && braces > 0) {
    if (source[cursor] === '{') braces += 1;
    else if (source[cursor] === '}') braces -= 1;
    cursor += 1;
  }
  assert.equal(braces, 0, `unterminated function body for ${name}`);
  return source.slice(open + 1, cursor - 1);
}

beforeEach(() => {
  calls = [];
  originalGate = process.env[MANAGEMENT_PLANE_GATE_ENV];
});

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
  if (originalGate === undefined) {
    delete process.env[MANAGEMENT_PLANE_GATE_ENV];
  } else {
    process.env[MANAGEMENT_PLANE_GATE_ENV] = originalGate;
  }
});

describe('management plane gate', () => {
  it('is shut for every value that is not exactly "true"', () => {
    for (const value of ['', ' ', 'false', 'FALSE', '0', '1', 'yes', 'on', 'enabled', 'truthy']) {
      assert.equal(
        isManagementPlaneEnabled({ [MANAGEMENT_PLANE_GATE_ENV]: value }),
        false,
        `gate must stay shut for ${JSON.stringify(value)}`,
      );
    }
  });

  it('is shut when the variable is absent entirely', () => {
    assert.equal(isManagementPlaneEnabled({}), false);
  });

  it('opens only for "true", trimmed and case-insensitive — so it is conditional, not an unconditional refusal', () => {
    for (const value of ['true', 'TRUE', ' true ', 'True']) {
      assert.equal(
        isManagementPlaneEnabled({ [MANAGEMENT_PLANE_GATE_ENV]: value }),
        true,
        `gate must open for ${JSON.stringify(value)}`,
      );
    }
  });
});

describe('no management-plane request escapes a shut gate', () => {
  it('issues zero requests when the variable is absent', async () => {
    delete process.env[MANAGEMENT_PLANE_GATE_ENV];
    installFetchRecorder();

    await getStorageHealth().catch(() => undefined);

    assert.deepEqual(
      managementCalls(),
      [],
      'a shut gate must produce zero management-plane requests',
    );
  });

  it('issues zero requests for any non-"true" value either', async () => {
    for (const value of ['false', '1', 'yes', '']) {
      calls = [];
      process.env[MANAGEMENT_PLANE_GATE_ENV] = value;
      installFetchRecorder();

      await getStorageHealth().catch(() => undefined);

      assert.deepEqual(
        managementCalls(),
        [],
        `gate value ${JSON.stringify(value)} must produce zero management-plane requests`,
      );
    }
  });
});

describe('every function that can reach the management plane owns its own gate', () => {
  it('getStorageHealth short-circuits on the gate before it fans out', () => {
    const body = functionBody(SOURCE, 'getStorageHealth');
    assert.match(
      body,
      /if\s*\(\s*!isManagementPlaneEnabled\s*\(\s*\)\s*\)\s*\{\s*return\s+unavailableStorageHealth\(/,
      'getStorageHealth lost its management-plane gate',
    );
    assert.ok(
      body.indexOf('isManagementPlaneEnabled') < body.indexOf('await Promise.all'),
      'the gate must be checked before the request fan-out, not after it',
    );
    assert.ok(
      body.indexOf('assertPrivilegedRequestAuthenticated') < body.indexOf('isManagementPlaneEnabled'),
      'authentication must come first — an unauthenticated caller must not learn the gate state',
    );
  });

  for (const name of ['fetchManagementJson', 'runManagementQuery']) {
    it(`${name} refuses before it builds a request`, () => {
      const body = functionBody(SOURCE, name);
      assert.match(
        body,
        /assertManagementPlaneEnabled\s*\(\s*\)\s*;/,
        `${name} lost its management-plane gate`,
      );
      assert.ok(
        body.indexOf('assertManagementPlaneEnabled') < body.indexOf('fetch('),
        `${name} must refuse before it calls fetch`,
      );
      assert.ok(
        body.indexOf('assertManagementPlaneEnabled') < body.indexOf('resolveManagementEnv'),
        `${name} must report a shut gate as a policy refusal, never as a missing credential`,
      );
    });
  }
});

describe('honest degradation', () => {
  it('reports the storage source as unavailable rather than omitting or zeroing it', () => {
    const health = unavailableStorageHealth('because the gate is shut');

    assert.equal(health.managementPlane.available, false);
    assert.equal(health.managementPlane.reason, 'because the gate is shut');

    // The rows must be present — an omitted row renders as nothing, and nothing
    // reads as healthy.
    assert.deepEqual(
      health.storageDomains.map((domain) => domain.name).sort(),
      ['app', 'ingestion'],
    );

    // And nothing anywhere in the reading may report a status a viewer would
    // read as healthy.
    assert.equal(health.disk.alertStatus, 'unavailable');
    for (const domain of health.storageDomains) {
      assert.equal(domain.alertStatus, 'unavailable', `${domain.name} must not read as healthy`);
    }
  });

  it('names the gate variable in its reason, so an operator can act on it', () => {
    const source = SOURCE.match(/MANAGEMENT_PLANE_DISABLED_REASON\s*=\s*[\s\S]*?;/)?.[0] ?? '';
    assert.match(source, new RegExp('MANAGEMENT_PLANE_GATE_ENV'));
  });
});
