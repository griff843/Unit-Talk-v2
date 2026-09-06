import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  MANAGEMENT_PLANE_GATE_ENV,
  getStorageHealth,
  isManagementPlaneEnabled,
  unavailableStorageHealth,
} from './storage-health.js';

/**
 * These tests exist to prove one thing that the rendered output cannot show:
 * with the gate shut, **no Supabase Management API request is issued at all**.
 *
 * So every assertion below is on the recorded call list of a `fetch` double,
 * not on the returned object's field values. A test that only inspected the
 * return value would pass just as happily against an implementation that made
 * all seven requests and then threw the answers away.
 */

interface RecordedCall {
  url: string;
  method: string;
}

let calls: RecordedCall[] = [];
let originalFetch: typeof globalThis.fetch | undefined;
let originalGate: string | undefined;

function installFetchRecorder(respond: (url: string) => unknown): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    calls.push({ url, method: init?.method ?? 'GET' });
    return {
      ok: true,
      status: 200,
      json: async () => respond(url),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

function managementCalls(): RecordedCall[] {
  return calls.filter((call) => call.url.startsWith('https://api.supabase.com/'));
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

  it('opens only for "true", trimmed and case-insensitive', () => {
    for (const value of ['true', 'TRUE', ' true ', 'True']) {
      assert.equal(
        isManagementPlaneEnabled({ [MANAGEMENT_PLANE_GATE_ENV]: value }),
        true,
        `gate must open for ${JSON.stringify(value)}`,
      );
    }
  });
});

describe('getStorageHealth with the gate shut', () => {
  it('issues no Supabase Management API request', async () => {
    delete process.env[MANAGEMENT_PLANE_GATE_ENV];
    installFetchRecorder(() => ({}));

    await getStorageHealth();

    assert.deepEqual(
      managementCalls(),
      [],
      'a shut gate must produce zero management-plane requests',
    );
  });

  it('issues no request for any non-"true" gate value either', async () => {
    for (const value of ['false', '1', 'yes', '']) {
      calls = [];
      process.env[MANAGEMENT_PLANE_GATE_ENV] = value;
      installFetchRecorder(() => ({}));

      await getStorageHealth();

      assert.deepEqual(
        managementCalls(),
        [],
        `gate value ${JSON.stringify(value)} must produce zero management-plane requests`,
      );
    }
  });

  it('reports the storage source as unavailable rather than omitting or zeroing it', async () => {
    delete process.env[MANAGEMENT_PLANE_GATE_ENV];
    installFetchRecorder(() => ({}));

    const health = await getStorageHealth();

    assert.equal(health.managementPlane.available, false);
    assert.match(health.managementPlane.reason, /disabled/i);
    assert.match(health.managementPlane.reason, new RegExp(MANAGEMENT_PLANE_GATE_ENV));

    // The rows must be present — an omitted row renders as nothing, and nothing
    // reads as healthy.
    assert.deepEqual(
      health.storageDomains.map((domain) => domain.name).sort(),
      ['app', 'ingestion'],
    );

    // And nothing anywhere in the reading may claim a healthy status.
    assert.equal(health.disk.alertStatus, 'unavailable');
    for (const domain of health.storageDomains) {
      assert.equal(
        domain.alertStatus,
        'unavailable',
        `${domain.name} must not report a status a viewer would read as healthy`,
      );
    }
  });
});

describe('getStorageHealth with the gate open', () => {
  it('does issue management-plane requests, so the refusal is conditional and not unconditional', async () => {
    process.env[MANAGEMENT_PLANE_GATE_ENV] = 'true';
    process.env['SUPABASE_ACCESS_TOKEN'] = 'test-access-token';
    process.env['SUPABASE_PROJECT_REF'] = 'testprojectref00000';

    installFetchRecorder((url) => {
      if (url.endsWith('/config/disk')) {
        return { attributes: { size_gb: 8, iops: 100, throughput_mibps: 50, type: 'gp3' } };
      }
      if (url.endsWith('/config/disk/util')) {
        return {
          timestamp: '2026-09-05T00:00:00.000Z',
          metrics: { fs_size_bytes: 100, fs_used_bytes: 40, fs_avail_bytes: 60 },
        };
      }
      if (url.endsWith('/database/backups')) {
        return { pitr_enabled: true, walg_enabled: true, backups: [] };
      }
      if (url.endsWith('/restore')) {
        return { available_versions: [] };
      }
      // The three registered SQL statements all return row arrays.
      return [];
    });

    try {
      const health = await getStorageHealth();

      assert.ok(
        managementCalls().length > 0,
        'an open gate must reach the management plane — otherwise the shut-gate test above proves nothing',
      );
      assert.ok(
        managementCalls().some(
          (call) => call.url.endsWith('/database/query') && call.method === 'POST',
        ),
        'the SQL route in particular must be reachable when the gate is open',
      );
      assert.equal(health.managementPlane.available, true);
    } finally {
      delete process.env['SUPABASE_ACCESS_TOKEN'];
      delete process.env['SUPABASE_PROJECT_REF'];
    }
  });
});

describe('unavailableStorageHealth', () => {
  it('never returns a status that reads as healthy', () => {
    const health = unavailableStorageHealth('because the gate is shut');
    assert.equal(health.disk.alertStatus, 'unavailable');
    assert.equal(health.managementPlane.available, false);
    assert.equal(health.managementPlane.reason, 'because the gate is shut');
    assert.equal(
      health.storageDomains.some((domain) => domain.alertStatus === 'stable'),
      false,
    );
  });
});
