# UTV2-1400: Source Activation/Deprecation Decision Packet

Decision packet only. No deployment, no producer activation, no
member-visible change, no DB mutation was made in this lane. This document
gives PM everything needed to make a final call on each source; it does not
make the call unilaterally.

Context: the prior scoring validation audit (UTV2-1382) and evidence-flow
observation (UTV2-1397) established that `alert-agent`, `model-driven`, and
`smart-form` have zero real production samples because none are part of the
current deployed topology (`docker-compose.prod.yml`, `deploy.yml` build
matrix). This packet answers *why*, in enough depth to decide what to do
about each one.

---

## 1. `alert-agent`

### Current code path
- Core logic: `packages/alert-runtime/src/alert-agent.ts` — `runAlertAgentTick()`, invoked on a 60-second interval (`ALERT_AGENT_INTERVAL_MS = 60_000`) by `startAlertAgent`, started from `apps/alert-agent/src/main.ts`.
- Each tick: (1) `runAlertDetectionPass` reads recent `providerOffers` line movements per event/market and tiers them `watch` / `notable` / `alert-worthy` (`alert-agent-service.ts:17-60`), persisting `alertDetections` rows; (2) `runHedgeDetectionPass` does the equivalent for hedge opportunities; (3) if any signals persisted, `runAlertNotificationPass` (`alert-notification-service.ts`) posts Discord embeds to channels resolved by tier; (4) on notify, calls the upstream adapter.
- It does **not** write `picks` directly. `alert-submission.ts` (`createAlertUpstreamAdapter`) only materializes `alert-worthy`, sport-eligible, non-player-prop detections into `market_universe` rows (tagged `provider_key: 'alert-agent'`), feeding the same governed board-scan → candidate → scoring → construction pipeline every other source goes through. A comment in that file notes the older direct `/api/submissions` POST path was retired in UTV2-496/512.

### Current deploy status
- **Not deployed.** Absent from `docker-compose.prod.yml`'s service list (api, worker, ingestor, discord-bot, scanner, command-center) and from `.github/workflows/deploy.yml`'s build matrix (`service: [api, worker, ingestor, discord-bot]`).
- Referenced only in the root Dockerfile's package-copy stage and in tests.

### Intended product surface or dead code?
**Intended product surface, not dead code.** The tick logic is complete, tested, and already wired to a pre-existing internal delivery mechanism: `discord:canary`. Per `docs/05_operations/T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT.md` ("Canary-First Rule"), every `notable`/`alert-worthy` detection already routes to `discord:canary` before any member-visible channel; the member-visible `discord:trader-insights` channel is explicitly gated to fire only for `alert-worthy` and only "after M13 board confirms channel is ready." This is a designed-but-never-deployed feature, not an abandoned one.

### What is required to activate (internal-only)
1. Add an `alert-agent` service block to `docker-compose.prod.yml` mirroring the `worker`/`ingestor` pattern, pointing at `apps/alert-agent`.
2. Add `alert-agent` to `deploy.yml`'s build matrix so an image is built.
3. Set env: `ALERT_AGENT_ENABLED=true`, `ALERT_DRY_RUN=false`, and leave `SYSTEM_PICKS_ENABLED` unset/`false` (its default is off).
4. With that config, the service runs live detection + real `discord:canary` notification, but **does not** materialize `market_universe` rows or reach the scoring/promotion pipeline at all — `SYSTEM_PICKS_ENABLED=false` fully blocks the upstream adapter from being constructed as enabled.
5. This is a genuinely internal-only activation path requiring zero code changes — only deploy config.

### Risks
- Even canary-only activation adds a new continuously-running process against production data (`providerOffers` reads every 60s) — a resource/cost consideration, not a correctness one.
- `SYSTEM_PICKS_ENABLED` is a single boolean; a config mistake (set to `true` prematurely, or omitted in a future redeploy that changes defaults) would silently start feeding `market_universe` and reach real scoring/promotion with no additional gate. This must be treated as a hard governance boundary, not a soft default.
- No live-DB (`pnpm test:db`) coverage exists for alert-agent specifically — only in-memory test coverage. Canary activation would be the first live-data exercise of this path.

### Rollback plan
- Set `ALERT_AGENT_ENABLED=false` (or remove the service from `docker-compose.prod.yml`) — the tick loop stops immediately, no state to unwind since it never wrote `market_universe`/`picks` rows in this mode.
- If `SYSTEM_PICKS_ENABLED` were ever set to `true` and needed reversal, existing `market_universe` rows it wrote would need the same review as any other source's rows — no special-cased cleanup exists today, which is itself a gap worth noting if activation is approved.

### Scoring/data requirements before this counts as "validated"
- Real `discord:canary` posts observed over a meaningful window (matching UTV2-1382's 30-day pattern).
- If/when `SYSTEM_PICKS_ENABLED` is later approved: real `market_universe` rows with `provider_key: 'alert-agent'` flowing through to `picks`, then the same band/edgeSourceQuality/fallback-reason distribution check UTV2-1382 ran for `board-construction`/`system-pick-scanner`.

### Recommended PM decision
**Confirms PM's preliminary stance: activate internal/canary-only.** The canary-first path already exists in the contract and requires no code change — only deploy wiring plus `ALERT_DRY_RUN=false` with `SYSTEM_PICKS_ENABLED` left off. This is the lowest-risk of the three sources to move forward on, specifically because "internal-only" is not a new invariant to build — it's already how the alert contract is designed to work.

---

## 2. `model-driven`

### Current code path
- No dedicated production writer exists. `model-driven` is an accepted enum value in `packages/contracts/src/submission.ts`, checked/branched on in `apps/api/src/controllers/submit-pick-controller.ts` (shadow-mode routing) and `apps/api/src/distribution-service.ts`.
- The only code that actually writes `source: 'model-driven'` rows is a one-off proof script, `apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts`, plus test fixtures.

### Current deploy status
N/A — there is no service to deploy. The enum value exists in the contract layer only.

### Intended product surface or dead code?
**Reserved enum value with no live forward momentum — closer to dead code than active product surface, but not formally deprecated.** The model registry (`docs/06_status/proof/MODEL_REGISTRY_AUDIT_20260511.md`, UTV2-890) is a generic scoring scaffold with 6 provisional champion entries, all `source_type_compatibility: ["board-construction"]` — the audit states outright: "capper and model-driven sources have no compatible champion." `findChampion(sport, marketFamily, sourceType)` (`apps/api/src/candidate-scoring-service.ts:566`) returns null for any non-board-construction source, and that file has an explicit comment: "Capper and model-driven picks are not routed through this service." The audit's "Next Steps" mention extending compatibility to model-driven as a possible future investigation, but no ticket or in-progress code commits to it.
- `packages/domain/src/models/model-blend.ts` computes a generic `p_final_v2` blend score used across sources — it is not a `model-driven`-specific pipeline and doesn't imply forward momentum toward an automated `model-driven` producer.

### What is required to activate
There is no "activate" here in the same sense as the other two — there is no built pipeline to turn on. Standing up a real `model-driven` producer would mean building: (1) a scoring/selection service that decides which model outputs become candidate picks, (2) wiring it into `submission-service`, (3) extending the model registry's `source_type_compatibility` to include `model-driven`, and (4) the same deploy/topology work as any new service. This is net-new feature work, not activation of dormant code.

### Risks
- None from inaction — leaving it dormant changes nothing.
- Risk of activation (if pursued later) is entirely in the unbuilt pipeline itself; nothing to assess yet since no pipeline exists.

### Rollback plan
N/A — nothing running to roll back.

### Scoring/data requirements before this counts as "validated"
N/A until a producer exists. Once one does, it would need the same distribution validation UTV2-1382 ran on `board-construction`/`system-pick-scanner`.

### Recommended PM decision
**Confirms PM's preliminary stance: dormant.** Do not build or validate scoring around a source that has no operational producer. If there's future appetite to build a model-driven picks pipeline, that's a distinct, larger scoping exercise (registry compatibility extension + new service), not a "turn it on" decision — it should be scoped as its own initiative if/when prioritized, not folded into this packet's follow-ups.

---

## 3. `smart-form`

### Current code path
- Writer: `apps/smart-form/lib/form-utils.ts` — `buildSubmissionPayload()`, submitted via `apps/smart-form/lib/api-client.ts` from a Next.js UI (`apps/smart-form/app/page.tsx`), hardcoding `source: 'smart-form'`.
- Capper identity is derived from an email allowlist (`auth-allowlist.ts`, `deriveCapperIdFromEmail`), with Google OAuth via next-auth (UTV2-659).

### Current deploy status
- **Not deployed.** Absent from `docker-compose.prod.yml` and `deploy.yml`'s build matrix; referenced only in CI path filters for QA regression gating (`qa-experience-regression.yml`, `qa-fast.yml`), which run tests on code changes, not deployment.

### Intended product surface or dead code?
**Fully built, production-quality intended product surface for capper users specifically — not a prototype, not dead code, just never deployed.** `apps/smart-form/CLAUDE.md` self-labels "Maturity: production." The app has real `dev`/`build`/`start`/`test`/`test:e2e` scripts, Zod validation, Radix UI, next-auth, a Playwright e2e suite, and an active multi-year commit history through UTV2-1379. No README exists at `apps/smart-form/README.md`, and no explicit rollout plan or named owner appears in `docs/CODEBASE_GUIDE.md` beyond documenting the app's existence (port 4100). The app's own `CLAUDE.md` flags an open item: "No auth header currently (submitter key should be added)" before submissions would be trusted end-to-end.

### What is required to activate
1. Add `apps/smart-form` to `docker-compose.prod.yml` and `deploy.yml`'s build matrix — standard deploy wiring, no missing code for the UI/submission path itself.
2. Resolve the open auth-header gap noted in the app's own docs before treating submissions as trusted.
3. **Product decision, not engineering task:** decide who uses it (which cappers), where it's hosted (subdomain/internal-only URL), and what governs access beyond the existing email allowlist (e.g. is the allowlist itself production-ready, or a dev convenience?).

### Risks
- This is a human-submission surface — activating it means real people can submit real picks that flow into the governed pipeline. Unlike `alert-agent`, there is no "dry-run" concept here; a submission is a submission.
- The auth-header gap noted in-app is a real trust boundary risk if activated before resolved.
- No live-DB test coverage exists for the submission path specifically (only in-memory `pnpm test` coverage across `form-schema`, `form-utils`, `api-client`, `auth-config`, `control-plane-boundary`).

### Rollback plan
- Take the app down (remove from `docker-compose.prod.yml` / stop the deployed instance) — no continuous background process to stop, unlike `alert-agent`.
- Submissions already made would remain in `picks` as normal governed-pipeline rows (subject to the same promotion/suppression gates as any other source) — no special rollback of pipeline state is implied by taking the form offline.

### Scoring/data requirements before this counts as "validated"
- Real, non-fixture `smart-form` submissions accumulating over a window, then the same edgeSourceQuality/fallback-reason/band distribution check UTV2-1382 ran for the two measurable sources, scoped to `smart-form`.

### Recommended PM decision
**Confirms PM's preliminary stance: dormant / internal-only until the product workflow is defined.** The code is ready; the open question is entirely product (who submits, where it's hosted, whether the allowlist is production-grade) plus one concrete engineering gap (the auth-header item the app's own docs already flag). Recommend treating "define the product workflow" as its own small decision, separate from a code activation task — there's no code blocker to activating this once that's decided, but activating it without deciding who it's for would be premature.

---

## Summary table

| Source | Product surface or dead code | Activation blocker | Recommended decision |
|---|---|---|---|
| `alert-agent` | Product surface — canary-ready | Deploy wiring only (no code) | **Activate internal/canary-only** |
| `model-driven` | Reserved enum, no producer | Would require building a new pipeline | **Stay dormant** |
| `smart-form` | Product surface — production-quality, unstaffed decision | Product decision (who/where) + one auth gap | **Stay dormant/internal-only pending product decision** |

No source is approved for production/member-visible activation by this
packet. `alert-agent`'s internal/canary activation, if PM approves it as a
follow-up lane, would still not reach any member-visible channel due to the
existing canary-first gating — that follow-up would be its own scoped lane
with its own deploy-config diff and proof, not something this packet
authorizes on its own.
