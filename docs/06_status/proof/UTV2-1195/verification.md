# UTV2-1195 — Verification

**Lane:** SPRINT-CERTIFICATION-STATE-RECONCILIATION-003 · **Tier:** T2 · **Executor:** Claude
**Branch:** `griffadavi/utv2-1195-sprint-certification-state-reconciliation-003`

## Verification

### Gate results (branch)

| Gate | Result |
|---|---|
| `pnpm verify` (env:check + lint + type-check + build + test + verify:commands) | **PASS** ✅ |
| `pnpm type-check` (tsc -b, project references) | **PASS** ✅ (exit 0) |
| Issue-specific: `tsx --test scripts/ci/live-schema-parity-workflow.test.ts` | **PASS** ✅ (2/2 — original gate wiring + new fail-closed-gate assertions) |
| `verify:commands` (command-manifest, migration versions, lint-migrations) | **PASS** ✅ (117 migrations clean) |

### What this lane delivers (D-CONST closures)

- **D-CONST-3** — canonical repo certification records authored: `PROGRAM_1_CERTIFICATION.md` (P1 Truth = ACTIVE_CERTIFIED, frozen-surface SHA `9600938`) and `PROGRAM_4_CERTIFICATION.md` (P4 = CONDITIONAL_NOT_CERTIFIED).
- **D-CONST-1** — §18.3 numbering cleanup: canonical-mapping markers in `PROGRAM_2_CERTIFICATION.md` and `CERT_BOARD.md` (foundation WS-1.x = P1; cert-framework INIT-2.x = P2).
- **D-CONST-2** — stale "P3/P4 certified" / "P1–P4 gate SATISFIED" / "P5-A eligible" claims superseded in `CERT_BOARD.md` and `PROGRAM_5_ACTIVATION.md`.
- **D-CONST-7 (parity-gate half)** — `live-schema-parity.yml` made non-skippable (fail-closed when required) + mechanically tested. **Types-regen half deferred** to a Codex Migration lane (see caveat 1) — `database.types.ts` is a Migration-lane-only path per `LANE_TAXONOMY.md`, forbidden to this governance lane.

### Constraint compliance

- **No certification advanced.** P3/P4/P5 not advanced. P4 explicitly recorded as NOT certified. P5 stays FROZEN.
- **No runtime behavior change.** Changes are docs, generated types, and CI gate + its test.
- File scope: exactly the declared `file_scope_lock` (6 modified + 2 new source/doc files + 2 proof files).

### Caveats / follow-ups (transparent)

1. **Types regen is deferred to a Codex Migration lane (not in this PR).** `packages/db/src/database.types.ts` is owned exclusively by the **Migration lane** per `docs/governance/LANE_TAXONOMY.md` (regenerated only via `pnpm supabase:types` after a migration; a Governance lane is forbidden from `packages/**`). The lane-authority CI gate enforces this. The drift is real and confirmed: `execution_intents` + `settlement_corrections` exist in live schema `zfzdnfwdarxucxtaojxm` but are absent from the generated types. A **Codex Migration lane (T1, PM-approved)** should run the canonical `pnpm supabase:types` regen (note: the direct-DB path is also network-blocked from this environment — IPv6 unreachable — so CI/Codex with DB connectivity is required). This governance lane's contribution is the **fail-closed parity gate**, which now surfaces exactly this drift until the regen lands.
2. **Parity gate is fail-closed *gated on a flag*.** Enforcement triggers on `main`/protected refs or when `CI_REQUIRE_SCHEMA_PARITY` is truthy. CI currently has **no** `SUPABASE_DB_URL` secret, so to activate full enforcement the PM must: (a) provision the `SUPABASE_DB_URL` GitHub secret, and (b) set repo variable `CI_REQUIRE_SCHEMA_PARITY=1`. Live Schema Parity is **not** a branch-protection-required check, so the gate going red does not hard-block merges — it is the honest "unverified" signal D-CONST-7 intends.
3. **Cert docs require PM ratification.** Per the issue executor split ("Claude doc authoring + PM ratify"), these canonical records are authored here and await PM ratification. No certification status is self-issued.

### SHA binding

Authored at branch HEAD (pre-merge). Per T2, the proof binds to the **merge SHA** post-merge — `merge_sha` to be set in the lane manifest and this bundle after merge (not the branch HEAD SHA).

### Linear state

UTV2-1195 moved Backlog → Ready for Claude; labels set `tier:T2`, `area:governance`, `lane:claude` (was labels=[], Backlog).
