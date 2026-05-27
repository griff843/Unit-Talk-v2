import {
  getChangedFiles,
  isLaneExecutorType,
  isLaneType,
  loadLaneManifest,
  validateLaneAuthority,
} from './lane-contract.js';
import { emitJson, getFlag, getFlags, parseArgs } from './ops/shared.js';

function main(): void {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const lane = getFlag(flags, 'lane') ?? process.env.LANE_TYPE ?? '';
  const json = bools.has('json');

  try {
    if (!isLaneType(lane)) {
      if (isLaneExecutorType(lane)) {
        if (json) {
          emitJson({
            ok: true,
            code: 'lane_authority_skipped_executor_lane',
            lane,
            changed_files: [],
            violations: [],
          });
        } else {
          console.log(`lane:check SKIP lane=${lane} reason=executor-lane`);
        }
        process.exit(0);
      }

      throw new Error('Missing or invalid lane. Pass --lane <type> or set LANE_TYPE.');
    }

    const explicitFiles = getFlags(flags, 'file');
    const changedFiles =
      explicitFiles.length > 0
        ? explicitFiles
        : getChangedFiles({
            baseRef: getFlag(flags, 'base') ?? process.env.BASE_REF,
            headRef: getFlag(flags, 'head') ?? process.env.HEAD_REF,
          });
    const manifest = loadLaneManifest(lane);
    const result = validateLaneAuthority({ manifest, changedFiles });

    if (json) {
      emitJson({
        ok: result.ok,
        code: result.ok ? 'lane_authority_pass' : 'lane_authority_fail',
        lane: result.lane,
        changed_files: result.changedFiles,
        violations: result.violations,
      });
    } else if (result.ok) {
      console.log(`lane:check PASS lane=${result.lane} files=${result.changedFiles.length}`);
    } else {
      console.error(`lane:check FAIL lane=${result.lane}`);
      for (const violation of result.violations) {
        console.error(`- ${violation.code}: ${violation.message}`);
      }
    }

    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitJson({ ok: false, code: 'lane_check_error', message });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

main();
