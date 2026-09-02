# DIFF SUMMARY: UTV2-1822 — migration-history correspondence via non-executable receipts

## Why anything changed

`supabase db push` aborts before doing anything when the remote migration ledger
contains a version that has no local file (`pkg/migration/apply.go`, "Remote migration
versions not found in local migrations directory"). Production's ledger held 127 such
versions. The consequence was not a degraded push — there was no sanctioned path to
apply *any* migration to production, including UTV2-1811's rate-limit contract.

`--include-all` does not relax this. It governs out-of-order **local** migrations; the
missing-local precondition is separate and unconditional.

## What changed

### 1. 127 non-executable historical version receipts — `supabase/migrations/`

One comments-only `.sql` file per remote-only version, named with that exact version
prefix so the CLI pairs it. Each records the remote version and name, the authoritative
source of its executed SQL, a `sha256` binding of that source, and the assertion that
its effects are subsumed by `00000000000000_baseline_live_schema.sql`.

They execute nothing. The baseline remains the replay root and no historical DDL is
re-run.

### 2. Preserved executed SQL — `supabase/migrations_archive/ledger/`

104 artifacts reconstructed verbatim from the ledger's ordered `statements` arrays, plus
`RECEIPTS.json` — the machine-readable correspondence manifest. The remaining 23 versions
carry no ledger payload and bind their existing `supabase/migrations_archive/` file
instead. This is the source-preference order the lane was given: ledger where present,
archive only where the ledger is silent.

Where a version has both a ledger payload and an archive file, the archive path is
recorded as `archive_intent_path` with an explicit `archive_diverges` verdict. Divergence
is preserved, never reconciled: the ledger is executed-history truth, the archive is
later-edited intent, and both survive.

### 3. Controls — `scripts/ci/`

| File | Role |
|---|---|
| `migration-history-receipt.ts` | The single definition of "this file executes nothing". |
| `migration-history-receipt-check.ts` | CLI wrapper so shell gates get the same answer from the same code. |
| `migration-history-receipt-validator.ts` | Enforces count, version correspondence, source existence, hash binding, divergence policy, and that no receipt gains executable SQL. Exported as `validateReceipts()` and invoked by the replay drill as phase 0, so it runs on every migration PR rather than sitting unreferenced. |
| `migration-history-replay-drill.ts` | Behaviour-level proof: validates the manifest, then replays the model against scratch Postgres and compares catalog fingerprints. Refuses to replay a set that failed validation. |

`migration-reversibility-gate.ts` gains a receipt exemption. It is granted on verified
file contents, never on the header claim — a file asserting the receipt header while
carrying SQL loses the exemption and is held to the ordinary down-script rule.

### 4. `.github/workflows/migration-reversibility-gate.yml` — +29/-0, two hunks

Added to this lane's `file_scope_lock` under PM approval recorded in Linear. Hunk one
exempts verified receipts in the drill loop via the in-scope predicate. Hunk two runs the
replay drill against the job's existing scratch Postgres, in its own database.

## What did NOT change

No production DDL, `db push`, `migration repair`, `db pull`, or raw SQL. No Smart Form
submission. No change to the baseline snapshot, to any existing migration, to any
archive file, or to any other workflow. The seven active forward migrations are
untouched.

## Populations

| | Count |
|---|---|
| Remote-only versions before | 127 |
| Receipts created | 127 |
| Sourced from ledger statements | 104 |
| Sourced from archive file (no ledger payload) | 23 |
| Versions with an archive counterpart recorded | 78 |
| Genuine executed-SQL divergences | 2 |
| Versions applied twice under different version strings | 6 |
| Versions that are aliases of active migrations | 5 |
