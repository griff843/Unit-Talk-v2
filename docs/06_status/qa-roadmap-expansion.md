# QA Roadmap Expansion — UTV2-763 Closeout

> Phase 7E is done. Experience QA has a trust layer (UTV2-761) and Fibery guardrails (UTV2-762).
> This document records the sequencing decision and the three concrete lanes created.

## Decision

Three focused lanes created from the Phase 1/2/4 slices of the roadmap. Discord QA (Phase 3)
and LLM exploratory (Phase 5) are explicitly deferred — both have unresolved dependencies.

## Lanes created

| Issue | Title | Tier | Executor |
|-------|-------|------|----------|
| UTV2-835 | QA: seed persona storage states + access matrix | T2 | Codex |
| UTV2-836 | QA: pick lifecycle E2E (Smart Form → Command Center) | T2 | Codex |
| UTV2-837 | QA: wire fast mode into CI on PR-affected surfaces | T3 | Codex |

## Sequencing rationale

- **UTV2-835 first**: Persona auth states are a prerequisite for UTV2-836 (lifecycle skill needs `vip` storage state). Can run in parallel with UTV2-837.
- **UTV2-836 second**: Depends on auth states from UTV2-835. Highest product-intelligence value — proves the full submission → visibility chain.
- **UTV2-837 parallel**: CI wiring is independent of auth states. Pure tooling change (new workflow + preflight fix).

## Non-starters (deferred, not cancelled)

- **Discord QA** — Discord foundation and delivery credentials must be stable first.
- **LLM exploratory mode** — Deferred until lifecycle E2E and CI gate are proven.
- **Settlement / outbox QA** — Separate concern, tracked under UTV2-433.

## AC verification for UTV2-763

- [x] Roadmap reviewed and converted into 3 focused implementation issues
- [x] First QA expansion lane selected (UTV2-835 auth seeding is the unblocking step)
- [x] Each lane has narrow scope and explicit non-goals
- [x] QA is not a giant undifferentiated project — 3 issues, each under 1 file scope
- [x] UTV2-433 proof/data-wait remains separate
