/**
 * UTV2-1346 — Read-only live-DB proof: smart-form capper attribution via metadata.capper
 *
 * Context: processSubmission built enrichedPick.metadata without copying
 * payload.submittedBy → metadata.capper. The CLV trust adjustment in
 * clv-feedback.ts reads metadata.capper to attribute picks to cappers for
 * per-capper trust score corpus accumulation. Without the field, all smart-form
 * picks were unattributed regardless of what submittedBy was set to.
 *
 * Fix: Added ...(payload.submittedBy ? { capper: payload.submittedBy } : {})
 * to enrichedPick.metadata in both processSubmission and processShadowSubmission.
 *
 * This proof queries the live picks table to show smart-form picks and their
 * current metadata state, demonstrating the attribution gap the fix closes.
 * READ-ONLY. No writes, no DDL, no mutation.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-1346-capper-attribution-proof.ts
 */

import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function restGet(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Supabase REST ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as unknown[];
}

async function main() {
  console.log('UTV2-1346 Capper Attribution Proof');
  console.log('===================================');
  console.log('Querying recent smart-form picks for metadata.capper presence...');

  const rows = await restGet(
    'picks?source=eq.smart-form&select=id,source,metadata,created_at&order=created_at.desc&limit=20',
  );

  console.log(`\nFound ${rows.length} recent smart-form picks.`);

  let withCapper = 0;
  let withSubmittedBy = 0;
  let withNeither = 0;

  for (const row of rows as Array<{ id: string; metadata: Record<string, unknown> | null; created_at: string }>) {
    const meta = row.metadata ?? {};
    const hasCapper = 'capper' in meta;
    const hasSubmittedBy = 'submittedBy' in meta;

    if (hasCapper) withCapper++;
    else if (hasSubmittedBy) withSubmittedBy++;
    else withNeither++;

    console.log(
      `  pick ${row.id.slice(0, 8)}… ${row.created_at.slice(0, 19)} ` +
      `capper=${hasCapper ? JSON.stringify(meta['capper']) : 'MISSING'} ` +
      `submittedBy=${hasSubmittedBy ? JSON.stringify(meta['submittedBy']) : 'absent'}`,
    );
  }

  console.log('\n--- Summary ---');
  console.log(`  Picks with metadata.capper set:      ${withCapper}`);
  console.log(`  Picks with submittedBy but no capper: ${withSubmittedBy} (pre-fix)`);
  console.log(`  Picks with neither:                   ${withNeither}`);
  console.log('\nFix maps payload.submittedBy → metadata.capper in processSubmission');
  console.log('and processShadowSubmission. New picks after deploy will have capper set.');

  // For pre-deploy evidence, existence of submittedBy without capper demonstrates the gap.
  // Post-deploy, withCapper should equal the count of picks submitted with a capper name.
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
