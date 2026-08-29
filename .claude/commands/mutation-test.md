# /mutation-test

Prove that a control actually works by making it **fail** on the condition it names.

> A control is only proven by making it fail. Presence and a green run prove nothing.

Presence of a test proves a file exists. A passing test proves the code did not crash. Neither proves the test would *notice* if the behavior it guards were removed. This skill exists because vacuous tests have repeatedly reached PM review here looking exactly like real ones.

Use this before any T1 merge claim, and whenever a PR adds a guard, gate, validator, or assertion.

---

## The method

For each behavior the test claims to protect:

1. **Name the mutation.** A specific, minimal edit to production code that removes or inverts the behavior.
2. **Apply it** to a scratch copy of the file.
3. **Run the suite.**
4. **Record the outcome.** The named test must FAIL. If the suite stays green, the test is vacuous.
5. **Revert** and move to the next mutation.

A mutation battery is complete when every claimed guarantee has a mutation that kills it.

### Baseline first

Run the suite unmutated and record the exact counts before starting. Without a baseline you cannot distinguish "the mutation was caught" from "the suite was already red".

---

## Vacuity traps

These are the ways a test passes while proving nothing. Check each one explicitly.

### T1. The fixture never reaches the code under test

The most common failure. A dry-run test that picks an issue with no manifest exits at the `manifestExists` guard and never touches the logic it claims to cover — and it passes, because nothing threw.

**Detection:** assert that the code path was entered. Assert on an artifact only the deep path produces, not on absence-of-error.

### T2. The fixture lacks the condition being tested

A control-character test whose fixture contains no control characters passes whether or not the sanitizer exists.

**Detection:** make the test assert its own non-vacuity first. Before checking the sanitizer's output, assert the input actually contains what the test is about:

```ts
assert.match(fixture, /[\x00-\x1f]/u, 'fixture has no control characters — this test is vacuous');
```

### T3. The fixture invents something that does not exist

A hand-written DB row fixture can declare a column the real schema does not have. The filter under test then silently matches nothing, and the inversion "proves" only that the test noticed its own invented field.

**Detection:** validate fixtures against `packages/db/src/database.types.ts`, or derive them from a real query. Never hand-author a row shape from memory.

### T4. The tool never ran

A compile-smoke test that shells out to a missing binary gets exit 127 and, if the assertion is `status !== 0`-tolerant, reports success. The compile never happened.

**Detection:** assert the tool reported a version, and assert the spawn itself did not error:

```ts
assert.equal(result.error, undefined, 'spawn failed');
assert.notEqual(result.status, null, 'process did not exit normally');
const probe = spawnSync('npx', ['--no-install', 'tsc', '--version'], { encoding: 'utf8' });
assert.match(probe.stdout ?? '', /Version \d+\.\d+/u, 'tsc never ran — compile smoke is vacuous');
```

### T5. A fix silently de-vacuums a companion test

Changing production code can make an "empty body" fixture non-empty, so the test that guarded the empty case stops testing it while still passing.

**Detection:** re-run the **whole** battery after every production change, not just the mutations for the thing you touched. This trap is only caught by the battery, never by the individual test.

### T6. The aggregate hides the sub-outcome

A status that conflates unrelated sub-results, or evidence collected after the fact, has a loss window. Green aggregate, failed component.

**Detection:** mutate one component at a time and confirm the *aggregate* goes red for each.

---

## Isolation

Mutation runs must not touch the real repo state.

- Never use `git checkout` or `git restore` to revert a mutation while uncommitted implementation work exists — that has destroyed an in-progress implementation here. Commit first, or copy the file aside and restore by copy.
- Run in a dedicated worktree when mutations and other lanes could collide.
- If the code under test resolves a repo root via `git rev-parse --show-toplevel` with no `cwd`, it inherits `process.cwd()` — a `git init`'d fixture directory rebinds it with zero production change. Prefer that over mocking.
- No live network. Delete credentials from the child env explicitly (`LINEAR_API_TOKEN`, `LINEAR_API_KEY`, …) rather than trusting that nothing will reach for them.

---

## Reporting

Report the battery as a table, one row per mutation, with the baseline stated above it:

```
Baseline: pnpm test → 4934/4934 pass

| # | Mutation                                   | Expected | Result   |
|---|--------------------------------------------|----------|----------|
| 1 | remove `manifestExists` guard              | FAIL     | detected |
| 2 | drop import of `generateExecutionPacket`   | FAIL     | detected |
| 3 | pass wrong argument order to `printDryRun` | FAIL     | detected |
```

A mutation that was **not** detected is a finding, not a footnote. Report it, then either strengthen the test or state plainly that the behavior is unguarded.

Paste the battery into the proof bundle under `## Verification`, per `/proof-authoring` — including the baseline command, so the counts are traceable.

---

## Rationalization resistance

- "The test passes, so the behavior works" — a vacuous test passes for exactly the same reason.
- "I can see the assertion is correct" — reading it is not running it against a mutation.
- "The mutation is unrealistic" — realism is irrelevant; the mutation is a probe, not a prediction.
- "I already tested that one" — T5 means an earlier result expires when production code changes.
- "It's covered by the type system" — types do not run, and the guard you removed compiled fine.

## Red flags — stop and report

- Any mutation that leaves the suite green.
- A test whose failure message you have never actually seen printed.
- A fixture you wrote from memory rather than from generated types or a real query.
- A battery run against uncommitted work with no copy-aside backup.
