import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRoleExistsFinding,
  evaluateSuperuserFinding,
  REQUIRED_ROLES,
} from './db-role-validator.js';

test('evaluateSuperuserFinding returns CRITICAL when connection is superuser', () => {
  const finding = evaluateSuperuserFinding(true, 'postgres');
  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.check, 'superuser');
  assert.match(finding.message, /superuser privileges/);
  assert.match(finding.message, /postgres/);
});

test('evaluateSuperuserFinding returns OK for non-superuser connection', () => {
  const finding = evaluateSuperuserFinding(false, 'ut_app_runtime');
  assert.equal(finding.level, 'OK');
  assert.equal(finding.check, 'superuser');
  assert.match(finding.message, /not superuser/);
  assert.equal(finding.subject, 'ut_app_runtime');
});

test('evaluateRoleExistsFinding returns CRITICAL when role does not exist', () => {
  const finding = evaluateRoleExistsFinding('app_user', false);
  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.check, 'role_exists');
  assert.match(finding.message, /does not exist/);
  assert.equal(finding.subject, 'app_user');
});

test('evaluateRoleExistsFinding returns OK when role exists', () => {
  const finding = evaluateRoleExistsFinding('ingestion_writer', true);
  assert.equal(finding.level, 'OK');
  assert.equal(finding.check, 'role_exists');
  assert.equal(finding.subject, 'ingestion_writer');
});

test('REQUIRED_ROLES includes all five expected group roles', () => {
  assert.ok(REQUIRED_ROLES.includes('app_user'));
  assert.ok(REQUIRED_ROLES.includes('ingestion_writer'));
  assert.ok(REQUIRED_ROLES.includes('scanner_user'));
  assert.ok(REQUIRED_ROLES.includes('metrics_user'));
  assert.ok(REQUIRED_ROLES.includes('migration_owner'));
  assert.equal(REQUIRED_ROLES.length, 5);
});

test('all REQUIRED_ROLES produce CRITICAL findings when they do not exist', () => {
  for (const role of REQUIRED_ROLES) {
    const finding = evaluateRoleExistsFinding(role, false);
    assert.equal(finding.level, 'CRITICAL', `Expected CRITICAL for missing role: ${role}`);
  }
});
