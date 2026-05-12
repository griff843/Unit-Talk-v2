# PROOF: UTV2-948
MERGE_SHA: TBD-on-merge

ASSERTIONS:
- [x] `pnpm ops:p0-detect <UTV2-###>` is a single mechanical source for P0 detection, used by CI, truth-check, and the dispatch-board skill (verified by inspection + tests).
- [x] `.github/workflows/p0-protocol.yml` mechanically rejects P0 PRs with no `claude-critique.md`, FAIL/SKIP in `runtime-verification.md`, or `automerge` labels (predicates verified by `scripts/ops/p0-detect.test.ts`).
- [x] `ops:truth-check` adds H1–H5 checks that fail for P0 lanes if any of the five protocol steps is unrecorded (manifest schema extended, code path verified).
- [x] Lane manifest schema (`docs/05_operations/schemas/lane_manifest_v1.schema.json`) accepts the `p0_protocol` block; existing manifests remain valid (UTV2-948's own manifest validates).
- [x] `/dispatch-board` skill prose explicitly forbids autonomous merge on P0 (`pnpm ops:p0-detect` pre-merge check codified in Rules section).
- [x] Branch-protection apply script (`scripts/ops/apply-branch-protection.sh`) is documented, idempotent, and reproducible by a second operator.
- [x] UTV2-948 ships its own `claude-critique.md` and `runtime-verification.md` to dogfood the protocol.
- [ ] Post-merge: `pnpm ops:truth-check UTV2-948` exits 0 with H1–H5 all PASS — deferred to merge.
- [ ] Post-merge: PM runs `apply-branch-protection.sh` so `P0 Protocol` is a required status check on `main` — deferred to PM action.

EVIDENCE:
```text
$ npx tsc --noEmit -p tsconfig.json
EXIT=0

$ npx tsx --test scripts/ops/p0-detect.test.ts scripts/ops/truth-check-lib.test.ts
ℹ tests 26
ℹ pass 26
ℹ fail 0
ℹ duration_ms ~1100

$ npx tsx scripts/ops/lane-manifest.ts validate UTV2-948 --json
{
  "ok": true,
  "code": "manifest_valid",
  "errors": []
}

$ pnpm ops:p0-detect UTV2-948 --json
{
  "schema_version": 1,
  "issue_id": "UTV2-948",
  "is_p0": true,
  "project_id": "46229dc4-c7c1-4ccb-af0d-dedaf8147a97",
  "project_name": "Runtime Hardening P0 - Runtime Trustworthiness",
  "source": "linear",
  "checked_at": "2026-05-12T15:02:30.208Z"
}
exit 0

$ pnpm ops:p0-detect UTV2-886 --json
{
  "schema_version": 1,
  "issue_id": "UTV2-886",
  "is_p0": false,
  "project_id": "1f8fd53d-a3b6-45b8-a40f-b4beee2f9a9c",
  "project_name": "Functional Completeness & Trust Hardening",
  "source": "linear",
  "checked_at": "2026-05-12T15:02:41.589Z"
}
exit 10
```

See `claude-critique.md` and `runtime-verification.md` in this directory for the full critique pass and runtime evidence.
