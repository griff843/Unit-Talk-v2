import { pathToFileURL } from 'node:url';
import { createServiceRoleDatabaseConnectionConfig, createDatabaseClientFromConnection } from '../packages/db/src/client.js';

type CliOptions = {
  apply: boolean;
};

type MarketUniverseRow = {
  id: string;
  provider_participant_id: string | null;
};

type ParticipantRow = {
  id: string;
  external_id: string | null;
  display_name: string | null;
};

type ProviderEntityAliasRow = {
  provider_entity_key: string;
};

const client = createDatabaseClientFromConnection(createServiceRoleDatabaseConnectionConfig());

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  const unresolvedRows = await fetchUnresolvedUniverseRows();
  const externalIds = unique(
    unresolvedRows
      .map((row) => row.provider_participant_id)
      .filter((value): value is string => value !== null),
  );
  const participants = await fetchParticipantsByExternalId(externalIds);
  const participantByExternalId = new Map(
    participants
      .filter((row): row is ParticipantRow & { external_id: string } => row.external_id !== null)
      .map((row) => [row.external_id, row]),
  );
  const existingAliases = await fetchExistingAliasKeys(externalIds);

  const aliasRowsToInsert = externalIds
    .filter((externalId) => !existingAliases.has(externalId))
    .map((externalId) => participantByExternalId.get(externalId))
    .filter((row): row is ParticipantRow & { external_id: string } => row !== undefined && row.external_id !== null)
    .map((row) => ({
      provider: 'sgo',
      entity_kind: 'player',
      provider_entity_key: row.external_id,
      provider_entity_id: row.external_id,
      provider_display_name: row.display_name ?? row.external_id,
      participant_id: row.id,
      metadata: {},
    }));

  const universeRowsToUpdate = unresolvedRows
    .map((row) => {
      const externalId = row.provider_participant_id;
      const participant = externalId ? participantByExternalId.get(externalId) : undefined;
      if (!participant) return null;
      return { id: row.id, participant_id: participant.id };
    })
    .filter((row): row is { id: string; participant_id: string } => row !== null);

  console.log('=== SGO participant alias backfill ===');
  console.log(`Unresolved market_universe rows: ${unresolvedRows.length}`);
  console.log(`Distinct provider_participant_id keys: ${externalIds.length}`);
  console.log(`Participants matched by external_id: ${participants.length}`);
  console.log(`Missing provider_entity_aliases rows: ${aliasRowsToInsert.length}`);
  console.log(`market_universe rows to update: ${universeRowsToUpdate.length}`);

  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to persist changes.');
    return;
  }

  if (aliasRowsToInsert.length > 0) {
    const { error } = await client.from('provider_entity_aliases').insert(aliasRowsToInsert);
    if (error) throw new Error(`Failed to insert provider_entity_aliases rows: ${error.message}`);
  }

  for (const batch of chunk(universeRowsToUpdate, 200)) {
    const results = await Promise.all(
      batch.map(async (row) => {
        const { error } = await client
          .from('market_universe')
          .update({ participant_id: row.participant_id })
          .eq('id', row.id);
        if (error) {
          throw new Error(`Failed to update market_universe ${row.id}: ${error.message}`);
        }
      }),
    );
    void results;
  }

  console.log('Backfill applied.');
}

async function fetchUnresolvedUniverseRows(): Promise<MarketUniverseRow[]> {
  const rows: MarketUniverseRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('market_universe')
      .select('id,provider_participant_id')
      .eq('provider_key', 'sgo')
      .not('provider_participant_id', 'is', null)
      .is('participant_id', null)
      .range(from, from + 999);
    if (error) throw new Error(`Failed to load unresolved market_universe rows: ${error.message}`);
    const page = (data ?? []) as MarketUniverseRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function fetchParticipantsByExternalId(externalIds: string[]): Promise<ParticipantRow[]> {
  const rows: ParticipantRow[] = [];
  for (const ids of chunk(externalIds, 200)) {
    const { data, error } = await client
      .from('participants')
      .select('id,external_id,display_name')
      .in('external_id', ids);
    if (error) throw new Error(`Failed to load participants by external_id: ${error.message}`);
    rows.push(...((data ?? []) as ParticipantRow[]));
  }
  return rows;
}

async function fetchExistingAliasKeys(externalIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const ids of chunk(externalIds, 200)) {
    const { data, error } = await client
      .from('provider_entity_aliases')
      .select('provider_entity_key')
      .eq('provider', 'sgo')
      .eq('entity_kind', 'player')
      .in('provider_entity_key', ids);
    if (error) throw new Error(`Failed to load existing alias rows: ${error.message}`);
    for (const row of (data ?? []) as ProviderEntityAliasRow[]) {
      keys.add(row.provider_entity_key);
    }
  }
  return keys;
}

function parseCliOptions(args: string[]): CliOptions {
  return {
    apply: args.includes('--apply'),
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
