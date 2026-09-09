# `approval-carry-forward/v1`

**Status:** PM-authorized 2026-09-05. Implemented as an operator tool only.
**Not yet wired into merge authority.** See "Reserved" below.

---

## What this is

A mechanically verified statement that a PM approval pinned to an earlier head SHA is still
*factually* applicable at the current head, because everything that arrived since was a merge from
authoritative `main` carrying only permitted bookkeeping.

## What this is not

It is **not** an approval, and it never becomes one.

- It carries forward a PM decision that already exists. It asserts nothing about the implementation.
- The original `pm-verdict/v1` comment is preserved exactly as written, and is never edited, deleted
  or superseded.
- An agent-generated receipt must never be presented as a new independent PM review.

Every rendered receipt ends with the sentence that keeps this honest:

> This receipt carries forward the PM decision recorded at Original-Verdict-SHA. It is not an
> independent review and asserts nothing about the implementation.

## The security property everything else rests on

**The receipt is an OUTPUT, never an INPUT.**

Any caller must recompute all four conditions itself, from git and the GitHub API, and then emit the
receipt. Nothing may accept a receipt supplied as a comment, a file, or a workflow input. If a
posted receipt were ever treated as evidence, any actor with comment access could forge one — which
is exactly the failure this mechanism exists to avoid.

`scripts/ops/approval-carry-forward.ts` is pure and read-only by construction: it performs no
network call, writes no file, and mutates nothing. All evidence is injected by the caller, which is
what allows each condition to be tested against the exact case it names.

## The four conditions

All four must pass. Any single failure refuses the carry-forward.

### C1 — a previously approved ancestor, and only merges from authoritative `main` after it

Let `A` be the head SHA of the surviving `pm-verdict/v1` APPROVED comment, and `H` the current head.

- `A` must be a genuine ancestor of `H`.
- Every commit on the first-parent chain `A..H` must be a **merge commit**, so no newly authored
  commit can sit on that chain.
- Each such merge's **second parent** must be an ancestor of `origin/main` **as fetched during this
  verification** — never a local ref, and never the PR's own base snapshot.
- An empty chain refuses. If the head has not moved, the original verdict is still valid on its own
  and no carry-forward is needed.

### C2 — the reviewed artifact is unchanged

No path changed between `A` and `H` may match implementation, tests, dependencies, configuration,
schema, or **this issue's own proof bundle and lane manifest**:

`apps/**`, `packages/**`, `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `package.json`,
`**/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, `**/*.config.*`,
`.env*`, `deploy/**`, `docker-compose*`, `**/Dockerfile*`, `supabase/migrations/**`,
`docs/06_status/proof/<THIS-ISSUE>/**`, `docs/06_status/lanes/<THIS-ISSUE>.json`.

### C3 — incoming changes limited to explicitly permitted bookkeeping

Two lists, evaluated **deny first**, so that widening the allowlist later can never accidentally
admit a reserved path.

**Deny — always requires a fresh review:**

```
docs/mission/**                      mission
docs/05_operations/**                acceptance criteria, approval policy, security contracts
docs/governance/**
.github/**                           approval policy and CI
CODEOWNERS, **/CODEOWNERS
.lane/**, .claude/**, .agents/**     execution authority
scripts/**
supabase/migrations/**
docs/06_status/lanes/<THIS-ISSUE>.json
docs/06_status/proof/<THIS-ISSUE>/**
.ops/sync/<THIS-ISSUE>.yml
.ops/leases/<THIS-ISSUE>.json
```

**Permitted bookkeeping — the complete allowlist:**

```
docs/06_status/lanes/UTV2-*.json      another lane's manifest
docs/06_status/proof/UTV2-*/**        another lane's proof bundle
docs/06_status/readiness/**           the readiness ledger bot
.ops/sync/UTV2-*.yml
.ops/leases/UTV2-*.json
```

`docs/**` and `.ops/**` are deliberately **not** exempted wholesale; the allowlist enumerates leaf
patterns. A path matching neither list refuses. Deny-by-default is the correct asymmetry here: a
false refusal costs one manual verdict, while a false accept bypasses a review that was required.

### C4 — checks green at the resulting head, and no changes-requested afterwards

- `verify`, `Executor Result Validation` and `P0 Protocol` must each be present and `success` at
  `H`. An absent context refuses; it is never read as green.
- `Merge Gate` is excluded, because it is the intended caller and its own verdict cannot be an input
  to its own decision.
- No `pm-verdict/v1` **CHANGES_REQUIRED** comment, and no GitHub review in state
  **CHANGES_REQUESTED**, may have been created after the approving comment. Both surfaces are
  checked, because a PM can withdraw approval through either.

## Receipt format

```
APPROVAL_CARRY_FORWARD: VERIFIED | REFUSED
schema: approval-carry-forward/v1
Issue: UTV2-####
Original-Verdict-SHA: <40-char sha the PM approved>
Original-Verdict-URL: <permalink to the original pm-verdict/v1 comment>
Current-Head-SHA: <40-char current head>
Generated-By: <workflow run URL>

Conditions:
- [x] C1 — ...
- [x] C2 — ...
- [x] C3 — ...
- [x] C4 — ...

Admitted paths:
- docs/06_status/lanes/UTV2-1834.json (rule: docs/06_status/lanes/UTV2-*.json)

This receipt carries forward the PM decision recorded at Original-Verdict-SHA. It is not an
independent review and asserts nothing about the implementation.
```

## Reserved — what is deliberately NOT changed here

Merge authority is a reserved surface (`docs/mission/intent.md`, reserved decision 7). Wiring this
verifier into `.github/workflows/merge-gate.yml` — so that a stale verdict consults it before
reporting BLOCKED — is a separate change that requires PM review as an architecture decision.

Until that lands:

- `strict: true` branch protection is untouched.
- No required check is removed or weakened.
- No existing gate changes behaviour. This module is not called by any workflow.
- Nothing is written to `main` outside the normal PR path.

This staging is deliberate, and follows `intent.md` § "How a reserved decision is surfaced": the
dependent work is prepared and verified as far as existing authority allows, so that the reserved
decision itself is a small, obvious diff rather than a large one.

## Reference case

PR #1503 (UTV2-1812) on 2026-09-05. Approved at `b06593e94`, then overtaken twice within two hours
purely by other lanes' merges landing on `main`. At head `6bfc5875a` the PR's own diff was measured
byte-identical to the approved diff, every commit added was a merge from `main`, and the only files
that changed were other lanes' manifests, proof bundles and the readiness ledger — the exact shape
C1 through C4 are written to recognise.
