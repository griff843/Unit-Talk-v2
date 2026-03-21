# Rebuild Charter

## Objective

Rebuild Unit Talk as a clean, contract-first platform with explicit ownership, stable operational tooling, and a migration path that does not inherit legacy drift by accident.

## Why A Greenfield Build

- The legacy repository contains valuable logic and domain knowledge, but it also carries coupled paths, outdated documentation, and governance debt.
- The rebuild needs a clean architecture boundary so that every retained concept is re-ratified before implementation.
- A separate repo allows clean issue tracking, cleaner milestones, and a less ambiguous cutover program.

## Non-Negotiables

- `C:\dev\unit-talk-v2` is the implementation workspace.
- `C:\dev\unit-talk-production` is reference-only by default.
- API remains the intended canonical write authority for business tables.
- Contracts and operating docs must exist before implementation depends on them.
- Slack is not truth storage, Notion is not task execution, and Linear is not documentation.
