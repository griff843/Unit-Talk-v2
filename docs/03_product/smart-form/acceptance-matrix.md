# Smart Form — submission acceptance matrix

**Status:** live. Rewritten whenever coverage changes.
**Last measured against `main`:** 2026-09-09 (UTV2-1864).
**Owner:** Claude. Product intent it serves: `docs/03_product/smart-form/intent.md`.

This is the answer to one question: **for which submission paths do we actually know a pick
persists correctly, and how do we know it?** It exists because Milestone 1 proved exactly one
shape — an MLB moneyline with `line = null` — and nothing licenses generalising from it.

A cell is only marked proven when something *fails* if the behaviour regresses. A test that renders
a form and never checks what was written proves the form renders.

---

## The three layers, and what each can and cannot prove

| Layer | What it exercises | What it cannot see |
|---|---|---|
| **Contract / unit** (`packages/contracts`, `packages/domain`) | shape, guards, provenance types | whether the browser ever sends the request |
| **API** (`apps/api/src/submission-service.test.ts`) | server validation, persistence semantics, lifecycle | the form's own family logic; `market` is a free string here |
| **Browser e2e** (`apps/smart-form/e2e/**`) | the operator's actual path | only what it asserts — and most of it asserts UI, not rows |

The 2026-09-08 client-guard defect is the standing reason this table separates the layers: a green
`verify`, a complete T1 proof bundle and a merged server repair all coexisted with a form that
refused before issuing a request. **Server-side evidence cannot detect that class at all.**

### Three strengths of e2e evidence, and only one of them is persistence

Inside the browser layer the tests are not interchangeable. Sorted weakest to strongest:

| Strength | What it asserts | How to recognise it |
|---|---|---|
| **UI only** | the form renders, filters, and reaches its success state | `page.route` fulfils `/api/submissions` and the test never reads the request |
| **Payload asserted** | the exact JSON the browser *would* send — canonical IDs, `distributionMode` | the route handler captures `route.request().postDataJSON()` and the test asserts on it |
| **Row asserted** | a real `201` from the local API, then the persisted pick read back | the test takes the `request` fixture and calls `readPersistedPick` |

`smart-form-submission.spec.ts` intercepts 61 routes and is **UI only** throughout: its four
"Pick Submitted" assertions are against mocked responses. `phase-one.spec.ts` mocks
`/api/submissions` in three tests (via `routeNcaaf` and two others), which are **payload
asserted**, and lets the request through in six — those six are **row asserted** and are the only
end-to-end persistence evidence in the repository.

The distinction is not pedantry. A payload-asserted test proves the client composed the right
request; only a row-asserted one proves the server accepted it and wrote what it claimed.

## Matrix — market family × participant resolution

Families come from `apps/smart-form/lib/market-types.ts`: five base families, plus 30 period
variants (`1h_`, `f5_`, `1p_` …) that reduce to `moneyline` / `spread` / `total`.

| Family | Line semantics | UI only | Payload asserted | Row asserted | Remaining gap |
|---|---|---|---|---|---|
| `moneyline` | **`line = null`** | `submission:927`, `:1293` (NHL) | `phase-one:158` (mobile NCAAF, canonical IDs + Track Only) | `phase-one:376`, `:445` — coverage-gap path | no canonical-path row assertion |
| `spread` | signed | `submission:998`, `:1066` | — | `phase-one:296` — canonical structured fallback | no coverage-gap row assertion |
| `total` | unsigned, no side | `submission:1114` (fallback only) | — | **`phase-one:738`** — canonical structured fallback | no coverage-gap row assertion |
| `team-total` | unsigned + team | `submission:1162` (fallback only) | — | **`phase-one:775`** — canonical structured fallback | no coverage-gap row assertion |
| `player-prop` | stat type + line | `submission:648`, `:721`, `:815`, `:1366` | `phase-one:182` (mobile NCAAF, canonical event/team/player) | **`phase-one:695`** — canonical structured fallback | no coverage-gap row assertion |
| period variants | inherit parent | — | — | — | covered by family inheritance, not by any test |

**The three bold cells are what UTV2-1864 added.** Before this lane the suite had 30 tests and
three of them read a persisted row — two moneylines and one spread. `total`, `team-total` and
`player-prop` were asserted only through the browser or through a captured request payload, and
those three are exactly the families that persist a *real* line. Milestone 1 was performed with a
single MLB moneyline, whose line is `null`; Milestone 2 condition 2 is a claim about **every**
submitted pick persisting with truthful provenance, so the families carrying a line have to be
exercised the same way rather than argued from the one that does not.

Each new case is connected end to end: real catalog, real participant search, real local API, the
row read back through `readPersistedPick`, and `distribution_outbox` asserted empty for that pick.

### The repair the new coverage found immediately

`phase-one:296` — the spread case, the *existing* strongest test in the suite — was **red on
`main`** when this lane opened, and had been since UTV2-1854. It mocked
`/api/reference-data/search/teams` with synthetic ids (`team:NBA:Celtics`), while the server
re-resolves every structured participant itself against its own reference data
(`smart-form-validation.ts:376` and `:406`). Once search began answering from `participants`, the
mocked id stopped matching and the submission was refused:

```
422 {"code":"SMART_FORM_RELATIONSHIP_INVALID",
     "message":"participant team:NBA:Celtics is not canonical for sport NBA"}
```

Nothing noticed, because the e2e gate defaults to off. **A row-asserted test can only stay honest
if it does not mock the endpoints the server independently re-reads** — and since the in-memory QA
seed mints fresh UUIDs on every server start, the id cannot be hardcoded either. The repair, and
the pattern every new case follows, is `canonicalParticipantId()`: read the id at run time from the
one source the browser and the server both consult.

### Resolution paths

| Path | Meaning | Proven by |
|---|---|---|
| canonical | participants resolve to real `participants` rows | `phase-one:265` (spread), and the Milestone 1 production pick (moneyline) |
| coverage-gap | `reason: 'canonical-coverage-gap'`, honest unresolved provenance | `phase-one:351`, `:420` (both moneyline) |

`intent.md` permits either for the contained pilot **provided the recorded provenance is truthful
about which was used**. That truthfulness is now asserted on the canonical path for all five families, and on the
coverage-gap path for moneyline only. **The remaining gap is uniform and known**: no family other
than moneyline has a row-asserted coverage-gap submission.

---

## What production has actually proven

Exactly one pick: `dfcd9486-cba2-4bb5-b684-beec36e52c0b`, 2026-09-09, MLB moneyline, `line = null`,
odds −110, 3.00 units, canonical participants, `eventId: null` recorded honestly, zero delivery
rows. That is one cell of the matrix, and it is the cell the matrix exists to stop us
over-reading.

---

## Known limitations of this document

- **The e2e suite does not run in CI by default.** `apps/smart-form/scripts/run-e2e-gate.mjs`
  executes it only when `UNIT_TALK_SMART_FORM_E2E` is exactly `'1'`. The gate is wired into the
  required `verify` check and fails closed when the flag is set — the default is a *coverage*
  decision, not a correctness one. Enabling it also requires `playwright install chromium
  --with-deps` inside a required check, which is a change to what that check does; it is T1-floored
  and tracked separately. **So every "proven" cell below is proven on demand, not on every merge.**
- Persistence is asserted against the **local** API and database, never production. Production
  evidence is the single pick above.
- Period variants are covered by family inheritance. No test exercises one directly, so a defect
  specific to, say, `f5_spread` would not be caught.
