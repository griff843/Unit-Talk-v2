/**
 * CI check: validate that an evidence bundle's mergeSha matches the PR head commit.
 *
 * Usage:
 *   tsx scripts/ci/bundle-sha-check.ts --bundle-path <path> --expected-sha <sha> [--tier T1|T2|T3]
 *
 * Exit codes:
 *   0 — SHA verified (T1), or non-T1 advisory only
 *   1 — T1 check failed (missing bundle, SHA mismatch, malformed JSON)
 */

import fs from 'node:fs';

function parseArgs(argv: string[]): {
  bundlePath: string | undefined;
  expectedSha: string | undefined;
  tier: string | undefined;
} {
  const args = argv.slice(2);
  let bundlePath: string | undefined;
  let expectedSha: string | undefined;
  let tier: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const current = args[i];
    if (current === '--bundle-path') {
      bundlePath = args[++i];
    } else if (current.startsWith('--bundle-path=')) {
      bundlePath = current.slice('--bundle-path='.length);
    } else if (current === '--expected-sha') {
      expectedSha = args[++i];
    } else if (current.startsWith('--expected-sha=')) {
      expectedSha = current.slice('--expected-sha='.length);
    } else if (current === '--tier') {
      tier = args[++i];
    } else if (current.startsWith('--tier=')) {
      tier = current.slice('--tier='.length);
    }
  }

  return { bundlePath, expectedSha, tier };
}

function main(): void {
  const { bundlePath, expectedSha, tier } = parseArgs(process.argv);

  if (!bundlePath || !expectedSha) {
    console.log(
      'usage: tsx scripts/ci/bundle-sha-check.ts --bundle-path <path> --expected-sha <sha> [--tier T1|T2|T3]',
    );
    process.exit(1);
  }

  // Non-T1 tiers: advisory only, no blocking
  if (!tier || tier === 'T2' || tier === 'T3') {
    console.log(
      `[bundle-sha-check] advisory: tier=${tier ?? 'unset'} — SHA check skipped (T1 only)`,
    );
    process.exit(0);
  }

  // T1 path: enforce SHA match
  if (!fs.existsSync(bundlePath)) {
    console.log(`T1 PR requires evidence bundle at ${bundlePath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(bundlePath, 'utf8');
  } catch {
    console.log(`Bundle at ${bundlePath} is missing mergeSha field or is not valid JSON`);
    process.exit(1);
  }

  type BundleJson = Record<string, unknown>;
  let bundle: BundleJson;
  try {
    bundle = JSON.parse(raw) as BundleJson;
  } catch {
    console.log(`Bundle at ${bundlePath} is missing mergeSha field or is not valid JSON`);
    process.exit(1);
  }

  // Support both camelCase (mergeSha) and snake_case (merge_sha) field names
  const mergeSha =
    typeof bundle['mergeSha'] === 'string'
      ? bundle['mergeSha']
      : typeof bundle['merge_sha'] === 'string'
        ? bundle['merge_sha']
        : undefined;

  if (mergeSha === undefined) {
    console.log(`Bundle at ${bundlePath} is missing mergeSha field or is not valid JSON`);
    process.exit(1);
  }

  if (mergeSha === expectedSha) {
    console.log(`Bundle SHA verified: ${expectedSha}`);
    process.exit(0);
  }

  console.log(
    `Bundle SHA mismatch — bundle was built against ${mergeSha} but PR head is ${expectedSha}. Re-run /t1-proof against the current commit.`,
  );
  process.exit(1);
}

main();
