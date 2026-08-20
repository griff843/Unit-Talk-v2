# UTV2-1724 — diff summary

MERGE_SHA: 4444932205f34aa76058e36072f3aa171057d488

Two files, both under `.github/workflows/`. No runtime code, schema, migration, or dependency change.

## `.github/workflows/linear-auto-close.test.sh`

1. **Closeout form added to extraction.** A third close-intent form, anchored to line start:
   `^chore\(lanes\):[[:space:]]+close[[:space:]]+UTV2-[0-9]+`.
   Bare `close` is deliberately *not* added to the inline `(closes|fixes|resolves)` alternation — it is an ordinary English word, and matching it anywhere would close an issue on prose like "do not close UTV2-N until the gate lands". Anchoring plus the literal `chore(lanes)` scope matches the sanctioned producer and nothing else.

2. **`has_lane_closeout_signature()` added.** A predicate, separate from extraction, that recognizes a commit produced by the closeout path — by its conventional-commit scope with any close verb form, or by the literal trailer phrase. Deliberately **broader** than the grammar that consumes it, so template drift keeps matching the signature while the grammar stops.

3. **`has_close_suppression_marker()` added.** Distinguishes a deliberate `No-close:` / `plan-only` / `partial-fix` opt-out from drift, so an intentional no-close never trips the tripwire.

4. **19 test cases added** — 12 covering the sanctioned closeout form and every other `chore(lanes):` producer that must *not* close, 7 covering the tripwire including a drifted-template case that asserts the control fires. Harness goes 28 → 47 cases, 0 failures.

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
