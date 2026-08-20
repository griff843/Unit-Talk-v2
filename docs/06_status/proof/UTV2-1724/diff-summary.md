# UTV2-1724 — diff summary

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

## Behavioural change

Commits from the sanctioned closeout path now transition their Linear issue instead of silently resolving to nothing. A future drift in the closeout template fails the workflow on its first commit instead of stranding lanes. No other commit shape changes behaviour.
