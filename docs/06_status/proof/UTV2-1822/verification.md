# PROOF: UTV2-1822 — migration-history correspondence via non-executable receipts

MERGE_SHA: pending merge

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1482

Anchor: bb8b9cac2983ba3e477b14237e27843960e69693 — the last non-proof commit on this branch and the head every CI
receipt below was captured against. Only proof-path commits follow it.

## Verification

### What was broken

`supabase db push` does not fail partway through when local and remote migration history
disagree. It refuses to start:

```
Remote migration versions not found in local migrations directory.
```

The check lives in `pkg/migration/apply.go:46`, reached from `up.go:42` and `push.go:33`.
It requires the local directory to be a **superset** of the remote ledger. Production's
ledger held 127 versions with no local file, so there was no sanctioned path to apply any
migration to production at all.

`--include-all` does not relax this. That flag governs out-of-order **local** migrations;
the missing-local precondition is separate and unconditional. This was measured, not
assumed: the flag was tried and produced a byte-identical failure and stack.

`supabase migration list --linked` does not surface it either. It reports these versions
as informational `remote_only` rows and exits 0, so the blocker is invisible to the
command an operator would naturally reach for.

### The measured before-state

```
supabase migration list --linked
both=7  local_only=0  remote_only=127
```

### What was built

One comments-only receipt per remote-only version, in `supabase/migrations/`, named with
that version prefix so the CLI pairs it. Each binds a `sha256` of the exact SQL that
actually executed and declares subsumption by the baseline snapshot.

Source selection follows the required preference order and was applied uniformly rather
than case by case:

| Source | Versions | Rule |
|---|---|---|
| `ledger_payload` | 104 | `statements` array present — reconstructed verbatim |
| `archive_fallback` | 23 | `statements` NULL — existing archive file, hash-bound |

The executed SQL is preserved outside the replay path under
`supabase/migrations_archive/ledger/`. Where a version also has an archive file (78 of
them) the receipt records `archive_intent_path` and an explicit `archive_diverges`
verdict. Nothing is reconciled: the ledger is executed truth, the archive is intent.

### Ledger extraction was direct, not transcribed

The 127 ledger rows were read through the Supabase Management API query endpoint
(`POST /v1/projects/{ref}/database/query`) authenticated with the CLI's own access token,
and written straight to disk. This matters for fidelity: the alternative was passing
~76KB of historical SQL through a model context and retyping it, where a single altered
byte would have silently corrupted preserved history. Every artifact is a direct copy of
what the ledger returned. Read-only `SELECT`; no write, no DDL.

### Divergence — 2, not 3

An earlier audit reported three ledger/archive divergences. Re-measured with a normaliser
that strips SQL comments before comparing, there are **two**:

| Version | Divergence |
|---|---|
| `202604080016` | ledger carries an additional `DELETE FROM public.audit_log ... '90 days'` |
| `202604210005` | ledger `INSERT INTO public.sports (id, name)` vs archive `(id, display_name, sort_order)` |

`202604300003` differs only by a UTV2-868 recovery **comment** in the archive file. A
comment cannot have executed, so it is not an executed-SQL divergence. The earlier count
came from a normaliser that did not strip comments. Correcting it downward was the
conservative direction to be wrong in, so it is stated explicitly rather than quietly
adjusted.

### Why re-executing history would have been unsafe

Six versions are the same logical migration applied twice under two different version
strings. Two are proven by the later row's `name` literally embedding its partner's
version (`202604270001_utv2_752_...` at version `20260427045252`;
`202605090001_utv2_862_...` at version `20260509160906`); the other four share a UTV2
slug (`utv2_727` twice, `utv2_753`, `utv2_82`). **All six pairs have different source
hashes** — the second application executed different SQL, not a replay of the first.

Five further versions are aliases of migrations still in the active replay path
(`20260714203644`, `20260714231357`, `20260801134241`, `20260801134256`,
`20260801222906`).

Executing any of these again would duplicate objects the baseline already creates. That
is the failure the receipt model exists to avoid, and it is why the drill below measures
behaviour rather than inspecting files.

### Behaviour-level replay — scratch Postgres

`scripts/ci/migration-history-replay-drill.ts`, run 33575558404, job 100078640448 (`migration-reversibility-gate / Schema round-trip drill (scratch Postgres — all new migrations)`), at head `bb8b9cac2983ba3e477b14237e27843960e69693`

```
phase 0: receipt manifest structurally valid
replay set: baseline=1 receipts=127 forward=6
phase 1: baseline applied, 1396 catalog entries
phase 2: all 127 receipts replayed with ON_ERROR_STOP=1
phase 3: catalog fingerprint identical before and after all 127 receipts (1396 entries compared)
phase 4: 6 forward migrations replayed
migration-history-replay-drill: PASS
```

Phase 0 gates the rest. `validateReceipts()` from
`scripts/ci/migration-history-receipt-validator.ts` runs first and the drill refuses to
replay a set that has already failed structural validation — replaying an invalid set
would report a green catalog comparison for a set nobody should trust, which is exactly
the case where an inert-looking replay is most misleading. This wiring was not
cosmetic: required `verify` failed the validator as `WIRING_CAPABILITY_ORPHAN` because
nothing invoked it, and a validator no CI path runs enforces nothing. It was given a
real caller rather than a suppression. Mutation check: corrupting one recorded
`source_sha256` produces `FAIL: receipt manifest is invalid (2); refusing to replay.`
before any `psql` call.

Phase 3 is the load-bearing assertion. Phase 1 exists to stop it being vacuous: if the
baseline had not applied, both fingerprints would be near-empty and identical and the
drill would report PASS having proven nothing. The first CI execution of this drill
reported `1 catalog entries`, which was a line-counting artefact — `COPY ... TO STDOUT`
escapes newlines, so the whole fingerprint arrived on one line — but a proof that cannot
be told apart from a vacuous one is not adequate. The drill now emits one row per catalog
entry and refuses below a floor of 200.

The fingerprint covers relations, columns with types, constraints and function identities
across all non-system schemas.

### Correspondence restored — measured against live production

```
supabase migration list --linked
both=134  local_only=0  remote_only=0
```

```
supabase db push --linked --dry-run
Would push these migrations:
 • 20260901150000_utv2_1811_rate_limit_buckets.sql
EXIT=0
```

Exactly one migration proposed. **The push was not executed.** Read-only and `--dry-run`
only; no production DDL, `migration repair`, `db pull`, raw SQL, or Smart Form
submission occurred in this lane.

### Every control was made to fail

`scripts/ci/migration-history-receipt-validator.ts` — 9 mutations, all caught, control clean:

| Mutation | Detected as |
|---|---|
| executable SQL appended to a receipt | receipt contains executable SQL |
| receipt file deleted | receipt file missing from `supabase/migrations/` |
| receipt renamed to another version | missing counterpart + unlisted receipt |
| preserved historical SQL modified | `source_sha256` mismatch |
| preserved historical SQL deleted | source artifact does not exist |
| unlisted file with the receipt header | absent from `RECEIPTS.json` |
| duplicate `remote_version` in manifest | duplicate remote_version |
| baseline replaced as replay root | not version `00000000000000` |
| a receipt dropped from the manifest | declares 126, expected 127 |

The "no executable SQL" rule is an allowlist — *nothing but comments* — not a keyword
denylist, which would fail open on the first statement nobody anticipated.

### The exemptions are not self-certifying

Two gates presuppose that a new migration executes DDL. Both were taught about receipts,
and in both the exemption is decided by reading the file's contents, never by trusting
its header:

| Gate | Control | Mutation | Result |
|---|---|---|---|
| `migration-reversibility-gate.ts` | receipt needs no down script | header + `DROP TABLE public.picks;` | **loses exemption** — "Missing down script" |
| `migration-reversibility-gate.ts` | " | header removed | **loses exemption** — "Missing down script" |
| `migration-precondition-drill.ts` | receipt has no precondition to drill | header + `DROP TABLE public.picks;` | **loses exemption** — "no FAIL-CLOSED-PRECONDITION declaration" |
| `migration-precondition-drill.ts` | " | header removed | **loses exemption** — same |

Both share one predicate (`scripts/ci/migration-history-receipt.ts`) so a shell gate and a
TypeScript gate cannot drift into disagreeing about which files are inert — a drift in
that direction means a file one gate treats as inert gets executed by another.

The reversibility gate's own 7 adversarial tests still pass.

### Why the precondition drill was not handled with its exemption marker

The workflow already supports `-- NO-PRECONDITION-REQUIRED:`. It is the wrong tool here.
That path does not increment `DRILLED`, and this PR's only new migrations are receipts,
so marking all 127 would drive the job's own "a run that drilled nothing is not a pass"
backstop to zero and fail — correctly. The drill script now returns a named `pass` result
instead, so every file the job counted yields a real result and the backstop keeps its
meaning.

### Static verification

```
pnpm type-check                                    → exit 0
pnpm exec tsx --test scripts/ci/migration-reversibility-gate.test.ts
# tests 7   # pass 7   # fail 0
pnpm exec tsx scripts/ci/migration-history-receipt-validator.ts
migration-history-receipt-validator: PASS (127 receipts)
pnpm exec tsx scripts/ci/migration-reversibility-gate.ts --base origin/main
migration-reversibility-gate: PASS
```

Required checks are cited from CI at the anchor, not from a local run, because the
authoritative execution is the one GitHub performed on this head:

```
pnpm verify   (job `verify`)  → SUCCESS  run 33575558347, job 100080123460
              covers env:check, lint, pnpm type-check, build and pnpm test
scripts/ci/r-level-check.ts   → SUCCESS  run 33576476049 (R-Level Compliance Check)
```

Stated precisely: `pnpm verify` was NOT green in this local worktree — `env:check` fails
here because `local.env` was deliberately removed from it, and a local `pnpm test` run was
killed part-way by the host rather than failing (0 `not ok`, 0 non-zero fail counts across
18,461 lines before the kill). The green that this proof relies on is the CI `verify` job
above, which runs the same script with credentials present.

### What is deliberately not claimed

- **No production DDL was applied.** The rate-limit migration remains unapplied; this lane
  only makes the sanctioned command able to run.
- **The 8 archived migrations with live effects but no ledger row are untouched.** They are
  out of scope and do not obstruct the acceptance path.
- **Phase 1 of the replay drill applies the baseline tolerantly.** Scratch Postgres lacks
  `transaction_timeout` and the `service_role` role, so a handful of statements error.
  That is a property of the container, not of this change; both fingerprints are taken
  inside the same container, so the phase-3 comparison is unaffected. Phases 2 and 4 run
  strictly.
- **`archive_diverges` is computed after stripping comments and normalising whitespace.**
  It answers "did different SQL execute", not "are the files byte-identical".

### Containment

| | |
|---|---|
| Production DDL | none |
| Production writes | none |
| `db push` executed | no — `--dry-run` only |
| `migration repair` / `db pull` | none |
| Smart Form submission | none |
| Baseline / existing migrations modified | none |
| Other workflow files modified | none |

ASSERTIONS:

EVIDENCE: every numbered assertion below cites the CI run and job that produced it; the
runs are enumerated in `evidence.json` under `runtime_proof`, all taken at the anchor
`bb8b9cac2983ba3e477b14237e27843960e69693`.

## Assertions

1. Local migration history is a superset of the remote ledger: `remote_only=0`, measured
   against production.
2. `db push --dry-run` proposes exactly one migration and nothing else.
3. All 127 receipts replay against a clean database with `ON_ERROR_STOP=1` and leave the
   catalog fingerprint unchanged.
4. No receipt contains an executable statement, and a control fails when one is added.
5. The exact SQL that executed is preserved and hash-bound; a control fails when it is
   modified or removed.
6. Ledger/archive divergence is preserved on both sides, never reconciled.
