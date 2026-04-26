import type { Persona } from '../core/types.js';

export const personas: Record<string, Persona> = {
  free_user: {
    id: 'free_user',
    displayName: 'Free User',
    memberTier: 'free',
    capabilities: ['view_public_content'],
    discordRoles: [],
  },
  free: {
    id: 'free',
    displayName: 'Free User',
    memberTier: 'free',
    capabilities: ['view_public_content'],
    discordRoles: [],
  },
  trial_user: {
    id: 'trial_user',
    displayName: 'Trial User',
    memberTier: 'trial',
    capabilities: ['view_public_content', 'view_trial_picks'],
    discordRoles: ['trial'],
  },
  vip_user: {
    id: 'vip_user',
    displayName: 'VIP User',
    memberTier: 'vip',
    capabilities: ['view_public_content', 'view_trial_picks', 'view_vip_picks', 'submit_picks'],
    discordRoles: ['vip'],
  },
  vip: {
    id: 'vip',
    displayName: 'VIP User',
    memberTier: 'vip',
    capabilities: ['view_public_content', 'view_trial_picks', 'view_vip_picks', 'submit_picks'],
    discordRoles: ['vip'],
  },
  vip_plus_user: {
    id: 'vip_plus_user',
    displayName: 'VIP+ User',
    memberTier: 'vip-plus',
    capabilities: [
      'view_public_content',
      'view_trial_picks',
      'view_vip_picks',
      'view_vip_plus_picks',
      'submit_picks',
    ],
    discordRoles: ['vip', 'vip-plus'],
  },
  capper: {
    id: 'capper',
    displayName: 'Capper',
    memberTier: 'capper',
    capabilities: ['view_public_content', 'view_all_picks', 'submit_picks', 'capper_dashboard'],
    discordRoles: ['capper'],
  },
  operator: {
    id: 'operator',
    displayName: 'Operator',
    memberTier: 'operator',
    capabilities: [
      'view_all',
      'submit_picks',
      'settle_picks',
      'manage_users',
      'command_center',
      'operator_override',
    ],
    credentials: {
      apiKey: process.env['UNIT_TALK_API_KEY_OPERATOR'],
    },
  },
  admin: {
    id: 'admin',
    displayName: 'Admin',
    memberTier: 'admin',
    capabilities: [
      'view_all',
      'submit_picks',
      'settle_picks',
      'manage_users',
      'command_center',
      'operator_override',
      'system_config',
    ],
    credentials: {
      apiKey: process.env['UNIT_TALK_API_KEY_OPERATOR'],
    },
  },
};

export function getPersona(id: string): Persona {
  const persona = personas[id];
  if (!persona) {
    throw new Error(`Unknown persona: "${id}". Available: ${Object.keys(personas).join(', ')}`);
  }
  return persona;
}
