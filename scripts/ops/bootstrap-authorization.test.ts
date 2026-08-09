import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildBootstrapAdmissionReceipt,
  evaluateBootstrapAuthorization,
  parseAuthorizations,
  partitionViolations,
  resolveBootstrapGovernanceAction,
  type BootstrapAuthorization,
} from './bootstrap-authorization.js';
import { evaluateBranchDiscipline, main as branchDisciplineMain } from './branch-discipline-guard.js';
import { evaluateFileScopeGuard } from '../ci/file-scope-guard.js';

const NOW = new Date('2026-08-05T00:00:00Z');

function grant(overrides: Partial<BootstrapAuthorization> = {}): BootstrapAuthorization {
  return {
    issue_id: 'UTV2-1619',
    lane_type: 'governance',
    tier: 'T2',
    authorized_by: 'griff843',
    authorized_at: '2026-08-05',
    expires_at: '2026-09-05',
    milestone: 'Milestone 1',
    reason: 'admission dependency',
    ...overrides,
  };
}

function file(...authorizations: BootstrapAuthorization[]): string {
  return JSON.stringify({ schema_version: 1, authorizations });
}

test('BA-1: a matching, unexpired governance grant authorizes the named lane', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authorized && result.authorization.issue_id, 'UTV2-1619');
});

test('BA-2: issue id matching is case-insensitive but exact otherwise', () => {
  const lower = evaluateBootstrapAuthorization({
    issueId: 'utv2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(lower.authorized, true);
});

test('BA-3: a grant for one issue does not admit a different issue', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1620',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_for_issue');
});

test('BA-4: a grant does not admit a non-governance lane for the same issue', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'runtime',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'lane_type_not_authorized');
});

test('BA-5: a grant that names a non-governance lane_type authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'runtime',
    authorizationsRaw: file(grant({ lane_type: 'runtime' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'lane_type_not_governance');
});

test('BA-6: an expired grant is refused', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: '2026-08-04' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-7: an expiry exactly at now is expired (boundary fails closed)', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: NOW.toISOString() })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-8: an unparseable expiry is treated as expired, not as no-expiry', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: 'whenever' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-9: a missing authorization file authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: null,
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_file');
});

test('BA-10: malformed JSON authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: '{ not json',
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'malformed_authorization_file');
});

test('BA-11: an entry missing a required field invalidates the whole file', () => {
  const raw = JSON.stringify({
    schema_version: 1,
    authorizations: [{ issue_id: 'UTV2-1619', lane_type: 'governance' }],
  });
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: raw,
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'malformed_authorization_file');
});

test('BA-12: two unexpired grants refuse everything rather than picking one', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1620' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'multiple_active_authorizations');
});

test('BA-13: an expired grant alongside an active one does not trip the accumulation guard', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1620', expires_at: '2026-01-01' })),
    now: NOW,
  });
  assert.equal(result.authorized, true);
});

test('BA-14: an empty authorizations array authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_for_issue');
});

test('BA-18: a missing tier invalidates the file (capability 19)', () => {
  const raw = JSON.stringify({
    schema_version: 1,
    authorizations: [
      {
        issue_id: 'UTV2-1619',
        lane_type: 'governance',
        authorized_by: 'g',
        authorized_at: '2026-08-05',
        expires_at: '2026-09-05',
        milestone: 'm',
        reason: 'r',
      },
    ],
  });
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: raw,
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'malformed_authorization_file');
});

test('BA-19: an invented tier invalidates the file rather than defaulting', () => {
  for (const tier of ['T4', 'TX', 'high', '2', '']) {
    assert.equal(
      parseAuthorizations(file(grant({ tier }))),
      null,
      `tier ${JSON.stringify(tier)} must invalidate the file`,
    );
  }
});

test('BA-20: a valid tier is accepted case-insensitively and preserved', () => {
  const parsed = parseAuthorizations(file(grant({ tier: 't3' })));
  assert.notEqual(parsed, null);
  assert.equal(parsed?.[0]?.tier, 't3');
});

test('BA-15: parseAuthorizations rejects a non-array authorizations field', () => {
  assert.equal(parseAuthorizations('{"authorizations": {}}'), null);
  assert.equal(parseAuthorizations('[]'), null);
  assert.equal(parseAuthorizations('null'), null);
});

test('BA-16: only cap violations are suppressible; structural rules stay blocking', () => {
  const violations = [
    { code: 'total_cap_exceeded', message: 'total' },
    { code: 'claude_cap_exceeded', message: 'claude' },
    { code: 'governance_type_cap_exceeded', message: 'governance' },
    { code: 'codex_cap_exceeded', message: 'codex' },
    { code: 'forbidden_combination', message: 'forbidden' },
    { code: 'singleton_type_conflict', message: 'singleton' },
    { code: 'verification_target_conflict', message: 'target' },
    { code: 'delivery_ui_app_conflict', message: 'ui' },
    { code: 'hygiene_type_cap_exceeded', message: 'hygiene' },
  ];
  const { suppressible, blocking } = partitionViolations(violations);
  assert.deepEqual(
    suppressible.map((v) => v.code),
    ['total_cap_exceeded', 'claude_cap_exceeded', 'governance_type_cap_exceeded', 'codex_cap_exceeded'],
  );
  // hygiene stays blocking: a governance-only authorization must never admit a
  // lane past a cap that belongs to a type it does not cover.
  assert.deepEqual(
    blocking.map((v) => v.code),
    [
      'forbidden_combination',
      'singleton_type_conflict',
      'verification_target_conflict',
      'delivery_ui_app_conflict',
      'hygiene_type_cap_exceeded',
    ],
  );
});

test('BA-17: partitioning an empty violation list yields two empty lists', () => {
  const { suppressible, blocking } = partitionViolations([]);
  assert.deepEqual(suppressible, []);
  assert.deepEqual(blocking, []);
});

test('BA-21: an admission receipt records the grant, its source, and the board', () => {
  const authorization = grant();
  const receipt = buildBootstrapAdmissionReceipt({
    authorization,
    laneType: 'governance',
    branch: 'claude/utv2-1619-x',
    admittedAt: '2026-08-05T00:00:00.000Z',
    sourceSha: 'a'.repeat(40),
    suppressed: [{ code: 'total_cap_exceeded', message: 'total' }],
    remaining: [],
    board: [{ issue_id: 'UTV2-1398', status: 'started' }],
  });
  assert.equal(receipt.kind, 'bootstrap_admission_receipt');
  assert.equal(receipt.issue_id, 'UTV2-1619');
  assert.equal(receipt.tier, 'T2');
  assert.deepEqual(receipt.authorization, authorization);
  assert.equal(receipt.authorization_source.sha, 'a'.repeat(40));
  assert.equal(receipt.authorization_source.path, 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json');
  assert.deepEqual(receipt.suppressed_violations, [{ code: 'total_cap_exceeded', message: 'total' }]);
  assert.equal(receipt.board_at_admission.length, 1);
  // The receipt must say in words that this was not normal admission, so a later
  // reader cannot mistake it for one.
  assert.match(receipt.note, /not assert that normal lane admission occurred/);
});

test('BA-22: an unresolvable authorization source sha is recorded as null, not omitted', () => {
  const receipt = buildBootstrapAdmissionReceipt({
    authorization: grant(),
    laneType: 'governance',
    branch: 'b',
    admittedAt: '2026-08-05T00:00:00.000Z',
    sourceSha: null,
    suppressed: [],
    remaining: [],
    board: [],
  });
  assert.equal(receipt.authorization_source.sha, null);
  assert.ok('sha' in receipt.authorization_source);
});

test('BGA-1: origin/main-authorized bootstrap action resolves with provenance and fixed scope', () => {
  const result = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: file(grant()), baseSourceSha: 'a'.repeat(40), now: NOW,
  });
  assert.equal(result.valid, true);
  assert.equal(result.valid && result.authority_source.ref, 'origin/main');
  assert.equal(result.valid && result.authority_source.sha, 'a'.repeat(40));
});

test('BGA-2: proposed PR-head grant cannot self-authorize without base authority', () => {
  const result = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1686', laneType: 'governance', tier: 'T1',
    changedFiles: ['docs/governance/BOOTSTRAP_AUTHORIZATIONS.json'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: null, baseSourceSha: 'a'.repeat(40),
    proposedAuthorizationsRaw: file(grant({ issue_id: 'UTV2-1686', tier: 'T1' })), now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.code, 'no_authorization_file');
});

test('BGA-3: malformed base grant fails closed', () => {
  const result = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: '{bad', baseSourceSha: 'a'.repeat(40), now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.code, 'malformed_authorization_file');
});

test('BGA-4: multiple active base grants fail closed', () => {
  const result = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1686' })),
    baseSourceSha: 'a'.repeat(40), now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.code, 'multiple_active_authorizations');
});

test('BGA-5: malformed and accumulating proposed grants are payload failures, never authority', () => {
  const malformed = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['docs/governance/BOOTSTRAP_AUTHORIZATIONS.json'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: file(grant()), baseSourceSha: 'a'.repeat(40),
    proposedAuthorizationsRaw: '{bad', now: NOW,
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.valid === false && malformed.code, 'malformed_proposed_authorization');

  const multiple = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['docs/governance/BOOTSTRAP_AUTHORIZATIONS.json'],
    bootstrapIntent: true,
    baseAuthorizationsRaw: file(grant()), baseSourceSha: 'a'.repeat(40),
    proposedAuthorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1686' })), now: NOW,
  });
  assert.equal(multiple.valid, false);
  assert.equal(multiple.valid === false && multiple.code, 'multiple_proposed_active_authorizations');
});

test('BGA-6: normal lane for the granted issue passes as a normal lane', () => {
  const result = resolveBootstrapGovernanceAction({
    issueId: 'UTV2-1619', laneType: 'governance', tier: 'T2',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    bootstrapIntent: true, normalLaneIdentified: true,
    baseAuthorizationsRaw: file(grant()), baseSourceSha: 'a'.repeat(40), now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.recognized, false);
  assert.equal(result.valid === false && result.code, 'normal_lane_identified');
  const guard = evaluateFileScopeGuard({
    prBranch: 'bootstrap/utv2-1619-support',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    manifests: [{
      issue_id: 'UTV2-1619', branch: 'bootstrap/utv2-1619-support', status: 'started',
      file_scope_lock: ['scripts/ops/bootstrap-authorization.ts'],
    }],
    bootstrapAction: result,
  });
  assert.equal(guard.verdict, 'PASS');
  assert.equal(guard.own_manifest_issue, 'UTV2-1619');
});

test('BGA-7: malformed and multiple grants do not break unrelated normal PRs', () => {
  for (const baseAuthorizationsRaw of ['{bad', file(grant(), grant({ issue_id: 'UTV2-1686' }))]) {
    const result = resolveBootstrapGovernanceAction({
      issueId: 'UTV2-1701', laneType: 'governance', tier: 'T2',
      changedFiles: ['apps/api/src/server.ts'], bootstrapIntent: false,
      baseAuthorizationsRaw, baseSourceSha: 'a'.repeat(40), now: NOW,
    });
    assert.equal(result.valid, false);
    assert.equal(result.recognized, false);
    assert.equal(result.valid === false && result.code, 'bootstrap_intent_absent');
    const guard = evaluateFileScopeGuard({
      prBranch: 'codex/utv2-1701-normal', changedFiles: ['apps/api/src/server.ts'],
      manifests: [{
        issue_id: 'UTV2-1701', branch: 'codex/utv2-1701-normal', status: 'started',
        file_scope_lock: ['apps/api/src/server.ts'],
      }],
      bootstrapAction: result,
    });
    assert.equal(guard.verdict, 'PASS');
  }
});

test('BGA-8: every bootstrap consumer executes the resolver extracted from origin/main', () => {
  for (const workflow of [
    '.github/workflows/file-scope-lock-check.yml',
    '.github/workflows/return-review-packet.yml',
    '.github/workflows/branch-discipline-guard.yml',
  ]) {
    const source = fs.readFileSync(workflow, 'utf8');
    assert.match(
      source,
      /git show "origin\/main:scripts\/ops\/bootstrap-authorization\.ts" > \.out\/trusted-bootstrap-authorization\.ts/,
      `${workflow} must materialize the resolver from origin/main`,
    );
    assert.match(
      source,
      /pnpm exec tsx \.out\/trusted-bootstrap-authorization\.ts/,
      `${workflow} must execute the trusted resolver copy`,
    );
    assert.doesNotMatch(
      source,
      /pnpm exec tsx scripts\/ops\/bootstrap-authorization\.ts/,
      `${workflow} must not execute the PR-head resolver`,
    );
  }
});

test('BGA-9: fabricated bootstrap decision file fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1619-fabricated-'));
  const decision = path.join(dir, 'decision.json');
  fs.writeFileSync(decision, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action', issue_id: 'UTV2-1619',
    allowed_scope: ['scripts/ops/bootstrap-authorization.ts'],
  }));
  const exitCode = branchDisciplineMain([
    '--title', 'UTV2-1619 bootstrap', '--branch', 'bootstrap/utv2-1619-test',
    '--commits', 'UTV2-1619', '--bootstrap-action-file', decision, '--json',
  ]);
  assert.equal(exitCode, 1);
});

test('BGA-10: bootstrap decision with authority SHA mismatch fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1619-sha-'));
  const decision = path.join(dir, 'decision.json');
  fs.writeFileSync(decision, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action', issue_id: 'UTV2-1619',
    allowed_scope: ['scripts/ops/bootstrap-authorization.ts'],
    authority_source: {
      ref: 'origin/main', sha: '0'.repeat(40), path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json',
    },
  }));
  const exitCode = branchDisciplineMain([
    '--title', 'UTV2-1619 bootstrap', '--branch', 'bootstrap/utv2-1619-test',
    '--commits', 'UTV2-1619', '--bootstrap-action-file', decision, '--json',
  ]);
  assert.equal(exitCode, 1);
});

test('BGA-6: branch discipline separates action identity from recovery references', () => {
  const result = evaluateBranchDiscipline({
    branch: 'bootstrap/utv2-1619-support',
    title: 'UTV2-1619: support bootstrap actions',
    commits: 'feat(ops): UTV2-1619 support bootstrap identity',
    body: 'Rotates a future grant for UTV2-1686 to recover UTV2-1627.',
    bootstrapAction: {
      recognized: true, valid: true, kind: 'bootstrap_governance_action', issue_id: 'UTV2-1619',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'bootstrap_action');
  assert.deepEqual(result.issue_ids, ['UTV2-1619', 'UTV2-1627', 'UTV2-1686']);
});

test('BGA-7: branch discipline rejects malformed bootstrap decision and foreign binding identity', () => {
  const malformed = evaluateBranchDiscipline({
    branch: 'bootstrap/utv2-1619-support', title: 'UTV2-1619: support', commits: 'UTV2-1619',
    bootstrapAction: { recognized: true, valid: false, kind: 'bootstrap_governance_action', message: 'malformed grant' },
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.errors.join('\n'), /malformed grant/);

  const foreign = evaluateBranchDiscipline({
    branch: 'bootstrap/utv2-1619-support', title: 'UTV2-1686: self authorize', commits: 'UTV2-1686',
    bootstrapAction: { recognized: true, valid: true, kind: 'bootstrap_governance_action', issue_id: 'UTV2-1619' },
  });
  assert.equal(foreign.ok, false);
  assert.match(foreign.errors.join('\n'), /must bind only UTV2-1619/);
});

test('BGA-8: ordinary branch discipline remains unchanged without recognized bootstrap authority', () => {
  const result = evaluateBranchDiscipline({
    branch: 'codex/utv2-1701-normal', title: 'UTV2-1701: normal', commits: 'UTV2-1701',
    bootstrapAction: { recognized: false, valid: false, kind: 'bootstrap_governance_action' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'single_issue_reference');
});
