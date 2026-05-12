# /execution-truth

Operational guard against narrative-vs-artifact drift. Apply when deciding if work is Done, whether a claim is authoritative, or when a state can be trusted.

**Done-gate (operational):** `/verification`
**Canonical spec:** `docs/05_operations/EXECUTION_TRUTH_MODEL.md`
**Done-gate spec:** `docs/05_operations/TRUTH_CHECK_SPEC.md`

---

## Truth hierarchy (ranked — higher wins unconditionally)

| Rank | Source | Authoritative For |
|---|---|---|
| 1 | **GitHub `main`** | shipped code, merge SHAs, CI on merge |
| 2 | **Proof bundle** (tied to merge SHA) | completion evidence for T1/T2 |
| 3 | **Lane manifest** (`docs/06_status/lanes/*.json`) | active lane state |
| 4 | **Linear** | workflow intent, tier label, ownership |
| 5 | **Chat / memory / agent claims** | context only — never authoritative |

Laws: higher ranks win unconditionally. The agent may never escalate its own claim above a lower rank it has read. `ISSUE_QUEUE.md`, `PROGRAM_STATUS.md`, and similar docs are *views*, not truth.

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

## Done-gate

The operational done-gate (7-step pre-closure checklist, tier matrix, proof rules, PM verdict format) lives in `/verification`. Do not duplicate it here. To check if work is Done, run `/verification` against the tier — never decide from this skill alone.

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

## Red flags — stop if you see these

- A recap or status update that claims Done without citing a merge SHA
- A proof file with a header SHA that does not match the current merge
- Linear says Done but no merge commit is reachable on `main`
- An open PR being described as "effectively complete"
- A follow-up "fix" commit landing on `main` after Done, without a linked issue
- The agent (you) composing a summary from memory instead of reading the artifacts

Report the drift before composing any further narrative.
