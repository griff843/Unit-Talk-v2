# Merge-Deploy Discipline

**Authority:** This document is the canonical policy for migration deployment to live Supabase.

## Rule

All database migrations must merge to `main` before being applied to the live Supabase project (`feownrheeefbcsehtsiw`).

Direct application of migrations via the Supabase Management API from developer machines against the main project is prohibited.

## Rationale

Applying migrations before merge creates drift between `main` (shipped truth) and the live database. If the PR is later revised or reverted, the database state no longer matches any commit on `main`.

## Allowed Exception: Preview Branches

Supabase preview branches created by CI are the approved path for testing migrations against real DB state before merge. Preview branches are isolated and disposable. They do not affect the main project.

## Enforcement

1. CI applies migrations on merge to `main` (standard Supabase GitHub integration).
2. Developer machines must not run `supabase db push` or Management API migration applies against the main project ref.
3. For pre-merge validation, use a Supabase preview branch.

## Policy Breach Record

**Date:** 2026-04-10
**Issue:** UTV2-519
**What happened:** Migrations `202604100004` and `202604100005` were applied directly to the live Supabase project via the Management API before the corresponding PR was merged to `main`.
**Corrective action:** This policy document was created. Future violations will be caught by CI-enforced merge-order checks when available.
