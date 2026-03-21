export const canonicalWriter = 'api' as const;

export const writerRoles = [
  'submitter',
  'promoter',
  'poster',
  'settler',
  'operator_override',
] as const;

export type WriterRole = (typeof writerRoles)[number];

export * from './distribution.js';
export * from './submission.js';
export * from './picks.js';
export * from './promotion.js';
export * from './settlement.js';
