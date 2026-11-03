# WORK-2026110301 — NHL asset host

The NHL resolver builds `https://assets.nhle.com/mugs/nhl/latest/<playerId>.png` from the uniquely matched provider playerId. No season or team segment is added. The source comment now names the live host.

Two regression tests require the exact URL and reject the dead host. Two existing successful-URL expectations change only the expected URL, keeping the selected IDs (1 and 8474100); all name, league, team, ambiguity, saturated-window, unknown-team and refusal assertions remain unchanged. No test is removed and no identity assertion is loosened.

`updateMetadata` is unchanged. No new live DB enrichment test is added and no live DB enrichment proof is claimed. No stored URL rewrite, host allowlist, schema, canonical submission, delivery, worker, domain or Discord change is included.

Proof artifacts contain regression-first output, passing output, the killed old-host mutation, and saved read-only public-provider measurements. Production was not connected to.

Merge SHA: pending merge
