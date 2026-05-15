# Lane Manifests

Lane manifests live in `.lane/lanes/*.yml` and define the repo regions, proof artifacts, CI checks, merge policy, and concurrency rules for each execution lane.

Agents choose the narrowest lane that owns every intended file path. If a change spans lanes, split the work unless a parent issue explicitly authorizes a broader governance lane. Migration paths are special: changes under `supabase/migrations/**`, `database/migrations/**`, or generated database type files require the `migration` lane and an active `.lane/migration-lock.yml`.

Local checks:

```bash
pnpm lane:check -- --lane runtime --base origin/main --head HEAD
pnpm proof:check -- --issue UTV2-123 --lane runtime
```

CI can provide the same values through `LANE_TYPE`, `BASE_REF`, and `HEAD_REF`.
