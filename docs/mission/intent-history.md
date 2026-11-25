# Mission Intent — historical sections

Griff-owned. Moved word for word out of `docs/mission/intent.md` under WORK-2026112502 so sessions do not read completed milestones at start-up. The text below is unchanged and keeps whatever authority it had; `intent.md` still points here.

## Milestone 1 — contained internal Smart Form "Track Only" pilot

Griff, personally, end to end:

1. reaches the deployed form
2. authenticates successfully
3. resolves canonical identity as `griff843`
4. submits a **real internal Track Only pick**
5. the pick persists correctly
6. Track Only is *proven* unable to create member delivery
7. the result is observed securely through the intended internal/operator path

This is a milestone, not the definition of production readiness.

### What step 4 does and does not require

Step 4 requires a *real* pick — a genuine current selection Griff actually intends, submitted
through the deployed form, persisted as a real row. It does **not** require canonical reference
data to be populated.

Containment deliberately keeps provider ingestion parked, so the canonical team and player catalogs
are not being filled. Requiring canonical reference-data coverage as a precondition would make the
pilot depend on unparking the very system this milestone is designed to leave parked. Instead,
**honest structured or manual provenance is acceptable for this contained pilot**: a pick submitted
through the structured canonical path where coverage exists, or through the manual
`canonical-coverage-gap` path where it does not, provided the provenance recorded on the pick is
truthful about which path was used. What is not acceptable is a fabricated selection, a synthetic
fixture, or provenance that claims canonical resolution it did not have.

### Containment during Milestone 1

Milestone 1 is a *contained* pilot. For its entire duration, and as a condition of it being
considered done, all of the following remain parked:

- paid provider ingestion
- provider activation or subscription purchase
- system picks (`SYNDICATE_MACHINE_MODE` stays `parked`)
- member-facing delivery and every deferred delivery target

None of these may be unparked to make the pilot complete. A pilot that required unparking any of
them would not have proven what this milestone exists to prove.

### Step 7 — observation path

Step 7 requires that the result be observed **securely, through an internal/operator path**. It
does **not** require the public Command Center to be deployed, and it does not make any Command
Center secret a prerequisite.

A safe read-only internal or operator observation path that demonstrates the pick's persisted
identity, distribution mode, provenance and the absence of any delivery record satisfies step 7.
Deploying the Command Center remains desirable product work and is tracked on its own merits; it is
not a Milestone 1 gate.

**The pilot does not wait** for the tracker-independence cutover, for Command Center completion,
or for the staging proof runner. Ratified 2026-09-05.

Ratified by PM on 2026-09-03: **step 7 may be satisfied by a governed read-only production
observation of the exact submitted pick and its non-delivery state.** A deployed Command Center is
not required for the contained pilot. "Governed" and "read-only" are both load-bearing — the
observation reads the one pick the pilot created and its delivery records, writes nothing, and
changes no containment setting.
