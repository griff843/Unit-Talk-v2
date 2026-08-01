# PROOF: UTV2-1659 (lane-close manifest repair)

MERGE_SHA: 64ac40ab0593f67fe848fa61d8a006f09d6e6a8e

## Summary

`docs/06_status/lanes/UTV2-1659.json` was still `status: "in_review"` on `main`
after PR #1361 squash-merged as `64ac40ab0593f67fe848fa61d8a006f09d6e6a8e`, because
the manifest lived on the feature branch and was carried through the squash
unchanged. `ops:lane-close UTV2-1659 --repair-merged`, run from a checkout on
`main`, correctly detected this and refused to commit the fix directly,
instead emitting a repair packet and the exact governed commands to land it
via its own PR.

## Fix

`pnpm ops:lane-repair-packet apply UTV2-1659 --packet <repair-packet>` applied
the mechanically-generated `proposed_manifest` derived from GitHub's
authoritative merge state for PR #1361. The repair PR contains the manifest
update plus this audit note; no implementation file changed.

## ASSERTIONS:

- [x] The repaired manifest content came from `ops:lane-repair-packet apply`'s tested tool output, not a hand edit.
- [x] `commit_sha` in the repaired manifest matches PR #1361's actual GitHub merge state.
- [x] The only non-manifest change is this repair audit note.
- [x] No other lane's manifest, lease, control-plane, or implementation file was touched.

## EVIDENCE:

```text
$ pnpm ops:lane-repair-packet apply UTV2-1659 --packet .../UTV2-1659.repair-packet.json
{
  "ok": true,
  "code": "repair_packet_applied",
  "issue_id": "UTV2-1659",
  "message": "Applied repair packet for UTV2-1659 (status, commit_sha).",
  "errors": []
}
```
