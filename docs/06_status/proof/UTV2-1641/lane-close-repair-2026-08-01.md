# PROOF: UTV2-1641 (lane-close manifest repair)

MERGE_SHA: fd3adcede53840d9ea62b7d6c4f789c46903c8f2

## Summary

`docs/06_status/lanes/UTV2-1641.json` was still `status: "started"` on `main`
after PR #1351 (implementing UTV2-1641/1642) squash-merged as `13a107b2`,
because the manifest lived on the feature branch and was carried through the
squash unchanged -- squash merges never advance a manifest's own status field.
`ops:lane-close UTV2-1641 --repair-merged`, run from a checkout on `main`,
correctly detected this and refused to commit the fix directly (per
`docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`), instead emitting a repair
packet and the exact governed commands to land it via its own PR. This PR is
that governed repair.

## Fix

`pnpm ops:lane-repair-packet apply UTV2-1641 --packet <repair-packet>` applied
the mechanically-generated `proposed_manifest` (derived from GitHub's
authoritative merge state for PR #1351: merge SHA `13a107b29cac1401cc4e7aeb988591903249292c`,
head ref `claude/utv2-1641-1642-proof-lifecycle-fixes`) — no hand-editing.
Exactly one file changed: `docs/06_status/lanes/UTV2-1641.json`, updating
`status` (`started` → `merged`), `commit_sha`, `pr_url`, and `heartbeat_at`.

## ASSERTIONS:

- [x] Exactly one file changed: `docs/06_status/lanes/UTV2-1641.json`.
- [x] The applied manifest content came from `ops:lane-repair-packet apply`'s tested tool output, not a hand edit.
- [x] `commit_sha`/`pr_url` in the repaired manifest match PR #1351's actual GitHub merge state (`13a107b29cac1401cc4e7aeb988591903249292c`, `https://github.com/griff843/Unit-Talk-v2/pull/1351`).
- [x] No other lane's manifest, lease, or control-plane file was touched.

## EVIDENCE:

```text
$ git show --stat HEAD
commit fd3adcede53840d9ea62b7d6c4f789c46903c8f2
 docs/06_status/lanes/UTV2-1641.json | 8 ++++----
 1 file changed, 4 insertions(+), 4 deletions(-)

$ pnpm ops:lane-repair-packet apply UTV2-1641 --packet .../UTV2-1641.repair-packet.json
{
  "ok": true,
  "code": "repair_packet_applied",
  "issue_id": "UTV2-1641",
  "message": "Applied repair packet for UTV2-1641 (status, commit_sha, pr_url).",
  "errors": []
}
```
