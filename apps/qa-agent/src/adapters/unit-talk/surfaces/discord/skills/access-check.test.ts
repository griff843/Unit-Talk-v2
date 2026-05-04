import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateQaPersonaVisibility } from './access-check.js';

test('free_user sees only public sandbox QA channels', () => {
  const evaluation = evaluateQaPersonaVisibility({
    personaId: 'free_user',
    guildId: '1195598141026742343',
    qaMap: baseQaMap(),
    roles: baseRoles(),
    channels: baseChannels(),
  });

  assert.deepEqual(evaluation.snapshot.actualVisible, ['qaAccessCheck', 'freePicks', 'recap']);
  assert.deepEqual(evaluation.snapshot.missingChannels, []);
  assert.deepEqual(evaluation.snapshot.leakedChannels, []);
});

test('no_access sees no QA sandbox channels', () => {
  const evaluation = evaluateQaPersonaVisibility({
    personaId: 'no_access',
    guildId: '1195598141026742343',
    qaMap: baseQaMap(),
    roles: baseRoles(),
    channels: baseChannels(),
  });

  assert.deepEqual(evaluation.snapshot.actualVisible, []);
  assert.deepEqual(evaluation.snapshot.missingChannels, []);
  assert.deepEqual(evaluation.snapshot.leakedChannels, []);
});

test('vip_plus_user sees vip-plus but not admin-only channels', () => {
  const evaluation = evaluateQaPersonaVisibility({
    personaId: 'vip_plus_user',
    guildId: '1195598141026742343',
    qaMap: baseQaMap(),
    roles: baseRoles(),
    channels: baseChannels(),
  });

  assert.deepEqual(
    evaluation.snapshot.actualVisible,
    ['qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'vipPlusPicks', 'recap'],
  );
  assert.deepEqual(evaluation.snapshot.missingChannels, []);
  assert.deepEqual(evaluation.snapshot.leakedChannels, []);
});

function baseQaMap() {
  return {
    guildId: '1195598141026742343',
    roles: {
      admin: 'admin-role',
      operator: 'operator-role',
      capper: 'capper-role',
      vip: 'vip-role',
      vipPlus: 'vip-plus-role',
      free: 'free-role',
      noAccess: 'no-access-role',
    },
    channels: {
      qaBotLog: 'qa-bot-log',
      qaAccessCheck: 'qa-access-check',
      qaPickDelivery: 'qa-pick-delivery',
      freePicks: 'free-picks',
      vipPicks: 'vip-picks',
      vipPlusPicks: 'vip-plus-picks',
      adminOps: 'admin-ops',
      recap: 'recap',
    },
  };
}

function baseRoles() {
  const none = '0';
  const view = '1024';
  return [
    { id: '1195598141026742343', name: '@everyone', permissions: none },
    { id: 'admin-role', name: 'QA_Admin', permissions: view },
    { id: 'operator-role', name: 'QA_Operator', permissions: view },
    { id: 'capper-role', name: 'QA_Capper', permissions: view },
    { id: 'vip-role', name: 'QA_VIP', permissions: view },
    { id: 'vip-plus-role', name: 'QA_VIPPlus', permissions: view },
    { id: 'free-role', name: 'QA_Free', permissions: view },
    { id: 'no-access-role', name: 'QA_NoAccess', permissions: view },
  ];
}

function baseChannels() {
  const categoryOverwrites = [
    everyoneHidden(),
    allow('admin-role'),
    allow('operator-role'),
    allow('capper-role'),
    allow('vip-role'),
    allow('vip-plus-role'),
    allow('free-role'),
  ];

  return [
    {
      id: 'qa-sandbox-category',
      type: 4,
      name: 'QA SANDBOX',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'qa-bot-log',
      type: 0,
      name: 'qa-bot-log',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role')],
    },
    {
      id: 'qa-access-check',
      type: 0,
      name: 'qa-access-check',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'qa-pick-delivery',
      type: 0,
      name: 'qa-pick-delivery',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-role'), allow('vip-plus-role')],
    },
    {
      id: 'free-picks',
      type: 0,
      name: 'free-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'vip-picks',
      type: 0,
      name: 'vip-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-role'), allow('vip-plus-role')],
    },
    {
      id: 'vip-plus-picks',
      type: 0,
      name: 'vip-plus-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-plus-role')],
    },
    {
      id: 'admin-ops',
      type: 0,
      name: 'admin-ops',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role')],
    },
    {
      id: 'recap',
      type: 0,
      name: 'recap',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
  ];
}

function everyoneHidden() {
  return { id: '1195598141026742343', type: 0 as const, allow: '0', deny: '1024' };
}

function allow(roleId: string) {
  return { id: roleId, type: 0 as const, allow: '1024', deny: '0' };
}
