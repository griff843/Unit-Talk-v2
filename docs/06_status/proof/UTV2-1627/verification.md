# PROOF: UTV2-1627

MERGE_SHA: b6c395f0565ad66ee4c799a10049ed8c5e0594b4

Authoritative implementation SHA: `b6c395f0565ad66ee4c799a10049ed8c5e0594b4`

ASSERTIONS:

- [x] Writable CI and proof execution uses the approved staging target, not production.
- [x] Pull-request shadow parity receives neither production service-role nor anon credentials.
- [x] Shadow parity requires a dedicated mechanically read-only credential.
- [x] Database query failures cannot be converted into zero-count evidence.
- [x] `candidatesScanned=0` fails parity instead of producing a successful comparison.
- [x] Lifecycle token recovery preserves lane ownership, PR binding, dependencies, and singleton scope checks.

EVIDENCE:

```text
authoritative implementation SHA: b6c395f0565ad66ee4c799a10049ed8c5e0594b4
CI run: https://github.com/griff843/Unit-Talk-v2/actions/runs/31265618087
Writable DB proof (staging only): PASS
pnpm verify: PASS
pnpm type-check: PASS (executed by pnpm verify)
pnpm test: PASS (executed by pnpm verify)
focused shadow/workflow tests: 102 pass / 0 fail
mutation testing: NOT_RUN; no mutation result is claimed by this proof
shadow parity live observation: BLOCKED until a mechanically read-only production role is provisioned; no empty result is accepted as PASS
scripts/ci/r-level-check.ts: PASS in exact-head CI
```

## Verification scope

The focused total is the non-overlapping sum of these measured runs:

- `pnpm exec tsx --test scripts/shadow-scoring-runner.test.ts scripts/ops/workflow-hardening.test.ts`: 75 pass / 0 fail.
- `pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts`: 27 pass / 0 fail.

No earlier test total or mutation campaign is authoritative for this head. This
document intentionally contains no prior proof history.

## Shadow parity disposition

Production service-role access remains removed. Anonymous access is not treated
as parity evidence because protected-table query failures or RLS-hidden rows can
produce an empty population. The runner now throws on every count-query error
and on zero candidates. The workflow remains blocking until the dedicated
read-only secrets are provisioned and a non-empty observation completes.

## SHA binding

The `MERGE_SHA` anchor above names the exact implementation tree measured by CI
run `31265618087`. The proof-only commit that carries this document does not
alter that measured implementation tree. Post-merge rebinding, if applicable,
must use `pnpm ops:proof-generate`; incidental SHA text is not an anchor.
