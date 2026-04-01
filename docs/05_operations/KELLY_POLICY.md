# Kelly Criterion Policy

**Status:** Ratified 2026-04-01
**Issue:** UTV2-203

## Role

Kelly fraction is computed at submission time and stored in `pick.metadata.kellySizing`. It serves as an **internal scoring signal** — it feeds the readiness component of the promotion score via a gradient mapping (UTV2-199).

## What Kelly IS

- An input to the promotion scoring model (readiness component)
- Higher Kelly fraction → higher readiness score → more likely to be promoted
- A mathematical indicator that the pick has positive expected value based on the model's confidence vs the offered odds

## What Kelly IS NOT

- A stake recommendation to members
- A position sizing instruction
- Displayed in Discord pick embeds
- Used for bankroll tracking (no bankroll is tracked)

## Why not use for sizing

1. Kelly requires accurate win probability estimates. Our model probability comes from capper confidence — not a proven statistical model. Kelly on inaccurate probability is dangerous.
2. No bankroll tracking exists. Kelly fraction without bankroll context is meaningless.
3. Members have their own bankroll management. Telling them "bet 3% of bankroll" without knowing their bankroll is irresponsible.

## Future path

When the system has:
- 500+ graded picks with statistically significant positive CLV
- Calibrated win probability model (not just capper confidence)
- Member bankroll tracking (opt-in)

Then Kelly can be promoted to a member-facing recommendation with appropriate disclaimers. Until then, it remains an internal scoring signal.
