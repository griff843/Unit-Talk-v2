# PROOF: UTV2-1980

MERGE_SHA: pending merge

Issue: UTV2-1980
Tier: T1
result: blocked (precondition drill cannot be satisfied by a privilege-only migration; evidence.json withheld until drills have real PASS receipts)

## ASSERTIONS:

- [x] Migration and down script are role-guarded: every role-specific REVOKE/GRANT runs only if the role exists in pg_roles; `security_invoker` and the PUBLIC revoke are unconditional; a fail-closed DO check raises if an existing role ends with wrong privileges (up: anon/authenticated none, service_role SELECT only, view security_invoker; down: all three hold ALL, no security_invoker).
- [x] Schema round-trip drill passes on scratch Postgres (run 39805611542, job 119917901417).
- [x] Live Schema Parity passes (run 39805611447, job 119917945208).
- [x] On staging (xskgrzbteyqdufktjrjx), verbatim statements of the guarded SQL replayed in a rolled-back transaction: before/after/recovered/reapplied snapshots correct; a tamper (GRANT SELECT to anon) makes the end-state check raise (fail closed).
- [ ] Fail-closed precondition drill: NOT MET. `[FAIL] declaration - ... has no "-- FAIL-CLOSED-PRECONDITION:" declaration`. The drill (scripts/ci/migration-precondition-drill.ts) seeds a declared relation as a decoy and requires SQLSTATE 42P07; a privilege-only migration on an existing view has no such relation. The NO-PRECONDITION-REQUIRED exemption is unreachable on a single-migration PR (drilled-0 backstop). No drill-shaped guard was added.
- [ ] Down-script presence check: NOT MET. The script exists; the step fails only at proof binding (`evidence.json not found`). evidence.json is withheld because the migration profile requires PASS receipts for precondition_drill, which does not exist.

## EVIDENCE:

Staging replay (project xskgrzbteyqdufktjrjx, ci.yml idle at run time, one DO block ending in RAISE EXCEPTION so everything rolled back; post-check confirmed original ACL and no options). Statements were taken from the files programmatically (the migration file text at ca6287f23; the later commit only added a `-- lint-override` comment inside a plpgsql array line):

```
0 BEFORE:   all 3 roles = all 7 privileges ; opts=null ; acl={postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
1 AFTER:    anon=- ; authenticated=- ; service_role=SEL ; opts={security_invoker=true} ; acl={postgres=arwdDxtm/postgres,service_role=r/postgres}
service_role count=0 (empty staging view); anon denied; authenticated denied (permission denied for view)
2 RECOVERED: identical to BEFORE
3 REAPPLIED: identical to AFTER
NEGATIVE ok: after GRANT SELECT to anon the end-state check raised "end-state wrong: anon SELECT expected f"
```

Control-view evidence (identical view without revoke keeps full anon/authenticated ACLs) is recorded from the first staging replay of the unguarded SQL: acl={postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}.

Reader check (static): board route, market-family-trust-service, Command Center board data, phase6 proof script and run-scoring all use the service-role client.

## Verification

Implementation head under test: 3877c791035d1a20041f354e42cc0cb5b58cdfa4 (guard commit ca6287f23, lint-override commit 3877c7910). Results read from GitHub:

- migration-reversibility-gate run 39805611542: Schema round-trip drill PASS; Fail-closed precondition drill FAIL (declaration missing, see above); Down-script presence check FAIL (evidence.json not found).
- Live Schema Parity run 39805611447: PASS.
- On ca6287f23, CI verify failed on lint-migrations D3 (TRUNCATE privilege name inside the guard); fixed by a lint-override in 3877c7910. CI Writable DB proof (staging) passed on ca6287f23.
- Lane Authority Check: fails with `Issue not found: UTV2-1980` (non-required Linear lookup; PM item).

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1775
