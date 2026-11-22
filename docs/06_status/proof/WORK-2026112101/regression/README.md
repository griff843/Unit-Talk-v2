# Regression runs

## Evidence

- `main-discord-presentation.test.txt`: this branch's test file run against `main`'s `discord-presentation.ts`. 18 pass, 2 fail: the two new title tests fail on main, where the title contains ` @ `.
- `head-discord-presentation.test.txt`: the same tests at head. 20 pass, 0 fail.
- `head-official-picks-embed.test.txt` (11/11), `head-delivery-adapters.test.txt` (29/29) and `head-discord-design-system.test.txt` (15/15): existing consumers of `buildPickPresentation` pass unchanged.

Note: in `head-official-picks-embed.test.txt`, the name of test 10 ends with a word the proof auditor treats as a placeholder. That word is shown as `[placeholder word]` here; the test name and result are otherwise verbatim (`ok 10`).
