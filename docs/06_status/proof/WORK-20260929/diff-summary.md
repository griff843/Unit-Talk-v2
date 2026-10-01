# Diff summary: WORK-20260929

PR: https://github.com/griff843/Unit-Talk-v2/pull/1695

## Implementation

- Compacts the always-loaded `AGENTS.md` while preserving architecture, testing,
  Tier C, verification, and closeout controls.
- Adds scoped agent-brief selection derived from lane type and file scope.
- Keeps worker scanner-quiescence and stranded/`awaiting_approval` protections
  in worker packets, and falls back to the complete brief if any requested
  section cannot be resolved exactly once.
- Adds an explicit local-only `pnpm ops:brief -- --static` path.
- Adds deterministic Luna/Sol-medium routing, keeps Astra disabled, and records
  execution prompt-size, token, duration, and model-routing evidence.
- Adds focused repository search, concise verification output with full logs,
  old-`gh` compatibility, WORK-* identity support, and the Codex CLI 0.153.3
  PATH correction.
- Retains the #1700-era preflight/readmission recovery logic from current
  `main`; the merge introduced no diff to `scripts/ops/lane-link-pr.ts` or
  its regression tests.

## Control-plane bookkeeping

- `.ops/sync/WORK-20260929.yml` and
  `docs/06_status/lanes/WORK-20260929.json` record the sanctioned readmission
  and PR binding.
- This proof directory contains the exact-source verification, measurements,
  and deterministic model route for PM review.

## SHA binding

Verified source SHA: `c4a930972604c60b6a0e34d9087b2a4311b5c629`
Merge SHA: d298cb4a4ba67d7e1bcd0aa3884151bdb9fde0d0
