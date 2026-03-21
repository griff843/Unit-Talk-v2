# Week 8 Failure Note Template — Settlement Runtime

Use this template if any settlement slice or the first posted-to-settled proof fails.

Copy the filled-in version into `docs/06_status/system_snapshot.md` under the heading
`Week 8 Settlement - Failure Record`. Also copy it into the active Week 8 Linear issue as a comment.

Do not edit this template in place. It must remain reusable.

Authority: `docs/06_status/status_source_of_truth.md` — Program Kill Conditions section

---

## Failure Classification

Check the type that applies:

- [ ] Slice 1 failure — settlement schema migration error or type generation failure
- [ ] Slice 2 failure — `POST /api/picks/:id/settle` returned an unexpected error or wrong behavior
- [ ] Slice 2 failure — lifecycle transition did not record or recorded incorrectly
- [ ] Slice 2 failure — audit event missing or malformed
- [ ] Slice 3 failure — operator snapshot does not include settlement data
- [ ] Slice 3 failure — operator-web does not show settled picks correctly
- [ ] Proof failure — first posted-to-settled run did not complete end-to-end
- [ ] Data integrity issue — original outbox, receipt, or pick records were mutated during settlement
- [ ] Test regression — `pnpm test` or `pnpm test:db` failed after settlement work

---

## Evidence

| Field | Value |
|---|---|
| Failure timestamp | ___ |
| Slice affected | Slice 1 / Slice 2 / Slice 3 / Proof run |
| Pick ID (if applicable) | ___ |
| Pick lifecycle state at failure | ___ |
| Settlement record ID (if created) | ___ |
| API route called | ___ |
| HTTP response status | ___ |
| Error message / stack trace location | ___ |
| DB state at failure (describe) | ___ |
| Operator snapshot timestamp at failure | ___ |
| Were original outbox/receipt rows modified? | yes / no |

---

## System State After Failure

| Field | Value |
|---|---|
| `discord:canary` health | healthy / degraded / unknown |
| `discord:best-bets` health | healthy / degraded / unknown |
| Worker health | healthy / degraded / down |
| Pending outbox rows | ___ |
| Failed outbox rows | ___ |
| Pick lifecycle state after failure | ___ |
| Settlement record count for this pick | ___ |

---

## Recovery Actions Taken

| Action | Completed | Timestamp |
|---|---|---|
| Identified root cause | yes / no / in progress | ___ |
| Reverted any partial DB writes (describe) | yes / no / not applicable | ___ |
| Confirmed live routing (`discord:canary`, `discord:best-bets`) unaffected | yes / no | ___ |
| Confirmed original pick/outbox/receipt rows unchanged | yes / no | ___ |
| Recorded failure in `docs/06_status/system_snapshot.md` | yes / no | ___ |
| Recorded failure in active Week 8 Linear issue | yes / no | ___ |

---

## Kill Condition Check

Settlement failures do not automatically trigger the program kill conditions unless:

- canonical pick records are mutated or lost without an operator trace → Hard Stop
- submission path materializes picks from untrusted sources → Hard Stop
- Discord bot token is confirmed exposed or compromised → Hard Stop

If a Hard Stop condition is met, follow the Hard Stop procedure in `docs/06_status/status_source_of_truth.md`.

| Kill condition triggered? | yes / no |
|---|---|
| Which condition (if yes) | ___ |
| Hard Stop procedure followed | yes / no / not applicable |

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
| Slice status after recovery | not started / in progress / complete |
| Live routing after recovery | unchanged / modified (describe) |
| Pick lifecycle state after recovery | ___ |
| Ready to retry | yes / no — blocker: ___ |
