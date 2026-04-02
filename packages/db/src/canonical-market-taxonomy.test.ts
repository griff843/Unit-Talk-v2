import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTables } from './index.js';
import { canonicalSchema } from './schema.js';

test('canonical table registry includes canonical market taxonomy tables', () => {
  for (const table of [
    'selection_types',
    'market_families',
    'market_types',
    'sport_market_type_availability',
    'combo_stat_types',
    'combo_stat_type_components',
    'provider_entity_aliases',
    'provider_market_aliases',
    'provider_book_aliases',
  ]) {
    assert.ok(canonicalTables.includes(table as (typeof canonicalTables)[number]));
  }
});

test('canonical schema metadata includes expected owners for market taxonomy tables', () => {
  const selectionTypes = canonicalSchema.find((row) => row.name === 'selection_types');
  const marketFamilies = canonicalSchema.find((row) => row.name === 'market_families');
  const marketTypes = canonicalSchema.find((row) => row.name === 'market_types');
  const availability = canonicalSchema.find((row) => row.name === 'sport_market_type_availability');
  const comboStats = canonicalSchema.find((row) => row.name === 'combo_stat_types');
  const comboComponents = canonicalSchema.find((row) => row.name === 'combo_stat_type_components');
  const entityAliases = canonicalSchema.find((row) => row.name === 'provider_entity_aliases');
  const marketAliases = canonicalSchema.find((row) => row.name === 'provider_market_aliases');
  const bookAliases = canonicalSchema.find((row) => row.name === 'provider_book_aliases');

  assert.ok(selectionTypes);
  assert.equal(selectionTypes.owner, 'platform');
  assert.ok(marketFamilies);
  assert.equal(marketFamilies.owner, 'platform');
  assert.ok(marketTypes);
  assert.equal(marketTypes.owner, 'platform');
  assert.ok(availability);
  assert.equal(availability.owner, 'platform');
  assert.ok(comboStats);
  assert.equal(comboStats.owner, 'platform');
  assert.ok(comboComponents);
  assert.equal(comboComponents.owner, 'platform');
  assert.ok(entityAliases);
  assert.equal(entityAliases.owner, 'ingestor');
  assert.ok(marketAliases);
  assert.equal(marketAliases.owner, 'ingestor');
  assert.ok(bookAliases);
  assert.equal(bookAliases.owner, 'ingestor');
});
