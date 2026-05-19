## Summary

UTV2-1050 automates lane authority failure triage into Linear from the lane-check workflow.

## Evidence

Changed files:
- `.github/workflows/lane-check.yml`: exports the inferred UTV2 issue id, captures lane authority output, posts a failure-only Linear triage comment with PR/run context, and re-raises the lane authority failure so CI remains blocking.
- `docs/06_status/lanes/UTV2-1050.json`: records the workflow and proof artifacts in lane scope for PR review packet validation.
- `docs/06_status/proof/UTV2-1050/runtime-verification.md`: records that this is a CI-only change with no runtime-sensitive paths touched.

Behavior:
- Passing lane authority checks remain unchanged.
- Failing lane authority checks now produce a Linear comment on the issue inferred from the PR branch when `LINEAR_API_TOKEN` is configured.
- Missing `LINEAR_API_TOKEN` or missing issue id emits a warning and does not mask the original lane authority failure.

## Verification

- `node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/lane-check.yml','utf8')); console.log('yaml ok')"`: PASS
- `git diff --check`: PASS
- `pnpm lane:check -- --lane hygiene --file .github/workflows/lane-check.yml`: PASS
- `pnpm lane:check -- --lane hygiene --file packages/contracts/src/foo.ts`: expected FAIL with `forbidden_path`; wrapper assertion confirmed exit code 1
- `pnpm type-check`: PASS
- `pnpm test`: PASS
- `pnpm verify`: PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no R-level artifacts required

## Merge SHA

4a41c8f22efba2ce6b9fec34ba743b515b2c230e
