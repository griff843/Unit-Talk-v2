# PROOF: UTV2-1646 (lane-close manifest repair)

MERGE_SHA: 5c7b3a18597afacd124f8677f7b1d7a2067889bc

## Summary

`docs/06_status/lanes/UTV2-1646.json` was still `status: "started"` on `main`
after PR #1356 squash-merged as `6adaa5d0`, because the manifest lived on the
feature branch and was carried through the squash unchanged -- squash merges
never advance a manifest's own status field. `ops:lane-close UTV2-1646
--repair-merged`, run from a checkout on `main`, correctly detected this and
refused to commit the fix directly (per
`docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`), instead emitting a repair
packet and the exact governed commands to land it via its own PR. This is that
governed repair -- the same pattern as UTV2-1641's own lane-close repair
(PR #1355) earlier in this same session.

## Fix

`pnpm ops:lane-repair-packet apply UTV2-1646 --packet <repair-packet>` applied
the mechanically-generated `proposed_manifest` (derived from GitHub's
authoritative merge state for PR #1356: merge SHA
`6adaa5d08016971f90ba4cac68bad23e894555a5`, head ref
`claude/utv2-1646-parked-mode-deploy-fix`) -- no hand-editing. Exactly one file
changed: `docs/06_status/lanes/UTV2-1646.json`, updating `status`
(`started` -> `merged`), `commit_sha`, `pr_url`, and `heartbeat_at`.

## ASSERTIONS:

- [x] Exactly one file changed: `docs/06_status/lanes/UTV2-1646.json`.
- [x] The applied manifest content came from `ops:lane-repair-packet apply`'s tested tool output, not a hand edit.
- [x] `commit_sha`/`pr_url` in the repaired manifest match PR #1356's actual GitHub merge state (`6adaa5d08016971f90ba4cac68bad23e894555a5`, `https://github.com/griff843/Unit-Talk-v2/pull/1356`).
- [x] No other lane's manifest, lease, or control-plane file was touched.

## EVIDENCE:

```text
$ git show --stat HEAD
commit 5c7b3a18597afacd124f8677f7b1d7a2067889bc
 docs/06_status/lanes/UTV2-1646.json | 8 ++++----
 1 file changed, 4 insertions(+), 4 deletions(-)

$ pnpm ops:lane-repair-packet apply UTV2-1646 --packet .../UTV2-1646.repair-packet.json
{
  "ok": true,
  "code": "repair_packet_applied",
  "issue_id": "UTV2-1646",
  "message": "Applied repair packet for UTV2-1646 (status, commit_sha, pr_url).",
  "errors": []
}
```
