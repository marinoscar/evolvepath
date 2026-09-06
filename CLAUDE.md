# CLAUDE.md

This file provides guidance for AI assistants working on this codebase.

## Project Overview

Web Application Foundation with React UI + Node API + PostgreSQL. Production-grade foundation with OAuth authentication, RBAC authorization, and flexible settings framework.

## Technology Stack

- **Backend**: Node.js + TypeScript, NestJS with Fastify adapter
- **Frontend**: React + TypeScript, Material UI (MUI)
- **CLI**: TypeScript, Commander (subcommands) + ink (interactive menu)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Passport strategies (Google OAuth required)
- **Testing**: Jest + Supertest (backend), React Testing Library + Vitest (frontend), Vitest (CLI)
- **Observability**: OpenTelemetry, Uptrace, Pino structured logging
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (same-origin routing)

## Repository Structure

```
/
  apps/
    api/                    # Backend API
      src/
      test/
      prisma/
        schema.prisma
        migrations/
      Dockerfile            # API container (near its code)
    web/                    # Frontend React app
      src/
      src/components/path/  # Path screen components (Best Self, outcomes, plans, routines, commitments)
      src/pwa/              # Service worker registration (production only)
      src/__tests__/
      build/                # Build-time Vite plugins (app-shell service worker)
      public/
        manifest.webmanifest  # PWA manifest (hand-authored; a test keeps it honest)
        icons/                # Installable app icons, generated from icon.svg
      scripts/
        generate-icons.mjs  # `npm run icons` — rasterises icon.svg
      Dockerfile            # Web container (near its code)
    cli/                    # First-party command-line client (`appctl`)
      src/
        commands/           # `login`, `api`, `config` subcommands
        tui/                # Interactive ink menu (real terminals only)
      README.md             # CLI usage, install, CI setup
  docs/                     # Documentation
  infra/                    # Infrastructure configuration
    compose/
      base.compose.yml       # Core services: api, web, nginx
      dev.compose.yml        # Development overrides (hot reload, volumes)
      prod.compose.yml       # Production overrides (resource limits)
      otel.compose.yml       # Observability: uptrace, clickhouse, otel-collector
      .env.example           # Environment variables template
    nginx/
      nginx.conf             # Nginx routing configuration
    otel/
      otel-collector-config.yaml   # OTEL Collector config
      uptrace.yml            # Uptrace configuration
  tests/e2e/                # Optional E2E tests
```

## MANDATORY: Issue-Driven Development (Traceability)

Every feature and bug fix MUST be tracked by a GitHub issue, filed **before** implementation planning is finalized (for features) or the fix starts (for bugs). This applies before any worktree or branch is created — traceability starts at the issue, not the code. Running `gh issue create` from inside the repo infers the target repository from the git remote automatically, so no repo owner/URL needs to be specified.

- **New feature**: Before finalizing an implementation plan, create (or confirm an existing) issue with `gh issue create --template feature_request.yml`. Fill in the real problem statement, proposed solution, affected component, and priority — not placeholder text.
- **Larger initiative**: If the work will span multiple features or sessions, file an Epic instead with `gh issue create --template epic.yml`. Child feature issues must reference the epic number in their body or task list.
- **Bug fix**: Before starting the fix, create (or confirm an existing) issue with `gh issue create --template bug_report.yml`. Fill in the description, reproduction steps, expected vs. actual behavior, component, and environment/logs if known. Do not file a duplicate if one already exists for the same bug — reuse it.
- **Link the work**: Reference the issue number in commit messages and/or the PR description (`Fixes #123` / `Relates to #123`), per the `.github/pull_request_template.md` convention.
- **Keep it current**: Update or close the issue as the corresponding PR resolves it, so issue state reflects real progress.
- **Scope**: This applies to feature and bug work specifically. Routine `chore`/`docs`/`refactor` commits don't each need their own tracking issue.

## MANDATORY: Worktree-Based Feature Development

Every feature or fix MUST be developed in a Git worktree. The main checkout stays on `main` at all times.

### Worktree Location & Naming
- All worktrees live under `worktrees/` in the repo root (git-ignored, never committed)
- Use **flat short names**: `worktrees/<short-name>` (e.g., `worktrees/add-export`, `worktrees/fix-auth-bug`)
- The branch name follows conventional format: `feat/<short-name>`, `fix/<short-name>`, etc.

### Workflow (Claude MUST follow)

**Starting feature work:**
0. Ensure a tracking issue exists, per [MANDATORY: Issue-Driven Development (Traceability)](#mandatory-issue-driven-development-traceability) above.
1. From the main checkout, create the worktree:
   ```bash
   git worktree add worktrees/<short-name> -b <type>/<short-name>
   ```
   Example: `git worktree add worktrees/add-export -b feat/add-export`
2. All development happens inside `worktrees/<short-name>/`
3. Commits follow all existing commit rules (see below)

**Finishing feature work:**
1. Ensure all changes are committed inside the worktree
2. Remove the worktree:
   ```bash
   git worktree remove worktrees/<short-name>
   ```
3. The branch remains for PR/merge

### Rules
- NEVER checkout feature branches in the main working directory
- NEVER work on features directly in the main checkout
- One worktree per feature branch (Git enforces this)
- If the worktree already exists for the requested feature, work inside it (don't recreate)

## MANDATORY: Claude Commit-Only Git Rules

Claude: these rules are **MANDATORY**. Follow them exactly.  
Your job is **only** to create clean, frequent commits while implementing the requested work.  
Assume the branch already exists and is checked out. Do **not** create branches or PRs.

---

### Core Commit Rules (MANDATORY)
1. **Commit early, commit often.** Do not leave large uncommitted change sets.
2. Each commit must be **small, coherent, and reviewable**.
3. **One intent per commit** (no “misc fixes” bundles).
4. **Do not include unrelated refactors** unless explicitly requested.
5. If you change behavior, you must add/adjust tests in the same commit or the next immediate commit.

---

### Commit Message Standard (MANDATORY: Conventional Commits)
Use this format:

`<type>(<scope>): <short imperative summary>`

Allowed types:
- `feat:` new functionality
- `fix:` bug fix
- `refactor:` internal change, no behavior change
- `test:` add/adjust tests only
- `docs:` documentation only
- `chore:` tooling, deps, formatting, build, CI

Scopes (pick one relevant area):
- `api`, `web`, `db`, `infra`, `auth`, `chat`, `ui`, `core`, `jobs`, `docs`, `tests`

Examples:
- `feat(chat): add permit search prompt builder`
- `fix(api): handle missing location gracefully`
- `test(api): cover permit filter edge cases`
- `chore(web): run formatter`

---

### Commit Cadence (MANDATORY)
Make commits at these checkpoints:

1) **Scaffold / wiring**
- New files, routes, handlers, basic plumbing (even if incomplete).
- Example: `feat(api): scaffold permit lookup endpoint`

2) **Core functionality**
- Implement the smallest working slice end-to-end.
- Example: `feat(core): implement permit filtering by location radius`

3) **Edge cases + validation**
- Input validation, error handling, fallback behavior.
- Example: `fix(api): validate lat/lng inputs and return 400`

4) **Tests**
- Unit/integration tests for the new behavior and critical edge cases.
- Example: `test(api): add coverage for location filter and empty results`

5) **Cleanup**
- Remove dead code, rename for clarity, small refactors strictly related to the change.
- Example: `refactor(core): extract permit query builder`

6) **Docs (if needed)**
- Only if the task requires it.
- Example: `docs(api): document permit endpoint parameters`

---

### What to Include / Exclude (MANDATORY)
#### Include
- Code + tests for the same feature area
- Minimal config changes needed to run/build/test
- Small, related refactors that reduce complexity for the feature

#### Exclude
- Repo-wide formatting changes unless required
- Dependency upgrades unless required
- Unrelated cleanup in neighboring modules

---

### Commit Command Sequence (MANDATORY)
Before committing:
1. `git status`
2. `git diff`
3. Stage intentionally:
   - `git add -p` (preferred) or `git add <files>`

Commit:
- `git commit -m "<type>(<scope>): <summary>"`

After commit:
- `git status`

Repeat until the next checkpoint is complete, then commit again.

---

### Handling Mixed Changes (MANDATORY)
If you accidentally made unrelated edits:
- Revert them before committing, or
- Split into separate commits (preferred). Only keep the unrelated commit if explicitly requested.

---

### If Tests Cannot Be Run (MANDATORY)
If you cannot run tests for a valid reason (missing env, tool not available):
- Still commit, but include a clear note in the commit body.

Example:
- Subject: `feat(api): implement permit search by address`
- Body: `Notes: tests not run (DB env not available).`

---

### Golden Rule (MANDATORY)
If the diff feels “big,” you waited too long. **Split the work and commit sooner.**

## MANDATORY: Settings UI Pattern

Every settings surface in this app — admin or per-user — is a **registry-driven
hub**, not a tab strip and not an ungoverned route. This was established by
epic #90 (issues #91–#96) and is documented in full, with rationale and
rejected alternatives, in [`docs/specs/settings-ui.md`](docs/specs/settings-ui.md).
This section states the rules; that file explains why.

### Core Rules (MANDATORY)

1. **Every new settings page MUST be declared in a section registry.**
   Admin cards go in `apps/web/src/config/adminSections.tsx`
   (`ADMIN_SECTIONS`); per-user cards go in
   `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`).
   A route added without a registry entry is not acceptable — it is a route
   the hub, the Console rail, and the AppBar title resolver all disagree
   about, because none of the three has any way to know it exists.

2. **A settings page MUST NOT be added as a new tab on an existing settings
   page.** Tabs remain legitimate **inside** a single destination, but only
   for genuinely **parallel** content — two views of the same question. The
   live example is `apps/web/src/pages/Admin/UsersPage.tsx`, which keeps its
   two tabs (Users, Allowlist) on purpose: they are two views of one question
   ("who may use this application"), backed by two controllers, not a
   hierarchy. State the distinction precisely:
   - A **destination** gate (which registry card, which route) is about
     **reachability**.
   - A **tab** gate (inside one page) is about **content**.
   Conflating the two is the exact mistake epic #90 fixed:
   `SystemSettingsPage`'s three tabs (UI Settings, Feature Flags, Advanced
   JSON) were hierarchical content wearing a tab strip, not parallel content.

3. **The card's `permission` field MUST be the exact string the API
   controller enforces** — never invented, never approximated. Follow the
   real, verified mapping as the model:
   - `system_settings:read` / `system_settings:write` →
     `system-settings.controller.ts`
   - `users:read` → `users.controller.ts`
   - `allowlist:read` → `allowlist.controller.ts` (gates content **inside**
     the Users & Allowlist page, not the route — see rule 2's
     reachability-vs-content distinction)

4. **New settings surfaces MUST reuse the shared
   `apps/web/src/components/settings/SettingsHub.tsx` component.** Do not
   fork it, do not copy it. The worked example is `/settings`
   (`apps/web/src/pages/UserSettingsHubPage.tsx`): it is a 4-prop binding
   (`sections`, `hubKey`, `title`, `subtitle`) over the exact same component
   `/admin/settings` uses — nothing more.

5. **The five coupled breakpoint gates move together or not at all.** Never
   change one without checking all five:
   1. `Layout.tsx`'s `showRail` (`up('sm')`) — mounts/unmounts `NavigationRail`
   2. `BottomNav`'s own `down('sm')` self-gate
   3. `<main>`'s `pb: { xs: 10, sm: 3 }` in `Layout.tsx`
   4. `SettingsHub.tsx`'s `isCompactWindow` (`down('sm')`)
   5. `AppBar.tsx`'s `isCompactWindow` (`down('sm')`)

   Related but NOT a sixth gate: the bottom bar renders only the **unpinned**
   destinations (#51), so Console never becomes a sixth tab. That is a
   destination-model rule, not a breakpoint one — see
   `docs/specs/settings-ui.md` §5a.

   The boundary is `sm` (600px), never `md` (900px) — gating at 900px hands
   the phone treatment to 600–899px tablets, foldables, and landscape
   phones. There is deliberately no shared constant binding these five: see
   `docs/specs/settings-ui.md` §5 for why.

See [`docs/specs/settings-ui.md`](docs/specs/settings-ui.md) for the full
rationale, the rejected alternatives, and the accessibility requirements.

## Today and the next best action

The Today screen, the deterministic next-best-action engine, the commitment
action endpoints and the Start flow have their own written contract in
[`docs/specs/today-and-nba.md`](docs/specs/today-and-nba.md): every scoring
weight and its value, the intervention-mode table **and its resolution order**,
the sizing rules, the STARTED pre-rule, the timer derivation, the reschedule
new-row model, the check-in and reflection contracts, the deep-link contract E12
builds on, and the rejected alternatives.

Read it before changing anything under `apps/api/src/today/`,
`apps/web/src/components/today/` or `apps/web/src/components/start/`.
`apps/api/test/docs/today-spec-doc.spec.ts` fails if a weight, a mode threshold
or an action name changes without the document changing with it — including when
only the VALUE moves, which is the realistic mistake.

Two rules that are easy to break and expensive to rediscover:

- **`GET /today` must never call AI.** PRD §120's "the screen works when the
  provider is down" is structural, not a timeout: the coach's sentence is a
  separate request (`GET /today/insight`) whose every failure is a 200 with
  `source: 'template'`. An integration spy asserts zero gateway calls.
- **The elapsed timer is derived, never stored.** `activeSeconds` is time banked
  at the last pause and `activeSince` is the current run's anchor; a stored
  elapsed value would need writing on a schedule and would be quietly wrong the
  moment a client stopped sending it.

## The domain model

The EvolvePath product tables — the PRD §9 hierarchy from Best Self down to
Evidence — have their own written contract in
[`docs/specs/domain-model.md`](docs/specs/domain-model.md): every enum, every
table, the plan-versioning rules, the commitment transition matrix, the
ownership rule (404, never 403), the audit actions, and an "extending the
model" section saying which tables E04–E11 add and which they must not touch.

Read it before changing anything under `apps/api/src/path/` or
`apps/api/src/commitments/`. `apps/api/test/docs/domain-model-doc.spec.ts`
fails if the schema grows an enum member or a table the document does not
mention, so the two cannot drift silently.

## Coaching notifications

The decision engine, the nine coaching categories, the copywriter and the
interaction log have their own written contract in
[`docs/specs/coaching-notifications.md`](docs/specs/coaching-notifications.md):
the decision order and every suppress reason, the quiet-hours and fatigue rules
with their constants, the candidate windows and dedupe keys, the copy gates and
the banned-phrase patterns, the run's ordering, and the rejected alternatives.

Read it before changing anything under `apps/api/src/coaching-notifications/` or
the `coach.*` entries in `apps/api/src/notifications/notification-events.ts`.

Three rules that are easy to break and expensive to rediscover:

- **The AI cannot decide whether to send.** PRD §14.7. `decide()` is a pure
  function with no I/O, and the copywriter is called only on a `send: true`
  decision, with none of the inputs that decision was made from. It is a
  signature, not a prompt instruction — keep it that way.
- **The SENT row is written before the message is.** Its id becomes `?n=` on
  every link, and the unique `(user_id, event_key, dedupe_key)` index is what
  makes two overlapping runs send once. Sending first and recording afterwards
  produces a message the user got and the caps cannot see.
- **A quiet-hours window usually crosses midnight.** `start <= t < end` matches
  nothing at all for `22:00–07:00`, so quiet hours silently stop working while
  every test written against a `12:00–13:00` window still passes.

## The AI coach and its memory

The coaching contract, the context assembler's scopes and budgets, the safety
layer, the mutation protocol, memory tiers and both screens have their own
written contract in
[`docs/specs/coach-and-memory.md`](docs/specs/coach-and-memory.md): the scope
table and the truncation order, the rule table and the fail-to-conservative
rule, the six plan-change ops and what accept touches, the guard, the two
booleans on a memory insight, the observability fields, the extension points
for E07/E09/E10/E11, and the rejected alternatives.

Read it before changing anything under `apps/api/src/coach/`,
`apps/web/src/components/coach/` or `apps/web/src/components/settings/`'s
memory files.

Three rules that are easy to break and expensive to rediscover:

- **No code path except `POST /proposals/:id/accept` turns AI output into a
  `PlanVersion`.** VISION §19, PRD §89/§107. `tests/e2e/specs/coach.spec.ts`
  counts `plan_versions` before the proposal, after it, and after the accept —
  because a claim about a write that does not happen is invisible to every
  other kind of test.
- **The prompt asks and `coach-output-guard.ts` enforces, and that is not
  redundant.** A model may name a commitment or a plan the user does not have,
  and the result is a confident, specific, plausible sentence a reader cannot
  tell from a true one (PRD §90). The guard is why `renderForPrompt` emits
  `planId=` / `routineId=` / `commitmentId=` lines: a reply may only name ids
  the context contained.
- **Safety runs before the model, never after.** A `redirect` is decided by a
  regex and answered with constant copy, so the professional-care path works in
  exactly the situation a model-written one would not — when the provider is
  down, or the user has no key.

## The weekly loop

Weekly review generation, the deterministic aggregation, the reviewer persona,
the hourly sweep, materialisation and the PRD §48 load check have their own
written contract in [`docs/specs/weekly-review.md`](docs/specs/weekly-review.md):
every count definition, the time-window boundaries, the reviewer's six outputs
and its guard, the template rules, the scheduling promise, the materialisation
and load-check rules with their constants, the screens, and the rejected
alternatives.

Read it before changing anything under `apps/api/src/weekly/` or
`apps/web/src/components/weekly/`.
`apps/api/test/docs/weekly-review-doc.spec.ts` fails if a constant, an audit
action or an output field changes without the document changing with it —
including when only the VALUE moves, which is the realistic mistake.

Three rules that are easy to break and expensive to rediscover:

- **A rescheduled intention is counted once.** E02-04's reschedule closes the
  original as `RESCHEDULED` and opens a new row carrying the count; both are in
  the week. A naive `planned` reports two workouts where the user intended one,
  and then a 50% completion rate for doing the only thing they meant to do.
- **Nothing in `WeeklyModule` may write a `PlanVersion`.** The reviewer's
  proposed changes become `plan_change_proposals` rows through
  `ProposalsService.createFromSource` and stop there; the plan changes only when
  the user calls `POST /proposals/:id/accept` (PRD §15, §89). `PathModule` is
  imported for `DomainModesService` and it also exports `PlanVersionsService` —
  do not inject it.
- **A load warning is data, never an exception.** PRD §48 asks the product to
  *recommend* replacing something. `approve` answers 422 until
  `acknowledgeWarnings: true`, which means the user has read the warning — not
  that the software agreed with them.

## The Family domain

Family members, rituals, recurrence materialization, the behaviour lint and the
planned-versus-kept summary have their own written contract in
[`docs/specs/family-domain.md`](docs/specs/family-domain.md): the privacy
boundary and the four places that enforce it, the recurrence rules (weekday
numbering, Monday-start weeks, DST), the 7-day horizon and the idempotency
index, the cancel-not-delete rule on edit, the lint's three rules, the summary's
count semantics, the no-score rule, and the rejected alternatives.

Read it before changing anything under `apps/api/src/family/` or
`apps/web/src/components/family/`.
`apps/api/test/docs/family-domain-doc.spec.ts` fails if a constant, a prompt
version or the coach's sentence changes without the document changing with it.

Three rules that are easy to break and expensive to rediscover:

- **A family member record is five fields, and there is no sixth.** PRD §33 fixes
  it; VISION §50 explains it — the people in it never consented to being modeled.
  The schema, a `.strict()` response schema, an explicit mapper projection and a
  sorted-equality test all enforce it, and audit rows carry the relationship and
  nothing else.
- **Editing a ritual cancels only the slots the new rule dropped.** Cancelling
  everything and re-materializing looks right and fails silently: the unique
  `(ritual_id, scheduled_start)` index turns each re-created slot into a
  `skipped`, so unticking Sunday would leave Tuesday and Thursday cancelled.
- **There is no family score, ratio or percentage, anywhere.** VISION §12 and
  PRD §105. `apps/api/src/family/no-score.guard.spec.ts` fails the build if one
  reaches a family schema, DTO or `/api/family` OpenAPI path.

## The Health domain

Workout programs, the session runner, progression, adaptation, media coaching,
nutrition behaviours and the weight trend have their own written contract in
[`docs/specs/health-domain.md`](docs/specs/health-domain.md): the data model,
the builder's rules table with its codes and constants, the starter program,
approve's transaction and scheduling formula, the finish → commitment status
table, the idempotent set-logging protocol, the progression rules verbatim, the
adaptation detectors, the media contracts with the safety redirect and the
no-calorie guard, the nutrition registry, the weight trend rules, and the
rejected alternatives.

Read it before changing anything under `apps/api/src/workouts/`,
`apps/api/src/health-domain/`, `apps/web/src/components/workouts/` or
`apps/web/src/components/health/`.
`apps/api/test/docs/health-domain-doc.spec.ts` fails if a constant, a prompt
version, a detector or the safety copy changes without the document changing
with it — including when only the VALUE moves, which is the realistic mistake.

Three rules that are easy to break and expensive to rediscover:

- **The progression rule has no model in it.** PRD §42. `suggestProgression` is
  pure and the six reasons are evaluated in a fixed order; the AI writes a
  sentence *about* the decision afterwards, and `numbersAreSafe()` rejects that
  sentence if it introduces a number the recommendation did not contain.
- **`equipment` on a catalog row is everything the movement needs, not a menu.**
  A row meaning "dumbbells or kettlebells" is read as "dumbbells and
  kettlebells" and disappears from every filter it appears in — silently, and
  only for the users who own one of the two.
- **Adaptation writes proposals, never plans.** The detectors are counting, not
  reasoning, and the plan changes only through
  `POST /api/proposals/:id/accept`. Accepting runs the registered
  `PROPOSAL_EFFECT`s inside the same transaction, which is what re-points
  `workout_templates.routine_id` at the new version's routine.

## The workout runner and its offline outbox

`/workout/:sessionId` (`apps/web/src/pages/WorkoutRunnerPage.tsx`) is full
screen **by route placement and nothing else** — it sits outside `Layout`,
exactly like `/start/:commitmentId`, so there is no rail and no bottom bar to
hide and **none of the five coupled breakpoint gates is touched**. PRD §11 asks
the runner to replace the navigation while a workout runs; "replace" is achieved
by never mounting it rather than by a gate that remembers to turn it off.

Three rules that are easy to break:

- **Every timer reads a clock; nothing counts.** The rest timer, the elapsed
  header and the commitment timer all compute from a timestamp on each render.
  A counter that decrements on an interval is wrong the moment the tab is
  backgrounded, the phone sleeps or the browser throttles timers — which is
  every set of a real workout, because people put the phone down.
- **A completed set is written to `localStorage` before it is sent**
  (`useSetLogOutbox.ts`, key `workout.outbox.<sessionId>`). The user did the set;
  a failed request must not be able to take it off the screen. The retry can be
  dumb because the server is idempotent on the client-minted `clientId` — a
  replay comes back in `duplicates`, never as a second row. A **4xx is not
  retried**: the server said no, and a set that never leaves the queue is a badge
  that never clears.
- **Sharp pain replaces the set inputs and offers only stop.** The copy comes
  from the server's own constant (`workout-safety-copy.ts`), quoted identically
  by the runner and the progression explanation, and it contains no programming
  advice — not "try it lighter", not "use the machine version" (PRD §45).

## Health media entry points

The three E09-06 coaching endpoints are reached from where the user already is:
**Check my form** from the workout runner (a sheet over the session, so the rest
timer keeps running), **Photograph your equipment** from the builder's equipment
step and from the program page, and **Meal check** from Today's quick add.

Three rules:

- **`capture="environment"` on every one of them.** PRD §123 is mobile-first,
  and a form check that opens a file browser in a gym is a feature nobody uses.
  The attribute is ignored on a desktop, so there is one code path rather than a
  width gate.
- **A photo pre-selects; it never overrides.** The builder's equipment chips
  stay editable after a photograph — a picture of one corner of a garage is
  evidence, not an inventory.
- **The meal card says "I look at habits, not calories" out loud.** A photograph
  of food invites the assumption, and PRD §46 is the answer to it. Risk flags on
  the form check carry an icon *and* text: a warning only a sighted reader with
  full colour vision can read is not a warning.

`MediaCapture` (`apps/web/src/components/health/media/`) uploads one file
through the existing storage endpoint. E03 (epic #67) owns
`MediaAttachmentPicker` with its purposes, targets and processing states; when
it lands, these three call sites swap component and keep their logic.

## Architecture Principles

1. **Separation of Concerns**: UI handles presentation only; API handles all business logic and authorization
2. **Same-Origin Hosting**: UI at `/`, API at `/api`, API reference at `/api/docs`
3. **Security by Default**: All API endpoints require authentication unless explicitly public
4. **API-First**: All business logic resides in the API layer

## Key Commands

```bash
# Setup: copy environment template
cp infra/compose/.env.example infra/compose/.env

# Start development (from infra/compose folder)
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up

# Start development with observability (Uptrace UI at http://localhost:14318)
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up

# Start development with a local object store (MinIO console at http://localhost:9001)
# Uncomment the MinIO block in .env first; see infra/compose/.env.example
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f minio.compose.yml up

# Start production mode
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up

# Run API tests
cd apps/api && npm test

# Run frontend tests
cd apps/web && npm test

# Generate Prisma client after schema changes
cd apps/api && npm run prisma:generate

# Create a new migration (development)
cd apps/api && npm run prisma:migrate:dev -- --name <migration_name>

# Apply migrations (production)
cd apps/api && npm run prisma:migrate

# Note: Use npm scripts (prisma:*) instead of direct npx commands
# They automatically construct DATABASE_URL from individual env vars
```

## Service URLs (Development)

- **Application**: http://localhost:3535 (via Nginx)
- **API Reference (Scalar)**: http://localhost:3535/api/docs
- **Uptrace**: http://localhost:14318 (when otel stack running)

## Command-Line Client (`appctl`)

`apps/cli` is the first-party CLI for this API (epic #110). It is a workspace
package (`--workspace=cli`) that is built from this monorepo and not published;
it logs in through the device authorization flow below, stores the resulting
personal access token, and exposes a single generic `api <method> <path>`
command so it does not go stale as endpoints are added or renamed.

Usage, install, flags, environment variables and CI setup are documented in
[`apps/cli/README.md`](apps/cli/README.md) — that file is the source of truth;
do not restate it here.

### Deploying to a VPS

VPS deployment (epic #168) lives entirely in this CLI as `appctl deploy
doctor|install|update|status` — there is no separate deploy script or
Ansible playbook anywhere in this repo, and there shouldn't be. The design
(why it runs on the VPS with no SSH client in the CLI, why TLS is terminated
by a shared host proxy instead of per-app, why there's no `db` service, what
was rejected) is documented in full in
[`docs/specs/vps-deploy.md`](docs/specs/vps-deploy.md); the operator-facing
runbook — prerequisites, first login after install, troubleshooting — is
[`docs/deployment/vps.md`](docs/deployment/vps.md). The command reference
(flags, exit codes) is [`apps/cli/README.md`](apps/cli/README.md#deploying-to-a-server)
above. Don't restate any of that here; extend those three instead.

## API Endpoints (MVP)

### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `POST /api/auth/logout-all` - Logout from all devices
- `GET /api/auth/me` - Get current user

### Device Authorization (RFC 8628)
- `POST /api/auth/device/code` - Generate device code (Public)
- `POST /api/auth/device/token` - Poll for authorization (Public)
- `GET /api/auth/device/activate` - Get activation info
- `POST /api/auth/device/authorize` - Approve/deny device
- `GET /api/auth/device/sessions` - List device sessions
- `DELETE /api/auth/device/sessions/{id}` - Revoke device session

### Users (Admin-only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/{id}` - Get user by ID
- `PATCH /api/users/{id}` - Update user (roles, activation)
- `PUT /api/users/{id}/roles` - Update user roles

### Settings
- `GET /api/user-settings` - Get current user's settings
- `PUT /api/user-settings` - Replace user settings
- `PATCH /api/user-settings` - Partial update user settings
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Replace system settings (Admin)
- `PATCH /api/system-settings` - Partial update system settings (Admin)

### Allowlist (Admin-only)
- `GET /api/allowlist` - List allowlisted emails (paginated, filterable)
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/{id}` - Remove email from allowlist

### Storage Objects
- `POST /api/storage/objects/upload/init` - Initialize resumable upload
- `GET /api/storage/objects/:id/upload/status` - Get upload progress
- `POST /api/storage/objects/:id/upload/complete` - Complete multipart upload
- `DELETE /api/storage/objects/:id/upload/abort` - Abort upload
- `POST /api/storage/objects` - Simple file upload
- `GET /api/storage/objects` - List objects (paginated)
- `GET /api/storage/objects/:id` - Get object metadata
- `GET /api/storage/objects/:id/download` - Get signed download URL
- `DELETE /api/storage/objects/:id` - Delete object
- `PATCH /api/storage/objects/:id/metadata` - Update metadata
- `GET /api/storage/quota` - Bytes used, the per-user ceiling and what is left. All three are **strings** (`size` is a BigInt); `quotaBytes`/`remainingBytes` are `null` when quotas are disabled, so a client renders "unlimited" rather than a meaningless bar

### Personal Access Tokens
- `POST /api/pat` - Create a new personal access token
- `GET /api/pat` - List current user's tokens
- `DELETE /api/pat/{id}` - Revoke a token

### Notifications (current user)
- `GET /api/notifications/push/public-key` - The VAPID public key, or `null` when push is not configured
- `GET /api/notifications/push-subscriptions` - This user's devices, by endpoint **host** — never the endpoint, never the keys
- `POST /api/notifications/push-subscriptions` - Register this browser; upserts on the endpoint and re-owns one held by another account
- `DELETE /api/notifications/push-subscriptions` - Stop pushing to this browser (204, idempotent)
- `POST /api/notifications/interactions` - Record `OPENED` / `ACTIONED` / `DISMISSED`; name the message by inbox row or by the deep link's `?n=`
- `POST /api/notifications/interactions/dismissed` - **Public.** The service worker's dismissal report; the UUID is the whole capability and the answer is always 204

### Coaching Notifications (current user)
- `GET /api/me/notification-policy` - Quiet hours, the three caps, muted categories and the current fatigue reduction
- `PATCH /api/me/notification-policy` - Merge patch; `quietHours: null` clears. Audited as `notification_policy:update`
- `GET /api/notifications/metrics?days=` - Per-category sends/opens/actions/suppressions, the independence metric (PRD §65) and the month-by-month reminder trend. `days` is 7-180

### AI Settings (Admin)
- `GET /api/ai-settings` - Provider, models and the masked platform-key status
- `PUT /api/ai-settings` - Replace settings (`If-Match`; `platformApiKey` is write-only)
- `GET /api/ai-settings/personas` - The personas a model can be assigned to
- `GET /api/ai-settings/models?refresh=` - Live catalog, filtered to GPT >= 5.4 (200 always)
- `POST /api/ai-settings/test` - Probe the platform key (200 always)

### AI Key (current user)
- `GET /api/me/ai-key` - Status, last test, and what the platform is missing
- `PUT /api/me/ai-key` - Save or replace your key (write-only)
- `DELETE /api/me/ai-key` - Remove your key (idempotent 204)
- `POST /api/me/ai-key/test` - Probe your own key (200 always)

Note: `GET /api/auth/me` also carries `aiKey: { configured, hint }` and
`onboarding: { completed }`, so the web app can gate its shell without a second
request on boot. Reading `onboarding` never creates a `user_profiles` row.

### Today
- `GET /api/today` - The day: deterministic next best action with rationale, three domain sections (always three, including paused), the check-in. **Makes no AI call**
- `GET /api/today/insight` - The coach's sentence. Always 200; `source: 'template'` when AI is unavailable
- `POST /api/today/check-in` - "How does today feel?"; upsert, one row per user per local day; invalidates the cached insight
- `GET /api/today/check-in` - Today's check-in, or null
- `POST /api/today/reflection` - End-of-day quick option + optional text, stored as a `relatedType: 'day'` reflection
- `GET /api/today/reflection` - Today's latest day reflection, or null

### Media Attachments (epic E03)
The product-level view of an upload: what it is for, what it belongs to, how far
processing has got, and what the coach said. Own data only; a foreign or unknown
id answers **404, never 403** — unlike the generic Storage API, which answers
403 because it is permission-based and admins reach other people's objects
through `storage:*_any`.
- `POST /api/media/attachments` - Give an upload a `purpose` and optionally a target. `kind` is derived from the MIME type, never sent. 409 if that upload is already attached — one attachment per upload
- `GET /api/media/attachments?targetType=&targetId=&purpose=` - The caller's rows, newest first
- `GET /api/media/attachments/{id}` - One attachment. `processingStatus` collapses storage's five statuses into the three a client can act on (wait / ask / retry), and `media.*` saves every client from reading `_processing` JSON
- `DELETE /api/media/attachments/{id}` - 204. Removes the attachment, the object and every derived object (frames, AI variant) through `ObjectsService.delete`
- `GET /api/media/attachments/{id}/preview?variant=&frameIndex=` - Signed URL. `variant` in the **response** says what was actually served: `ai` falls back to the original rather than failing

### Best Self (current user)
- `GET /api/me/best-self` - The caller's Best Self profile; `data: null` until saved
- `PUT /api/me/best-self` - Replace it whole and stamp `lastReviewedAt` (no PATCH by design)

### Outcomes
- `GET /api/outcomes` - List own outcomes (`domain`, `state`, `includeArchived`)
- `POST /api/outcomes` - Create an outcome
- `GET /api/outcomes/{id}` - Get one (404 for another user's, never 403)
- `PATCH /api/outcomes/{id}` - Update (`domain` immutable; 409 if archived)
- `POST /api/outcomes/{id}/archive` - Archive; idempotent

### Domain Modes (current user)
- `GET /api/me/domain-modes` - Always three entries; an unset domain reports GROW
- `PUT /api/me/domain-modes/{domain}` - Set one domain's posture

### Plans (versioned)
- `POST /api/outcomes/{id}/plans` - Create the plan + v1 (ACTIVE, approved) + routines, atomically
- `GET /api/outcomes/{id}/plans` - List an outcome's plans (0 or 1 today)
- `GET /api/plans/{id}` - Plan with its active version
- `GET /api/plans/{id}/versions` - Full history, newest first
- `GET /api/plans/{id}/versions/{version}` - One version in full, with routines
- `POST /api/plans/{id}/versions` - Draft the next version (`rationale` required; routines cloned)
- `PATCH /api/plans/{id}/versions/{version}` - Edit a draft (409 otherwise)
- `POST /api/plans/{id}/versions/{version}/activate` - Supersede + activate atomically
- `POST /api/plans/{id}/versions/{version}/reject` - Draft → REJECTED (rationale kept)

### Routines
- `GET /api/routines?planVersionId=` - Routines of one version (`planVersionId` required)
- `POST /api/routines` - Add a routine (409 if the version is read-only)
- `GET /api/routines/{id}` - Get one
- `PATCH /api/routines/{id}` - Update (rules re-checked against the merged routine)
- `DELETE /api/routines/{id}` - Delete (204)

### Commitments
- `GET /api/commitments?from=&to=` - Window required, capped at 62 days; `status` is CSV
- `POST /api/commitments` - Create (writes no evidence; foreign ids must be owned and consistent)
- `GET /api/commitments/{id}` - With its evidence and reflections
- `PATCH /api/commitments/{id}` - Edit (no `status` here; 409 on a terminal row)
- `POST /api/commitments/{id}/transition` - The only status change; 409 + `details.reason: INVALID_TRANSITION`

### Commitment actions
Ten intent-named routes over the same matrix. Each returns a **commitment card**
(the shape `GET /today` uses) and answers 404, never 403, for a foreign id.
- `GET /api/commitments/{id}/actions` - The card an execution screen reads, plus `whyItMatters`
- `POST /api/commitments/{id}/actions/start` - Timer on; `APP_FLOW started`. Resumes a paused row; pauses any other running timer
- `POST /api/commitments/{id}/actions/pause` - Banks the seconds; status stays STARTED (paused is `activeSince: null`)
- `POST /api/commitments/{id}/actions/continue` - Timer back on; `extraMinutes` extends the target. Accepted while still running ("Continue another 15?"), keeping the anchor
- `POST /api/commitments/{id}/actions/complete` - Legal without a start; `minutesSpent` defaults to the timer
- `POST /api/commitments/{id}/actions/partial` - Same, to PARTIALLY_COMPLETED
- `POST /api/commitments/{id}/actions/fallback` - Which size is being attempted; no status change; 400 `VERSION_NOT_DEFINED`
- `POST /api/commitments/{id}/actions/reschedule` - Returns the **new** row; 409 `ALREADY_STARTED`
- `POST /api/commitments/{id}/actions/skip` - Reflection with a friction tag, never evidence
- `POST /api/commitments/{id}/actions/decompose` - Coach proposal; **writes nothing**; 200 `source: 'template'` when AI is down
- `POST /api/commitments/{id}/actions/decompose/apply` - 201; a new commitment from the first step

### Evidence
- `POST /api/evidence` - Log what happened (`source` must be `USER_LOG`)
- `GET /api/evidence?from=&to=` - Window required, capped at 93 days
- `DELETE /api/evidence/{id}` - Remove your own row (204)

### Reflections
- `POST /api/reflections` - Note/tags/scores on a commitment, outcome, plan version or day
- `GET /api/reflections` - Newest first, capped at 200

### Coach (epic E06)
- `POST /api/coach/messages` - One coaching turn. **Always 201**: a provider failure, or output naming things the user does not have, is a readable message plus `degraded: true` (PRD §120). A safety `redirect` answers with professional-care copy and never calls the model
- `POST /api/coach/conversations` / `GET /api/coach/conversations` - Start / list threads (most recently used first)
- `GET /api/coach/conversations/{id}/messages` - Read a thread, ascending; `before` pages upward
- `DELETE /api/coach/conversations/{id}` - Delete it and its messages (204, PRD §84). A proposal created from one survives with `sourceMessageId: null`
- `GET /api/coach/suggested-prompts` - The seven PRD §66 chips, in order

Note: `structured` is null on a degraded turn — a fallback is deliberately
indistinguishable from "no model output". `invocationId` is never on the wire.

### Memory Insights (epic E06)
What the coach remembers, and PRD §85's controls over it. `userConfirmed`
("this is true") and `doNotUse` ("never bring this up") are two different
questions — an insight can be both true and forbidden.
The user-facing surface is `/settings/ai-memory`, declared as a card in
`USER_SETTINGS_SECTIONS` — a destination, never a tab on the key page.
- `GET /api/memory-insights?category=&includeDoNotUse=` - Ordered by category, confirmed first, then confidence
- `POST /api/memory-insights` - Tell the coach something yourself; stored confirmed at full confidence
- `PATCH /api/memory-insights/{id}` - Reword it. Editing an AI guess **confirms** it
- `POST /api/memory-insights/{id}/confirm` / `POST /api/memory-insights/{id}/do-not-use` - The two flags
- `DELETE /api/memory-insights/{id}` - Forget it (204). A **hard delete**; the audit row carries the category and nothing else (PRD §86)
- `POST /api/memory-insights/propose` - 28 days of aggregated counts in, at most five unconfirmed insights out. Always 200 (`insufficient_data` / `ai_unavailable`); 429 beyond one run per ten minutes

### Plan Proposals (epic E06)
The user's half of PRD §15's mutation protocol. There is deliberately no
`POST /proposals` — proposals are created by the service that produced them.
- `GET /api/proposals?status=&planId=` - Your proposals, newest first. Reading one past its 7-day life marks it `EXPIRED` (lazy; there is no sweeper)
- `GET /api/proposals/{id}` - One proposal plus `preview.diff`, computed by the **same pure function** accept applies
- `POST /api/proposals/{id}/accept` - **The only path in the product that turns AI output into a `PlanVersion`.** Atomic; returns the new version
- `POST /api/proposals/{id}/edit` - Rewrite the whole change set. Keeps `originalChanges`; a later accept is attributed `createdBy: USER`
- `POST /api/proposals/{id}/reject` - Keep the current plan. Touches nothing; the reason is kept for the coach

### Weekly Review (epic E10)
The PRD §135 loop's first half. Weeks are the user's local Monday as
`'YYYY-MM-DD'`; the numbers are deterministic and the coach's reading of them is
a separate column, so a provider outage changes the words and never the counts.
- `POST /api/weekly/reviews/generate` - Aggregate the week, then ask the reviewer for the PRD §14.6 six outputs. **Always produces a review**: `aiSummary.source` is `'template'` when the provider is unavailable. Any proposed change becomes a `WEEKLY_REVIEW` proposal — this route never writes a `PlanVersion`. Omitting `weekStart` reviews last week on Mon/Tue and the week in progress from Wed. 400 `INVALID_WEEK_START`; 409 `WEEKLY_REVIEW_APPROVED` / `WEEKLY_REVIEW_IN_PROGRESS`; 429 after five per hour
- `GET /api/weekly/reviews?weekStart=&limit=` - Newest week first
- `GET /api/weekly/reviews/current` - The latest, or **`null`** for a user who has never had one
- `GET /api/weekly/reviews/{id}` - One review with its resolved proposals (404 for a foreign id, never 403)
- `POST /api/weekly/reviews/{id}/skip` - A week the user chooses not to review; 409 `WEEKLY_REVIEW_NOT_SKIPPABLE`
- `GET /api/weekly/settings` / `PUT /api/weekly/settings` - The review day (0–6) and `'HH:mm'`, plus `nextReviewAt`. **The sweep is hourly**, so `16:30` is prepared in the 16:00 pass

Note: `invocationId` is never on the wire. It is an internal telemetry pointer,
written to the review row and the audit meta and nowhere a client can read it.

### Weekly Planning (epic E10)
PRD §50's seven steps as a draft row patched step by step. **No model call
anywhere in this block** — materialisation is arithmetic over the user's own
routines.
- `POST /api/weekly/plans` - Start or resume next week. **Idempotent**: a second call returns the same DRAFT (201 for a new one, 200 for an existing). `domainModes` opens on the postures the user is in today. 400 `INVALID_WEEK_START`; 409 `WEEKLY_PLAN_APPROVED`
- `GET /api/weekly/plans?weekStart=` / `GET /api/weekly/plans/{id}` - List / read (404 for a foreign id)
- `PATCH /api/weekly/plans/{id}` - One step. `constraints` replaced whole (a merge patch cannot delete a travel day), `domainModes` merged (naming FAMILY means "leave the other two alone"). Clears the previous proposal; 409 `WEEKLY_PLAN_NOT_EDITABLE`
- `POST /api/weekly/plans/{id}/propose` - What next week would look like, plus the PRD §48 load check. An occurrence dropped for a travel day, a colliding fixed event or a paused domain comes back with `include: false` and an `excludedBy` reason, never omitted
- `POST /api/weekly/plans/{id}/approve` - One transaction: the commitments, the changed domain modes and the previous week's review. Idempotent under retry (`skippedExisting`); 422 `LOAD_WARNINGS_UNACKNOWLEDGED` until the user has read the warnings

### Family (epic E08)
Own data only; a foreign or unknown id answers 404, never 403.
- `GET /api/family/members` - List; items carry exactly `id`, `nickname`, `relationship`, `birthday`, `createdAt` — PRD §33 fixes the record and there is nothing else to return
- `POST /api/family/members` - Add someone. `birthday` is a calendar date; `1900` is the placeholder year and nothing reads it
- `PATCH /api/family/members/{id}` / `DELETE /api/family/members/{id}` - Update / remove (204). Rituals and past commitments keep their history
- `GET /api/family/rituals?active=` - List; active first, then by title
- `GET /api/family/rituals/{id}` - One ritual plus `upcoming`: the next 7 days as commitment cards
- `POST /api/family/rituals` - Create, lint the title, and **materialize the next 7 days synchronously**
- `PATCH /api/family/rituals/{id}` - Update. A material change cancels future `PLANNED`/`READY` occurrences **through the transition matrix** and rebuilds them
- `DELETE /api/family/rituals/{id}` - Delete (204); future occurrences cancelled, past ones keep their place with `ritualId: null`
- `POST /api/family/rituals/{id}/materialize` - Create any missing occurrences now. Idempotent via the unique `(ritual_id, scheduled_start)` index
- `POST /api/family/lint` - Check a title, and optionally get a rewrite. **Always 200**; the verdict is deterministic and `source: 'none'` when AI is unavailable
- `GET /api/family/summary?weekStart=&weeks=` - Planned versus kept, per ritual, per week. Integers only: **no ratio, percentage, streak or score anywhere**, and a test fails the build if one appears (VISION §12, PRD §105)

Completing, moving and skipping a ritual occurrence are the ordinary commitment
actions — there are deliberately no family-specific lifecycle endpoints.

### Workouts (epic E09)
Structured training. **Nothing writes a plan until the user approves** — `generate` writes `workout_programs` rows and stops (PRD §15).
- `GET /api/workouts/exercises?q=&group=` - The seeded catalog plus the caller's own custom rows. `substitutionGroup` makes "what can I do instead?" a lookup, not a model call
- `POST /api/workouts/programs/generate` - Safety pre-check → the programmer persona → deterministic rules (beginner day cap, contraindications, time budget). Any failure returns the **starter program** with a `reason` (`invalid_output` / `ai_unavailable` / `safety_redirect` / `requested`); 412 `AI_KEY_REQUIRED` is the one exception, because that is the user's to fix
- `GET /api/workouts/programs?status=` / `GET /api/workouts/programs/{id}` - List / read (404 for a foreign id)
- `POST /api/workouts/programs/{id}/approve` - The only path that turns a draft into a plan. One transaction: the Health outcome and plan, a user-approved `PlanVersion`, one `Routine` per FULL template linked by `workout_templates.routine_id`, the previous program archived, and 14 days of commitments carrying all three sizes. 409 `PROGRAM_NOT_DRAFT`
- `POST /api/workouts/sessions` - Start a workout from a commitment or a template. Goes through E05's `start` action so the timer, the matrix and the evidence stay in one place. 409 `SESSION_IN_PROGRESS` carries the open session's id
- `GET /api/workouts/sessions` / `GET /api/workouts/sessions/{id}` - List / the runner view: the current variant's exercises, everything logged, and `lastTime` per movement (the latest COMPLETED session for it, in **any** template)
- `POST /api/workouts/sessions/{id}/sets` - Idempotent on the client-minted `clientId`: a replay returns the existing row, a new `clientId` on the same `(exercise, setNumber)` is a correction. `SHARP_PAIN` flags the session and answers with the PRD §45 constant — **no model call, no programming advice**
- `POST /api/workouts/sessions/{id}/sets/batch` - The offline replay. Per item, never all-or-nothing: `accepted` / `duplicates` / `rejected`
- `POST /api/workouts/sessions/{id}/switch-variant` - Drop to SHORT or MINIMUM. Sets for dropped movements survive under `alsoLogged`
- `GET /api/workouts/sessions/{id}/exercises/{exerciseId}/explain` - One sentence about the progression suggestion. **The rule decides, the coach explains** (PRD §42): a reply naming any load the deterministic rule did not is discarded for the template, and `source: 'template'` is a complete answer, not a degraded one
- `POST /api/workouts/sessions/{id}/finish` - One `WORKOUT_LOG` evidence row, then the commitment through E05's actions. Abandoning with nothing logged leaves the commitment open, on purpose
- `POST /api/workouts/sessions/{id}/form-check` - Observations, ≤ 3 cues and risk flags from a closed list. **A flagged risk, or a session that already reported discomfort, withholds the cues** and answers with the PRD §45 constant. No score, no rep count, no grade — the contract has no field for one
- `POST /api/workouts/equipment-check` - Detected equipment, plus what the active program cannot do in that room and what the catalog offers instead. Raises a `WORKOUT` proposal; **changes nothing itself**
- `POST /api/nutrition/meal-check` - Behaviour-level observations and ≤ 3 registry behaviours. Any calorie, macro or gram in the answer **rejects it whole** — not edits it
- `POST /api/workouts/adaptation/run` / `GET /api/workouts/adaptation/candidates` - PRD §43's detectors over 14 days (skipped twice, sessions over-running, a disliked or avoided movement). Deterministic, at most one proposal per workout per fortnight, and **writes nothing** — the template changes only when the user accepts the proposal
- `POST /api/workouts/templates/{templateId}/exercises/{id}/dislike` - "Not this one". Records a timestamp, not a flag; the swap is a proposal on the next run
- `POST /api/workouts/programs/{id}/archive` - Retire it; future `PLANNED` days cancelled, history untouched
- `DELETE /api/workouts/programs/{id}` - Drafts only (204). A live program is archived, never deleted

### Health Domain (epic E09)
Behaviours, not calories: no macro, no food database, no BMI, no goal weight.
- `GET /api/nutrition/behaviors` - The eleven-behaviour registry (PRD §46), each with a full and a **minimum** version
- `POST /api/nutrition/behaviors/{key}/commit` - Creates `repeatDays` ordinary HEALTH commitments through the same service quick add uses. A behaviour is not a second kind of intention
- `PUT /api/health/weight` - One row per local date, upserted. 400 `WEIGHT_DATE_IN_FUTURE` / `WEIGHT_DATE_TOO_OLD`. The audit row carries the **date and nothing else**
- `GET /api/health/weight?from=&to=` - Points, a rolling 7-day mean (`null` under two readings) and a delta. **No per-day judgment field exists** — PRD §47's promise is kept by the field's absence, not by client discipline
- `DELETE /api/health/weight/{dateLocal}` - Idempotent (204)

### Health
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check (includes DB)

## RBAC Model

### Roles
- **Admin**: Full access, manage users and system settings
- **Contributor**: Standard capabilities, manage own settings
- **Viewer**: Least privilege (default), manage own settings

### Key Permissions
- `system_settings:read/write` - System settings access
- `user_settings:read/write` - User settings access
- `users:read/write` - User management
- `rbac:manage` - Role assignment
- `allowlist:read/write` - Allowlist management (Admin only)
- `storage:read/write` - Storage object access (own objects)
- `storage:read_any/write_any/delete_any` - Storage object access (all objects, Admin only). Real, seeded to admin only, and consulted by `ObjectsService` since issue #71 — `read_any` and `write_any` were previously documented here and existed nowhere. Uploads themselves stay plain `@Auth()`: Viewer is the default EvolvePath role and every user uploads media

## Database Tables

- `users` - User accounts with profile info
- `user_identities` - OAuth provider identities (provider + subject)
- `roles` / `permissions` / `role_permissions` - RBAC
- `user_roles` - User-to-role assignments
- `system_settings` - Global app settings (JSONB)
- `user_settings` - Per-user settings (JSONB)
- `audit_events` - Action audit log
- `refresh_tokens` - JWT refresh tokens (hashed)
- `allowed_emails` - Allowlist for access control
- `device_codes` - Device authorization codes (RFC 8628)
- `storage_objects` - File metadata, status, storage references
- `storage_object_chunks` - Multipart upload chunk tracking
- `personal_access_tokens` - User-created long-lived API tokens (hashed)
- `ai_invocations` - AI call telemetry (model, prompt version, tokens, latency, validation result, redacted I/O); never chain of thought
- `best_self_profiles` - Who the user is trying to become (identity statements, six-month vision, motivations); one row per user, replaced whole
- `outcomes` - Meaningful results per domain (Work, Family, Health) with importance, target date and state
- `plans` - One per outcome; an identity only, everything mutable lives on its versions
- `plan_versions` - Versioned plan content (rationale, expected weekly load, lineage); at most one ACTIVE per plan, enforced by a partial unique index
- `routines` - Repeatable behaviours prescribed by a plan version (trigger, frequency, duration, fallback)
- `commitments` - One intended action at one time, with its lifecycle status and reschedule lineage (+ execution fields, E05-02: `activeSince`/`activeSeconds`/`timerMinutes`, `versionUsed`, `minutesSpent`, `steps`, `decomposedFromId`, `skipNote`, and per-version minutes; + `ritual_id`, `family_member_id`, E08-01, both `SET NULL`, with a unique `(ritual_id, scheduled_start)` index that makes ritual materialization idempotent)
- `evidence_items` - Facts about what actually happened; survives its commitment (`commitment_id` is SET NULL)
- `reflections` - What the user made of a commitment, outcome, plan version or day
- `domain_modes` - Per-domain posture (GROW, MAINTAIN, RECOVER, PAUSE); a missing row means GROW
- `daily_check_ins` - "How does today feel?" — one row per user per local day, upserted; `date_local` is text in the user's own timezone, never a date column
- `user_profiles` - Typed per-user preferences the product reasons about: `timezone` (what "today" means), `coachingStyle`, `weekdayMinutes`, quiet hours, the weekly review rhythm (`weeklyReviewWeekday` 0-6 with a database check constraint, `weeklyReviewTime` `'HH:mm'`) and onboarding progress; one row per user, created lazily (a missing row means onboarding has not finished)
- `family_members` - Someone the user shares a ritual with. Exactly `nickname`, `relationship`, optional date-only `birthday` — and nothing else, by design (PRD §33, VISION §50: the people in it never consented to being modeled)
- `rituals` - A recurring family behaviour the user is protecting: the recurrence rule (`weekdays`, `HH:mm`, `everyNWeeks`), ideal and minimum minutes, fallback text and the materialization horizon. A rule, not a schedule — the materializer turns it into ordinary `commitments`
- `notification_interactions` - The coaching decision log: one `SENT`, `OPENED`, `ACTIONED`, `DISMISSED` or `SUPPRESSED` row per decision or response. The only place that records **why a message was not sent** (`suppress_reason`), what the user did with one, and which commitment it concerned. The unique `(user_id, event_key, dedupe_key)` index is the scheduler's idempotency; responses carry a null dedupe key and are unconstrained by it
- `push_subscriptions` - A browser's web-push endpoint and its `{p256dh, auth}` keys. `endpoint` is unique **across users**, not per user: a browser profile handed to another account must not keep delivering to the previous owner
- `coach_conversations` / `coach_messages` - The coach thread and its turns (PRD §17 Tier 4). A message carries the validated `coach_reply` contract in `structured`, the `ai_invocations` id it came from, and the `SafetyDecision` that governed the turn — a `redirect` turn is the one case with a decision and no invocation, because no coach model was called
- `plan_change_proposals` - A proposed change to a plan, waiting on a human (PRD §15). `changes` is the diff, `originalChanges` preserves what the coach actually proposed once an edit rewrites it, and `appliedPlanVersionId` records which version an acceptance produced. Both that and `sourceMessageId` are `SET NULL`: deleting a thread or a version must never erase the record of a plan change the user accepted
- `memory_insights` - A durable sentence about the user the coach may reuse (PRD §17 Tier 3, §85). `userConfirmed` ("this is true") and `doNotUse` ("never bring this up") are two different questions, so neither is the other's negation
- `obstacles` - A recurring friction (PRD §10.11). E06 creates the table and lets the coach read it; nothing detects obstacles until E07
- `weekly_reviews` - One Monday-start week compared against its plan (PRD §14.6, §51). `weekStart` is the user's local Monday as `'YYYY-MM-DD'` **text**, never a date column; `aggregates` is deterministic and `aiSummary` is the coach's reading of it, so a `source: 'template'` fallback never touches the numbers. `proposalIds` is a string array with no FK on purpose — proposals expire and may be pruned, and the review has to survive that
- `weekly_plans` - The coming week before it is committed to (PRD §50): the user's constraints, one primary focus, the intended domain modes, and the materialised `proposal` with its load check. `review_id` is `SET NULL` — deleting a review must not delete the week somebody approved off the back of it
- `exercises` - The movement catalog (PRD §39) plus per-user custom rows. `scope` is `'catalog'` or the owning user's id, so `(scope, name_key)` lets two people each invent the same name while the catalog keeps exactly one. `substitution_group` is what makes "what can I do instead?" a lookup rather than a model call
- `workout_programs` - A structured workout program (PRD §37, §38). `plan_id` is null until the user approves — PRD §15 means a DRAFT program must not already point at a plan
- `workout_templates` - One workout at one size. "Upper A" exists three times (FULL, SHORT, MINIMUM) rather than once with modifiers, because the runner renders a concrete list the moment somebody drops to the short version. `routine_id` is the 1:1 join that lets a routine-targeted plan-change proposal reach a template
- `workout_template_exercises` - A prescribed movement: sets, a rep RANGE and rest. Two columns for the range because double progression is arithmetic over its ends
- `workout_sessions` - One run of one template. Not the commitment: `commitment_id` is nullable and `SET NULL`, because a session can happen without one and must survive it
- `set_logs` - One set as performed. `client_id` is minted by the phone and unique: it is the whole of PRD §121's offline story — a replayed queue raises P2002 instead of writing a second set
- `body_weight_logs` - An optional weight entry (PRD §47). `date_local` is text in the user's timezone, like `daily_check_ins.date_local`: the day you weighed yourself is a calendar fact, not an instant
- `media_attachments` - One upload given a purpose (`WORKOUT_FORM`, `EQUIPMENT`, `MEAL`, `GENERAL`), an optional polymorphic target, and the coach's last structured verdict in `ai_summary`. `storage_object_id` is `@unique` — one attachment per upload, so re-purposing means uploading again rather than a photo that is simultaneously a meal and a piece of equipment. Both FKs cascade: media metadata must not outlive its owner or its bytes. `target_type`/`target_id` are deliberately **not** foreign keys; the legal target types are a Zod enum at the API boundary
- `user_profiles.notification_policy` - Caps (`dailyCap`, `weeklyCap`, `perCommitmentMax`) and `mutedCategories` for the coaching engine. Quiet hours are deliberately **not** here — they stay on the `quiet_hours_start/end` columns, so there is one answer to "when is this person asleep?"

## Access Control: Email Allowlist

The application uses an **email allowlist** to restrict access to pre-authorized users only.

### How It Works
1. Admins add email addresses to the allowlist before users can login
2. During OAuth login, the user's email is checked against the allowlist
3. If the email is not in the allowlist, login is denied with a clear error message
4. Exception: `INITIAL_ADMIN_EMAIL` always bypasses the allowlist check

### Configuration
- `INITIAL_ADMIN_EMAIL` environment variable grants initial admin access
- This email is automatically added to the allowlist during database seeding

### Admin Management
- Access allowlist management at `/admin/settings/users` (Allowlist tab; `/admin/users` still redirects here)
- Two tabs available:
  - **Users**: Manage existing registered users
  - **Allowlist**: Pre-authorize email addresses for future logins

### Status Tracking
- **Pending**: Email added to allowlist but user hasn't logged in yet
- **Claimed**: User has successfully logged in and created an account
- Claimed entries cannot be removed (prevents accidentally removing existing user access)

## Security Guidelines

- Secrets via environment variables only (see `.env.example`)
- JWT access tokens are short-lived (15 min default)
- Refresh tokens in HttpOnly cookies with rotation
- Input validation on all endpoints
- File uploads: images and videos only (`ALLOWED_MIME_TYPES`), size limit (`MAX_FILE_SIZE`, 500 MiB default), randomized object keys. Both limits are enforced on both upload paths, and the simple path counts the bytes it stores rather than recording `0`
- Email allowlist restricts application access to pre-authorized users
- OpenAI keys (platform and per-user) are encrypted in `credentials` under two
  distinct purposes, write-only through the API, and redacted from every error,
  log line, audit row, OTel span and `ai_invocations` row. The gateway uses only
  the caller's own key — there is deliberately no platform-key fallback

## Testing Requirements

- Unit tests: isolated logic (services, guards, validators)
- Integration tests: API + DB + RBAC flows with test DB
- Mock OAuth in CI (no real Google dependency)
- Frontend: component and hook tests
- **E2E: every epic ships Playwright specs under `tests/e2e/specs/` proving its
  flow end to end — browser, API and database — against the fake OpenAI server
  (`infra/compose/fake-openai.compose.yml`). E12's `notifications.spec.ts`
  drives the scheduler through `POST /api/auth/test/run-job` with a simulated
  clock rather than waiting for the cron. They run on two projects,
  `chromium` and `mobile-chromium`, because the shell mounts different
  navigation components either side of the `sm` boundary. See
  `docs/TESTING.md` → "E2E Testing with Playwright".

## Environment Variables

Key variables (see `infra/compose/.env.example` for full list):

**Application:**
- `NODE_ENV` - Environment (development/production)
- `PORT` - API port (default: 3000)
- `APP_URL` - Base URL (default: http://localhost:3535)

**Database (individual connection parameters):**
- `POSTGRES_HOST` - Database hostname (default: localhost)
- `POSTGRES_PORT` - Database port (default: 5432)
- `POSTGRES_USER` - Database user (default: postgres)
- `POSTGRES_PASSWORD` - Database password (default: postgres)
- `POSTGRES_DB` - Database name (default: appdb)
- `POSTGRES_SSL` - Enable SSL connection (default: false)

Note: `DATABASE_URL` is constructed automatically from these variables at runtime.

**Authentication:**
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_ACCESS_TTL_MINUTES` - Access token TTL (default: 15)
- `JWT_REFRESH_TTL_DAYS` - Refresh token TTL (default: 14)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `INITIAL_ADMIN_EMAIL` - First user with this email becomes Admin
- `DEVICE_CODE_EXPIRY_MINUTES` - Device code lifetime (default: 15)
- `DEVICE_CODE_POLL_INTERVAL` - Device polling interval in seconds (default: 5)
- `DEVICE_TOKEN_EXPIRY_DAYS` - Token lifetime for device sessions in days (default: 7)
- `DEVICE_PAT_EXPIRY_DAYS` - Lifetime of the PAT minted when a device (e.g. the CLI) requests `clientInfo.tokenType: "pat"`, in days; clamped to 1-999 (default: 90)
- `SECRETS_ENCRYPTION_KEY` - Base64-encoded 32-byte AES-256 key (generate with `openssl rand -base64 32`) that encrypts runtime-configured credentials (e.g. an SMTP password an admin enters through the app) before they are stored in the `credentials` table. Optional until a credential is stored; see `docs/runbooks/rotate-secrets-encryption-key.md`. Note: credentials configured at runtime through the UI/API live encrypted in the database, not in the environment — unlike every other secret in this section.

**AI (epic #20):**
- `OPENAI_BASE_URL` - Provider base URL (default: `https://api.openai.com/v1`). Normally unset; the fake-server overlay sets `http://fake-openai:8089/v1`. An administrator can also override it per-installation in the AI settings, which wins.
- `AI_REQUEST_TIMEOUT_MS` - Hard deadline for one generation (default: 60000)
- `AI_MAX_IMAGE_BYTES` - Largest image the gateway will inline (default: 20971520). Bounds one AI call, not one upload.
- `AI_MAX_IMAGES_PER_CALL` - Images per call, counted after a video expands to its sampled frames (default: 10)
- `AI_VIDEO_MAX_FRAMES` - Frames sampled from one video (default: 8, **clamped** to 1-16). A clamp rather than a validation: the failure mode of too many frames is a bill, not a broken deploy.
- `AI_VIDEO_MAX_SECONDS` - Longest video the sampler will process (default: 120). A **refusal**, not a clamp — silently sampling the first two minutes of a ten-minute video hands the coach frames of something the user did not ask about.
- `FFMPEG_PATH` / `FFPROBE_PATH` - Binary locations (default: `ffmpeg` / `ffprobe`). Both are installed in the API image's base stage, so production has them.
- `AI_ATTACHMENT_MODE` - `inline` (default) or `signed-url`. Inline puts base64 in the request the user's own key pays for and keeps the whole exchange observable; signed-url hands the provider a short-lived GET it fetches itself — smaller on the wire (PRD §118), at the cost of a credential reaching this deployment's storage. An unknown value **throws at boot**, so a typo is a failed deploy rather than a broken coaching reply.
- `AI_ATTACHMENT_SIGNED_URL_TTL` - Lifetime of those URLs, in seconds (default: 300)
- `AI_MAX_SOURCE_IMAGE_BYTES` - Largest **original** the normalizer will decode (default: 26214400 = 25 MiB). Distinct from `AI_MAX_IMAGE_BYTES`, which bounds what reaches the model: a 25 MiB phone photo is normal and normalizes to ~150 KiB, so refusing it up front would refuse the product's main input.
- `STORAGE_USER_QUOTA_BYTES` - Bytes one user may hold, derived children included (default: 2147483648 = 2 GiB). `0` disables the check; `GET /api/storage/quota` then reports nulls and never rejects.
- `TMPDIR` - Where the sampler writes the video it is about to read (default: the platform temp dir). ffmpeg needs a **seekable file**: MP4 `moov` atoms are routinely at the end, so a streamed input makes ffprobe report nothing for exactly the format phones produce.

**Weekly review (epic E10):**
- `WEEKLY_LOAD_SOFT_CAP` - The number of recurring commitments past which the product says "replace something rather than add another habit" (PRD §48, default 8). A **soft** cap: the warning is data on the response, never an exception, because a person who deliberately wants a heavy week is not making a mistake the software should refuse.
- `WEEKLY_REVIEW_CRON_DISABLED` - Stops the hourly review sweep (default `false`). Integration tests and the e2e stack set it to `true`: a background job that writes reviews for every seeded user turns a deterministic assertion into a race.

**The Health domain (epic E09):**
- `WORKOUT_ADAPTATION_CRON_DISABLED` - Stops the daily sweep that raises workout plan-change proposals (default `false`). Set it in tests and the e2e stack: a job raising proposals for every seeded user turns a deterministic assertion into a race.

**Coaching notifications (epic E12):**
- `COACHING_NOTIFICATIONS_ENABLED` - The decision engine's five-minute cron (default: `true`). An off switch rather than a feature flag: the engine's failure mode is sending people messages, so it must be stoppable in one restart. The on-demand `POST /api/auth/test/run-job` route (non-production) is deliberately not gated by it.
- `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` / `WEB_PUSH_SUBJECT` - VAPID credentials for web push, generated once per deployment with `npx web-push generate-vapid-keys`. All three optional: without them the push channel is inactive and every user still gets the inbox row and the live update. `WEB_PUSH_PRIVATE_KEY` is a secret and is never logged or returned. **Rotating them invalidates every existing subscription** — each browser signed up against the old public key.

Note: `SECRETS_ENCRYPTION_KEY` now also protects the platform OpenAI key and every user's own key. Without it, saving either fails.

**Storage (epic #67):**
- `MAX_FILE_SIZE` - Largest upload accepted, in bytes (default: 524288000 = 500 MiB). Enforced on `upload/init` from the declared size and on the simple path from the bytes that actually flow — a Content-Length is a claim, not a measurement.
- `ALLOWED_MIME_TYPES` - Comma-separated allowlist (default: `image/*,video/*`). An exact type, or one trailing `/*`. **An empty value denies every upload**, which is the safe reading of "no types are configured".
- `S3_FORCE_PATH_STYLE` - Path-style addressing for MinIO/LocalStack (default: true whenever `S3_ENDPOINT` is set). AWS ignores it.
- `S3_PUBLIC_ENDPOINT` - The address a **browser** reaches the object store at, used only when signing URLs (default: `S3_ENDPOINT`). In Compose the API talks to `http://minio:9000` and signs against `http://localhost:9000`; signing against the internal host produces a URL that is valid and unreachable.
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` - Credentials for the `minio.compose.yml` overlay (default: `minioadmin`).

**Observability:**
- `OTEL_ENABLED` - Enable OpenTelemetry (default: true)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTEL Collector endpoint
- `UPTRACE_DSN` - Uptrace connection string

## Common Patterns

### Adding a New API Endpoint
1. Create controller method with decorators for auth/RBAC
2. Add service method with business logic
3. Update OpenAPI annotations
4. Add unit + integration tests
5. Update API.md if needed

### Adding a New Setting
1. Update Zod schema for validation
2. Add migration if schema structure changes
3. Update TypeScript types
4. Add frontend UI if user-facing

### Adding a Notification

Three steps, and no migration — the same "one registry entry" promise the
settings hub makes on its own axis (epic #109, wired end to end by #128).

1. **Declare the event** in `apps/api/src/notifications/notification-events.ts`
   (`NOTIFICATION_EVENTS`): a stable dotted `key` (`billing.invoice_ready`), a
   `label` and `description` written as user-facing copy, the `channels` it can
   genuinely be delivered over (`email`, `browser`), and `defaultEnabled`. Add
   `mandatory: true` only for events a user must not be able to silence — a
   privilege or security change. This one entry feeds the dispatcher, the
   `/settings/notifications` matrix and the docs; there is no second list to
   update, and no preference row is created for anybody (absent means enabled).

2. **Write the template(s)**, one per channel the event declares.
   - *Email*: a new `apps/api/src/email/templates/<name>.email.ts` exporting a
     payload interface and a pure function returning `{ subject, html, text }`.
     Build the body with the `html` tagged literal so every interpolation is
     escaped by construction, pass it to `renderLayout`, put any CTA URL
     through the layout (it applies `safeUrl`), and **hand-write the text
     part** — there is deliberately no HTML-to-text helper. Register it in
     `templates/index.ts` (`EmailTemplateDataMap` **and** `EMAIL_TEMPLATES`;
     the compiler rejects half a registration), then map the event key to the
     template name in `EVENT_EMAIL_TEMPLATES`
     (`notifications/channels/email-notification.channel.ts`). A missing entry
     is a recorded delivery failure, not a silent skip.
   - *Push*: **nothing to write.** The push channel renders the browser
     template (`renderBrowserContent`), because a user holding a phone and
     looking at an open tab must not read two different sentences about the same
     moment — and the way to guarantee that is not "keep two templates in sync"
     but "there is one". Declaring `'push'` in the event's `channels` is the
     whole of it.
   - *Browser*: an entry in `EVENT_BROWSER_TEMPLATES`
     (`notifications/channels/browser-notification.channel.ts`) returning
     `{ title, body, link? }`. Optional — a miss falls back to the registry's
     label and description. `link` must be a root-relative path.
   - `test-email.email.ts` and `role-changed.email.ts` are the worked examples.

3. **Call `notify()` at the real trigger**, from a service whose module
   `imports: [NotificationsModule]`:

   ```ts
   await this.notifications.notify('billing.invoice_ready', userId, payload);
   ```

   Place it **after** the triggering write has committed and **outside** any
   `$transaction`. `notify` is detached — it schedules the dispatch and returns
   before anything is rendered or sent — so it never rejects, never joins your
   transaction, and never delays your response; a send failure becomes a
   `notification_deliveries` row, never an exception. Annotate the payload with
   the template's data type: `notify` takes `data: unknown`, so the call site is
   the only place its shape is checked.

   For a recipient who has **no user account** (an allowlist invitation), use
   `notifyAddress(eventKey, email, payload)`. It resolves the address to an
   account when one exists — so real users' preferences are never skipped — and
   otherwise dispatches through the same gate with no stored preferences, which
   the sparse absent-key contract already defines as "use the event's default".

Live examples of all three steps: `AuthService.handleGoogleLogin`
(`user.welcome`), `AllowlistService.addEmail` (`allowlist.invitation`), and
`UsersService.updateUserRoles` (`security.role_changed`, mandatory).
`WorkoutProgramsService.approve` (`health.program_activated`) is the worked
example of the placement rule: the `notify` call sits **after** the approval
transaction commits, because a detached dispatch would otherwise announce a
program a rollback removed.

**A COACHING event (`coach.*`) is the same three steps plus two declarations**,
and both live in `apps/api/src/coaching-notifications/` — never a second event
list. `coaching-events.spec.ts` fails the build if the two disagree in either
direction.

- Its **payload schema** in `coaching-events.ts`: add the key to
  `COACHING_EVENT_KEYS`, its PRD letter to `COACHING_CATEGORY`, and a Zod schema
  to `COACHING_PAYLOAD_SCHEMAS`. Every coaching payload extends the common base
  — `sentInteractionId` (the E12-01 SENT row, minted before dispatch; it becomes
  the `?n=` on every link and is the whole attribution chain) and the optional
  `copy` overlay the copywriter fills in.
- Its **actions and link** in `coaching-actions.ts` (`actionsFor`) and its
  **deterministic wording** in `copy/copy-templates.ts` (`DEFAULT_COPY`). The
  browser template itself is generated from those, so there is nothing to write
  in `EVENT_BROWSER_TEMPLATES`. Labels come from PRD §63's vocabulary verbatim,
  and `copy/banned-phrases.ts` is test-enforced against both the template and
  the AI output — the deterministic copy ships on every provider outage, so a
  shaming template would reach users silently and forever.

### Adding a Path resource

The EvolvePath product domain (epic #33) is six layers deep, and every layer is
reached the same way. Adding a resource to it is six steps in one direction —
never a component that fetches for itself:

1. **Types** in `apps/web/src/types/index.ts`, mirroring the Prisma model. They
   are hand-maintained: generating them would put the API's build output on the
   web app's critical path for values that change about once an epic.
2. **API functions** in `apps/web/src/services/api.ts`, in the EvolvePath block
   at the bottom. That block is the ONLY place the web app names these
   endpoints — if a route or a field moves, it plus the types are the entire
   reconciliation surface.
3. **A hook** in `apps/web/src/hooks/`, shaped like `useOutcomes.ts`:
   `{ data, isLoading, error, refresh, …mutations }`, every `setState` past an
   `await` guarded by `useIsMounted`. **Mutations refetch rather than splice**:
   the API decides the ordering, and reproducing it client-side is a second,
   wrong implementation of it.
4. **A component** in `apps/web/src/components/path/`. Presentational — it
   takes data and callbacks, never a hook.
5. **A handler** in `apps/web/src/__tests__/mocks/pathHandlers.ts`, which is a
   real in-memory store rather than canned responses. Any rule the API enforces
   must be enforced there too, or page tests pass against behaviour the server
   rejects.
6. **A test** driving the real hook against that store.

Two rules the Path screen holds that are easy to break:

- **No client-side authorization decision, ever.** An id that is not yours
  answers 404 — identical to one that never existed — and that answer is the
  truth. `useOutcome` renders a not-found state for it rather than redirecting,
  because a redirect would make a mistyped URL look like a working one.
- **The commitment action menu renders the API's `allowedTransitions`,** never
  a locally computed list. `apps/web/src/utils/commitmentTransitions.ts` is a
  verbatim copy of the API's matrix and exists only for optimistic rendering
  between a successful transition and its refetch; each file points at the
  other.

### Materialising commitments from routines

`apps/api/src/weekly/materialize-week.ts` turns a week's active routines into
proposed commitments, and `load-check.ts` measures what that adds up to. Both
are **pure** — no Prisma, no Nest, no clock — because three things read them:
the approve path, the wizard (which renders the summary the API computed rather
than recomputing it), and their own table-driven specs.

Two rules that are easy to break:

- **An excluded occurrence is still an item.** A Wednesday dropped for a travel
  day is returned with `include: false` and an `excludedBy` reason. A silently
  missing row is indistinguishable from one the product forgot about, and the
  user has no way to tell which happened.
- **Recurring counts are per routine, not per occurrence.** Five morning focus
  blocks are one habit; counting occurrences would put every weekday routine
  over the soft cap on its own and the PRD §48 warning would fire on every
  realistic week until people learned to ignore it.

E08-02's ritual generator solves the same occurrence problem for family rituals
and should converge on these rules rather than growing a second copy.

### Proposing a plan change

AI code never calls `PlanVersionsService` and never writes `plan_versions`. It
calls `ProposalsService.createFromSource(userId, sourceKind, {...})`
(`apps/api/src/coach/proposals/`), which writes one row and stops. The plan
changes when — and only when — the user calls
`POST /proposals/:id/accept` (PRD §15, §89, §107; VISION §19).

Three rules that make that hold:

1. **`applyChanges` is pure and is called twice** — once to render the preview
   the user reads, once to apply what they accepted. Two implementations would
   mean approving one thing and getting another.
2. **A change carries its own `reason`.** PRD §80 wants history to say why the
   plan changed, and the only moment that reason exists is when the change is
   proposed.
3. **Attribution follows who wrote the content.** An accepted proposal is
   `createdBy: AI`; an accepted proposal the user edited first is
   `createdBy: USER`.

The full protocol, the six ops and the rejected alternatives are in
[`docs/specs/coach-and-memory.md`](docs/specs/coach-and-memory.md) §3.

### Adding an AI persona

Three steps, and no migration — the same "one registry entry" promise the
settings hub and the notification registry each make on their own axis
(epic #20). The full rationale is in
[`docs/specs/ai-gateway.md`](docs/specs/ai-gateway.md) and
[`docs/specs/ai-configuration.md`](docs/specs/ai-configuration.md).

1. **Declare the persona** in `apps/api/src/ai/ai-personas.ts`: add the key to
   `PERSONA_KEYS` **and** the entry to `AI_PERSONAS`, in the same position (a
   spec asserts the two agree). `label` and `description` are user-facing copy
   on the admin page; `tier` guides the administrator's model choice; declare
   `capabilities: ['text', 'vision']` **only** if the persona will actually
   receive attachments — the gateway refuses them for a persona that does not,
   before a byte leaves storage. No migration: `GET /ai-settings/personas` and
   the admin table pick it up, and `personaModels` is sparse so no stored
   settings row needs updating.

   **Never rename or reuse a key.** It is persisted on every `ai_invocations`
   row and in every installation's `personaModels`; renaming one is a data
   migration over telemetry, not a refactor.

2. **Define the output contract** as a Zod object with **explicit keys** beside
   the caller, and version the prompt (`'<persona>.v1'`). Strict mode cannot
   express a record or a union of objects, and `toOpenAiStrictSchema` throws at
   the call site rather than shipping a request OpenAI would reject — so model
   alternatives as nullable keys on one object. Prefer `.nullable()` over
   `.optional()`: the converter turns an optional property into a nullable
   required one, so `.nullable()` round-trips losslessly.

3. **Call the gateway** from a service whose module `imports: [AiModule]`:

   ```ts
   const result = await this.ai.invoke({
     persona: 'planner',
     userId,
     promptVersion: 'planner.v1',
     instructions: PLANNER_PROMPT,
     input: userText,
     schema: plannerOutputSchema,
     schemaName: 'planner_output',
   });

   if (!result.ok) {
     // PRD §120: the deterministic path must keep working. Branch, do not throw
     // — `invoke` never rejects for a provider, key, model or schema problem.
     return this.templateFallback();
   }
   ```

   Bump `promptVersion` whenever `instructions` changes meaningfully; nothing
   can detect that for you, and it is what makes "did the coach get worse after
   we changed the prompt?" answerable. Where PRD §15 applies, never persist AI
   output without user approval — the gateway returns structured output, and the
   caller decides.

   Live example of the smallest possible call: `AiAdminTestService`'s connection
   probe (`apps/api/src/ai/connection-probe.ts`). The `weekly_reviewer` persona
   is called from exactly one place —
   `apps/api/src/weekly/weekly-review.service.ts` — and is the worked example of
   a caller that branches on `ok: false` into a deterministic template rather
   than failing the request.

### Calling an AI persona

**Run `SafetyPolicyService.evaluate({ userId, text, surface })` over user free
text before the call** (`apps/api/src/coach/safety/`). A `redirect` decision
means the persona is not invoked at all and the caller returns
`decision.userFacingNote`; a `conservative` one means
`SAFETY_CONSERVATIVE_INSTRUCTIONS` is appended to the persona's instructions.
Pass the decision back as `invoke({ …, safetyDecision })` so it lands on the
`ai_invocations` row (PRD §88). `evaluate` never throws and never returns
`allow` when it could not reach the safety persona — see
[`docs/specs/coach-and-memory.md`](docs/specs/coach-and-memory.md) §2.

Whatever the persona, the **input comes from
`ContextAssemblerService.assemble(userId, scope)` and
`renderForPrompt(context)`** (`apps/api/src/coach/context/`), never from an
ad-hoc Prisma dump at the call site. `CONTEXT_SCOPES` is the single place that
says what each persona may know, and it is what makes PRD §85's promise —
an insight marked "don't use for coaching" is never used — enforceable rather
than aspirational: there is exactly one query that could have included it.

`assemble` rejects rather than returning a partial context; a caller treats
that the same way it treats an unavailable provider, by falling back to the
deterministic path (PRD §120). The scope table, the character budget, the
truncation order and the rejected alternatives are in
[`docs/specs/coach-and-memory.md`](docs/specs/coach-and-memory.md) §1.

## Specialized Subagents (MANDATORY)

**CRITICAL REQUIREMENT**: This project uses specialized subagents for all development work. You MUST delegate tasks to the appropriate subagent. Do NOT attempt to perform development tasks directly without using the designated agent.

### Why Subagents Are Mandatory
- Each agent contains domain-specific knowledge from the System Specification
- Agents ensure consistent patterns and conventions across the codebase
- Agents have the full context needed for their specialized area
- Direct implementation without agents risks missing requirements

### Available Agents

| Agent | Domain | MUST Use For |
|-------|--------|--------------|
| `backend-dev` | NestJS API, Fastify, auth, RBAC | **ANY** backend code: endpoints, services, guards, middleware, JWT, OAuth |
| `frontend-dev` | React, MUI, TypeScript | **ANY** frontend code: components, pages, hooks, theming, responsive design |
| `database-dev` | PostgreSQL, Prisma | **ANY** database work: schema changes, migrations, seeds, queries |
| `testing-dev` | Jest/Supertest (API), Vitest/RTL (web) | **ANY** testing: unit tests, integration tests, typecheck, test fixtures |
| `docs-dev` | Technical documentation | **ANY** documentation: ARCHITECTURE.md, SECURITY.md, API.md, README updates |
| `ops-dev` | Routine operations (Haiku) | Rebuilding/restarting containers, running Prisma migrations, running typecheck. NEVER for state-changing git operations |

### Mandatory Delegation Rules

1. **Backend code changes** → ALWAYS use `backend-dev`
2. **Frontend code changes** → ALWAYS use `frontend-dev`
3. **Database/Prisma changes** → ALWAYS use `database-dev`
4. **Writing or updating tests** → ALWAYS use `testing-dev`
5. **Documentation updates** → ALWAYS use `docs-dev`
6. **Routine ops (container rebuilds, migrations, typecheck)** → use `ops-dev`. IMPORTANT: `ops-dev` must NEVER perform state-changing git operations (pull, merge, push, commit, worktree management, branch operations) — those are always handled by the main agent directly, and `ops-dev` is instructed to refuse them

### Multi-Domain Tasks

For tasks spanning multiple domains, you MUST invoke multiple agents sequentially:

**Example: "Add a new user preference setting"**
1. `database-dev` → Add migration for schema change
2. `backend-dev` → Implement API endpoint
3. `frontend-dev` → Build UI component
4. `testing-dev` → Write tests for all layers
5. `docs-dev` → Update API documentation

### Usage Examples
```
# Backend work - MUST use backend-dev
"Use backend-dev to implement the user settings endpoint"

# Frontend work - MUST use frontend-dev
"Use frontend-dev to create the theme toggle component"

# Database work - MUST use database-dev
"Use database-dev to add audit_events table migration"

# Testing work - MUST use testing-dev
"Use testing-dev to write integration tests for auth"

# Documentation work - MUST use docs-dev
"Use docs-dev to update SECURITY.md with new auth flow"

# Routine ops - use ops-dev (never for git operations)
"Use ops-dev to rebuild the api container and run migrations"
```

### What You Should NOT Do Directly
- Do NOT write NestJS controllers, services, or guards without `backend-dev`
- Do NOT create React components or pages without `frontend-dev`
- Do NOT modify Prisma schema or create migrations without `database-dev`
- Do NOT write Jest/Vitest/RTL tests without `testing-dev`
- Do NOT update documentation files without `docs-dev`

The only exceptions are:
- Reading files to understand context
- Answering questions about the codebase
- Planning and coordination between agents
- Running simple commands (git status, npm install, etc.)
