# PROOF: UTV2-1648 (lane-close manifest repair)

MERGE_SHA: 225731c1173d197ef7598d2a64d8fe589ee31cc9

## Summary

`docs/06_status/lanes/UTV2-1648.json` was still `status: "started"` on `main`
after PR #1358 squash-merged as `1e027610`, because the manifest lived on the
feature branch and was carried through the squash unchanged. `ops:lane-close
UTV2-1648 --repair-merged`, run from a checkout on `main`, correctly detected
this and refused to commit the fix directly, instead emitting a repair packet
and the exact governed commands to land it via its own PR — the same pattern
as UTV2-1641's (PR #1355) and UTV2-1646's (PR #1357) repairs earlier in this
session.

## Fix

`pnpm ops:lane-repair-packet apply UTV2-1648 --packet <repair-packet>` applied
the mechanically-generated `proposed_manifest` (derived from GitHub's
authoritative merge state for PR #1358: merge SHA
`1e027610d57a9ca5722fe04ce6c2562b581a13d8`, head ref
`claude/utv2-1648-ghcr-token-auth`) — no hand-editing. Exactly one file
changed: `docs/06_status/lanes/UTV2-1648.json`.

## ASSERTIONS:

- [x] Exactly one file changed: `docs/06_status/lanes/UTV2-1648.json`.
- [x] The applied manifest content came from `ops:lane-repair-packet apply`'s tested tool output, not a hand edit.
- [x] `commit_sha`/`pr_url` in the repaired manifest match PR #1358's actual GitHub merge state.
- [x] No other lane's manifest, lease, or control-plane file was touched.

## EVIDENCE:

```text
$ pnpm ops:lane-repair-packet apply UTV2-1648 --packet .../UTV2-1648.repair-packet.json
{
  "ok": true,
  "code": "repair_packet_applied",
  "issue_id": "UTV2-1648",
  "message": "Applied repair packet for UTV2-1648 (status, commit_sha, pr_url).",
  "errors": []
}
```
