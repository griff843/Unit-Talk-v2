# UTV2-1397: Evidence-Flow Observation — alert-agent, model-driven, smart-form

Observe-only follow-up to UTV2-1382, which found these three sources had
zero measurable production data over a 30-day window (100% test/proof
fixtures). This lane checked (a) whether they are wired to run in production
at all, and (b) whether real (non-fixture) samples exist now.

- **Window:** last 30 days (`2026-06-02` → `2026-07-02`)
- **Tool:** `scripts/audits/utv2-1397-evidence-flow-observation.ts` (read-only,
  reusable — `pnpm exec tsx scripts/audits/utv2-1397-evidence-flow-observation.ts --days 30`)
- **Raw output:** `docs/06_status/proof/UTV2-1397/evidence-flow-summary.json`
- **No picks triggered, no synthetic samples created, no DB rows mutated, no
  fixture rows cleaned, no delivery activated, no CLV/ROI/edge-performance
  claims made.**

## Verdict: **INSUFFICIENT_DATA** (overall)

All three sources return `INSUFFICIENT_DATA` individually — zero real
samples exist for any of them. This is the same finding as UTV2-1382,
confirmed independently 2 days later, and now explained: **none of the three
sources are currently deployed to run in production.**

## Per-source results

| Source | real_sample_count | excluded_fixture_count | domainAnalysis present | verdict |
|---|---|---|---|---|
| `alert-agent` | 0 | 1,745 | — | INSUFFICIENT_DATA |
| `model-driven` | 0 | 1,721 | — | INSUFFICIENT_DATA |
| `smart-form` | 0 | 22,349 | — | INSUFFICIENT_DATA |

`edge_source_quality`, `fallback_reason`, `promotion_status`, and
`delivery_status` are all empty objects / `null` for each source — there is
no real data to classify. Full detail in `evidence-flow-summary.json`.

## Why: production-wiring finding

For each source, the writer code exists and is functionally wired to submit
picks, but **none of the three are part of the deployed production
topology**:

### `alert-agent`
- Writer: `packages/alert-runtime/src/alert-agent.ts` (`runAlertAgentTick`),
  started via `apps/alert-agent/src/main.ts`.
- Designed cadence: a 60-second poll loop (`ALERT_AGENT_INTERVAL_MS = 60_000`).
- Production wiring: **absent**. `apps/alert-agent` is not in
  `docker-compose.prod.yml`'s service list (api, worker, ingestor,
  discord-bot, scanner, command-center) and not in `.github/workflows/deploy.yml`'s
  build matrix (`service: [api, worker, ingestor, discord-bot]`). It's only
  referenced in the root Dockerfile's package-copy stage and in test files.
- **Conclusion: dormant.** The interval-loop code is production-shaped but
  is not started anywhere in the current deployment.

### `model-driven`
- No dedicated production service writes `source: 'model-driven'` picks.
  It's an accepted enum value in `packages/contracts/src/submission.ts` and
  is branched on in `apps/api/src/controllers/submit-pick-controller.ts`
  (shadow-mode routing) and `apps/api/src/distribution-service.ts`, but
  `apps/api/src/candidate-scoring-service.ts` explicitly states "Capper and
  model-driven picks are not routed through this service" — confirming the
  live candidate-scoring/board-construction path is separate.
- The only code that actually writes `source: 'model-driven'` rows is a
  one-off proof script (`apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts`)
  and test files.
- **Conclusion: dormant.** The submission path accepts the value but has no
  live producer.

### `smart-form`
- Writer: `apps/smart-form/lib/form-utils.ts` (`buildSubmissionPayload`),
  submitted from a Next.js UI a human capper fills out and clicks submit —
  manual by design, no polling/cron logic.
- Production wiring: **absent from the deployed topology**. `apps/smart-form`
  is not in `docker-compose.prod.yml` or `deploy.yml`'s build matrix; it's
  referenced only by CI path filters (QA regression gating, not deployment).
- **Conclusion: not currently hosted in production.** Even setting aside
  that submissions are inherently human-paced, the app itself does not
  appear to be running as a deployed service right now. The 22,349 excluded
  `smart-form` rows in the 30-day window are entirely the recurring
  `UTV2-519`/`UTV2-521`/`UTV2-1022` live-DB proof-suite fixtures identified
  in UTV2-1382 Finding 1/2 (see `docs/06_status/proof/UTV2-1382/audit-report.md`),
  not real capper submissions.

## Finding

**Exact issue:** `alert-agent`, `model-driven`, and `smart-form` are not
part of the current production deployment topology (`docker-compose.prod.yml`,
`.github/workflows/deploy.yml`). `alert-agent` has a designed 60s poll loop
that is simply never started; `smart-form` is a human-submission UI that
isn't deployed; `model-driven` has no producer at all beyond a one-off proof
script.

**Impact:** UTV2-1382's scoring-validation coverage gap for these three
sources cannot be closed by waiting — there is no real traffic to wait for.
Any scoring-health claim about these three paths remains unverifiable until
one of two things happens: they get deployed, or the coverage question is
explicitly deprioritized as out of current scope (dormant paths don't need
scoring validation until they're live).

**Affected source paths:**
`packages/alert-runtime/src/alert-agent.ts`, `apps/alert-agent/src/main.ts`,
`apps/smart-form/` (entire app), `apps/api/src/candidate-scoring-service.ts`
(confirms model-driven exclusion), `docker-compose.prod.yml`,
`.github/workflows/deploy.yml` (build matrix).

**Recommended next lane — smallest safe step:** Do not deploy these services
as part of closing this coverage gap; that is a member-visible/production
change requiring its own scoped decision, well beyond an evidence-flow
observation. Instead:

1. A short PM decision packet: for each of the three sources, is it
   (a) intentionally dormant/deprecated, (b) planned for a future deploy
   wave, or (c) actually dead code that should be removed? This determines
   whether "wait for real traffic" is even the right frame — a source that's
   never going to run doesn't need a coverage-gap lane, it needs a
   deprecation decision.
2. Only for sources marked "planned for deploy" in that packet: fold the
   re-validation step (re-running this or the UTV2-1382 script scoped to
   that source) into the deploy lane's own verification checklist, rather
   than opening a separate standing "wait and poll" lane.

**Proof required:** N/A for this observation itself (no code changed). The
recommended next lane's proof requirement depends on which of (a)/(b)/(c)
is chosen for each source.

**PM gate:** **Yes, for the recommended next lane.** Deciding to deploy any
of these three sources is a member-visible/production topology change and
must be escalated, not decided inside an observation lane. This lane itself
made no such decision and took no such action.

## Constraints honored

- Mode: observe-only. No picks triggered, no synthetic samples created.
- No public/member-facing delivery activated.
- No DB rows mutated, no fixture rows backfilled or cleaned.
- No ROI/CLV/edge-performance claims made.
- Excluded `metadata.testRun`, `proof_issue`/`proof_fixture_id`-tagged rows,
  selection-text "proof" rows, and non-production source values — same
  exclusion rule as UTV2-1382's script.
- Escalated (this report) rather than acting, since the only path to closing
  the gap is a deploy decision, which is out of scope for an observation lane.
