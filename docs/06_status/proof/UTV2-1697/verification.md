# PROOF: UTV2-1697

MERGE_SHA: 7255dcd0301892d945f4ff59564020a78ecc44bf

Verified implementation SHA: `7255dcd0301892d945f4ff59564020a78ecc44bf`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. Post-merge closeout binds it to the authoritative merge SHA.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ci/capability-map-check.test.ts'` | PASS | 5 tests passed; 0 failed |
| Exact UTV2-1693 map payload | PASS | 22 entries checked; 0 findings |
| `pnpm type-check` | PASS | TypeScript project-reference check completed with exit code 0 |
| `pnpm test` | PASS | Root aggregate completed within `pnpm verify:static` |
| `pnpm verify:static` | PASS | DB boundary, sync/alignment, env, lint, type-check, build, root tests, Smart Form verification, and command checks completed with exit code 0 |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | No R-level rules matched; no additional artifacts required |

## Issue-specific assertions

- A missing map or invalid JSON fails instead of silently treating the map as valid.
- Every entry requires a supported schema version, declared authority level, unique non-empty situation, primary capability, kind, and fallback/null value.
- Command references resolve to root package scripts; agent and skill references resolve to the respective `.claude` Markdown surfaces.
- Fallbacks resolve to any supported capability surface, preserving the map’s declared fallback contract.
- The CI workflow is path-scoped and checks the committed map after UTV2-1693 supplies it; before that dependency lands, it still runs this checker’s regression tests and issues a visible skip notice.

## Database verification

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

This T2 lane changes repository governance tooling only and performs no database writes.

---

## Independent review findings and their fixes

Reviewed by `codex-return-reviewer` at head `e4d8996d`. **Verdict: REJECT.** The review verified the validator itself by executing all five required mutations against the *real* map and the *real* `.claude/agents` / `package.json` — every one produced a non-zero exit naming the offending entry, and the `fallback: null` control correctly stayed PASS. The validator logic was sound. **Both blockers were in the CI wiring around it.**

### Blocker 1 — deleting an agent could not fail CI

The workflow triggered only on the map, the checker, its test and the workflow file. `.claude/agents/**` and `.claude/commands/**` were absent, so a PR deleting `.claude/agents/lane-governor.md` would never run this workflow at all — and a path-filtered check that does not run counts as not-applicable, not as failing.

That is the single most likely real-world breakage: the map breaks far more often by a referenced agent disappearing than by the map being edited badly.

**Fixed.** `.claude/agents/**`, `.claude/commands/**` and `package.json` added to both the `pull_request` and `push` path filters, with the reasoning recorded inline so a future edit does not quietly drop them.

### Blocker 2 — a permanent pass-on-absence bypass

```yaml
if [ ! -f docs/05_operations/CAPABILITY_MAP.json ]; then
  echo '::notice ...The map has not reached this branch yet...'
  exit 0
fi
```

Unconditional, and not scoped to the bootstrap window. Once the map is on `main`, any later PR deleting or renaming it would make this workflow **pass**, with a notice claiming the map had not arrived yet. Deletion would have been the one way to silence the check permanently.

Worth stating plainly: this lane exists because a governance document claimed a mechanical guarantee that nothing provided. Its own CI wiring was doing the same thing.

**Fixed.** Absence is now resolved against the base branch:

- map present → validate, exit on the checker's result;
- map absent **and** absent on base → genuine bootstrap, pass with a notice that says so;
- map absent **but present on base** → this PR deleted it → `::error` and exit 1.

The bootstrap branch retires itself the moment the map lands on `main`; no dated marker to forget. `fetch-depth: 0` was added so the base ref is actually resolvable.

### Finding 3 — the two named cases were untested

Acceptance criterion 2 names `fallback: null` (valid) versus an omitted `fallback` key (invalid), and the `" / "` two-alternative command form. Both were correct in the implementation but proven only by the reviewer's ad-hoc mutation — evidence that expires as soon as nobody repeats it by hand.

Both are now checked-in tests, taking the suite from 5 to 7.

### Controls proven by making them fail

The two-alternative test is the subtler one: a parser that validates the first token and stops would pass a naive test. The parser was mutated to validate only the first alternative:

```
not ok 7 - both sides of a " / " two-alternative command are resolved
# tests 7
# pass 6
# fail 1
```

Exactly the new regression fails, and only that one. Restored, the suite returns 7/7.

### Attribution

The three fixes above were implemented by the orchestrator directly rather than re-dispatched, because the sibling lane UTV2-1696 had just produced two consecutive re-dispatches that returned `SUCCESS` while changing no source at all (filed as UTV2-1698). Per invariant 14 the implementer must not be the sole validator, so this bundle requires a further independent review before merge.
