# DIFF SUMMARY: UTV2-1715

MERGE_SHA: d52972df5e530c4c569f9d28862e6a62d1dda646

## Files changed

| File | Change |
|---|---|
| `.lane/lanes/delivery-ui.yml` | Adds `apps/web/**` to `allowed_path_globs`, with the gap recorded inline. |
| `scripts/lane-contract.test.ts` | Adds the regression asserting admission and isolation. |
| `docs/06_status/proof/UTV2-1715/verification.md` | Proof bundle. |
| `docs/06_status/proof/UTV2-1715/diff-summary.md` | This file. |

## Behaviour change

Before: `apps/web/**` was in no lane type's allowlist, so any lane touching the public website failed `Lane Authority` with `outside_allowed_paths`. There was no lane type that could legally carry the change, making customer-facing website work undispatchable.

After: `delivery-ui` admits `apps/web/**`, alongside the other member-facing delivery surfaces it already governs.

## Not changed

- No lane type added, renamed, or removed.
- No allowlist other than `delivery-ui`'s.
- `forbidden_path_globs`, `singleton_types`, `type_caps` (`delivery-ui` stays `max_per_app: 1`), and `forbidden_combinations` are untouched.
- No `apps/web` source file — that is the follow-on website lane.
