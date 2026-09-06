# PT1 — the T1 live-DB precondition, and where it should bind

**Status:** DECISION PACKET — Part 1 applied, Part 2 prepared and **not** applied. Part 2 requires
PM authority.
**Issue:** UTV2-1845
**Prepared:** 2026-09-06
**Blocks:** UTV2-1842 (Smart Form submission repair), and every future T1 lane opened from a
contained workstation.
**Reserved under:** `docs/mission/intent.md` § "Changes to the operating model" — this changes lane
admission, which is execution authority.

---

## 1. What is actually broken

`ops:preflight` PT1 (`scripts/ops/preflight.ts:1312-1321`) pings live Supabase and classifies the
result in two ways only:

```ts
if (!env?.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.SUPABASE_URL?.trim()) {
  addCheck('PT1', 'fail', 'SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are required for T1 health ping');
} else {
  const ping = await runSupabaseHealthPing(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  addCheck('PT1', ping.ok ? 'pass' : 'infra_error', ping.detail);
}
```

`local.env` lines 1-4 state, in the repository, what the environment is:

```
# CONTAINMENT PLACEHOLDER — NOT production credentials.
# Satisfies `pnpm env:check` ... while pointing every
# client at an unreachable address so no test run can reach production Supabase.
SUPABASE_URL=http://127.0.0.1:1
```

So the ping is **designed to fail**. PT1 reports that deliberate, documented policy state as
`infra_error`. `resolveVerdict` (`:1454-1456`) maps any `infra_error` to verdict `INFRA`, no
preflight token is written, and `lane-start.ts:418` then refuses with *"validated preflight token is
unavailable."*

Three consequences, each measured:

1. **PT1 runs only at T1** (`:394-396`), so a T2 lane opens cleanly on the same workstation and a T1
   lane cannot open at all.
2. **PT1 is not waivable at any tier.** `WAIVABLE_CHECKS` (`:153-157`) is `T1: {PE3}`,
   `T2: {PE3, PL4}`, `T3: {PE3, PB2, PG3, PL4, PR7}`. PT1 appears in none.
3. **UTV2-1842 is genuinely T1 and cannot be reclassified down.** Its finding A is
   `checkEventExistenceGate`, defined at `apps/api/src/submission-service.ts:867` and called at
   `:203`. That path is a Tier C exact path, so `classifyMechanicalMinimum` returns a `T1` floor
   (`scripts/ops/tier-classifier.ts:60-63`), and the floor can never be lowered. There is no
   scope-shaping route around this.

**This is a misclassification, not a missing feature.** An infrastructure fault and a policy state
are being reported as one verdict — the same aggregate-conflation class already recorded against
UTV2-1730 / UTV2-1724.

## 1a. There is an immediate unblock that needs no code change — measured 2026-09-06

`loadEnvironment` merges `.env.example` -> `.env` -> `local.env` into a map, but `readEnvValue`
(`packages/config/src/env.ts:707-713`) reads **`process.env` first** and only falls back to that map:

```ts
function readEnvValue(key: string, merged: Map<string, string>) {
  const processValue = process.env[key];
  if (processValue && processValue.length > 0) {
    return processValue;
  }
  return merged.get(key);
}
```

Verified by execution, not by reading:

```
$ SUPABASE_URL=https://example-override.invalid pnpm exec tsx -e "..."
resolved SUPABASE_URL === override? true
is loopback placeholder? false
```

So the containment placeholder in `local.env` is **overridable per-invocation**, and PT1 can be
satisfied today by exporting real credentials for the single `ops:preflight` command:

```
SUPABASE_URL=<staging url> SUPABASE_SERVICE_ROLE_KEY=<staging service role key> \
  pnpm ops:preflight UTV2-1842 --tier T1 --branch <branch> --files ...
```

Three things about this route must be stated plainly rather than assumed:

- **Staging, not production.** The right target is the staging project the required `staging-db-proof`
  job already uses under `environment: staging-ci`. Pointing PT1 at production would put a
  production service-role key in a workstation shell for no benefit; PT1 only pings.
- **It is still a secrets action** — reserved decision 4 — because it puts a service-role credential
  in a local shell. It is bounded to one command and writes nothing: `ops:lane-start` afterwards
  validates the *token*, not the environment.
- **It does not fix the defect.** Every future T1 lane pays the same cost, and the misclassification
  in section 1 stays. It unblocks UTV2-1842; it does not close this issue.

An earlier version of this packet did not contain this section, because it assumed `local.env` won
over `process.env`. That assumption was wrong and is withdrawn.

## 2. The precedent is in the same function, and it is not self-authorizing

PL1 had the identical cascade and was corrected on 2026-09-05. The comment at
`preflight.ts:1130-1137` reads:

> An absent tracker credential is not an infrastructure failure and not a policy refusal — it is the
> tracker being optional. Reporting it as `infra_error` made `resolveVerdict` return INFRA, which
> wrote no token, which made `ops:lane-start` fail ... That cascade is the single hard block on the
> whole open->PR path.

That change was legitimate **because Griff ratified it** in `intent.md` § "Execution must not depend
on the tracker". No equivalent ratification exists for the live-DB precondition. Reusing PL1's
mechanism without its authority would be taking a policy decision by analogy, which is precisely
what `intent.md` § "Changes to the operating model" forbids.

**So: changing `infra_error` to `skip` is not bookkeeping. It changes what a T1 lane is admitted
without, repo-wide, and it needs explicit authority.** An earlier framing of this in chat called it
an ops-script change with no merge-authority exposure. That was wrong and is withdrawn.

## 3. What PT1 actually proves, measured against what already gates the merge

This is the load-bearing measurement, because it decides whether the precondition is *redundant* or
*load-bearing*.

**PT1 proves:** the workstation running `ops:preflight` can reach *a* Supabase host with the
service-role key in its `local.env`, at lane-open time. It runs before a single line is written.

**`verify` — a required check — already proves more, on every push, at the PR head:**

| Mechanism | Location |
|---|---|
| `verify` **needs** `staging-db-proof` | `.github/workflows/ci.yml:172` |
| `verify` fails closed if that job did not succeed | `:178-181` |
| The DB proof runs against staging with real credentials, bound to `environment: staging-ci` | `:37-41` |
| It runs the T1 live proof suites (`test:live-db` → `test:t1-proof:live`) | `:122-134` |
| The receipt is uploaded scoped to `run_id` **and** `run_attempt` | `:149-154` |
| `verify` downloads that exact artifact with `if-no-files-found: error` | `:279-284` |
| `verify` verifies the receipt with `--expect-job staging-db-proof` | `:286-294` |

A previous run's receipt cannot be substituted, and a merge cannot proceed without one, because
`verify` is one of the four required checks.

**Conclusion: the binding live-DB evidence for a T1 lane is produced and verified in CI at the head,
not by PT1.** PT1 is an earlier, weaker, environment-local echo of a control that already exists in
a stronger form at the point where it actually matters.

That is an argument about *where the precondition binds*. It is **not** an argument that T1 needs
less evidence, and this packet proposes no reduction in the T1 evidence bar.

## 4. The correction — two parts, deliberately separable

### Part 1 — classification. No admission change. Needs no policy authority. **Applied in this PR.**

PT1 gains a distinct outcome for the containment case, so a deliberate policy state stops being
reported as a broken database:

| Condition | Today | Proposed |
|---|---|---|
| Credential or URL absent | `fail` | `fail` — unchanged |
| Resolved URL is the documented containment placeholder | `infra_error` | **`blocked_by_containment`** |
| Real host configured, ping unhealthy | `infra_error` | `infra_error` — unchanged |
| Ping healthy | `pass` | `pass` — unchanged |

Detection is exact, not heuristic: the containment case is the resolved `SUPABASE_URL` matching the
placeholder recorded in `local.env`, i.e. a loopback or otherwise unroutable host. It never matches a
real project URL, so a genuinely unreachable production database still reports `infra_error`.

**On its own, Part 1 admits nothing.** `blocked_by_containment` maps to verdict `INFRA` exactly as
today and no T1 lane opens that could not open before. Its whole value is that the refusal names the
real cause, and the owner decision below becomes visible instead of hidden.

### Part 2 — admission. This is the decision. **Not applied.**

Whether `blocked_by_containment` may issue a preflight token for a T1 lane.

**If admitted**, the deferral is recorded and re-checked rather than forgotten:

1. `preflight` writes the token with `t1_live_db_precondition: "deferred_to_ci"` recorded on it.
2. `ops:lane-start` copies that field onto the lane manifest.
3. `ops:truth-check` **refuses closeout** for any lane carrying that field unless the `verify` run at
   the merge SHA carries a verified `staging-db-proof` receipt — the same receipt `ci.yml:286-294`
   already validates. A new closeout check, failing closed.

Net effect on the T1 evidence bar **at merge**: unchanged. Net effect **at closeout**: strictly
stronger, because the deferral is now an explicit, checked obligation rather than an unrecorded one.
Net effect **at lane-open**: a T1 lane may open on a contained workstation, which it cannot today.

## 5. The decision

**Does the T1 live-DB precondition bind at lane-open (a local ping) or at lane-close (the CI staging
receipt at the merge SHA)?**

| Option | Effect | Consequence for UTV2-1842 |
|---|---|---|
| **A0 — export staging credentials for one preflight invocation.** No code change | Nothing changes in the repository. The defect stays for every future T1 lane | **Unblocked today.** Reserved decision 4 (secrets), bounded to one command. See section 1a |
| **A — Part 1 only.** Classify containment; keep refusing | T1 lanes stay unopenable under containment. The refusal is honest instead of misleading | Still blocked without A0 |
| **B — Part 1 + Part 2.** Admit with a recorded, closeout-enforced deferral | T1 lanes open under containment; the live-DB obligation moves to where it is already mechanically verified | Unblocked, and every future T1 lane too |
| **C — hand-generate a preflight token** | Routes around the check with no record | Not proposed. This is what was done before and it should not be repeated |

**Recommendation: A0 now, B as the durable fix.** They are independent and neither waits on the
other. A0 costs one command and one bounded secrets decision, and it moves UTV2-1842's backend
admission today. B is the repair — it is worth deciding on its own timeline, not under the pressure
of a blocked lane.

**Why B.** It removes a precondition that is environment-local and weaker than the
control already enforced at the head, while adding a fail-closed closeout obligation that does not
exist today. It does not touch the merge gate, CODEOWNERS, branch protection, tier semantics or any
required check.

**What B does not do.** It does not make an absent Supabase credential pass — that stays `fail`. It
does not admit a genuinely unreachable real host — that stays `infra_error`. It does not lower any
tier, waive any proof artifact, or change what `verify` requires.

**Non-secret success criterion.** After it lands:

1. `pnpm ops:preflight UTV2-1842 --tier T1 --branch <branch>` on the contained workstation reports
   `PT1 blocked_by_containment` and verdict `PASS`, and writes a token carrying
   `t1_live_db_precondition: deferred_to_ci`.
2. Pointing `SUPABASE_URL` at a real but unreachable host still reports `PT1 infra_error` and
   verdict `INFRA` — the control still fails on the condition it names.
3. `ops:truth-check` on a lane carrying the deferral **fails** when the merge-SHA `verify` run has
   no verified `staging-db-proof` receipt, and passes when it does.

All three are mechanical and will ship as tests with the change.


---

## 6. What this PR actually changed

Part 1 only.

- `scripts/ops/shared.ts` — `CheckResult['status']` gains `blocked_by_containment`.
- `scripts/ops/preflight.ts` — `isContainmentPlaceholderSupabaseUrl()` (exact: loopback and
  unspecified hosts only, never a project URL); PT1 selects the new outcome for the placeholder and
  keeps `infra_error` for a real unreachable host and `fail` for an absent credential;
  `resolveVerdict` maps the new outcome to `INFRA`, exactly as `infra_error`.
- `scripts/ops/preflight.test.ts` — seven tests, four of which are inversions.

**No lane can open that could not open before.** Part 2 is written above and is not implemented.

### Mutation evidence

| Mutation | Result |
|---|---|
| `isContainmentPlaceholderSupabaseUrl` returns `false` unconditionally | 3 tests fail, including the one bound to the repository's own `local.env` value |
| `resolveVerdict` stops considering `blocked_by_containment` | 1 test fails — the one asserting the new outcome still resolves to `INFRA` |

Both were executed, not reasoned about. The controls that must keep failing on their own conditions
— a real-but-unreachable host reporting `infra_error`, an absent credential reporting `fail` — are
asserted directly and pass.

## 7. Why this document lives in `docs/governance/`

`docs/05_operations/` would be the ordinary home, and it was the first choice. It is unavailable to
this lane: UTV2-1843 holds an active lease on two files under that directory, and a lane's scope is
declared as a trailing `/**` glob, so any declaration wide enough to hold one new file there
overlaps that lease and `ops:lane-start` refuses with `lease_conflict`. `docs/governance/**` is
admitted to governance lanes by `.lane/lanes/governance.yml`, is free of active leases, and is a
defensible home for a packet about lane admission. Recorded here so the placement is a stated
decision rather than an unexplained one; moving it later is a one-line change.
