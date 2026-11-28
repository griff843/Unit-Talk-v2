import { pathToFileURL } from 'node:url';
import { emitJson, manifestExists, parseArgs, readManifest, requireIssueId } from './shared.js';

/**
 * P0 detection reads the lane manifest, the repo-owned authority for a lane.
 *
 * A lane is P0 when its manifest declares `p0_protocol.required: true`. There
 * is no external tracker lookup: the Linear project this used to query was
 * retired with the Linear workflow (2026-11-25).
 */
export interface P0DetectResult {
  schema_version: 2;
  issue_id: string;
  is_p0: boolean;
  source: 'manifest' | 'no_manifest';
  checked_at: string;
}

export function detectP0FromManifest(
  issueId: string,
  readers: {
    exists?: (id: string) => boolean;
    read?: (id: string) => { p0_protocol?: { required?: boolean } | null };
  } = {},
): P0DetectResult {
  const normalized = issueId.toUpperCase();
  const exists = readers.exists ?? manifestExists;
  const read = readers.read ?? readManifest;
  const checkedAt = new Date().toISOString();
  if (!exists(normalized)) {
    return { schema_version: 2, issue_id: normalized, is_p0: false, source: 'no_manifest', checked_at: checkedAt };
  }
  const manifest = read(normalized);
  return {
    schema_version: 2,
    issue_id: normalized,
    is_p0: manifest.p0_protocol?.required === true,
    source: 'manifest',
    checked_at: checkedAt,
  };
}

function main(): void {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const result = detectP0FromManifest(issueId);

  if (bools.has('json')) {
    emitJson(result);
  } else if (result.source === 'no_manifest') {
    console.log(`${result.issue_id} has no lane manifest; not P0`);
  } else {
    console.log(result.is_p0 ? `${result.issue_id} IS P0 (manifest)` : `${result.issue_id} is not P0 (manifest)`);
  }
  process.exitCode = result.is_p0 ? 0 : 10;
}

const entryArg = process.argv[1];
const isCli = entryArg !== undefined &&
  import.meta.url === pathToFileURL(entryArg).href;
if (isCli) {
  main();
}
