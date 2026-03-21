export const workspaceConfig = {
  activeWorkspace: 'C:\\dev\\unit-talk-v2',
  legacyWorkspace: 'C:\\dev\\unit-talk-production',
  docsRoot: 'docs',
} as const;

export type WorkspaceConfig = typeof workspaceConfig;

export * from './env.js';
