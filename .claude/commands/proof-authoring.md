# /proof-authoring

How to write a proof bundle that is **true** and that passes every gate that reads it. `/t1-proof` covers assembling a T1 evidence bundle; `/verification` covers whether work is verified. This skill covers the document itself — the file where fabrication is easiest and most damaging.

---

## Rule 1 — every number is a pasted command output

**A figure you computed, remembered, or estimated is a fabrication, regardless of whether it happens to be right.**

Each statistic in a proof must be accompanied by the command that produced it, and the output must be pasted, not paraphrased. If you cannot name the command, delete the number.

This is the single highest-frequency defect in this repo's proof history: file counts, insertion counts, and test counts that disagreed with reality across multiple correction rounds, each time discovered by a reviewer rather than by the author.

### Test counts are not interchangeable

`pnpm verify` and `pnpm test` produce different totals — `verify:static` includes suites that `pnpm test` does not. Label which command produced the number:

```
pnpm test        → 4934/4934
pnpm verify      → (larger; includes verify:static suites)
```

Reporting one under the other's name is a false statement even when both are green.

### Whole-diff counts self-invalidate

A "files changed" or "insertions" figure computed over the whole diff **includes the proof file itself**. Writing that number into the proof changes the number. Use a stable subset instead and say so explicitly:

```bash
git diff --stat origin/main...HEAD -- scripts/ apps/ packages/
```

> Scope of this figure: implementation files only, excluding `docs/06_status/**`.

---

## Rule 2 — never cite an artifact you did not read

Do not describe a test's behavior, a shim, an assertion, or a fixture unless you have just read it in the file. Borrowing a reviewer's description of your own code into your proof is a fabricated citation — it has happened here, and it is indistinguishable from lying to a reader who trusts the document.

If a claim rests on a reviewer's finding, attribute it: "per review comment <id>", not as your own observation.

---

## Rule 3 — the SHA field must be a token

The `Merge SHA:` field must hold a 40-character hex SHA or the literal `N/A`. Prose in that field makes `ops:proof-rebind` refuse, stranding the lane merged-but-unclosed.

```
MERGE_SHA: 0000000000000000000000000000000000000000
```

Post-merge binding is automated — `post-merge-lane-close.yml` runs `ops:proof-generate --merge-sha` after merge. Do not append the SHA by hand unless recovering (see `/lane-recovery` S8).

Use `sha_binding` schema v2 in `evidence.json`: `verified_source_sha` plus CI sentinels. Never a single `branch_head_sha` chasing the PR tip. Rule 4 of that schema: every commit between `verified_source_sha` and HEAD must touch only `docs/06_status/proof/**` or `docs/06_status/lanes/**`.

---

## Rule 4 — satisfy all readers, which want different things

Three gates read the proof directory and each wants something different. Write a layout that satisfies all of them at once rather than iterating against whichever one is currently red.

**`proof-auditor-gate.ts`** (`--proof-dir`, `--sha`, optional `--r-level`, `--require-executed-command`)
- At least one markdown file in the proof dir.
- At least one of `## Summary`, `## Evidence`, `## Verification` present somewhere in the bundle.
- **No placeholder strings anywhere**: `TODO`, `TBD`, `PLACEHOLDER`, `INSERT HERE`, `your SHA here`, `FILL IN`. This is a hard failure and it scans every file, including JSON.
- `--r-level r2` additionally requires the word `determinism` somewhere.
- A `--require-executed-command` that is *not* a writable-DB command must appear in the text **with node:test pass evidence**: `# pass <n>`, `# fail 0`, `# skipped 0`.
- Missing `--sha` in the text is a **warning**, not a failure — exact-SHA embedding is impossible at commit time (UTV2-985).
- `pnpm test:db` is explicitly **not** audited from proof text (UTV2-1630): text cannot show which database a run targeted. Enforcement moved to the CI-produced `ci-db-proof-receipt/v2`, verified inside the required `verify` context. Do not paste hand-typed TAP to satisfy it — that path was removed precisely because it was forgeable.

**`runtime-verifier-gate.ts`** (`--proof-dir`, `--sha`)
- Looks only at markdown files whose **filename** contains `runtime`, `verification`, or `verify`.
- Each must match one of `## Pre-merge`, `## Runtime Verification`, `## Verification`.
- Each must contain **at least one commit SHA** — this one is a hard failure, unlike the auditor's advisory SHA check.
- Same placeholder ban.

**`t1-proof-gate.yml`** (T1-labelled PRs)
- C1: `docs/06_status/proof/<ISSUE>/verification.md` must exist and must contain the literal string `pnpm verify`.
- C2: the proof directory must exist before live-DB proof execution.

### Layout that satisfies all three

`docs/06_status/proof/UTV2-###/verification.md`:

```markdown
# PROOF: UTV2-###
MERGE_SHA: <40-hex or N/A>
ASSERTIONS: <count>
EVIDENCE: <relative paths>

## Summary
...

## Evidence
...

## Verification
Command: pnpm verify
<pasted output>

## Runtime Verification
<pasted output, or an explicit statement of why this lane has no runtime surface>
```

Filename must stay `verification.md` — the `.log` extension is gitignored, and the runtime verifier keys off the filename.

`ops:proof-generate` does not by itself produce a bundle that satisfies all three gates. Generate, then reconcile against this checklist.

---

## Rule 5 — state what you did not do

A proof that omits a skipped step is a false proof. If a check was waived, blocked, or run under an exception, say so in the proof with the reason and the authority. "Not mentioned" reads as "done".

---

## Pre-submit checklist

```bash
pnpm exec tsx scripts/ops/proof-auditor-gate.ts --proof-dir docs/06_status/proof/UTV2-### --sha <head> --json
pnpm exec tsx scripts/ops/runtime-verifier-gate.ts --proof-dir docs/06_status/proof/UTV2-### --sha <head> --json
pnpm ops:proof-check --pr <number> --json
grep -nE 'TODO|TBD|PLACEHOLDER|INSERT HERE|FILL IN' docs/06_status/proof/UTV2-###/*
```

Running the auditor **without** the `--require-executed-command` flag CI uses will pass locally while CI fails. Match CI's invocation.

Then re-read the document and, for each number in it, point at the command above it. Any number without one comes out.

---

## Rationalization resistance

- "The figure is approximately right" — approximately right is fabricated.
- "It was right when I wrote it" — a proof describes a specific SHA. Re-measure after every commit.
- "The reviewer already confirmed this" — cite them, don't absorb their finding as your own observation.
- "Adding the TAP block will satisfy the DB requirement" — it will not; that path was deliberately closed.
- "I'll fill the SHA in later" — `PLACEHOLDER` and friends are a hard gate failure, and prose in the SHA field breaks rebinding.

## Red flags — stop and report

- Any sentence in a proof you cannot trace to a command output or a file you read this session.
- A proof that passes locally but whose local invocation differs from CI's.
- A statistic that changes when you re-run the command.
