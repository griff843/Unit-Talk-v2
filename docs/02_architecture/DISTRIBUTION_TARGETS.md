# Distribution Targets

**Status:** Canonical
**Purpose:** Canonical registry of Discord delivery targets used by the distribution layer (`apps/api` → `distribution_outbox` → `apps/worker` → Discord adapter).
**Out of scope:** channel activation decisions (owned by PM), non-Discord delivery surfaces, notification routing in `alert-agent`.

This document replaces the Discord target table previously embedded in `CLAUDE.md`. It is the single source of truth for target identifiers and activation state. Environment-specific overrides (development/staging) are noted but not detailed here — consult the relevant `apps/*` env file when needed.

---

## 1. Target naming convention

Distribution target identifiers follow the pattern:

```
discord:<target-slug>
```

- The prefix `discord:` identifies the delivery adapter.
- The slug is stable, lowercase, hyphen-separated, and must not be reused for a different channel.
- Targets are referenced by identifier in `distribution_outbox.target`, `distribution_receipt.target`, and the `DeliveryAdapter` routing layer.

Changing a target identifier requires migrating historical outbox rows — do not rename casually.

---

## 2. Canonical target registry

| Target | Channel ID | Status | Purpose |
|---|---|---|---|
| `discord:canary` | `1296531122234327100` | **Live** — permanent control lane | Dry-run / control lane. All new delivery paths smoke-test here first. Never deactivated. |
| `discord:best-bets` | `1288613037539852329` | **Live** — production | Promoted picks that clear the Best Bets promotion gate (`promotionScore ≥ 70`, `promotion_target = 'best-bets'`). Distribution is gated — unqualified picks never reach this target. |
| `discord:trader-insights` | `1356613995175481405` | **Live** — production | Premium-tier promoted picks clearing the Trader Insights gate (`promotionScore ≥ 80`, `edge ≥ 85`, `trust ≥ 85`). Takes priority over Best Bets when a pick qualifies for both. |
| `discord:recaps` | `1300411261854547968` | **Live** — daily/weekly recap posts | Recap deliveries (daily/weekly summaries). Not gated by the promotion pipeline. |
| `discord:exclusive-insights` | `1288613114815840466` | **Code merged — activation deferred** | Routing code exists and the channel exists. Live activation is deferred pending PM sign-off. Treat as inactive for new work. |
| `discord:game-threads` | — | **Not implemented — deferred** | Intended per-game live-thread delivery. No channel ID is canonical. Do not route outbox rows here. |
| `discord:strategy-room` | — | **Not implemented — deferred** | Intended strategy-room delivery. No channel ID is canonical. Do not route outbox rows here. |

---

## 3. Activation state — what each label means

| Label | Meaning | Agent obligation |
|---|---|---|
| **Live** | Target is active, channel id is canonical, outbox delivery is routed. | Safe to write outbox rows targeting this id. |
| **Code merged — activation deferred** | Routing exists, channel exists, but live delivery is deferred by PM. | Do not activate. Do not enable outbox routing. Do not mark as Live in any doc without explicit PM approval. |
| **Not implemented — deferred** | No runtime routing exists. No canonical channel id. | Do not create. Do not add to the target enum. Do not write outbox rows. These are explicitly out of scope. |

Agents must **never** activate a deferred target, create a new Discord channel, or propose a new distribution target without an explicit PM instruction tied to a Linear issue.

---

## 4. Canonical vs environment-specific

- The channel IDs above are **production canonical**. They are the IDs that ship in `main`.
- Development and staging environments may override individual target IDs via env config (e.g. a dev-only `discord:canary` pointing at a sandbox channel). Environment overrides live in env files, not in this document.
- If an env override is present, it takes precedence for that environment. This document always reflects production truth.
- When in doubt about which channel a message will reach in a given environment, check the effective env file and the `DeliveryAdapter` config — do not assume this doc applies verbatim to non-prod runs.

---

## 5. Hard boundaries (never violate)

- **Do not create new Discord channels.** New channels require PM approval and are usually rejected.
- **Do not activate `discord:exclusive-insights`, `discord:game-threads`, or `discord:strategy-room`.** These are explicitly deferred.
- **Do not write to `discord:best-bets` or `discord:trader-insights` without clearing the promotion gate.** The gate lives in `apps/api/src/promotion-service.ts` and `apps/api/src/distribution-service.ts`. Bypassing it reintroduces a Phase-1 incident class.
- **Do not rename a target identifier without a migration plan.** Outbox history references these strings.
- **Do not promote a target's status (e.g. deferred → live) from a doc change.** Activation is a runtime event and requires PM sign-off plus Linear issue tracking.

---

## 6. Updating this document

Update this doc when:
- a new target is ratified and activated by PM (add row, mark Live)
- an existing target's channel ID changes (rare — treat as a breaking change)
- a deferred target is formally cancelled (remove row, note in commit message)
- a target is deactivated (mark state, do not delete — outbox history still references it)

Do not update this doc to reflect aspirations, plans, or in-flight work. Only shipped truth belongs here.

---

## 7. Related specifications

- `docs/05_operations/delivery_operating_model.md` — delivery adapter and outbox lifecycle
- `docs/05_operations/DELIVERY_ADAPTER_HARDENING_CONTRACT.md` — delivery adapter contract
- `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md` — circuit breaker rules
- `docs/05_operations/discord_routing.md` — per-target routing rules
- `apps/api/src/distribution-service.ts` — promotion gate enforcement
- `apps/worker` — outbox poller and Discord adapter
