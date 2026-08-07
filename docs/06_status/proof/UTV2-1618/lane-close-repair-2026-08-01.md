# PROOF: UTV2-1618 (lane-close manifest repair)

MERGE_SHA: e357edd5c9180fb8e2c1e8485a1d11f06245d5f6

## Summary

`docs/06_status/lanes/UTV2-1618.json` was still `status: "in_review"` on
`main` after PR #1314 squash-merged as `147462572b46d80b18c38d3960053ccc272ba087`,
because the manifest lived on the feature branch and was carried through the
squash unchanged. `ops:lane-close UTV2-1618 --repair-merged`, run from a
checkout on `main`, correctly detected this and refused to commit the fix
directly, instead emitting a repair packet and the exact governed commands to
land it via its own PR -- the same pattern as UTV2-1641/1646/1648's repairs
earlier in this program.

## Fix

`pnpm ops:lane-repair-packet apply UTV2-1618 --packet <repair-packet>` applied
the mechanically-generated `proposed_manifest` (derived from GitHub's
authoritative merge state for PR #1314: merge SHA
`147462572b46d80b18c38d3960053ccc272ba087`, head ref
`claude/utv2-1618-readonly-diagnostic-hardening`) -- no hand-editing. Exactly
one file changed: `docs/06_status/lanes/UTV2-1618.json`.

## ASSERTIONS:

- [x] Exactly one file changed: `docs/06_status/lanes/UTV2-1618.json`.
- [x] The applied manifest content came from `ops:lane-repair-packet apply`'s tested tool output, not a hand edit.
- [x] `commit_sha`/`pr_url` in the repaired manifest match PR #1314's actual GitHub merge state.
- [x] No other lane's manifest, lease, or control-plane file was touched.

## EVIDENCE:

```text
$ pnpm ops:lane-repair-packet apply UTV2-1618 --packet .../UTV2-1618.repair-packet.json
{
  "ok": true,
  "code": "repair_packet_applied",
  "issue_id": "UTV2-1618",
  "message": "Applied repair packet for UTV2-1618 (status, commit_sha, preflight_token).",
  "errors": []
}
```
