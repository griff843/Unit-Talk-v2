# Claude Prompt For Linear Build

Use this prompt in Claude Code to build the entire Linear workspace for `unit-talk-v2`.

## Prompt

```md
Build the full Linear workspace for the `unit-talk-v2` program using the repo at `C:\dev\unit-talk-v2`.

Important naming rule:
- Use `unit-talk-v2` as the team or space name everywhere.
- Use `UTV2` as the team key / shorthand prefix.
- Do not use `Unit Talk 2.0` or `UT2`.

Your task:
1. Read the reference docs listed below.
2. Create the Linear team or confirm it exists.
3. Create the full project portfolio, milestones, labels, workflow states, and initial issue set based on the docs.
4. Use the issue pack as the seed issue batch.
5. Preserve the naming and sequencing exactly unless the docs explicitly conflict.

Reference docs to use:
- `C:\dev\unit-talk-v2\docs\05_operations\linear_setup.md`
  Use for the Linear operating model, team design, projects, milestones, labels, workflow states, policy rules, and setup sequence.
- `C:\dev\unit-talk-v2\docs\05_operations\linear_issue_pack.md`
  Use for the actual initial issues to create in Linear.
- `C:\dev\unit-talk-v2\docs\01_principles\rebuild_charter.md`
  Use for program intent, non-negotiables, and naming posture.
- `C:\dev\unit-talk-v2\docs\01_principles\system_context.md`
  Use for system boundaries and platform ownership context.
- `C:\dev\unit-talk-v2\docs\02_architecture\domain_model.md`
  Use for entity and flow context when mapping issue descriptions.
- `C:\dev\unit-talk-v2\docs\02_architecture\rebuild_scope.md`
  Use for scope boundaries.
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\submission_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\pick_lifecycle_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\writer_authority_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\distribution_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\settlement_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\run_audit_contract.md`
- `C:\dev\unit-talk-v2\docs\02_architecture\contracts\environment_contract.md`
  Use these contract docs to keep issue creation aligned with the intended architecture.
- `C:\dev\unit-talk-v2\docs\05_operations\repo_bootstrap.md`
  Use for foundation and tooling issues.
- `C:\dev\unit-talk-v2\docs\05_operations\supabase_setup.md`
  Use for schema and platform setup issues.
- `C:\dev\unit-talk-v2\docs\05_operations\migration_cutover_plan.md`
  Use for migration and cutover issues.
- `C:\dev\unit-talk-v2\docs\05_operations\risk_register.md`
  Use for hardening, blocker, and cutover-risk issue framing.
- `C:\dev\unit-talk-v2\docs\05_operations\tooling_setup.md`
  Use for local bootstrap and environment-related issue framing.
- `C:\dev\unit-talk-v2\docs\05_operations\notion_setup.md`
  Use for cross-system alignment and documentation dependency notes.
- `C:\dev\unit-talk-v2\docs\05_operations\slack_setup.md`
  Use for communication workflow and alert-related dependencies.

Execution requirements:
- Create all eight projects from the Linear setup doc.
- Create all milestones from the Linear setup doc.
- Create all labels from the Linear setup doc.
- Use the workflow states from the Linear setup doc if the workspace allows custom workflow design.
- Create the issues from the issue pack with their project, labels, and body content.
- If an exact Linear field cannot be represented, preserve the content in the issue body instead of dropping it.
- Do not invent new naming conventions.
- If something already exists, reconcile to the docs instead of duplicating it.

Output requirements:
- Return a concise summary of what was created.
- List any items that had to be adapted because of Linear limitations.
- List any docs that appeared ambiguous or conflicting.
```
