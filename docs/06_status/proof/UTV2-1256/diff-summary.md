# UTV2-1256 Diff Summary

Two one-line additions to lane config YAML files:

- `.lane/lanes/hygiene.yml`: `+ - docs/06_status/proof/**`
- `.lane/lanes/delivery-ui.yml`: `+ - docs/06_status/proof/**`

Both files previously required proof artifacts (`diff-summary.md`, `verification.md`) but did not allow writes to `docs/06_status/proof/**`, making the config self-contradictory. This fix aligns the allowed paths with the required artifacts, consistent with the other 6 lane types (governance, runtime, modeling, migration, verification, data-canonical) which already include this glob.
