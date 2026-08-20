# PROOF: UTV2-1724

MERGE_SHA: N/A

Lane: auto-close intent grammar misses sanctioned closeout commits, stranding merged lanes as ghosts.
Tier: T1 · lane_type: governance · proof profile: static
Substantive anchor: `4444932205f34aa76058e36072f3aa171057d488`

## Summary

The auto-close grammar recognized two close-intent forms. The sanctioned closeout path emits a third that neither matched, so every closeout commit it produced resolved to no issue IDs and the Linear transition silently never fired. The grammar is extended to the shape production actually emits, and — the more important half — a no-match on a commit carrying a lane-closeout signature now **fails the workflow** instead of logging a notice.

## Verification

ASSERTIONS:

- [x] The defect reproduced against `origin/main`'s own grammar: it returns an empty ID list for the verbatim producer output, while its harness reports 28 passed / 0 failed. The suite was green because it never tested the one commit shape production emits.
- [x] The extended grammar extracts the correct ID from the verbatim producer output, from an ASCII-hyphen variant, and from a message carrying a body.
- [x] Every other `chore(lanes):` producer in this repo is proved NOT to close: lane-start metadata, branch readmission, PR binding, truth-check record, and stale-lane auto-reconcile. Each has an explicit MUST-NOT-CLOSE case citing its producing line.
- [x] Bare `close` is not added to the inline alternation. Prose forms — a negated verb, a mid-line verb, and an unanchored quotation of a closeout subject — all yield no IDs.
- [x] The existing `No-close:` / `plan-only` / `partial-fix` opt-out still suppresses the new form.
- [x] The fail-closed control is validated **by execution on the condition it names**, not by presence: a drifted closeout template exits 1 with `reason=closeout_signature_unmatched`.
- [x] The control does not fire on any legitimate case: sanctioned closeout, deliberate opt-out, and an ordinary commit all exit 0.
- [x] Harness: **47 passed, 0 failed** — all 28 pre-existing cases still green.
- [x] `bash -n` clean on the test file; the workflow YAML parses.
- [x] No runtime code, schema, migration, or dependency change. Two `.github/workflows/` files only.

## Runtime Verification

EVIDENCE:

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

### 4. Harness after the change

```text
$ bash .github/workflows/linear-auto-close.test.sh
  === UTV2-1724: SANCTIONED CLOSEOUT COMMITS ===   12 cases, all PASS
  === UTV2-1724: FAIL-CLOSED TRIPWIRE ===           7 cases, all PASS

  Results: 47 passed, 0 failed
```

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
