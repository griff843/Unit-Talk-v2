# UTV2-1724 — diff summary

MERGE_SHA: 4444932205f34aa76058e36072f3aa171057d488

That SHA is an anchor required by the executor-result validator, not a claim that nothing substantive followed it. This lane has **three** substantive commits: the grammar and tripwire (`44449322`), the completion-gate SHA comparison (`8ace5346`), and two escape hatches in the tripwire itself (`55c8fe10`).

Two files, both under `.github/workflows/`. No runtime code, schema, migration, or dependency change.

## `.github/workflows/linear-auto-close.test.sh`

1. **Closeout form added to extraction — subject line only.** A third close-intent form:
   `^chore\(lanes\):[[:space:]]+close[[:space:]]+UTV2-[0-9]+`, matched against the **first line** of the message.
   Bare `close` is deliberately *not* added to the inline `(closes|fixes|resolves)` alternation — it is an ordinary English word, and matching it anywhere would close an issue on prose like "do not close UTV2-N until the gate lands". Restricting to the subject matches the single-line message the producer writes, and keeps extraction in the same scope as the signature below. An earlier revision matched any line at column 0, which left a body line able to close an issue the tripwire could not see.

2. **`has_lane_closeout_signature()` added — subject line only.** A predicate, separate from extraction, recognising a commit produced by the closeout path: its conventional-commit scope with any close verb form, or the literal trailer phrase in the subject. Deliberately **broader** than the grammar that consumes it, so template drift keeps matching the signature while the grammar stops. `Revert "..."` subjects are exempt — `git revert` reproduces the reverted subject verbatim, and undoing a closeout is a deliberate act, not drift.

3. **`has_close_suppression_marker()` added.** Answers whether extraction returned empty because a deliberate opt-out filtered the result, or because no close-intent form matched at all. It calls `extract_close_ids_ignoring_suppression()` and checks whether the **forms** matched. An earlier revision grepped the message for the words `plan-only` / `partial-fix` / `No-close:`, which meant any commit whose prose merely mentioned them silently disabled the tripwire.

4. **`evaluate_completion_block()` added.** The truth-gated completion decision, moved out of the workflow YAML so the harness drives the real decision path rather than a paraphrase of it.

5. **39 test cases added**, taking the harness from **28 to 67**, 0 failures: 14 covering the sanctioned closeout form and every other `chore(lanes):` producer that must *not* close, 12 covering the tripwire including cases proving prose can neither silence nor trigger it, and 13 driving the full completion-decision path over realistic manifests and closeout ancestry.

## `.github/workflows/linear-auto-close.yml`

The extraction step's empty-`ids` branch previously emitted `::notice decision=no_close reason=no_close_intent` and exited 0 for *every* commit. It now checks the closeout signature first: a commit that carries one, without a suppression marker, emits `::error reason=closeout_signature_unmatched` and **exits 1**. Ordinary commits and deliberate opt-outs are unchanged.

## `.github/workflows/linear-auto-close.yml` — the completion-gate P1

`MERGE_SHA` is `github.sha`, the pushed commit. On the sanctioned closeout path that is the closeout commit, created *after* the merge, while the manifest's `commit_sha` is bound to the merge. The gate's `[ "$m_sha" != "$MERGE_SHA" ]` therefore compared two SHAs that can never be equal, refusing every sanctioned closeout with *"manifest commit_sha X is not this merge SHA Y"* — a second fail-open that survives the grammar fix.

- `resolve_authoritative_merge_sha()` resolves the merge SHA the closeout already recorded, reading only fields the gate already cross-checks. Non-closeout commits still resolve to the pushed SHA.
- `sha_is_ancestor_of_push()` restores the guarantee the broken comparison was reaching for: the claimed merge must actually be reachable from the pushed commit. Fails closed on any API error.
- `evaluate_completion_block()` moves the decision out of YAML into the shared file, so the harness drives the real path.
- The Linear comment now cites and links the implementation merge, keeping the closeout commit as a secondary reference; previously it recorded the bookkeeping commit as the change that shipped.

## Behavioural change

Commits from the sanctioned closeout path now transition their Linear issue instead of silently resolving to nothing. A future drift in the closeout template fails the workflow on its first commit instead of stranding lanes. Completion is decided against the implementation merge SHA rather than the closeout commit, so a healthy closeout is no longer refused. No other commit shape changes behaviour.
