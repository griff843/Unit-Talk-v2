import { pathToFileURL } from 'node:url';
import {
  emitJson,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  issueToManifestPath,
  writeManifest,
} from './shared.js';
import { resumeLaneManifest } from './lane-execution.js';

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

    const result = resumeLaneManifest({
      manifest: readManifest(issueId),
      now: new Date().toISOString(),
    });
    writeManifest(result.manifest);

    const payload = {
      ok: true,
      code: result.changed ? 'lane_resumed' : 'lane_already_resumed',
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
      console.log(`${payload.issue_id} ${payload.status}`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitJson({ ok: false, code: 'lane_resume_failed', message });
    } else {
      console.error(message);
      usage();
    }
    return 1;
  }
}

function usage(): void {
  console.error('Usage: pnpm ops:lane:resume -- UTV2-123 [--json]');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
