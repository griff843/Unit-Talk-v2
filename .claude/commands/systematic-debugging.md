# /systematic-debugging

Structured debugging for Unit Talk V2. Use when a test fails, a migration breaks, CI goes red, or a runtime error resists a quick fix. Do not guess-and-retry — diagnose first.

**Stack:** TypeScript, Supabase (Postgres), node:test, pnpm monorepo, CI via GitHub Actions

---

## Phase 1: Gather evidence

- [ ] Read the full error message and stack trace — don't skim
- [ ] Identify the failing component boundary (domain / app / DB / CI / config)
- [ ] Check `git log --oneline -10` — did a recent commit introduce this?
- [ ] Check `git diff` — is there uncommitted state that could be the cause?
- [ ] If DB-related: run `pnpm test:db` and check migration serial numbers
- [ ] If type error: run `pnpm type-check` and read the full diagnostic
- [ ] Reproduce the failure yourself — don't trust secondhand reports

---

## Phase 2: Find the pattern

- [ ] Find a working example of the same pattern in the codebase (grep for similar code that passes)
- [ ] Compare the failing code against the working example — what differs?
- [ ] Check if the failure is environment-dependent (local.env, Supabase connection, missing env var)
- [ ] Check if it's a known-debt item: `docs/06_status/KNOWN_DEBT.md`

---

## Phase 3: Single-hypothesis fix

- [ ] State one hypothesis: "The failure is caused by X because Y"
- [ ] Make the smallest possible change that tests that hypothesis
- [ ] Change one variable at a time — never combine fixes
- [ ] Run the specific failing test: `tsx --test <path>`
- [ ] If it passes, run the full suite: `pnpm test` + `pnpm type-check`

---

## Phase 4: Verify and close

- [ ] Confirm the fix doesn't break other tests
- [ ] If the fix touches DB: run `pnpm test:db`
- [ ] If the fix touches types: run `pnpm type-check`
- [ ] Write a regression test if the failure wasn't already covered

---

## Escape hatch

**After 3 failed fix attempts:** stop fixing and question the architecture.

This is not a failed hypothesis — this is evidence the mental model is wrong. Ask:
- Am I debugging the right layer?
- Is the contract between these components what I think it is?
- Should I read the upstream code instead of the failing code?
- Is this a symptom of a different root cause?

Escalate to the user with your evidence rather than attempting a 4th speculative fix.

---

## Anti-patterns

- **Guess-and-retry:** changing random things until the error changes is not debugging
- **Fixing the symptom:** suppressing an error without understanding the cause creates hidden debt
- **Shotgun debugging:** making multiple changes at once makes it impossible to know which one worked
- **Trusting agent self-reports:** "Codex said it fixed it" is not verification — run the test yourself
