# PROOF: UTV2-1980

MERGE_SHA: pending merge

Issue: UTV2-1980
Tier: T1
result: blocked (migration is not portable to scratch Postgres; see Verification)

## ASSERTIONS:

- [x] Migration and down script are byte-identical to PR #1774 head 8a46cc1bd (sha256 compared with `git show 8a46cc1bd:<path>`).
- [x] On staging (xskgrzbteyqdufktjrjx) the migration statements make anon and authenticated lose every privilege and leave service_role SELECT only, with security_invoker=true; the down statements restore the measured pre-change posture; reapply converges again (rolled-back transaction, nothing persisted).
- [x] A control view in the same schema without the REVOKE keeps full anon/authenticated ACLs, so the revoke is load-bearing.
- [ ] migration-reversibility-gate drills pass: NOT MET. Both scratch-Postgres drills fail at migration line 36 with `role "anon" does not exist` (scratch Postgres has no Supabase roles; the migration has no role-existence guard).
- [ ] proof-binding / evidence.json: NOT MET. No evidence.json exists, because the migration proof profile requires PASS receipts for precondition_drill and schema_roundtrip_drill, which do not exist.

## EVIDENCE:

Staging snapshots, project xskgrzbteyqdufktjrjx, executed as one DO block that ended in RAISE EXCEPTION so every change rolled back. Post-check confirmed no `zz_control_view`, reloptions null, and the original ACL.

```
0 BEFORE:     anon, authenticated, service_role = SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ; opts=null
              acl={postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
1 AFTER:      anon=- ; authenticated=- ; service_role=SELECT ; opts={security_invoker=true}
              acl={postgres=arwdDxtm/postgres,service_role=r/postgres}
CONTROL:      acl={postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
service_role: SELECT count=0 (staging view is empty; no permission error on underlying tables under security_invoker)
anon:         SELECT denied: permission denied for view v_governed_pick_performance
authenticated:SELECT denied: permission denied for view v_governed_pick_performance
2 RECOVERED:  identical to BEFORE (all privileges for the three roles, opts=null)
3 REAPPLIED:  identical to AFTER
```

Caveat: the statements were replayed verbatim inside a DO block (the migration file's own BEGIN/COMMIT cannot nest); the file itself was not executed against staging.

Static reader check (all four readers use the service-role client): apps/api/src/routes/board.ts and market-family-trust-service.ts via createServiceRoleDatabaseConnectionConfig; apps/command-center/src/lib/data/board.ts via getDataClient (service role, authenticated operator); apps/api/src/scripts/utv2-481-phase6-proof.ts via SUPABASE_SERVICE_ROLE_KEY; scripts/evidence-truthworthiness/run-scoring.ts via createDatabaseClient({useServiceRole: true}).

## Verification

Exact head under test: bb07260246e04774bb1a86db8aca55af4b2bdaf9 (implementation commit d8578932dc4c6d333ccffc1ed746d4fd8934d8ec; the head also carries the bot PR-binding commit bb0726024 and manifest-only changes). Results read from GitHub:

- CI run 39796870799: success (Writable DB proof (staging only) success, verify success).
- Live Schema Parity run 39796870713: success.
- migration-reversibility-gate run 39796870641: FAILURE. Fail-closed precondition drill step failed and Schema round-trip drill failed, both `psql ...sql:36: ERROR: role "anon" does not exist`; Down-script presence check failed at the proof-binding step (`evidence.json not found`).
- Branch Discipline Guard, File Scope Lock Check, R-Level, Tier Label, P0 Protocol: success.
- Lane Authority Check: failure, `Issue not found: UTV2-1980` from the Linear lookup in CI.
- Proof Gate, Executor Result Validator, Return Review Packet, Merge Gate, Close Eligibility Preflight: failure/not satisfied pending proof and the drills above.

Classification: the drill failures are a genuine migration portability defect (unguarded role references), not a workflow defect. Prior art guards role grants with `pg_roles` existence checks (20260901150000_utv2_1811_rate_limit_buckets.sql). The migration is intentionally unchanged pending PM disposition.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1775
