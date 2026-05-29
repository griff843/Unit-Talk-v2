import { pathToFileURL } from 'node:url';
import {
  emitJson,
  getFlag,
  getFlags,
  manifestExists,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  issueToManifestPath,
  writeManifest,
} from './shared.js';
import { blockLaneManifest } from './lane-execution.js';

export function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const json = bools.has('json');

  try {
    const issueId = requireIssueId(
      getFlag(flags, 'issue') ?? positionals[0] ?? '',
    );
    if (!manifestExists(issueId)) {
      throw new Error(`Manifest not found for ${issueId}`);
    }

    const blockedBy = [
      ...getFlags(flags, 'blocked-by'),
      ...getFlags(flags, 'reason'),
    ];
    const result = blockLaneManifest({
      manifest: readManifest(issueId),
      blockedBy,
      now: new Date().toISOString(),
    });
    writeManifest(result.manifest);

    const payload = {
      ok: true,
      code: result.changed ? 'lane_blocked' : 'lane_already_blocked',
      issue_id: result.manifest.issue_id,
      status: result.manifest.status,
      blocked_by: result.manifest.blocked_by,
      heartbeat_at: result.manifest.heartbeat_at,
      manifest_path: relativeToRoot(
        issueToManifestPath(result.manifest.issue_id),
      ),
    };
    if (json) {
      emitJson(payload);
    } else {
      console.log(
        `${payload.issue_id} ${payload.status}: ${payload.blocked_by.join('; ')}`,
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitJson({ ok: false, code: 'lane_block_failed', message });
    } else {
      console.error(message);
      usage();
    }
    return 1;
  }
}

function usage(): void {
  console.error(
    'Usage: pnpm ops:lane:block -- UTV2-123 --blocked-by "<reason>" [--json]',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
