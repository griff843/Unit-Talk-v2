import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryMemberTierRepository } from '@unit-talk/db';
import type { AuditLogCreateInput, AuditLogRepository, AuditLogRow, Json } from '@unit-talk/db';
import { runTrialExpiryPass } from './trial-expiry-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TrackingAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogRow[] = [];
  private nextId = 1;

  async record(input: AuditLogCreateInput): Promise<AuditLogRow> {
    const row: AuditLogRow = {
      id: `audit-${this.nextId++}`,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      action: input.action,
      actor: input.actor ?? null,
      payload: input.payload as Json,
      created_at: new Date().toISOString(),
    };
    this.entries.push(row);
    return row;
  }
}

function makeIso(offsetDays: number, base: Date = new Date('2026-03-29T12:00:00Z')): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

const NOW = '2026-03-29T12:00:00.000Z';

async function activateTrialWithExpiry(
  repo: InMemoryMemberTierRepository,
  discordId: string,
  effectiveUntil: Date | null,
) {
  return repo.activateTier({
    discordId,
    tier: 'trial',
    source: 'system',
    changedBy: 'test',
    effectiveUntil,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('runTrialExpiryPass: expired trial row is deactivated and audit entry written', async () => {
  const tierRepo = new InMemoryMemberTierRepository();
  const auditRepo = new TrackingAuditLogRepository();

  // Activate a trial that expired 1 day ago
  await activateTrialWithExpiry(tierRepo, 'user-001', new Date(makeIso(-1)));

  const result = await runTrialExpiryPass(tierRepo, auditRepo, NOW);

  assert.equal(result.expired, 1);

  // The tier row should now be deactivated (effective_until set)
  const activeTiers = await tierRepo.getActiveTiers('user-001');
  assert.equal(activeTiers.length, 0, 'expired trial should have been deactivated');

  // An audit entry should have been written
  assert.equal(auditRepo.entries.length, 1);
  assert.equal(auditRepo.entries[0]?.action, 'member_tier.trial_expired');
  assert.equal(auditRepo.entries[0]?.entity_ref, 'user-001');
});

test('runTrialExpiryPass: non-expired trial row is NOT deactivated', async () => {
  const tierRepo = new InMemoryMemberTierRepository();
  const auditRepo = new TrackingAuditLogRepository();

  // Activate a trial that expires 3 days in the future
  await activateTrialWithExpiry(tierRepo, 'user-002', new Date(makeIso(3)));

  const result = await runTrialExpiryPass(tierRepo, auditRepo, NOW);

  assert.equal(result.expired, 0);

  // Tier row should still be active
  const activeTiers = await tierRepo.getActiveTiers('user-002');
  assert.equal(activeTiers.length, 1, 'non-expired trial should remain active');

  assert.equal(auditRepo.entries.length, 0, 'no audit entries should be written');
});

test('runTrialExpiryPass: returns expired:0 when there are no rows at all', async () => {
  const tierRepo = new InMemoryMemberTierRepository();
  const auditRepo = new TrackingAuditLogRepository();

  const result = await runTrialExpiryPass(tierRepo, auditRepo, NOW);

  assert.equal(result.expired, 0);
  assert.equal(auditRepo.entries.length, 0);
});

test('runTrialExpiryPass: multiple expired rows are all deactivated', async () => {
  const tierRepo = new InMemoryMemberTierRepository();
  const auditRepo = new TrackingAuditLogRepository();

  // Three expired trials
  await activateTrialWithExpiry(tierRepo, 'user-a', new Date(makeIso(-7)));
  await activateTrialWithExpiry(tierRepo, 'user-b', new Date(makeIso(-3)));
  await activateTrialWithExpiry(tierRepo, 'user-c', new Date(makeIso(-1)));

  // One still-active trial (not yet expired)
  await activateTrialWithExpiry(tierRepo, 'user-d', new Date(makeIso(1)));

  const result = await runTrialExpiryPass(tierRepo, auditRepo, NOW);

  assert.equal(result.expired, 3);

  // All expired users deactivated
  for (const id of ['user-a', 'user-b', 'user-c']) {
    const active = await tierRepo.getActiveTiers(id);
    assert.equal(active.length, 0, `${id} should have been deactivated`);
  }

  // Active user untouched
  const stillActive = await tierRepo.getActiveTiers('user-d');
  assert.equal(stillActive.length, 1, 'user-d should remain active');

  // Three audit entries, all for trial_expired
  assert.equal(auditRepo.entries.length, 3);
  for (const audit of auditRepo.entries) {
    assert.equal(audit.action, 'member_tier.trial_expired');
  }
});
