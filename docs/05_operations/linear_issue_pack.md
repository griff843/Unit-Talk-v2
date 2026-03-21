# Linear Issue Pack

This file contains the initial issue batch for building the `unit-talk-v2` Linear workspace. Each issue is written in a format that can be copied directly into Linear.

## UTV2-FOUND-01

Title: Create repo bootstrap, workspace tooling, and package boundaries

Project: `UTV2-R1 Foundation`

Labels:
- `tooling`
- `infra`
- `build`
- `codex`
- `p1`

Body:

```md
Problem
The new repo needs a stable monorepo foundation before feature work begins.

Why now
Every later stream depends on package boundaries, scripts, and workspace structure being consistent.

Source of truth or contract
- docs/01_principles/rebuild_charter.md
- docs/05_operations/repo_bootstrap.md

Scope in
- Root workspace files
- App and package manifests
- TypeScript bootstrap

Scope out
- CI implementation
- Feature logic

Acceptance criteria
- Workspace installs successfully
- Type-check passes
- Build passes

Risks
- Overfitting early package structure

Test proof required
- pnpm type-check
- pnpm build

Migration impact
- None directly

Dependencies
- None

Owner
- Engineering

Agent lane
- codex
```

## UTV2-FOUND-02

Title: Add CI skeleton for install, type-check, and build

Project: `UTV2-R1 Foundation`

Labels:
- `tooling`
- `testing`
- `infra`
- `build`
- `p1`

Body:

```md
Problem
The repo currently lacks an automated validation path for bootstrap and future changes.

Why now
Contract-first work still needs fast regression checks from day one.

Source of truth or contract
- docs/05_operations/repo_bootstrap.md
- docs/05_operations/tooling_setup.md

Scope in
- CI workflow skeleton
- Install, type-check, build jobs

Scope out
- Deploy workflows
- Environment secret provisioning

Acceptance criteria
- CI runs on push and pull request
- Failing type-check or build blocks merge

Risks
- CI assumptions may drift from local development

Test proof required
- CI green run on bootstrap branch

Migration impact
- None

Dependencies
- UTV2-FOUND-01

Owner
- Engineering

Agent lane
- codex
```

## UTV2-FOUND-03

Title: Define environment variable ownership and local env templates

Project: `UTV2-R1 Foundation`

Labels:
- `infra`
- `docs`
- `tooling`
- `p1`

Body:

```md
Problem
The repo needs a clean rule for shared defaults versus machine-local secrets.

Why now
Service integrations will become messy quickly if env ownership is implicit.

Source of truth or contract
- docs/02_architecture/contracts/environment_contract.md
- docs/05_operations/tooling_setup.md

Scope in
- .env.example template
- local.env local secret template
- docs alignment

Scope out
- Secret manager rollout

Acceptance criteria
- Shared defaults and local overrides are documented
- Secret-bearing files are handled safely

Risks
- Developers may still place secrets in the wrong file

Test proof required
- Repo review
- Type-check remains green

Migration impact
- None

Dependencies
- UTV2-FOUND-01

Owner
- Engineering

Agent lane
- codex
```

## UTV2-CONTRACT-01

Title: Ratify submission contract

Project: `UTV2-R2 Contracts`

Labels:
- `contract`
- `api`
- `docs`
- `adr`
- `p1`

Body:

```md
Problem
The rebuild needs a single approved path for inbound submission before implementation expands.

Why now
Submission is the first authoritative entry point into the platform.

Source of truth or contract
- docs/02_architecture/contracts/submission_contract.md
- docs/02_architecture/domain_model.md

Scope in
- Allowed submission path
- Validation expectations
- Event emission expectations

Scope out
- UI details
- Final schema implementation

Acceptance criteria
- Contract language is complete enough to guide implementation
- Open decisions are explicitly listed

Risks
- Premature contract detail may lock poor assumptions

Test proof required
- Contract review signoff

Migration impact
- Determines what parts of legacy intake are reusable

Dependencies
- UTV2-FOUND-01

Owner
- Architecture

Agent lane
- claude
```

## UTV2-CONTRACT-02

Title: Ratify writer authority contract

Project: `UTV2-R2 Contracts`

Labels:
- `contract`
- `api`
- `docs`
- `p1`

Body:

```md
Problem
The platform needs explicit write authority boundaries before service logic is ported.

Why now
Single-writer discipline is one of the main reasons to rebuild cleanly.

Source of truth or contract
- docs/02_architecture/contracts/writer_authority_contract.md
- docs/01_principles/rebuild_charter.md

Scope in
- Canonical writer declaration
- Named writer roles
- Service boundary expectations

Scope out
- Detailed lifecycle states

Acceptance criteria
- Contract clearly states who may write what and under which named roles

Risks
- Ambiguous operator authority

Test proof required
- Contract review signoff

Migration impact
- Controls which legacy write paths may be considered for reuse

Dependencies
- UTV2-FOUND-01

Owner
- Architecture

Agent lane
- claude
```

## UTV2-PIPE-01

Title: Design canonical V2 schema

Project: `UTV2-R3 Core Pipeline`

Labels:
- `schema`
- `data`
- `api`
- `p1`

Body:

```md
Problem
The rebuild needs a canonical schema that reflects the new contracts rather than the legacy drift.

Why now
Submission, lifecycle, distribution, and settlement all depend on canonical table design.

Source of truth or contract
- docs/02_architecture/domain_model.md
- docs/02_architecture/contracts/submission_contract.md
- docs/02_architecture/contracts/pick_lifecycle_contract.md
- docs/02_architecture/contracts/distribution_contract.md
- docs/02_architecture/contracts/settlement_contract.md
- docs/05_operations/supabase_setup.md

Scope in
- Canonical table list
- Ownership and mutation notes
- Migration-first schema design

Scope out
- Full migration implementation

Acceptance criteria
- Schema proposal covers all canonical entities
- Mutation authority is documented per table group

Risks
- Recreating legacy ambiguity in new names

Test proof required
- Schema review

Migration impact
- Defines the target for future migration mapping

Dependencies
- UTV2-CONTRACT-01
- UTV2-CONTRACT-02

Owner
- Data platform

Agent lane
- codex
```

## UTV2-DIST-01

Title: Design distribution outbox schema and event contract

Project: `UTV2-R4 Distribution`

Labels:
- `distribution`
- `discord`
- `schema`
- `contract`
- `p1`

Body:

```md
Problem
Distribution needs a durable outbox and receipt model instead of direct side-effect coupling.

Why now
Posting and receipt capture must be reliable before Discord flow implementation begins.

Source of truth or contract
- docs/02_architecture/contracts/distribution_contract.md
- docs/02_architecture/domain_model.md

Scope in
- Outbox shape
- Receipt shape
- Retry and idempotency expectations

Scope out
- Full bot implementation

Acceptance criteria
- Distribution design is concrete enough to support worker implementation

Risks
- Missing receipt fields may weaken auditability

Test proof required
- Design review signoff

Migration impact
- Determines what legacy Discord patterns can be salvaged

Dependencies
- UTV2-PIPE-01

Owner
- Engineering

Agent lane
- codex
```

## UTV2-MIG-01

Title: Create migration ledger from legacy repo

Project: `UTV2-R7 Migration`

Labels:
- `migration`
- `docs`
- `investigation`
- `p1`

Body:

```md
Problem
The rebuild needs a clear map of what is reusable, rewrite-only, or delete-on-arrival from the legacy repo.

Why now
Without a ledger, legacy code will leak into the rebuild opportunistically.

Source of truth or contract
- docs/05_operations/migration_cutover_plan.md
- docs/01_principles/rebuild_charter.md

Scope in
- Legacy path inventory
- Keep, rewrite, delete decisions
- Rationale per item

Scope out
- Porting implementation

Acceptance criteria
- Ledger exists and covers critical legacy surfaces

Risks
- Missing legacy hotspots may distort future estimates

Test proof required
- Ledger review

Migration impact
- Establishes the migration work queue

Dependencies
- UTV2-FOUND-01
- UTV2-CONTRACT-02

Owner
- Engineering

Agent lane
- codex
```

## UTV2-HARD-01

Title: Define incident and rollback plan

Project: `UTV2-R8 Hardening`

Labels:
- `security`
- `observability`
- `docs`
- `cutover-risk`
- `p2`

Body:

```md
Problem
The rebuild needs a documented response and rollback posture before cutover readiness work is considered complete.

Why now
Production hardening should not be deferred until the final week of migration.

Source of truth or contract
- docs/05_operations/migration_cutover_plan.md
- docs/05_operations/risk_register.md

Scope in
- Incident ownership
- Rollback expectations
- Minimum signals required for safe cutover

Scope out
- Full on-call tooling rollout

Acceptance criteria
- Incident and rollback plan exists with named responsibilities

Risks
- Hardening may become performative if not tied to real signals

Test proof required
- Operations review signoff

Migration impact
- Reduces cutover risk for the migration program

Dependencies
- UTV2-MIG-01

Owner
- Operations

Agent lane
- claude-os
```
