import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_SCENARIOS } from './definitions.js';
import type { ScenarioDefinition, ScenarioMode } from './types.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ScenarioRegistry {
  private readonly scenarios = new Map<string, ScenarioDefinition>();

  register(definition: ScenarioDefinition): void {
    this.scenarios.set(definition.id, definition);
  }

  get(id: string): ScenarioDefinition | undefined {
    return this.scenarios.get(id);
  }

  getAll(): ScenarioDefinition[] {
    return Array.from(this.scenarios.values());
  }

  getByMode(mode: ScenarioMode): ScenarioDefinition[] {
    return this.getAll().filter(definition => definition.mode === mode);
  }

  getByTag(tag: string): ScenarioDefinition[] {
    return this.getAll().filter(definition => definition.tags.includes(tag));
  }

  getFixturePath(id: string): string | undefined {
    const fixture = this.get(id)?.fixturePath;
    return fixture ? join(PACKAGE_ROOT, 'test-fixtures', fixture) : undefined;
  }
}

export const DEFAULT_REGISTRY = new ScenarioRegistry();

for (const scenario of CORE_SCENARIOS) {
  DEFAULT_REGISTRY.register(scenario);
}
