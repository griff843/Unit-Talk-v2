# PROOF: UTV2-1643 — pnpm audit --prod blocks all PRs on 5 new advisories

MERGE_SHA: 0a03450f

## Summary

At approximately 2026-08-01T04:25Z, `verify`'s `pnpm audit --prod --audit-level high`
step started failing on every open and future PR — a fresh advisory-database update
surfaced 5 distinct high/critical findings simultaneously, none present the last time
`pnpm audit` ran clean. Confirmed repo-wide, not scoped to any one lane: PR #1350
(UTV2-1633) failed on this exact step at 04:25:15Z while PR #1349 (UTV2-1624), whose
`verify` had completed minutes earlier, was unaffected only by timing.

## Findings, all measured via `pnpm audit --prod --audit-level high --json`

| severity | package | vulnerable | patched | advisory |
|---|---|---|---|---|
| critical | next-auth | `>=5.0.0-beta.0 <=5.0.0-beta.31` | `>=5.0.0-beta.32` | GHSA-8fpg-xm3f-6cx3 — existence-based auth checks fail open on config errors |
| high | sharp | `<0.35.0` | `>=0.35.0` | libvips CVE-2026-33327/33328/35590/35591 |
| high | next | `>=13.0.0 <15.5.21` | `>=15.5.21` | Denial of Service in App Router Server Actions |
| high | next | `>=14.1.1 <15.5.21` | `>=15.5.21` | SSRF in Server Actions on custom servers |
| high | next | `>=12.0.0 <15.5.21` | `>=15.5.21` | SSRF in rewrites via attacker-controlled hostname |
| high | postcss | `<=8.5.17` | `>=8.5.18` | Path traversal in source-map auto-loading |

`apps/smart-form/package.json` declares `next-auth: "5.0.0-beta.31"` directly, inside
the vulnerable range. `next` and `sharp` are pulled in transitively across multiple
apps; `postcss`'s existing override floor (`8.5.14`) was itself inside the newly
vulnerable range and needed raising, not just re-adding.

## Fix

`pnpm-workspace.yaml` overrides, following the existing established pattern
(`@babel/core`, `ws`, `undici` entries already there for the same reason):

```yaml
"next-auth@<5.0.0-beta.32": 5.0.0-beta.32
"sharp@<0.35.0": 0.35.0
"next@<15.5.21": 15.5.21
```

Plus raising the existing `postcss` floor from `8.5.14` to `8.5.18` in place (not a
second, conflicting entry).

## Verification (this exact worktree, this exact commit)

```
pnpm audit --prod --audit-level high  →  "No known vulnerabilities found"
pnpm type-check                       →  exit 0, no diagnostics
pnpm lint                             →  exit 0, no findings
pnpm build                            →  exit 0
pnpm test                             →  # tests 19 / # pass 19 / # fail 0
```

Ran in this order specifically to catch any breaking change from the `next`/`sharp`
major-version-adjacent bumps before merging — none found. `pnpm-lock.yaml` updated by
the same `pnpm install --frozen-lockfile=false` that applied the overrides; no other
file touched.

## Not run locally (no local staging credentials on this host — expected)

`Writable DB proof (staging only)` / `pnpm test:db` — this PR touches no runtime or
DB code, so no live-DB evidence is applicable. `verify` on the PR itself carries the
authoritative CI result.

## Scope

This is a dependency-pin change only. No application logic, migration, or governance
tooling touched. Tier T3.

## ASSERTIONS:

- `pnpm audit --prod --audit-level high` reports zero vulnerabilities on this commit.
- `pnpm type-check` exits 0 with no diagnostics.
- `pnpm lint` exits 0 with no findings.
- `pnpm build` exits 0.
- `pnpm test` reports 19 pass, 0 fail.
- Only `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and this proof file are touched — no application code changed.

## EVIDENCE:

```
$ pnpm audit --prod --audit-level high
No known vulnerabilities found

$ pnpm type-check
> tsc -b tsconfig.json
(exit 0, no output)

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no output)

$ pnpm build
> tsc -b tsconfig.json
(exit 0, no output)

$ pnpm test
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
