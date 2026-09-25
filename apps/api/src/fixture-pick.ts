/**
 * Recognises a CI / proof fixture pick.
 *
 * Production `picks` holds a large corpus of fixtures written by CI runs that
 * predate staging isolation. They are retained for auditability, but a
 * fixture is never owed delivery, so a health check must not treat one as a
 * stranded production pick.
 *
 * Same markers as Command Center's `isTestFixturePick`
 * (`apps/command-center/src/lib/data/client.ts`). Apps never import from apps,
 * so the rule is restated here; keep the two in step. `testRun` is written as a
 * run identifier string, never a boolean, so every marker is presence-checked.
 */
const FIXTURE_METADATA_MARKERS = [
  'testRun',
  'proof_issue',
  'proof_fixture_id',
  'proof_script',
  'test_key',
] as const;

export function isTestFixturePick(pick: { metadata: unknown; selection: unknown }): boolean {
  const metadata =
    pick.metadata !== null && typeof pick.metadata === 'object' && !Array.isArray(pick.metadata)
      ? (pick.metadata as Record<string, unknown>)
      : {};
  if (FIXTURE_METADATA_MARKERS.some((key) => metadata[key] != null)) {
    return true;
  }
  return typeof pick.selection === 'string' && /proof/i.test(pick.selection);
}
