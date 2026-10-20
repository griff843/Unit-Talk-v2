# Diff summary: WORK-2026102001

Proof-only repair. Binds the merged grading lane's proof (original PR #1768, merge commit `3afaa0fa3858ec9b7aa75b3f24c8db47ee20472f`) to its genuine merge identity and genuine protected staging runtime evidence, so the original lane's closeout can pass its normal truth check. No implementation file, test, manifest of another lane, workflow or script is changed.

| File | Change |
|---|---|
| `docs/06_status/proof/WORK-2026101604/diff-summary.md` | The authored pre-merge line `Merge SHA: pending merge (null in evidence.json)` is replaced by `MERGE_SHA: 3afaa0fa3858ec9b7aa75b3f24c8db47ee20472f`, and the original wording is preserved as history in the next paragraph. All other authored prose is untouched. |
| `docs/06_status/proof/WORK-2026101604/evidence.json` | The prohibited top-level `merge_sha` key is removed. `sha_binding.merge_sha` is set to the merge commit and `sha_type` to `merge_sha`; `verified_source_sha` (the implementation commit) and all other provenance are retained. `runtime_proof` is replaced by the output of `ops:proof-generate`'s CI-DB-proof harvest: nine passing smoke tests with tables, eight seed/reset row counts, run id 39192328761, job id 117867623770, project `xskgrzbteyqdufktjrjx`. The old `BLOCKED_DEFERRED_TO_PROTECTED_CI` placeholder is superseded, and the blocked local `test:db` disposition is preserved in that lane's `verification.md`. |
| `docs/06_status/proof/WORK-2026101604/verification.md` | `ops:proof-generate` rebound the merge-SHA anchor lines (two lines). No authored verification content is changed. |

Not changed on purpose: `docs/06_status/proof/WORK-2026101604/model-routing.json`. Its `closeout_binding` is immutable once bound and is bound by the closeout workflow's trusted repair step, not by this lane.

## How this was produced

- `diff-summary.md`: hand edit, because `ops:proof-generate` refuses to overwrite authored proof that carries no merge-SHA anchor (`unbindable_proof_artifact`).
- `evidence.json` / `verification.md`: `pnpm ops:proof-generate WORK-2026101604 --merge-sha 3afaa0fa3858ec9b7aa75b3f24c8db47ee20472f`; the harvest re-verifies the CI receipt and cross-checks the run through the GitHub API.
- Two hand edits to `evidence.json` after generation: removing the top-level `merge_sha` key, and appending one sentence to `sha_binding.note` saying the earlier text described the pre-merge state.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1770
