# /execution-truth

Enforce the Unit Talk V2 execution-truth model. Apply whenever you are deciding whether work is Done, whether a claim is authoritative, or whether a state can be trusted.

**Canonical spec:** `docs/05_operations/EXECUTION_TRUTH_MODEL.md`
**Done-gate spec:** `docs/05_operations/TRUTH_CHECK_SPEC.md`

---

## When this skill applies

Apply automatically when:
- deciding whether a Linear issue is Done
- reconciling Linear state against repo truth
- evaluating an agent or PM claim that work is "finished"
- writing status updates, recaps, or PR descriptions
- handling a proof bundle or evidence artifact
- considering whether to reopen an issue
- any time narrative and artifacts disagree

Also apply when you catch yourself about to say "I completed this" — stop and run through the done-gate instead.

---

## Truth hierarchy (ranked — higher wins unconditionally)

| Rank | Source | Authoritative For |
|---|---|---|
| 1 | **GitHub `main`** | shipped code, merge SHAs, CI on merge |
| 2 | **Proof bundle** (tied to merge SHA) | completion evidence for T1/T2 |
| 3 | **Lane manifest** (`docs/06_status/lanes/*.json`) | active lane state |
| 4 | **Linear** | workflow intent, tier label, ownership |
| 5 | **Chat / memory / agent claims** | context only — never authoritative |

**Laws:**
- Higher ranks win unconditionally. If rank 1 contradicts rank 4, rank 4 is wrong.
- The agent may never escalate its own claim above a lower rank it has read.
- `ISSUE_QUEUE.md`, `PROGRAM_STATUS.md`, and similar docs are *views*, not truth.

---

## Done-gate law

An issue is Done **if and only if all are true**:

1. Merge commit exists on `main`'s first-parent history.
2. CI on the merge commit is green.
3. Required proof artifacts exist at declared paths and reference the merge SHA.
4. `ops:truth-check <UTV2-###>` exits 0.
5. Lane manifest records the truth-check pass and has `status: done`.
6. Linear transitioned to Done by `ops:lane:close`, not by hand.

An issue is **not Done** on the basis of:
- agent narrative ("I finished this")
- an open or draft PR
- green CI on an unmerged branch
- a proof file that does not reference the merge SHA
- PM verbal approval without a GitHub label
- memory, session notes, or chat summary

If any rank-1 or rank-2 source contradicts Done, the issue is not Done. Period.

---

## Narrative vs artifact rule

**Artifacts are authoritative. Narrative is not.**

Before describing any state or making any recommendation that depends on state:

- Did you check the artifact, or are you recalling it?
- Does the artifact currently agree with your claim?
- If you cite a file path, function, commit, or PR — does it exist right now?

If you cannot point to the artifact, do not make the claim. Say "I need to verify" and verify.

**Forbidden claim patterns:**
- "This should be done" (should ≠ is)
- "The PR was merged earlier" (check `main`)
- "The test passed last time I ran it" (re-run or don't claim)
- "I believe the proof is attached" (open it or don't claim)

---

## Proof expectations

Proof is **tied to the merge SHA**, not to the branch, not to a date, not to "recently."

| Tier | Required Proof |
|---|---|
| T1 | Evidence bundle v1 with both `static_proof` and `runtime_proof` sections, schema-validated, SHA-tied |
| T2 | Diff summary + verification log referencing type-check and test outcomes |
| T3 | Green CI on merge SHA |

- **Static proof** = verifiable without running the merged code (CI logs, diffs, schema validation, file contents).
- **Runtime proof** = requires the merged code to have run against live/staging infra (row counts, receipts, audit entries, delivery outcomes).
- **T1 requires both.** Neither substitutes for the other.

Stale proof is forbidden: if `mtime < merge_commit_timestamp`, or if the header SHA does not match the merge SHA, the proof is invalid. Regenerate — do not paper over.

---

## Reopen conditions

An issue returns from Done to In Progress if any are true:
- `ops:truth-check` run post-merge fails for a reason tied to the merge SHA
- a follow-up commit on `main` within 24h touches files in `files_changed` without a linked follow-up issue
- required proof artifacts become unreadable or schema-invalid
- a phase-boundary guard flags a violation traced to the merge SHA
- PM explicitly reopens via a `reopened` label

Reopen is mechanical, not polite. The fix is never "mark it Done again" — it is to resolve the failing check and re-run truth-check.

---

## When to invoke truth-check

Invoke `ops:truth-check <UTV2-###>` when:
- closing a lane (always; `ops:lane:close` wraps it)
- re-checking a recently-Done issue after any follow-up activity on touched files
- PM asks "is this really done?"
- you find yourself about to narrate completion instead of verifying it

Treat a missing or failing truth-check as "not Done." Do not interpret exit code `2` (ineligible) as failure — it means "come back later." Exit code `4` means reopen, not fail.

---

## Red flags — stop if you see these

- A recap or status update that claims Done without citing a merge SHA
- A proof file with a header SHA that does not match the current merge
- Linear says Done but no merge commit is reachable on `main`
- An open PR being described as "effectively complete"
- A manifest with `status: merged` but no truth-check entry, being treated as Done
- A follow-up "fix" commit landing on `main` after Done, without a linked issue
- The agent (you) composing a summary from memory instead of reading the artifacts

Report the drift before composing any further narrative.

---

## Rationalization resistance

| You might think… | But actually… |
|---|---|
| "I completed this" | You don't decide Done. `ops:truth-check` decides Done. Run it. |
| "The PR was merged, so it's shipped" | Check `main` first-parent history. Merged PRs can be reverted or force-pushed over. |
| "I remember the proof was valid" | Memory is rank 5. Open the proof file and check the SHA. |
| "Linear says Done, so it's Done" | Linear is rank 4. GitHub `main` is rank 1. Check rank 1. |
| "This is just a status update, accuracy isn't critical" | Status updates that cite wrong state create drift. Verify before writing. |

---

## Output format (when invoked explicitly)

```
## Execution Truth Check

### Claim under test
[the claim being evaluated]

### Artifacts consulted
- GitHub main: [merge SHA or "no merge found"]
- Proof bundle: [path + SHA match status]
- Lane manifest: [status + last truth-check result]
- Linear state: [state + tier]

### Verdict
DONE — [merge SHA, truth-check pass timestamp]
— or —
NOT DONE — [specific failing check IDs or missing artifacts]
— or —
DRIFT DETECTED — [which sources disagree and which wins]

### Required action
[what must happen next — regenerate proof / run truth-check / reopen / correct Linear]
```
