# PROOF: UTV2-1839

MERGE_SHA: d35b82217aabc5efeac6b27e47b21f8029d19967

> Pre-merge the merge row is intentionally the ratified `pending merge` anchor; the
> Execution SHA row carries the verified implementation identity.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the
> merged-PR attestation.

Issue: UTV2-1839
Tier: T2
Lane type: governance
PR: https://github.com/griff843/Unit-Talk-v2/pull/1514
Execution SHA: 5046a095ecd5b87635dff6da75f4b4055a64f33a
Head SHA: 5046a095ecd5b87635dff6da75f4b4055a64f33a

## ASSERTIONS:

- [x] **AC1 — C5 refuses the real evil merge `c31b8ee191e1704a5ebca70e60e178b97a433d99` and admits the nineteen merges measured clean in the same window.** Both directions are asserted from measured values, not from a description of them: the refusal names the offending path `docs/06_status/lanes/UTV2-1514.json`, and the accept case runs the nineteen real SHAs.
- [x] **AC2 — C6 refuses a path whose blob at the resulting head differs from main's, and admits one whose blob is identical.** Also asserted: absent-on-both-sides is identical (a deletion main also made), present-at-head/absent-on-main is a refusal, an unmeasured changed path is a refusal, and an anchor that is not on the base branch is a refusal.
- [x] **AC3 — the widened C1 refuses a chain carrying a commit that is not an ancestor of `origin/main`.** Demonstrated on real git objects with an octopus merge whose second parent is on main and whose third parent is not.
- [x] **AC4 — inversion.** Five mutations were applied to the real source, one at a time, each followed by a byte-for-byte restore. The decisive one is M3: with C5, C6 and C7 removed — i.e. the condition set that shipped in UTV2-1836 — a **real evil merge, built in a real git repository, is VERIFIED**. See the mutation table below.
- [x] **AC5 — the accept direction is re-measured over real `origin/main` first-parent windows.** `git diff-tree --cc` was run over the twenty most recent first-parent merges on `origin/main`; nineteen report nothing and one reports a path. The extended condition set also VERIFIES a real clean sync built end to end in a temporary repository.
- [x] **AC6 — `grep -rl 'carry-forward' .github/ | wc -l` is 0.** No workflow, and therefore no gate, references any of this.
- [x] **AC7 — a previously posted receipt is never read back as evidence.** The pre-existing collector test asserting this still passes, and every value added by this lane is recomputed from git or the GitHub API; none is parsed from a comment.
- [x] **AC8 — the merge-gate integration is written as a proposal, not a change.** `.github/workflows/merge-gate.yml` is byte-identical to `origin/main`. The proposal is below.

## Verification

## EVIDENCE:

```
$ pnpm type-check
tsc -b tsconfig.json, exit 0, no diagnostics

$ pnpm test
[exited with code 0]
   The repo-wide suite is a sequence of separate `tsx --test` invocations;
   the aggregate receipt is the exit status, and the per-file totals for the
   two files this lane changes are measured separately below.

$ npx tsx --test scripts/ops/approval-carry-forward.test.ts scripts/ops/carry-forward-collect.test.ts
# tests 81
# pass 81
# fail 0
   (approval-carry-forward.test.ts 52, was 35 on origin/main;
    carry-forward-collect.test.ts 29, was 20)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS — no R-level artifacts required for this diff

$ pnpm eslint scripts/ops/approval-carry-forward.ts scripts/ops/carry-forward-collect.ts \
    scripts/ops/approval-carry-forward.test.ts scripts/ops/carry-forward-collect.test.ts
(no output — clean)

$ grep -rl 'carry-forward' .github/ | wc -l
0

$ git diff origin/main -- .github/
(no output — the reserved surface is untouched)
```

- [x] `pnpm type-check`: PASS — `tsc -b tsconfig.json` exits 0 with no diagnostics
- [x] `pnpm test`: PASS — exit 0. Stated as the exit status rather than a total, because the script is a sequence of per-package `tsx --test` runs and no single total is printed. The two suites this lane changes are counted exactly, above.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — no rules matched, so no R-level artifact is required and none is claimed
- [ ] `pnpm verify`: **not obtainable locally, and not claimed as PASS here.** `verify` is
  `pnpm verify:static && pnpm test:live-db`. The local run reached `test:live-db` — which
  mechanically establishes that `verify:static` (env check, lint, type-check, build, test,
  command manifest, migration lint) exited 0 — and then refused:
  `[assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` That stage
  refuses a non-staging target by design and cannot run outside the `staging-ci` GitHub
  environment. The authoritative result for `pnpm verify` is the required `verify` check
  on this PR at this head; this bundle represents no completed check as pending and claims
  no local pass it did not get.

## The measured gap this lane closes

Run read-only against `origin/main` on 2026-09-06:

```
$ for s in $(git rev-list --first-parent --merges -20 origin/main); do
    echo "$s $(git diff-tree --cc -r --name-only $s | tail -n +2 | wc -l)"; done
1734bf2017eb0fe5e00d93a4cff3d074d7be4546 0
5ed005a6da848917a355c4c0ee5e7d8f5513713b 0
c35afcfcfa333709780fb930793a0cd81641173b 0
c31b8ee191e1704a5ebca70e60e178b97a433d99 1      <-- content in neither parent
b2dbf5225c79160536e3ea2d03d96054664b7331 0
... (fifteen more, all 0)

$ git diff-tree --cc -r --name-only c31b8ee191e1704a5ebca70e60e178b97a433d99
c31b8ee191e1704a5ebca70e60e178b97a433d99
docs/06_status/lanes/UTV2-1514.json

$ git log -1 --format=%s c31b8ee1
Merge remote-tracking branch 'origin/main'
```

`docs/06_status/lanes/UTV2-*.json` is `ALLOW_PATTERNS[0]`. So the shipped C1–C4
would have admitted that merge's content on the grounds that its *path* is
permitted bookkeeping, having never looked at what the path now holds.

## Mutation controls

Each mutation was applied to the real source, run, and reverted byte-for-byte
(`git diff` clean afterwards, and the full suite back to 81/81). M1–M3 were
evaluated against a **real evil merge constructed in a temporary git
repository** — `git merge --no-commit`, edit a bookkeeping file to a value in
neither parent, commit — driven through the real collector with the real `git`
binary.

| # | Mutation | Result |
|---|---|---|
| baseline | none | `REFUSED` — C1 pass C2 pass C3 pass C4 pass **C5 fail C6 fail C7 fail** |
| M1 | C5 removed from the aggregate | `REFUSED` — C6 and C7 still catch it |
| M2 | C6 removed from the aggregate | `REFUSED` — C5 and C7 still catch it |
| M3 | **C5, C6 and C7 removed — the condition set UTV2-1836 shipped** | **`VERIFIED`** — C1 pass C2 pass C3 pass C4 pass |
| M4 | C1's `rev-list --not origin/main` cross-check disabled | 29/29 collector tests still pass — **the cross-check fires independently in no constructible scenario** |
| M5 | C1's per-parent walk reverted to `parents[1]` only | **2 tests fail**, including the real-git octopus case: `real git: an octopus merge whose third parent is off main is caught by the widened C1` |

Two results are worth stating plainly rather than presenting as uniform success.

**M1 and M2 did not individually flip the verdict.** On a branch-side evil merge
all three new conditions fire, so removing any one of them leaves two. The
inversion that actually demonstrates the gap is M3, and it is the one that
matters: the shipped condition set verifies a real evil merge. The single-
condition inversions are recorded as they came out, not as they would have read
better.

**M4 shows the `rev-list` cross-check is redundant.** The premise it was
written against — scope item 3's "a merge whose second parent is on main can
still carry, through its ancestry, commits that are not" — is false for a
two-parent merge. It is kept as a second, independently computed answer to the
same question, and its source comment says exactly that rather than claiming a
catch it does not have. The load-bearing half of the C1 change is the per-parent
walk, which M5 proves.

## Real-git integration, not fixtures

Four tests build an actual repository — a bare `origin`, a clone, a `main`, a
feature branch, real merges — and drive `collect()` with the real `git` binary
rooted there. They exercise `diff-tree --cc`, `rev-parse <ref>:<path>`,
`rev-list --not` and `patch-id --stable` as themselves:

1. a clean sync from main is `VERIFIED`, with the anchor equal to
   `git rev-parse origin/main`, the incoming blob identical, `commitsNotOnMain`
   exactly the merge, and the patch-id equal at both points;
2. a branch-side evil merge is `REFUSED` by C5 and C6, while **C1, C2, C3 and C4
   all pass** — asserted explicitly, because that is the claim;
3. a commit smuggled in through a merged side branch is refused by C1;
4. an octopus merge whose third parent is off main is refused by C1, with the
   test first asserting that its *second* parent is on main — i.e. that the
   pre-existing check would have looked at the innocent parent and stopped.

## Merge Gate integration — PROPOSAL ONLY, NOT APPLIED

PM authorization of 2026-09-05 is to **prepare and verify**, not to activate.
`.github/workflows/merge-gate.yml` is unmodified; `git diff origin/main -- .github/`
is empty. What follows is the written proposal for a separate reserved decision
under `intent.md` reserved decision 7.

**The gate job cannot run any of this as written today.** Measured, not assumed:

- `merge-gate.yml:88-91` checks out at `github.event.pull_request.base.sha` with
  **no `fetch-depth`**, so the job has a shallow tree at the *base*: no PR head
  commit, no `origin/main` ref, and no history to walk. Every one of C1, C5, C6
  and C7 is a git-history question. The base-SHA pin is a deliberate privilege
  boundary — it is what stops a PR from editing `merge-gate-verdict.cjs` to
  defeat its own freshness check — and **it must not move**.
- The job's `permissions` do not include anything that would make a deeper fetch
  safe by default, and `actions/checkout` with a greater depth at `base.sha`
  still would not contain the PR head.
- The job `require()`s `./scripts/ops/merge-gate-verdict.cjs` directly. There is
  no `pnpm install` in it, so a TypeScript module cannot be loaded. A port to
  CJS **beside** `merge-gate-verdict.cjs` is the shape that fits.

**Therefore the proposal is deliberately narrow.** Three parts:

1. **A separate, minimally privileged job** that performs the git work —
   `permissions: contents: read` only, `fetch-depth: 0`, and it emits the
   carry-forward result as a job output. It must not hold `checks: write`.
2. **A CJS port** of the verifier's condition evaluation, placed beside
   `merge-gate-verdict.cjs`, so the gate job loads it from the trusted
   base-SHA checkout exactly as it loads the verdict helper today.
3. **A call site in the gate that fires only in one situation**, and fails
   closed on any throw:

```js
// PROPOSED — not applied. Inside the T1 block, replacing nothing.
if (tier === 'T1') {
  const t1Errors = validateT1Verdicts(verdicts, { prNumber, headSha, authorizedReviewers: AUTHORIZED_REVIEWERS });

  const onlyStaleness =
    t1Errors.length === 1 && /^PM verdict is stale: /.test(t1Errors[0]);

  if (onlyStaleness && labels.includes('t1-approved')) {
    try {
      const receipt = evaluateCarryForward(carryForwardEvidence);   // job output, recomputed
      if (receipt.verdict === 'VERIFIED') {
        notes.push(`Approval carried forward from ${receipt.original_verdict_sha}: ${receipt.original_verdict_url}`);
      } else {
        errors.push(...t1Errors, ...receipt.refusals);
      }
    } catch (e) {
      errors.push(...t1Errors, `carry-forward evaluation failed: ${e.message}`);
    }
  } else {
    errors.push(...t1Errors);
  }

  if (!labels.includes('t1-approved')) {
    errors.push('T1 requires "t1-approved" label on the PR. PM must apply this label after review.');
  }
}
```

**What that call site does and does not do.** It never creates an approval: a
`t1-approved` label and a real `pm-verdict/v1` APPROVED comment must both
already exist, and the original comment is never edited or superseded. It fires
only when the *sole* remaining T1 error is staleness — any other T1 error, and
any non-T1 error anywhere in the gate, still blocks exactly as today. A throw
blocks. An absent required check blocks, because C4 treats absent as not-green.

**The security property, restated because it is the one that must not slip.**
The receipt is an **output**, never an input. Nothing may accept a receipt
supplied as a comment, a file or a workflow input — otherwise anyone with
comment access could forge one, which is precisely the failure this mechanism
must not create. The proposed job recomputes every condition from git and the
check-runs API and emits the receipt; the gate reads that job's output, not a
comment.

**Two things this proposal does not settle**, and both belong to the PM decision
rather than to this lane: whether the git job's evidence, passed between jobs as
an output, is trusted to the same standard as the base-SHA-pinned checkout; and
whether carrying an approval forward at all is the right answer to head-pinned
staleness, as against changing how the ledger writes to `main`. This lane's
position is that the mechanism is now sound enough to be *reviewed*, not that it
should be adopted.

## Scope note

`scripts/ops/**` only, plus this lane's own artifacts. No workflow, no policy
input, no CODEOWNERS, no branch protection, no merge-gate change. The verifier
remains pure and read-only; the collector still performs no write.

## Known gaps, stated rather than omitted

- **C7 cannot be computed for an empty PR diff**, and reports as unavailable
  rather than as a match, so two unrelated empty diffs can never read as
  identical to each other.
- **C6's anchor is the merge-base, not `origin/main`'s tip** — see the diff
  summary. This is a deliberate divergence from the issue text and is the
  difference between a usable control and an always-refuse one.
- **The `rev-list` cross-check in C1 is redundant** (mutation M4). Kept, and
  documented as redundancy.
- **`Return review packet` will report this lane's own proof artifacts as
  out-of-scope.** That is the recorded defect in `pr-review-packet.ts:487-491`,
  where the allowed scope admits only literal `expected_proof_paths` entries and
  no proof glob. It is not one of the four required checks and blocks no merge.

## Merge SHA Binding

Merge SHA: d35b82217aabc5efeac6b27e47b21f8029d19967
PR: https://github.com/griff843/Unit-Talk-v2/pull/1514

`sha_binding.merge_sha` is `null` pre-merge and `verified_source_sha` is the last
commit that changed source. `post-merge-lane-close.yml` runs
`ops:proof-generate --merge-sha` after the merge; no manual append is made here.

## Addendum — the review packet's scope contradiction, closed by hand on this lane

`Return review packet` failed at head `5050048fa` with:

```
"detail": "out-of-scope files: docs/06_status/proof/UTV2-1839/.gitkeep,
           docs/06_status/proof/UTV2-1839/evidence.json"
```

Both files are required by the system that rejected them. `ops:lane-start`
**creates and commits** the `.gitkeep`. `Executor Result Validation` selects the
narrow legacy proof contract — which demands a real merge SHA pre-merge, and so
cannot pass — unless `evidence.json` exists. Yet
`scripts/ops/pr-review-packet.ts:487-491` builds the allowed scope from
`scopeLock + sameIssueLaneMetadataPaths(issueId) + expectedProofPaths`, and
`sameIssueLaneMetadataPaths` (`:662-668`) covers only the sync file and the
manifest — no proof glob. So the lane's own proof directory is admitted **only**
by literal `expected_proof_paths` entries, and `ops:lane-manifest update` cannot
extend that list (`lane-manifest.ts:128` sets it at `create` only).

Closing it exposed a second contradiction between the same two gates. Adding
`.gitkeep` to `expected_proof_paths` satisfied the review packet and immediately
failed `Close eligibility preflight` with `CEP-E2 empty proof artifacts:
docs/06_status/proof/UTV2-1839/.gitkeep` — one gate demands the file be declared,
the other refuses a declared artifact that is empty, and `ops:lane-start` creates
it empty. The resolution taken here is to **delete the placeholder**: it existed
only to make an empty directory committable, and the directory now holds three
real files. `evidence.json` and the two markdown artifacts are declared in
`expected_proof_paths`, which is a truthful widening — each listed path is a real
file this lane produced. It is recorded here because the
underlying repair is one of the two named in `plan.md` — give the packet a
`docs/06_status/proof/<ID>/**` glob the way `sameIssueLaneMetadataPaths` already
does for the sync file and the manifest, or teach `ops:lane-manifest update` to
extend the list — and neither is in this lane's scope.

`Return review packet` is not one of the four required checks, so this blocked no
merge. This is its second measured occurrence.
