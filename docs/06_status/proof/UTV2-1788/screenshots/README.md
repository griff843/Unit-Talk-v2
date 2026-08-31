# UTV2-1788 — Command Center screenshot evidence

MERGE_SHA: 216098727bf2508393adb3902137aade4f04697d
Merge SHA: 216098727bf2508393adb3902137aade4f04697d

## Summary

This directory holds the visual capture set referenced by `../verification.md`.
It is an asset directory of that proof bundle, not a proof bundle of its own.
The Proof Auditor Gate scans every directory under `docs/06_status/proof/**`
independently, so an asset directory with no markdown reads to it as a proof
bundle missing its verification document. That is an auditor scoping defect,
recorded under UTV2-1625; this file states what the assets are so the directory
is self-describing either way.

## Evidence

Captured by `e2e/command-center.spec.ts` against `next start` on a production
build (not the dev server), so no framework development diagnostics appear in
the images. Desktop is 1440x1000; mobile is 390x844 with the navigation drawer
transition awaited before capture.

| Workflow | Route | Desktop | Mobile |
| --- | --- | --- | --- |
| Overview | `/` | `desktop-overview.png` | `mobile-overview.png` |
| Review | `/review` | `desktop-review.png` | `mobile-review.png` |
| Active Picks | `/active-picks` | `desktop-active-picks.png` | `mobile-active-picks.png` |
| Settlement | `/settlement` | `desktop-settlement.png` | `mobile-settlement.png` |
| Exceptions | `/exceptions` | `desktop-exceptions.png` | `mobile-exceptions.png` |
| System Health | `/system-health` | `desktop-system-health.png` | `mobile-system-health.png` |

Twelve PNGs, one desktop and one mobile capture per primary workflow. The spec
asserts the H1 text and the final URL for each workflow before capturing, so a
screenshot cannot be recorded against a redirected or error route.

## What these images do not prove

The capture ran with `COMMAND_CENTER_AUTH_MODE=fail_open` as an ephemeral
process environment so an uncredentialed workstation could render the internal
UI. That is a local rendering affordance, **not** production authorization
evidence, and no environment or auth file was modified. Command Center is still
not production-deployed. The unsafe production `fail_open` precedence remains an
open Tier C residual described in `../verification.md`.
