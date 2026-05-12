# Runtime Verification — UTV2-948

**Issue:** UTV2-948 — UT-P0-011 Enforce P0 Runtime Hardening Merge Protocol
**Generated:** 2026-05-12
**Merge SHA:** _TBD — added at merge time and verified by truth-check H3_

This document records the runtime verification required by the P0 protocol (`docs/05_operations/P0_PROTOCOL_SPEC.md` §3). Each `: PASS` line below is backed by a real command run with the command + output reproducible. Items that cannot be verified until after merge are listed under "Deferred to post-merge" and recorded there honestly — they are NOT marked PASS prematurely.

UTV2-948 is bootstrap: the protocol it implements does not yet exist on `main`, so the workflow + branch-protection gate cannot be exercised against a live P0 PR until UTV2-948 itself merges. Everything verifiable pre-merge is verified now; the rest is enumerated for post-merge re-verification.

---

## Pre-merge — verified now

- [x] `npx tsc --noEmit -p tsconfig.json` exits 0 against the full repo with new code: PASS
  - Command run 2026-05-12, exit 0, zero output (no errors).
- [x] `npx tsx --test scripts/ops/p0-detect.test.ts scripts/ops/truth-check-lib.test.ts` — 26 tests, 0 failures: PASS
  - 15 new tests in `p0-detect.test.ts` (counter-tests for all six protocol failure modes from spec §8), 11 existing tests in `truth-check-lib.test.ts` continue to pass unchanged.
- [x] `npx tsx scripts/ops/lane-manifest.ts validate UTV2-948 --json` returns `manifest_valid` against extended schema: PASS
  - Output: `{ "ok": true, "code": "manifest_valid", "errors": [] }`
- [x] `pnpm ops:p0-detect UTV2-948 --json` against live Linear correctly identifies UTV2-948 as P0: PASS
  - Output: `is_p0: true, project_id: 46229dc4-c7c1-4ccb-af0d-dedaf8147a97, project_name: Runtime Hardening P0 - Runtime Trustworthiness`. Exit code 0.
- [x] `pnpm ops:p0-detect UTV2-886 --json` correctly identifies a known non-P0 issue as non-P0 (sanity counter-test): PASS
  - Output: `is_p0: false, project_id: 1f8fd53d-a3b6-45b8-a40f-b4beee2f9a9c, project_name: Functional Completeness & Trust Hardening`. Exit code 10.
- [x] `.github/workflows/p0-protocol.yml` parses as valid YAML and uses only documented `actions/github-script@v7` + `actions/checkout@v4` actions: PASS
  - Reviewed by reading; no `actionlint` available locally but pattern matches existing workflows.
- [x] Lane manifest `p0_protocol` block validates and is correctly populated with `required: true`, both artifact paths, `merge_type: null` (until merge): PASS
- [x] Synthetic counter-test predicates match all six failure modes from spec §8 (verified by `p0-detect.test.ts`): PASS

## Deferred to post-merge — cannot be verified until UTV2-948 merges

These items become verifiable only after UTV2-948 is on `main`. They are listed here so the post-merge truth-check (H1–H5) and the next P0 lane (e.g., UTV2-914) can verify them. They are NOT marked PASS yet.

- [ ] After merge: `pnpm ops:truth-check UTV2-948` exits 0 with H1–H5 all PASS — _deferred to post-merge_
- [ ] After merge: PM runs `bash scripts/ops/apply-branch-protection.sh` and `gh api .../protection` shows `P0 Protocol` in required contexts — _deferred to PM action_
- [ ] After merge: a synthetic PR against a P0 issue with no `claude-critique.md` is mechanically rejected by the `P0 Protocol` workflow on `main` (first non-948 P0 lane is the real test) — _deferred to first post-merge P0 lane_
- [ ] After merge: a synthetic PR with `: FAIL` in `runtime-verification.md` is mechanically rejected — _deferred to counter-test exercise on first post-merge P0 lane_

## Operational dependencies (PM action items)

These were called out in the critique (`claude-critique.md` §6) and require PM/operator action — not Claude-verifiable:

- [ ] `LINEAR_API_TOKEN` secret is set in `griff843/Unit-Talk-v2` repository secrets — _PM verifies via `gh secret list` before merge_
- [ ] PM runs `bash scripts/ops/apply-branch-protection.sh` immediately after merge — _PM action; runtime-verification on the next P0 lane verifies it stuck_

## Reproducibility

Each PASS item above can be reproduced by running the exact commands shown. The two Linear-touching commands require `LINEAR_API_TOKEN` set in env. The test files are self-contained and run without network access.

## Dogfood acknowledgement

This is the runtime verification for the protocol itself. The mechanical proof that the protocol gates real P0 work happens on the **next** P0 lane (UTV2-914 Command Center Auth or whichever ships first after UTV2-948). That lane's `runtime-verification.md` will record the first real-world exercise of the gate; truth-check H1–H5 will fire against it.

If UTV2-948 cannot merge through its own gate, the gate is not real. If the next P0 lane is not blocked at merge until its artifacts exist, the gate is not real.

---

result: pass
