# Standing Guardrails

PM-maintained. These are the guardrails currently in force that every agent must hold regardless of what any single directive says. They are injected into session context automatically by `.claude/hooks/session-start.sh` — do not re-paste them into chat; edit this file instead.

Keep entries short and dated. Remove an entry the moment it's no longer true — a stale guardrail here is worse than none, since agents will treat it as current.

Format: one line per guardrail, starting at column 1 with a bracketed date (the hook greps for this pattern — indented/prose text is ignored):

    [YYYY-MM-DD] rule — reason (issue ref if any)

Example (indented on purpose so it is NOT picked up as a live guardrail):

    [2026-07-02] No CLV/ROI/edge claims outside DEBT-018 scope — band assignment not yet persisted (UTV2-906).

[2026-07-07] No direct-main bypass for ordinary execution — all planned work must land through a tier-labeled PR unless the emergency exception in DIRECT_MAIN_BYPASS_POLICY.md is recorded first (UTV2-1432).
