# Regression runs

## Evidence

- `main-discord-presentation.test.txt`: this branch's test file run against `main`'s `discord-presentation.ts`. 18 pass, 2 fail: the two new title tests fail on main, where the title contains ` @ `.
- `head-discord-presentation.test.txt`: the same tests at head. 20 pass, 0 fail.
- `head-official-picks-embed.test.txt` (11/11), `head-delivery-adapters.test.txt` (29/29) and `head-discord-design-system.test.txt` (15/15): existing consumers of `buildPickPresentation` pass unchanged.
