# Preservation Controls — Proof

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02.
> How the constitution is protected from disappearing again.

## Control 1 — Version-controlled canonical home
The constitution lives at `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` in the repo (the authoritative truth surface). It is no longer dependent on a Downloads folder or Linear.

## Control 2 — Fail-closed preservation guard
`scripts/constitution-check.ts` (`pnpm constitution:check`) **exits 1** if any of these fail:
- any of the 6 required artifacts is missing,
- the constitution does not contain exactly **19 capability layers** (§4.1–§4.19),
- the **14 principles** (§2.1–§2.14) are not all present,
- the **§18 roadmap** + **Programs 1–5** are not present,
- the **§23 end state** is missing.

It also computes the constitution SHA-256 and **warns** if it diverges from the pinned value `b22b6e5b…` (tamper-evidence; warn-not-fail so an intentional re-ratification is possible with a pin update).

## Control 3 — Adversarial proof the guard works (§2.13)
Verified live this sprint:
| Adversarial action | Guard result |
|---|---|
| Remove `PROGRAM_ALIGNMENT_MATRIX.md` | `FAIL: Missing required constitutional artifact` → exit 1 |
| Delete capability layer §4.19 header | `FAIL: Expected 19 capability layers, found 18` → exit 1 |
| Restore pristine | SHA `b22b6e5b…` → `RESULT: PASS` → exit 0 |

## Control 4 — SHA pin
`PINNED_CONSTITUTION_SHA256 = b22b6e5b47ece0d2b04688ad4b29e2fc3cb20fd09d00e50f91ac1e5fe3e2efc5` in the guard. Any silent edit to the doctrine file surfaces as a WARN on every run.

## Recommended follow-on hardening (not done this sprint — requires PM/CI owner)
1. **Add `pnpm constitution:check` to a CI gate** (e.g. a `constitution-guard.yml` workflow or the `verify` chain) so the guard runs on every PR, not just on demand. *(Deferred: adding a CI workflow is a governance change for PM/Codex.)*
2. **Promote the SHA-pin warning to a hard fail** once the constitution file is considered frozen, so any doctrine edit must be an explicit re-ratification PR.
3. **CODEOWNERS** entry for `docs/00_constitution/**` requiring PM review on any change.
