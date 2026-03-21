# Claude Week 6 Prompt

Use this prompt for Claude on the Week 6 governance lane.

```md
Work in `C:\dev\unit-talk-v2`.

Another agent owns the primary implementation lane for Week 6. Your job is to maximize governance closure, contradiction detection, and acceptance-readiness without overlapping the implementation path.

Read these authority files first:
- `C:\dev\unit-talk-v2\docs\05_operations\week_6_execution_contract.md`
- `C:\dev\unit-talk-v2\docs\04_roadmap\active_roadmap.md`
- `C:\dev\unit-talk-v2\docs\06_status\current_phase.md`
- `C:\dev\unit-talk-v2\docs\06_status\system_snapshot.md`
- `C:\dev\unit-talk-v2\docs\06_status\next_build_order.md`
- `C:\dev\unit-talk-v2\docs\05_operations\delivery_operating_model.md`
- all contract docs under `C:\dev\unit-talk-v2\docs\02_architecture\contracts\`

Your Week 6 lane:
1. Create `docs/06_status/status_source_of_truth.md` and make it explicit which file answers current program status.
2. Create `docs/05_operations/docs_authority_map.md` and map which docs govern:
   - principles
   - contracts
   - roadmap
   - operations
   - status
   - external sync surfaces
3. Add owner and ratified metadata to:
   - `docs/01_principles/system_context.md`
   - `docs/02_architecture/domain_model.md`
   - all files under `docs/02_architecture/contracts/`
4. Add explicit program kill conditions to the appropriate authoritative doc(s).
5. Lock settlement planning:
   - assign an exact implementation week
   - define the first three settlement slices
   - define the acceptance criteria for first posted-to-settled proof
6. Update repo status docs if your changes alter the official Week 6 view.

Constraints:
- Do not implement runtime promotion logic.
- Do not add new product surfaces.
- Do not activate real `discord:best-bets`.
- Keep changes governance-focused and acceptance-focused.
- If you find contradictions, resolve them in docs rather than leaving them implied.

Required verification:
- `pnpm lint`
- `pnpm type-check`
- `pnpm build`
- `pnpm test`

Required output:
- summary of all doc/governance changes
- exact files changed
- commands run and results
- remaining Week 6 blockers after your changes
```
