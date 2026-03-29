import { loadCommandRegistry } from './command-registry.js';

export async function buildCommandManifest(rootDir?: string) {
  const registry = await loadCommandRegistry(rootDir);

  return [...registry.values()]
    .map((command) => command.data.toJSON())
    .sort((left, right) => left.name.localeCompare(right.name));
}
