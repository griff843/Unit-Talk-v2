# Week 9 Failure Note Template — Full Lifecycle Proof

Use this template if the full lifecycle proof fails at any stage, or if a failure trigger fires during the cleanup pass.

Copy the filled-in version into `docs/06_status/system_snapshot.md` under the heading
`Week 9 Failure Record`. Also copy it into the active Week 9 Linear issue as a comment.

Do not edit this template in place. It must remain reusable.

Authority: `docs/06_status/status_source_of_truth.md` — Program Kill Conditions section
Authority: `docs/05_operations/week_9_full_lifecycle_contract.md` — Failure Conditions section

---

## Failure Classification

Check the stage where the failure occurred:

- [ ] Stage 1 failure — submission record not created or submission event missing
- [ ] Stage 2 failure — pick not created or approval state incorrect
- [ ] Stage 3 failure — promotion gate did not fire or history row missing
- [ ] Stage 3 failure — pick routed to wrong target (non-qualified pick reached `discord:best-bets`)
- [ ] Stage 4 failure — outbox row entered `failed` or `dead_letter`
- [ ] Stage 4 failure — outbox row did not transition to `sent`
- [ ] Stage 5 failure — receipt not recorded or channel mismatch
- [ ] Stage 5 failure — Discord message ID missing or target channel ID incorrect
- [ ] Stage 6 failure — `POST /api/picks/:id/settle` returned error
- [ ] Stage 6 failure — settlement record not created
- [ ] Stage 6 failure — lifecycle did not transition to `settled`
- [ ] Stage 7 failure — audit entry missing for one or more stages
- [ ] Stage 7 failure — operator-web does not show settled state
- [ ] Data integrity failure — original outbox or receipt row mutated
- [ ] Independent verification mismatch — DB state differs from API response
- [ ] Test regression — `pnpm test` or `pnpm test:db` failed during cleanup
- [ ] Kill condition triggered (see Program Kill Conditions section)

---

## Evidence

| Field | Value |
|---|---|
| Failure timestamp | ___ |
| Stage that failed | Stage 1 / 2 / 3 / 4 / 5 / 6 / 7 / Cleanup |
| Pick ID (if created) | ___ |
| Outbox ID (if created) | ___ |
| Pick lifecycle state at failure | ___ |
| API route called (if applicable) | ___ |
| HTTP response status | ___ |
| Error message or location | ___ |
| DB state at failure (describe) | ___ |
| Were original outbox/receipt rows modified? | yes / no |
| Operator snapshot timestamp at failure | ___ |

---

## System State After Failure

| Field | Value |
|---|---|
| `discord:canary` health | healthy / degraded / unknown |
| `discord:best-bets` health | healthy / degraded / unknown |
| Worker health | healthy / degraded / down |
| Pending outbox rows | ___ |
| Failed outbox rows | ___ |
| Dead_letter outbox rows | ___ |
| Pick lifecycle state after failure | ___ |
| Settlement record created? | yes / no |
| Audit entries present? | describe |

---

## Kill Condition Check

Check each program kill condition before proceeding:

| Condition | Applies? |
|---|---|
| `discord:best-bets` outbox row entered `dead_letter` and unrecoverable within 24h | yes / no |
| Worker health `degraded` or `down` for more than 4 consecutive hours | yes / no |
| Promotion gate bypass confirmed (non-qualified pick reached `discord:best-bets`) | yes / no |
| Pick delivered to wrong channel or wrong audience tier | yes / no |
| More than 2 consecutive delivery failures | yes / no |
| Canonical pick records mutated or lost without operator trace | yes / no |
| Discord bot token confirmed exposed or compromised | yes / no |

If any condition applies, follow the corresponding kill procedure in `docs/06_status/status_source_of_truth.md` before proceeding.

---

## Recovery Actions Taken

| Action | Completed | Timestamp |
|---|---|---|
| Identified root cause | yes / no / in progress | ___ |
| Reverted any partial DB writes (describe) | yes / no / not applicable | ___ |
| Confirmed `discord:canary` unaffected | yes / no | ___ |
| Confirmed `discord:best-bets` unaffected | yes / no | ___ |
| Confirmed original pick/outbox/receipt rows unchanged | yes / no | ___ |
| Kill condition procedure followed (if triggered) | yes / no / not applicable | ___ |
| Recorded failure in `system_snapshot.md` | yes / no | ___ |
| Recorded failure in active Week 9 Linear issue | yes / no | ___ |

---

## Root Cause Notes

Describe what is known about the failure:

```
[fill in]
```

---

## Next Steps Before Retrying

```
[fill in]
```

---

## Post-Recovery State

| Field | Value |
|---|---|
| Live routing state after recovery | unchanged / modified — describe |
| Pick lifecycle state after recovery | ___ |
| Settlement record state (if partial) | ___ |
| Proof run status | not started / partial — retry from stage ___ / abandoned |
| Ready to retry | yes / no — blocker: ___ |
