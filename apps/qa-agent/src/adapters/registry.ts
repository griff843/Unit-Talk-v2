import { unitTalkAdapter } from './unit-talk/index.js';
import type { ProductAdapter } from '../core/types.js';

const registry: Record<string, ProductAdapter> = {
  'unit-talk': unitTalkAdapter,
  // 'poker-os': pokerOsAdapter,   ← add future product adapters here
  // 'chess-app': chessAppAdapter,
};

export function getAdapter(productId: string): ProductAdapter {
  const adapter = registry[productId];
  if (!adapter) {
    throw new Error(`Unknown product: "${productId}". Available: ${Object.keys(registry).join(', ')}`);
  }
  return adapter;
}

export function listProducts(): string[] {
  return Object.keys(registry);
}
