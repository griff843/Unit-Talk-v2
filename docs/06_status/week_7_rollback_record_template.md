# Week 7 Rollback Record Template

Use this template only if a rollback trigger fires during or after the Week 7 Best Bets activation.

Copy into `docs/06_status/system_snapshot.md` and into the UNI-132 Linear issue as a comment.

Authority: `docs/06_status/status_source_of_truth.md` — Program Kill Conditions section

---

## Trigger Fired

Check the trigger that fired:

- [ ] `discord:best-bets` outbox row entered `failed`
- [ ] `discord:best-bets` outbox row entered `dead_letter`
- [ ] more than 2 consecutive delivery failures
- [ ] worker health became `degraded` or `down`
- [ ] pending outbox backlog grew without `sent` transitions
- [ ] `discord:canary` degraded

---

## Evidence

| Field | Value |
|---|---|
| Trigger timestamp | ___ |
| Outbox row ID | ___ |
| Outbox row status | failed / dead_letter |
| Outbox attempt count | ___ |
| Worker health at trigger time | degraded / down / unknown |
| Canary health at trigger time | healthy / degraded / down |
| Pending outbox count | ___ |
| Failed outbox count | ___ |
| Most recent receipt ID (if any) | ___ |
| Discord response error (if any) | ___ |
| Operator snapshot timestamp | ___ |

---

## Rollback Actions Taken

| Action | Completed | Timestamp |
|---|---|---|
| Removed `discord:best-bets` from `UNIT_TALK_DISTRIBUTION_TARGETS` or reverted target map | yes / no | ___ |
| Confirmed `discord:canary` still active and posting | yes / no | ___ |
| Confirmed outbox rows preserved (not deleted) | yes / no | ___ |
| Recorded evidence in `docs/06_status/system_snapshot.md` | yes / no | ___ |
| Recorded evidence in UNI-132 Linear issue | yes / no | ___ |

---

## Post-Rollback State

| Field | Value |
|---|---|
| Live routing after rollback | `discord:canary` only |
| `discord:best-bets` status | removed from targets / mapped back to canary channel |
| Worker health after rollback | ___ |
| Pending outbox count after rollback | ___ |
| Failed outbox count after rollback | ___ |

---

## Root Cause Notes

Describe what is known about the failure:

```
[fill in]
```

Next steps before re-attempting activation:

```
[fill in]
```
