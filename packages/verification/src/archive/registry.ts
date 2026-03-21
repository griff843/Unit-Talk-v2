import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_REPLAY_PACKS } from './replay-packs.js';
import { CORE_ARCHIVE_SOURCES } from './sources.js';
import type {
  ArchiveSource,
  ArchiveSourceType,
  ReplayPurpose,
  ReplayRegistryEntry
} from './types.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ArchiveRegistry {
  private readonly sources = new Map<string, ArchiveSource>();
  private readonly packs = new Map<string, ReplayRegistryEntry>();

  registerSource(source: ArchiveSource): void {
    this.sources.set(source.id, source);
  }

  registerReplayPack(entry: ReplayRegistryEntry): void {
    this.packs.set(entry.id, entry);
  }

  getSource(id: string): ArchiveSource | undefined {
    return this.sources.get(id);
  }

  getReplayPack(id: string): ReplayRegistryEntry | undefined {
    return this.packs.get(id);
  }

  getAllSources(): ArchiveSource[] {
    return Array.from(this.sources.values());
  }

  getAllReplayPacks(): ReplayRegistryEntry[] {
    return Array.from(this.packs.values());
  }

  getSourcesByType(type: ArchiveSourceType): ArchiveSource[] {
    return this.getAllSources().filter(source => source.type === type);
  }

  getReplayPacksByPurpose(purpose: ReplayPurpose): ReplayRegistryEntry[] {
    return this.getAllReplayPacks().filter(pack => pack.suitableFor.includes(purpose));
  }

  getFixturePath(sourceId: string): string {
    const source = this.getSource(sourceId);
    if (!source) {
      throw new Error(`ArchiveRegistry: unknown source '${sourceId}'`);
    }

    return join(PACKAGE_ROOT, 'test-fixtures', source.fixturePath);
  }
}

export const DEFAULT_ARCHIVE_REGISTRY = new ArchiveRegistry();

for (const source of CORE_ARCHIVE_SOURCES) {
  DEFAULT_ARCHIVE_REGISTRY.registerSource(source);
}

for (const pack of CORE_REPLAY_PACKS) {
  DEFAULT_ARCHIVE_REGISTRY.registerReplayPack(pack);
}
