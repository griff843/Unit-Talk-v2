# PROOF: WORK-2026101201

MERGE_SHA: cdbd8d654b4b96b595d6a4480cefaf1ba53ecd17

Issue: WORK-2026101201
Tier: T2
Lane type: runtime
Branch: codex/work-2026101201-member-tier-repair
Verified source SHA: `a99855568c5416e115fe895f147655650d38dbab`
result: static_pass_db_deferred

## ASSERTIONS:

- [x] A bot-created Trial receives a bounded `effectiveUntil` from
      `computeTrialEffectiveUntil()`: seven days by default and the configured duration when
      `TRIAL_DURATION_DAYS` is set.
- [x] VIP and VIP+ bot sync behavior remains expiry-free.
- [x] The bot sync accepts Trial, VIP, VIP+, Capper, and Operator while continuing to reject Free.
- [x] Recording Capper or Operator membership state does not change the bot API caller's auth role;
      it remains `submitter`, and the existing generic submitter authorization test remains 403.
- [x] The Discord sync handler activates every configured mapped role.

## EVIDENCE:

Focused issue suite:

```text
pnpm exec tsx --test 'apps/api/src/member-picks.test.ts' 'apps/discord-bot/src/discord-bot-foundation.test.ts'
tests 137
pass 137
fail 0
```

Full local verification reached the enforced staging boundary only after the complete static gate
passed:

```text
pnpm verify
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 137 migration file(s) verified — no duplicate versions.
[lint-migrations] 136 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

This is the required writable live-DB deferral. No local or production write was attempted.

## Verification

```text
pnpm exec tsx --test 'apps/api/src/member-picks.test.ts' 'apps/discord-bot/src/discord-bot-foundation.test.ts'  # 137 pass, 0 fail
pnpm exec eslint apps/api/src/routes/member-tiers.ts apps/api/src/member-picks.test.ts apps/discord-bot/src/discord-bot-foundation.test.ts  # exit 0
pnpm type-check                                                                                                  # exit 0
pnpm verify:static                                                                                               # exit 0
pnpm ops:scope-diff -- --issue WORK-2026101201                                                                   # pass; 3 implementation files within declared scope
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD                                         # Verdict: PASS; rule: discord-delivery
pnpm verify                                                                                                      # static pass; exit 1 only at ci:assert-staging containment
```

Writable live-DB proof remains blocked/deferred to the `staging-ci` GitHub environment using
`CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.

## Merge SHA Binding

Merge SHA: `cdbd8d654b4b96b595d6a4480cefaf1ba53ecd17`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1742
