## Diff summary

MERGE_SHA: 8762836ba710b9b8c08cac4549935174f735e9fe

Substantive source binding: `8762836ba710b9b8c08cac4549935174f735e9fe`.

### Correction addendum

- Trusted post-merge closeout now retains the merge mutex from the passing gate through a single persistence push; rejected pushes fail closed without rebase or retry, and an `always()` cleanup releases the exact issue/branch lock after the attempt.
- Behavioral spawnSync tests prove push-before-release ordering, exactly one push, no rebase on rejection, zero successful persistence mutation on failure, and lock release after either result.
- Legacy schema-v1 governance bundles retain their additive DB-proof harvest path; profile-aware immutability remains schema-v2-only.
- The merged-PR verifier fetches GitHub's immutable `refs/pull/<n>/head` when the attested PR-head commit is absent locally.
- Writable DB proof is closed by the verified exact-head CI receipt from run `32126797482`, job `95679040123`, head `ecd42d20a3ba8d547f078f8b7617cf5498a4ea2a`; the local containment refusal remains recorded without fabricated TAP.
- Removed the redundant proof-directory `.gitkeep`.

### Requirement mapping

1. Proof generation derives the profile from the manifest-backed shared contract, harvests only app-runtime evidence, preserves migration/static evidence, and fails closed on unknown profiles.
2. The post-merge workflow evaluates binding and truth checks in the working tree, then commits and pushes the exact gate-evaluated state only after a passing closeout.
3. P10/R3 uses the existing merged-PR attestation and strategy-aware main-reference resolver; pre-merge exact-head enforcement remains unchanged.
4. The historical migration evidence was restored mechanically from the authoritative source blob and verified byte-identical.
5. The already-wired issue suites cover profile preservation, forbidden author identity, rollback-safe ordering, authentic merge strategies, stale receipt failures, and real-bundle attestations.

### Historical evidence restoration

Authoritative source command:

```text
git show 97862ddc:docs/06_status/proof/UTV2-1718/evidence.json > docs/06_status/proof/UTV2-1718/evidence.json
```

Byte-identity verification:

```text
$ git show 97862ddc:docs/06_status/proof/UTV2-1718/evidence.json | git hash-object --stdin
426c5898e6ae50de0611fc79cd458295b91a9d1c
$ git hash-object docs/06_status/proof/UTV2-1718/evidence.json
426c5898e6ae50de0611fc79cd458295b91a9d1c
```

### Single-file damage proof

Actual `git show --stat 823b38dc` output:

```text
commit 823b38dce844871112279868da33bbb994e727bc
Author: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
Date:   Tue Aug 18 07:08:21 2026 +0000

    chore(proof): bind UTV2-1718 to authoritative merge SHA [skip ci]

 docs/06_status/proof/UTV2-1718/evidence.json | 139 ++++++++++++++++++---------
 1 file changed, 95 insertions(+), 44 deletions(-)
```

The corresponding name-status proof is:

```text
$ git show --format= --name-status 823b38dc
M	docs/06_status/proof/UTV2-1718/evidence.json
```

No other file was changed by `823b38dc`.

### Substantive files

- `.github/workflows/post-merge-lane-close.yml`: defers durable binding persistence until the closeout gate passes.
- `scripts/ops/proof-generate.ts`: performs manifest-profile-aware, schema-version-aware harvesting.
- `scripts/ops/proof-schema.ts`: centralizes the merged-PR attestation bridge and verifier provenance result codes.
- `scripts/ops/truth-check-lib.ts`: applies the shared verifier binding to P10/R3.
- Existing wired test suites: pin the required profile, ordering, provenance, and historical-bundle regressions.
- Historical evidence bundle: restored byte-identically from the authoritative commit.

### Proof-only files

- `docs/06_status/proof/UTV2-1722/evidence.json`
- `docs/06_status/proof/UTV2-1722/model-routing.json`
- `docs/06_status/proof/UTV2-1722/verification.md`
- `docs/06_status/proof/UTV2-1722/runtime-verification.md`
- `docs/06_status/proof/UTV2-1722/diff-summary.md`

### R-level compliance

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
```
