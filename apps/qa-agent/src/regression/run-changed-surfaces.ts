import { execSync } from 'node:child_process';

export interface SurfaceTarget {
  product: string;
  surface: string;
  flow: string;
  persona: string;
}

const FILE_SURFACE_MAP: Array<{ pattern: RegExp; targets: SurfaceTarget[] }> = [
  {
    pattern: /^apps\/command-center\//,
    targets: [{ product: 'unit-talk', surface: 'command_center', flow: 'daily_ops', persona: 'operator' }],
  },
  {
    pattern: /^apps\/smart-form\//,
    targets: [{ product: 'unit-talk', surface: 'smart_form', flow: 'submit_pick', persona: 'operator' }],
  },
  {
    pattern: /^apps\/discord-bot\//,
    targets: [
      { product: 'unit-talk', surface: 'discord', flow: 'access_check', persona: 'free_user' },
      { product: 'unit-talk', surface: 'discord', flow: 'pick_delivery', persona: 'vip_user' },
    ],
  },
  {
    pattern: /^apps\/worker\//,
    targets: [{ product: 'unit-talk', surface: 'discord', flow: 'pick_delivery', persona: 'vip_user' }],
  },
  {
    pattern: /^packages\/contracts\//,
    targets: [
      { product: 'unit-talk', surface: 'command_center', flow: 'daily_ops', persona: 'operator' },
      { product: 'unit-talk', surface: 'smart_form', flow: 'submit_pick', persona: 'operator' },
    ],
  },
];

export function getChangedSurfaces(compareBranch = 'main'): SurfaceTarget[] {
  let changedFiles: string[] = [];
  try {
    const output = execSync(`git diff --name-only ${compareBranch}...HEAD`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    changedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    return getAllDefaultTargets();
  }

  const seen = new Set<string>();
  const targets: SurfaceTarget[] = [];

  for (const file of changedFiles) {
    for (const { pattern, targets: mappedTargets } of FILE_SURFACE_MAP) {
      if (pattern.test(file)) {
        for (const t of mappedTargets) {
          const key = `${t.product}/${t.surface}/${t.flow}/${t.persona}`;
          if (!seen.has(key)) {
            seen.add(key);
            targets.push(t);
          }
        }
      }
    }
  }

  return targets.length > 0 ? targets : getAllDefaultTargets();
}

function getAllDefaultTargets(): SurfaceTarget[] {
  return [
    { product: 'unit-talk', surface: 'command_center', flow: 'daily_ops', persona: 'operator' },
    { product: 'unit-talk', surface: 'smart_form', flow: 'submit_pick', persona: 'operator' },
    { product: 'unit-talk', surface: 'discord', flow: 'access_check', persona: 'free_user' },
  ];
}
