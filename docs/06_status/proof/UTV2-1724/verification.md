# PROOF: UTV2-1724

MERGE_SHA: 4444932205f34aa76058e36072f3aa171057d488

Lane: auto-close intent grammar misses sanctioned closeout commits, stranding merged lanes as ghosts.
Tier: T1 · lane_type: governance · proof profile: static
Substantive commits: **every `fix(ci)` commit on this branch**. They are not enumerated by SHA here — the list has grown with every review round, and three revisions of this note stated a count that was already stale by the time it was committed — the same self-referential drift the count was meant to avoid. No number is given. Run `git log --oneline origin/main..HEAD` and read every `fix(ci)` entry; the `chore(proof)` entries are proof-only.

`MERGE_SHA` stays bound to the first because the executor-result validator requires a single ancestor SHA. It is an anchor, not a claim that nothing substantive followed it — an earlier revision made exactly that claim and it was false.

## Summary

Two independent fail-opens on the same path, either of which alone strands a merged lane.

**First**, the grammar recognized two close-intent forms and the sanctioned closeout path emits a third, so every closeout commit resolved to no issue IDs.

**Second — and this one survives the grammar fix** — the truth-gated completion gate compared the manifest's `commit_sha` against `github.sha`. On the closeout path `github.sha` is the closeout commit, created *after* the merge, so the comparison could never match. Fixing extraction alone converts a silent `no_close_intent` ghost into a silent `completion withheld` ghost: same stranded lane, different reason. Both are closed here, and a no-match on a commit carrying a lane-closeout signature now **fails the workflow** instead of logging a notice.

## Verification

ASSERTIONS:

- [x] The defect reproduced against `origin/main`'s own grammar: it returns an empty ID list for the verbatim producer output, while its harness reports 28 passed / 0 failed. The suite was green because it never tested the one commit shape production emits.
- [x] The extended grammar extracts the correct ID from the verbatim producer output, from an ASCII-hyphen variant, and from a message carrying a body.
- [x] Every other `chore(lanes):` producer in this repo is proved NOT to close: lane-start metadata, branch readmission, PR binding, truth-check record, and stale-lane auto-reconcile. Each has an explicit MUST-NOT-CLOSE case citing its producing line.
- [x] Bare `close` is not added to the inline alternation. Prose forms — a negated verb, a mid-line verb, and an unanchored quotation of a closeout subject — all yield no IDs.
- [x] The existing `No-close:` / `plan-only` / `partial-fix` opt-out still suppresses the new form.
- [x] The fail-closed control is validated **by execution on the condition it names**, not by presence: a drifted closeout template exits 1 with `reason=closeout_signature_unmatched`.
- [x] The control does not fire on any legitimate case: sanctioned closeout, deliberate opt-out, and an ordinary commit all exit 0.
- [x] Harness: **75 passed, 0 failed** — all 28 pre-existing cases still green.
- [x] The tripwire's own escape hatches are closed, both found by adversarial review of this lane:
  - The opt-out test grepped the message for `plan-only` / `partial-fix` / `No-close:`. Any commit whose **prose** mentioned them silently disabled the tripwire — a fail-open inside the fix for a fail-open, reproduced on this lane's own squash merge. It now asks whether the close-intent **forms** matched and were filtered, which prose cannot fake.
  - The signature scanned the whole message, so a commit that merely **described** a closeout template matched. It is now subject-line only, matching the single-line message the producer actually writes. Verified: this PR's own squash merge carries no signature and does not fire.
- [x] Further holes found by later review rounds, each reproduced before fixing:
  - **Reverting a closeout reddened `main`.** `git revert` reproduces the reverted subject verbatim, so `Revert "chore(lanes): close <ID> — lane closed, sync file removed"` carried both signatures while extracting nothing, firing the tripwire on a correct, deliberate revert. `Revert "..."` subjects are now exempt: undoing a closeout is an intentional act, not template drift.
  - **A third, unaligned scope — the fourth recurrence of this one bug class.** `extract_close_ids_ignoring_suppression()`, which the tripwire consults to tell a deliberate opt-out from drift, still scanned the whole message after the other two were narrowed to the subject. A drifted subject whose *body* carried a well-formed closeout line therefore reported a form match, the tripwire read that as an intentional opt-out, and real drift passed in silence — the exact ghost this lane exists to abolish. All three scopes are now aligned, and a case asserts agreement across all three rather than two, plus a case reproducing the exploit itself.
  - **An opt-out for an unrelated issue silenced a drifted closeout.** The signature came from the subject while the `No-close:` came from the body and named an ID an inline verb had matched there — the two paths disagreed about *which* issue "deliberate" applied to. Suppression now requires a `No-close:` naming the ID in the subject's own closeout form; a drifted subject yields no such ID, so nothing in the body can make drift deliberate.
  - **Reverts were under-covered and the phrase match was unanchored.** `Reapply "..."` — the subject `git revert` writes when reverting a revert — plus `revert!:` and `Reverts:` all reddened `main`, and a subject merely *quoting* the closeout template did too. Revert and reapply prefixes are now matched case-insensitively across those forms, and the trailer-phrase signature additionally requires an issue id in the subject, which a quotation does not carry but a real closeout always does.
  - **Prose could silently void a valid closeout.** `extract_linear_close_ids()` suppresses on bare `plan-only` / `partial-fix` anywhere in the message — pre-existing behaviour — while the tripwire read any form match as a deliberate opt-out. So a well-formed sanctioned closeout carrying one of those words in its body extracted nothing, and the tripwire stayed silent. Silencing now requires an explicit `No-close:` naming an ID the forms actually found. Extraction's own semantics are unchanged; suppressing a sanctioned closeout by prose is now loud instead of silent.
  - **A scope asymmetry introduced by the subject-only signature.** Extraction still matched any line at column 0, so a commit whose *body* contained `chore(lanes): close UTV2-N ...` would **close that issue** while the tripwire, reading only the subject, stayed structurally blind to it. Extraction's closeout form is now subject-only as well. Extraction and signature must see the same text or the control does not cover the behaviour; a case asserts they agree.
- [x] The completion-gate defect reproduced against the **real merged `UTV2-1721` manifest** from `main`, not a fixture: a lane with `status: done`, `verdict: pass`, runner `ops:lane-close` and its receipt bound to the merge was refused, because `3ca047fa != 44068585`.
- [x] `resolve_authoritative_merge_sha()` introduces no new contract: it reads `commit_sha` and the truth-check receipt's `merge_sha` — the two fields the gate already cross-checks — and resolves nothing when they disagree rather than picking a side.
- [x] Non-closeout commits still resolve to the pushed SHA; behaviour on the ordinary merge path is unchanged.
- [x] Because the resolver reads `commit_sha`, the SHA comparison is true by construction for a closeout. The guarantee is carried instead by an ancestry check — the claimed merge SHA must be reachable from the pushed commit — which fails closed on any API error or missing token.
- [x] The completion decision was moved out of the workflow YAML into `evaluate_completion_block()` in the shared file, so the harness drives the **real** decision path rather than a paraphrase of it.
- [x] End-to-end on the real manifest: the closeout commit extracts `UTV2-1721`, resolves to `3ca047fa`, and the gate returns no block — with the ancestry check running live against the API, not stubbed.
- [x] `bash -n` clean on the test file; the workflow YAML parses.
- [x] No runtime code, schema, migration, or dependency change. Two `.github/workflows/` files only.
- [x] `pnpm type-check` clean.
- [x] `pnpm test` — the full suite across all 97 node:test roots: **4855 tests, 4855 pass, 0 fail, 0 skipped**.
- [x] `scripts/ci/r-level-check.ts` evaluated: verdict PASS, 8 changed files, no R-level artifacts required for this diff.
- [x] `pnpm verify` runs green through every static stage and is refused only at `test:db`, by design, under credential containment. `ci:assert-staging` correctly refuses the containment sentinel `host=127.0.0.1` because writable DB verification requires the staging project. The staging result for this lane must therefore come from CI, exactly as for any governance lane on this workstation.

## Runtime Verification

EVIDENCE:

### 0. Gate commands executed, verbatim

```text
$ pnpm type-check
  -> pnpm exec tsc -b tsconfig.json
  -> clean, no output

$ pnpm test
  -> 97 node:test roots
  -> # tests 4855 / # pass 4855 / # fail 0 / # skipped 0
  -> exit 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1724
  Verdict: PASS
  Changed files: 7
  Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm verify
  -> [lint-migrations] 6 migration file(s) checked — no findings
  -> test:db -> ci:assert-staging
     [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
     [assert-staging] REFUSED: target identity could not be resolved from its URL
  -> exit 1, attributable solely to the containment refusal
```

The `pnpm verify` non-zero exit is the containment guard working, not a lane failure: every static stage passes and `ci:assert-staging` refuses to let a writable DB proof run against anything but the approved staging project. The CI-side staging result is the authority.

### 1. The defect, reproduced against the pre-fix grammar

```text
$ git show origin/main:.github/workflows/linear-auto-close.test.sh > /tmp/old-grammar.sh
$ source /tmp/old-grammar.sh

  chore(lanes): close UTV2-1614 — lane closed, sync file removed -> []
  chore(lanes): close UTV2-1721 — lane closed, sync file removed -> []
  chore(lanes): close UTV2-1590 — lane closed, sync file removed -> []

$ bash /tmp/old-grammar.sh
  Results: 28 passed, 0 failed
```

Empty extraction on every sanctioned closeout commit, and a fully green suite in the same breath. That pairing is the defect: the aggregate green conflated "nothing to close" with "the thing this workflow exists to do did not happen".

### 2. The producer

```text
.github/workflows/post-merge-lane-close.yml:536
  git commit -m "chore(lanes): close $ISSUE_ID — lane closed, sync file removed"
```

Bare imperative `close`. The pre-fix alternation was `(closes|fixes|resolves)`.

### 3. The fail-closed control, proved by execution path

Each row runs the workflow's extraction step verbatim against a real commit message.

```text
sanctioned closeout            exit=0  ::notice decision=will_close ids="UTV2-1614"
DRIFTED template               exit=1  ::error  reason=closeout_signature_unmatched
deliberate opt-out             exit=0  ::notice decision=no_close
ordinary commit                exit=0  ::notice decision=no_close
```

The drift row is the control failing on the condition it names. `has_lane_closeout_signature()` is deliberately broader than the grammar that consumes it, so a future template change keeps matching the signature while the grammar stops — surfacing on the first drifted commit rather than accumulating silently.

### 3a. The completion-gate fail-open, reproduced on real data

The grammar fix makes the workflow *extract* the ID. The gate then decides whether to complete. It compared the manifest against the pushed commit:

```text
post-merge-lane-close.yml pushes, AFTER the merge:

  3ca047fa  UTV2-1721: port bounded harness corrections (#1432)   <- the merge
  44068585  chore(lanes): close UTV2-1721 — lane closed, ...      <- github.sha

real merged manifest, docs/06_status/lanes/UTV2-1721.json on main:
  status                     done
  commit_sha                 3ca047fa8fcae2a8768d2ba63cace8019a5a76ca
  truth_check_history[-1]    verdict pass · runner ops:lane-close
                             merge_sha 3ca047fa8fcae2a8768d2ba63cace8019a5a76ca

gate: [ "$m_sha" != "$MERGE_SHA" ]  ->  3ca047fa != 44068585  ->  ALWAYS BLOCKS
      "manifest commit_sha X is not this merge SHA Y"
```

Nothing is wrong with that lane. It is the healthiest possible closeout, and it was refused.

### 3b. After the fix, on the same real manifest

Run against `git show origin/main:docs/06_status/lanes/UTV2-1721.json`, with the ancestry check live rather than stubbed:

```text
ids      : UTV2-1721
resolved : 3ca047fa8fcae2a8768d2ba63cace8019a5a76ca
gate     : COMPLETE (no block)
```

Resolution returns the implementation merge, not the closeout commit.

### 3c. The decision path, proved case by case

The gate now lives in `evaluate_completion_block()` in the shared file, so these drive the real code the workflow runs, over realistic manifests and closeout ancestry:

```text
pre-fix: healthy manifest vs pushed closeout SHA can never match      PASS
sanctioned closeout on a healthy lane COMPLETES                       PASS
resolver returns the implementation merge SHA, not the closeout SHA   PASS
non-closeout commit still resolves to the pushed SHA (unchanged)      PASS
closeout with no commit_sha fails closed                              PASS
closeout whose receipt is bound to a different SHA fails closed       PASS
closeout on a non-terminal lane is refused                            PASS
closeout with a failing truth-check is refused                        PASS
closeout with a non-canonical runner is refused                       PASS
missing manifest is refused                                           PASS
merge SHA that never landed on main is refused (ancestry fires)       PASS
completes again once ancestry holds — ancestry the only variable      PASS
end to end: same commit extracts an ID and passes the gate            PASS
```

The last two are a matched pair: identical manifest, identical commit, ancestry the only changed variable. That is the ancestry gate proved by making it fail on the condition it names, not by its presence.

### 4. Harness after the change

```text
$ bash .github/workflows/linear-auto-close.test.sh
  Results: 75 passed, 0 failed
```

Per-section counts are deliberately not reproduced here. They shift whenever a case is added to one section rather than another, and two revisions of this bundle already recorded a breakdown that did not match the suite. Run the harness for the current split; the total and the zero-failure result are the load-bearing facts.

### 5. Reconciliation baseline

```text
$ pnpm ops:orchestration-reconcile --current --json
  verdict FAIL  exit 1
  pass 1113 / warn 169 / fail 52

  ORCH-MERGED-PR-LINEAR-DONE   25   (14 distinct issues)
  ORCH-OPEN-PR-MANIFEST-URL    17
  ORCH-LINEAR-ACTIVE-RECORD     9
  ORCH-LEASE-MANIFEST           1
```

Recorded as the **before** state for the replay. Draining it is exit criterion 2 and is deliberately sequenced after this fix merges: replaying a closeout while the grammar is still blind would re-emit commits that again match nothing.

## Stop Condition

The sanctioned replay of the 25-lane backlog and the clean `ops:orchestration-reconcile` run that proves three-way agreement are **not yet performed**. This bundle covers exit criteria 1 (grammar) and the fail-closed requirement only. Merge requires `t1-approved` and a `pm-verdict/v1` APPROVED comment, neither of which this lane may produce for itself.
