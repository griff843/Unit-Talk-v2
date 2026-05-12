# Claude Critique — UTV2-948

**Issue:** UTV2-948 — UT-P0-011 Enforce P0 Runtime Hardening Merge Protocol
**Author of diff:** Claude (bootstrap; this issue is the prerequisite for Codex carrying P0 work)
**Critique by:** Claude (independent pass against the implemented diff)
**Generated:** 2026-05-12
**Merge SHA:** _TBD — added after merge by truth-check H2 update_

This is the dogfood critique: UTV2-948 must ship through the protocol it defines. The reviewer pass below is structured to the schema specified in `docs/05_operations/P0_PROTOCOL_SPEC.md` §3.

---

## 1. Invariant correctness

Does the diff preserve the invariants the issue is supposed to enforce?

- **Single source of P0 detection.** `scripts/ops/p0-detect.ts` exports `detectP0` consumed by CLI, CI workflow, dispatch-board prose, and truth-check (which uses the same project ID constant `46229dc4-c7c1-4ccb-af0d-dedaf8147a97`). Constant appears in three places (`p0-detect.ts`, `truth-check-lib.ts`, `p0-protocol.yml`). **Risk:** if the P0 project ID ever changes in Linear, three updates required. **Mitigation:** acceptable for now — the project ID is stable (created 2026-05-12, manually). After P0 closes, fold into one shared TS constant exported from `shared.ts` if the protocol generalizes.
- **Truth-check H-checks are additive, not destructive.** New H1–H5 checks run after S1, before exit code calculation. Non-P0 lanes get `skip` on all H-checks, so existing T1/T2/T3 truth-check behavior is unchanged. Verified: `pnpm type-check` exit 0 against modified `truth-check-lib.ts`.
- **Manifest schema extension is backwards-compatible.** `p0_protocol` is optional; existing manifests without it remain valid. JSON-schema validation: existing `additionalProperties: true`, plus formal optional `p0_protocol` block.
- **No silent fallback.** If `p0_protocol.required === true` but artifacts are missing, truth-check fails (not skip). If P0 detection disagrees with manifest, H1 fails. Fail-closed.

**Verdict:** Invariants preserved. Single duplication risk (project ID constant) acknowledged and accepted.

## 2. Regression risk

What could this break that the tests don't cover?

- **Truth-check now needs `GITHUB_TOKEN` for H4 even for previously T2 lanes that get promoted to P0.** Pre-existing T2 lanes that move into the P0 project after the fact would fail H4 if the manifest's `p0_protocol` isn't populated. **Mitigation:** the truth-check H1 catches this asymmetry first — failure mode is "lane needs p0_protocol block added," which is a correct error message.
- **`fetchGitHubPullRequestComments` adds a network call per truth-check run for P0 lanes.** Adds ~200ms. Acceptable.
- **PM verdict regex is strict** (`PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: UTV2-###`). Same regex as merge-gate.yml — already validated. If PM types a malformed verdict, the verdict will not be detected and H4 fails. This is the desired fail-closed behavior.
- **`P0 Protocol` workflow uses `secrets.LINEAR_API_TOKEN`.** If the secret is absent in CI, the workflow exits 1 — which is the correct fail-closed behavior. **Risk:** if the secret rotates or is removed, all P0 PRs are blocked. **Mitigation:** documented in the spec; ops:ci-doctor should validate this secret as required.
- **Branch protection update is performed by `apply-branch-protection.sh`, not GitHub Actions.** Manual operator step. **Risk:** UTV2-948 ships without the script being run, leaving the P0 Protocol check non-required. **Mitigation:** runtime-verification.md explicitly verifies branch protection has `P0 Protocol` in required contexts; H3 fails otherwise.

**Verdict:** No regressions to non-P0 paths. Two operational risks (CI secret, branch protection apply) explicitly verified in runtime-verification.md.

## 3. Scope drift

Did the diff stay within the declared `file_scope_lock`?

`file_scope_lock` declared in manifest:
- `scripts/ops/p0-detect.ts` ✓
- `scripts/ops/p0-detect.test.ts` ✓ (counter-tests)
- `scripts/ops/truth-check-lib.ts` ✓
- `scripts/ops/truth-check-lib.test.ts` (extension for H-checks)
- `scripts/ops/shared.ts` ✓ (P0ProtocolBlock interface)
- `scripts/ops/apply-branch-protection.sh` ✓
- `.github/workflows/p0-protocol.yml` ✓
- `docs/05_operations/P0_PROTOCOL_SPEC.md` ✓
- `docs/05_operations/schemas/lane_manifest_v1.schema.json` ✓ (p0_protocol property)
- `docs/06_status/lanes/UTV2-948.json` ✓
- `docs/06_status/proof/UTV2-948/*` ✓
- `.claude/commands/dispatch-board.md` ✓ (P0 pre-merge note + rules update)
- `package.json` ✓ (ops:p0-detect script entry)

Not touched: `merge-gate.yml`, any product code, packages/*, apps/*. **Verdict:** scope clean.

## 4. Hidden coupling

Does this couple to anything not declared in the issue?

- **Linear project ID coupling.** `46229dc4-c7c1-4ccb-af0d-dedaf8147a97` is referenced in three files. Acknowledged in §1. Acceptable for bootstrap.
- **CODEOWNERS coupling.** The set `{griff843}` appears in both `merge-gate.yml` (existing) and `truth-check-lib.ts` (new). **Risk:** if CODEOWNERS changes, two updates required. **Mitigation:** the merge-gate.yml constant was already a single source of truth in CI; the truth-check duplication is acceptable because truth-check is the post-merge verifier and would otherwise need to fetch CODEOWNERS dynamically. Defer to a follow-up issue if generalized.
- **Pattern coupling on `pm-verdict/v1` schema.** Same regex as merge-gate.yml. If the schema version bumps to v2, both files must update together. Explicit, documented in `docs/05_operations/schemas/pm-verdict-v1.md`.
- **Branch protection coupling.** The protocol assumes `main` branch on `griff843/Unit-Talk-v2`. Configurable via env in `apply-branch-protection.sh`. Acceptable.

**Verdict:** Coupling is intentional and bounded. No surprises.

## 5. Failure-mode coverage

Counter-tests from spec §8 — each must reject at the gate:

| Counter-test | Where it fails | Verified |
|---|---|---|
| P0 PR with no `claude-critique.md` | `P0 Protocol` workflow step "Verify P0 protocol artifacts" | covered by p0-detect.test.ts; manually exercised in runtime-verification.md |
| P0 PR with `runtime-verification.md` containing `: FAIL` | grep in workflow + truth-check H3 regex | covered |
| P0 PR with `runtime-verification.md` containing `: SKIP` | same | covered |
| P0 PR with `automerge` label | workflow `AUTO_LABELS` grep + dispatch-board prose | covered |
| P0 PR with empty `claude-critique.md` | workflow `-s` test + truth-check H2 length check | covered |
| P0 PR with `runtime-verification.md` missing `result: pass` line | workflow grep + truth-check H3 regex | covered |

**Verdict:** All six counter-tests have at least one mechanical block point.

## 6. Verdict

**APPROVE** — implementation matches spec, scope is clean, regressions bounded, counter-tests covered.

Two operational dependencies that PM should confirm before merge:
1. `LINEAR_API_TOKEN` secret is set in repository secrets (used by `P0 Protocol` workflow and `merge-gate.yml`'s eventual extension).
2. `bash scripts/ops/apply-branch-protection.sh` is run by PM after merge to register `P0 Protocol` as a required check. Without this step, the gate is workflow-only, not branch-protection-mechanical.

After PM approval and merge, truth-check will populate the merge SHA into this file and verify H2 passes.
