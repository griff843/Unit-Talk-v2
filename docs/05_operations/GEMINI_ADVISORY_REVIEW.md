# Gemini advisory review — integration seam

**Status:** defined, not installed. Nothing in CI or the merge path depends on this document.
**Authority:** `docs/mission/intent.md` → Multi-model execution.

---

## What this is

Griff wants an independent model-family reviewer for high-risk security and architecture work and
for large-context analysis, on the reasoning that two models from the same family share their blind
spots. Gemini is the intended reviewer. It is **not installed and not proven useful yet**, so this
file defines the seam it will attach to rather than pretending an integration exists.

The seam is written down now for one reason: the last operating model grew reviewers that started
advisory and quietly became gates, and the cost was a human servicing a queue. This one is
constrained before it exists.

## Non-negotiable constraints

1. **Non-blocking, permanently.** Gemini review is never a required status check, never a merge
   condition, and never a reason a PR waits. Adding it to branch protection would change merge
   authority, which is itself a reserved surface (`RESERVED_RISK_SURFACES.json` →
   `merge-authority`) and requires Griff.
2. **Advisory output only.** It produces findings for a human or for Claude to weigh. It cannot
   approve, reject, label, or comment a `pm-verdict/v1`. Approval authority is Griff's and is
   asserted by a CODEOWNERS-authored verdict — a model cannot hold it.
3. **No consensus voting.** Work is routed on outcome, risk and comparative model strength, not on
   agreement between models. Two models agreeing is not evidence; a specific reproducible finding is.
4. **Read-only.** No write access to the repo, no branch or PR mutation, no credentials beyond a
   read scope. It receives a diff and returns text.
5. **No secrets in the payload.** A diff sent to a third-party model is disclosure. Never send
   `.env` files, credential material, or production data samples — the same reserved-surface list
   that gates merges marks what must not leave the repo.

## Where it attaches

| Trigger | Shape | Result |
|---|---|---|
| Manual, on a specific PR | `gemini review --diff <base>...<head>` invoked by the operator or by Claude | findings printed to the session; Claude decides what to act on |
| Optional GitHub workflow | a `pull_request` job with `continue-on-error: true`, posting one comment | comment only; never added to branch protection |

The manual path is the one to build first. A workflow that comments on every PR earns its keep only
after the manual path has produced findings that mattered — otherwise it is noise with a token bill.

## Proving it is useful before relying on it

Before Gemini review is described anywhere as part of the operating model, it must have produced, on
real Unit Talk diffs:

- at least one finding that was **real, specific, and not found** by CI, Claude review, or Codex review;
- with a false-positive rate low enough that reading its output is cheaper than not reading it.

Record the outcome in `docs/mission/plan.md` → Learned. If it fails that bar, say so there and drop
it; a reviewer nobody reads is worse than no reviewer, because it looks like coverage.

## What to do today

Nothing is required. When Gemini CLI access exists, wire the manual path, run it against the highest-
risk open diff, and write down what it found. Until then this file is the whole integration.
