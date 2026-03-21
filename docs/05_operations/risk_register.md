# Risk Register

| Risk | Description | Owner | Status | Mitigation |
| --- | --- | --- | --- | --- |
| MCP drift | Remote MCP registration has been inconsistent for Linear. | Platform ops | Open | Re-verify Codex MCP state before relying on automation. |
| Legacy gravity | V2 may inherit old assumptions without re-ratifying them. | Architecture | Open | Require contract docs before porting logic. |
| Schema ambiguity | Canonical table design is not yet finalized. | Data platform | Open | Ratify schema package and Supabase plan before implementation. |
| Tool sprawl | Slack, Notion, and Linear may diverge if ownership is unclear. | Program owner | Open | Use the setup specs and assign owners per system. |
