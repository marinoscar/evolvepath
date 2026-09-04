# E02 — Product Shell, Domain Model & Path Screen

<!-- epic-meta: slug=product-shell-domain-model phase=1 -->

## Epic

### Goal

Give EvolvePath its deterministic backbone before any AI touches it: the PRD §9 hierarchy (Best Self → Domains → Outcomes → Plans → Routines → Commitments → Evidence → Reflection) persisted as real Prisma tables, exposed through ownership-scoped API modules, and made visible on a new **Path** screen inside a five-destination product shell (Today / Path / Coach / Progress / Profile, PRD §11). Plans are versioned from day one so PRD §80 / §103 ("plans have versions", "user can inspect why the plan changed", "old commitments remain historical evidence") hold structurally rather than by convention. The shell ships as an installable PWA baseline (PRD §123 mobile-first) so every later epic lands on a phone-shaped surface. When this epic closes, a user can build and inspect a complete Path by hand, with no AI involved — which is exactly the state VISION Part V §20 ("deterministic state, probabilistic intelligence") requires before E04–E06 add the intelligence.

### Background

- The repo is a generic foundation (OAuth, RBAC, settings hub, encrypted credentials, storage, notifications) with **no product tables**. `apps/api/prisma/schema.prisma` ends at `notifications`; the last migration is `20260831030721_add_notifications`.
- E01 ships the `RequireAiKey` gate (`apps/web/src/components/common/RequireAiKey.tsx`, route tree `ProtectedRoute` → `RequireAiKey` → `NotificationProvider`+`Layout`), the `AiGatewayService` contract, and the fake OpenAI server (`tools/fake-openai/server.mjs`, `infra/compose/fake-openai.compose.yml`, E01-10) plus the `withAiKey` option on `POST /auth/test/login` and `tests/e2e/helpers/auth.helper.ts`. E02 makes **no AI calls**; it only has to coexist with that gate (every shell route is behind it) and reuse `withAiKey` in e2e so a test user is not bounced to `/setup/ai-key`.
- Per-user resources follow the PAT pattern: plain `@Auth()` (`apps/api/src/auth/decorators/auth.decorator.ts`, `Auth(options: { roles?, permissions? })`), `@CurrentUser('id')`, `prisma.<model>.findFirst({ where: { id, userId } })` and `NotFoundException` when absent (`apps/api/src/pat/pat.service.ts`). No new permission strings are introduced by this epic.
- DTOs are `nestjs-zod` `createZodDto` classes (`apps/api/src/pat/dto/create-pat.dto.ts`); `ZodValidationPipe` is global (`APP_PIPE` in `app.module.ts`). class-validator is not used anywhere.
- Audit is a direct `prisma.auditEvent.create({ actorUserId, action: '<domain>:<verb>', targetType, targetId, meta })` (`apps/api/src/email/email-settings.service.ts` ~line 434).
- OpenAPI tags are declared once in `apps/api/src/openapi/tags.ts` (`TAG_GROUPS`); `apps/api/test/openapi/openapi-document.spec.ts` fails on any undeclared or orphaned tag, so a tag is added in the same child that adds its controller.
- Responses are wrapped `{ data, meta }` by `apps/api/src/common/interceptors/transform.interceptor.ts`; error bodies carry `code` (`NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, …) from `apps/api/src/common/filters/http-exception.filter.ts`.
- Navigation is a single destination model: `apps/web/src/config/destinations.ts` (`DESTINATIONS`, `DESTINATION_ROUTES`, `UNOWNED_ROUTES`, `resolveActiveDestination`, `pinned`), consumed by `NavigationRail.tsx`, `BottomNav.tsx`, `UserMenu.tsx` and `home/QuickActions.tsx`; `apps/web/src/__tests__/config/destinations.test.ts` reads the live `App.tsx` route list and asserts every route is owned exactly once or listed in `UNOWNED_ROUTES`.
- The five coupled breakpoint gates (CLAUDE.md rule 5: `Layout.tsx` `showRail` `up('sm')`, `BottomNav` `down('sm')`, `<main>` `pb: { xs: 10, sm: 3 }`, `SettingsHub` `isCompactWindow`, `AppBar` `isCompactWindow`) are **not touched** by this epic.
- Pixel baselines live in `tests/visual/specs/*-snapshots/` and are regenerated only inside `mcr.microsoft.com/playwright:v1.62.1-noble` (`docs/TESTING.md` → "Visual Regression Testing"). The harness `apps/web/visual/main.tsx` mounts the real `Layout`/rail/bottom bar over a fake `AuthContext`.
- Web tests: Vitest + RTL + MSW (`apps/web/src/__tests__/mocks/handlers.ts`, `utils/test-utils.tsx` `renderWithProviders`); `vitest-axe` is already a devDependency (used by `components/datatable/__tests__/conformance/runDataTableConformanceSuite.tsx`).
- There is no PWA manifest, no service worker, no `apps/web/public/icons/`; `apps/web/index.html` carries only the `%APP_NAME%` title/description and the Inter stylesheet link; `apps/web/nginx.conf` caches `\.(js|css|png|…)$` for one year with `immutable` — a service worker file served under that rule would never update.
- Related specs: `docs/specs/settings-ui.md` (E01-11), `docs/specs/ai-gateway.md` (E01-12). This epic adds `docs/specs/domain-model.md` (E02-08).

### Scope

- [ ] E02-01 feat(db): add EvolvePath core domain schema
- [ ] E02-02 feat(api): add Best Self, Outcomes and Domain Mode endpoints
- [ ] E02-03 feat(api): add Plans with versioning and Routines endpoints
- [ ] E02-04 feat(api): add Commitments, Evidence and Reflections endpoints
- [ ] E02-05 feat(web): add app shell with Today/Path/Coach/Progress/Profile navigation
- [ ] E02-06 feat(web): add Path screen with outcome, plan version and routine management
- [ ] E02-07 feat(web): add PWA baseline with manifest, icons and app-shell service worker
- [ ] E02-08 test(tests): E02 end-to-end verification

### Out of scope

- Any AI call, proposal, or plan mutation by AI (E04 onboarding, E06 mutation protocol). Every write in this epic is user-authored (`createdBy: USER`).
- The real Today screen, next-best-action engine, Start flow, quick add, daily check-in (E05). E02-05 ships a placeholder Today page only.
- Coach and Progress screens (E06, E11) — placeholders only.
- `UserProfile` (timezone, locale, onboarding state, coaching style) — E04-01. Commitments in this epic store UTC `Timestamptz` and the browser renders local time.
- Focus sessions, rituals/recurrence generation, workouts (E07–E09). `Routine` describes a repeatable behaviour; nothing in E02 materialises commitments from routines automatically.
- Momentum, consistency runs, comeback loop (E11); notifications of any kind (E12); web push (E12-04).
- Offline data caching or background sync in the service worker (PRD §121 applies to workout logging, E09-08). E02-07 precaches the app shell only.
- Wearables, calendar, voice, social (PRD §100, §112, §113).

### Sequencing

- **Critical path:** E02-01 → E02-02 → E02-03 → E02-04 → E02-06 → E02-08.
- E02-05 (shell/navigation) depends on nothing in this epic besides E01's route tree; it can start in parallel with E02-01 and must land before E02-06 (which needs the `/path` destination).
- E02-07 (PWA) depends only on E02-05 (the shell it caches) and can run in parallel with E02-03/E02-04.
- E02-02, E02-03, E02-04 are sequential because each extends `PathModule`/`CommitmentsModule` and the OpenAPI tag group the previous one created; running them in parallel produces merge conflicts in `tags.ts`, `app.module.ts` and `docs/API.md`.
- E02-08 is last and depends on every other child plus E01-10 (fake OpenAI server, `withAiKey`).

### Manual end-to-end verification

1. Clean clone, `cp infra/compose/.env.example infra/compose/.env`; set `INITIAL_ADMIN_EMAIL=<you>`, `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `POSTGRES_HOST`/`POSTGRES_PORT` to a reachable PostgreSQL (the stack bundles no `db` service — see `docs/DEVELOPMENT.md`).
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build`.
3. In a second shell: `docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:migrate` then `… exec api npm run prisma:seed`. Expect the migration `add_evolvepath_core_domain` in the applied list.
4. `psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U postgres -d appdb -c '\dt'` → tables `best_self_profiles`, `outcomes`, `plans`, `plan_versions`, `routines`, `commitments`, `evidence_items`, `reflections`, `domain_modes` exist. `SELECT count(*) FROM outcomes;` → `0` (seed adds nothing user-specific).
5. Open http://localhost:3535/testing/login, sign in as `path-owner@test.local` (role `contributor`). The E01 gate lands you on `/setup/ai-key`: paste `sk-test-manual-key`, click **Test** (fake server answers OK), **Continue**.
6. You land on `/`: the Today placeholder greets you by name and shows the empty state "Your Path is empty" with a **Go to Path** button. Resize the window below 600px: a bottom bar with five labelled tabs (Today, Path, Coach, Progress, Profile) appears and the rail disappears; above 600px the rail lists the same five in that order. Sign in as an admin in another browser: the rail additionally pins **Console** at its foot; the phone bottom bar does **not** show Console (it is in the avatar menu).
7. On `/path`: the Best Self card is empty → **Edit Best Self** → fill identity statement and six-month vision → Save → card renders the text. Reload: it persists.
8. In the **Health** section click **Add outcome** → title "Three strength workouts per week", importance 4, target date +6 weeks → Save. The outcome card appears under Health with an **ACTIVE** chip. Reload: still there.
9. Open the outcome (card click; on phone this drills down with a back arrow in the top bar). Click **Create plan** → rationale "Start with mornings", expected weekly load 120 → Save. The page shows **Plan v1 · ACTIVE** and an empty routines list.
10. **Add routine** → title "Morning workout", trigger EVENT "after morning coffee", frequency WEEKDAYS, preferred time 06:30, estimated 45, minimum 10, fallback "10-minute bodyweight circuit" → Save; it lists under v1.
11. **New version** → rationale "Evenings kept slipping; move to two mornings + Saturday" → Save. The history shows **v2 · DRAFT** beneath v1 with its rationale and a copied "Morning workout" routine. Click **Activate v2** → v2 becomes ACTIVE, v1 shows **SUPERSEDED** with its "active until" date. Both versions stay readable.
12. **Add commitment** → title "Upper A", scheduled tomorrow 06:30–07:15, importance 4, minimum version "10-minute circuit" → Save. It lists under **Upcoming commitments** with a **PLANNED** chip.
13. Open the chip menu: only **Ready**, **Start**, **Reschedule**, **Skip**, **Cancel** are offered (the transition matrix). Choose **Start** → STARTED; open again → **Complete** → the "Log what happened" dialog opens; enter "Finished all sets" → Save. The chip reads **COMPLETED** and the row shows **1 evidence · USER_LOG**.
14. Choose **Reschedule** on a second commitment: pick a new time → the original row shows **RESCHEDULED**, a new PLANNED row appears at the new time with "rescheduled ×1".
15. Archive the outcome from its menu → confirm → it disappears from Health; toggle **Show archived** → it reappears with an **ARCHIVED** chip and read-only controls.
16. DB checks: `SELECT version, status, previous_version_id, user_approved FROM plan_versions ORDER BY version;` → v1 SUPERSEDED, v2 ACTIVE with `previous_version_id` = v1's id. `SELECT status, reschedule_count FROM commitments;` → COMPLETED/0, RESCHEDULED/0, PLANNED/1. `SELECT source FROM evidence_items;` → one `USER_LOG`. `SELECT action FROM audit_events WHERE action LIKE 'outcome:%' OR action LIKE 'plan_version:%' OR action LIKE 'commitment:%';` → `outcome:create`, `plan_version:create` ×2, `plan_version:activate` ×2, `commitment:create` ×3, `commitment:transition` ×3, `outcome:archive`.
17. Sign in as a second user `other@test.local` and open `http://localhost:3535/path/outcomes/<first user's outcome id>` → "Not found" state (never a 403 that reveals the row exists).
18. Production PWA check: `cd apps/web && npm run build && npm run preview`, open the preview URL in Chrome → DevTools → Application → Manifest shows name, icons 192/512 (maskable) and "Installable" with no errors; Service Workers shows `sw.js` activated. Lighthouse → PWA category → "Installable" passes.

## Child issues

### E02-01 `feat(db): add EvolvePath core domain schema`

**Part of epic:** E02 · **Blocked by:** none · **Component:** database · **Priority:** P0 · **Agents:** database-dev → testing-dev → docs-dev

#### Problem statement

PRD §9 requires the Best Self → Domains → Outcomes → Plans → Routines → Commitments → Evidence → Reflection hierarchy to be "represented explicitly in the product", and PRD §10 enumerates the persistent objects. PRD §103 adds hard constraints: every plan has versions, old commitments remain historical evidence, and the user can inspect why a plan changed. VISION Part VI §24 says plans "must be real" objects, not chat. Today `apps/api/prisma/schema.prisma` has no product table at all, so nothing downstream (API, Path screen, AI context in E06) has anything to stand on.

#### Proposed solution

Add the core domain enums and nine models to `apps/api/prisma/schema.prisma` in a new `// EvolvePath core domain (epic E02)` block after `Notification`, wire the relations onto `User`, and ship them as one migration `add_evolvepath_core_domain` whose SQL is hand-amended with the one constraint Prisma cannot express (a partial unique index enforcing one ACTIVE version per plan).

**Data (database-dev)**

Enums (exact names and members):

```prisma
enum Domain            { WORK FAMILY HEALTH }
enum OutcomeState      { ACTIVE PAUSED COMPLETED ARCHIVED }
enum PlanVersionStatus { DRAFT ACTIVE SUPERSEDED REJECTED }
enum PlanAuthor        { USER AI }
enum RoutineTriggerType { TIME EVENT }
enum RoutineFrequency  { DAILY WEEKDAYS WEEKENDS WEEKLY CUSTOM }
enum CommitmentStatus  { PLANNED READY STARTED COMPLETED PARTIALLY_COMPLETED RESCHEDULED SKIPPED MISSED CANCELLED }
enum EvidenceSource    { USER_LOG TIMER WORKOUT_LOG APP_FLOW }
enum DomainModeKind    { GROW MAINTAIN RECOVER PAUSE }
```

Models (all ids `String @id @default(uuid()) @db.Uuid`; all `userId String @map("user_id") @db.Uuid` with `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`; every `DateTime` is `@db.Timestamptz` except `Outcome.targetDate` which is `@db.Date`; `createdAt @default(now())`, `updatedAt @updatedAt`; column names `@map` snake_case; tables `@@map` snake_case plural):

| Model / table | Fields (beyond id, userId, createdAt, updatedAt) | Relations / indexes |
|---|---|---|
| `BestSelfProfile` / `best_self_profiles` | `identityStatement String?`, `workIdentity String?`, `familyIdentity String?`, `healthIdentity String?`, `sixMonthVision String?`, `motivations String[]`, `reasons String[]`, `lastReviewedAt DateTime?` | `@@unique([userId])` |
| `Outcome` / `outcomes` | `domain Domain`, `title String`, `description String?`, `targetDate DateTime? @db.Date`, `importance Int @default(3)` (1–5), `motivation String?`, `state OutcomeState @default(ACTIVE)`, `successDefinition String?`, `userConfidence Int?` (1–5), `archivedAt DateTime?` | `plan Plan?`, `commitments Commitment[]`; `@@index([userId, domain])`, `@@index([userId, state])` |
| `Plan` / `plans` | `outcomeId String @unique @map("outcome_id") @db.Uuid` | `outcome Outcome @relation(fields:[outcomeId], references:[id], onDelete: Cascade)`, `versions PlanVersion[]`; `@@index([userId])` |
| `PlanVersion` / `plan_versions` | `planId`, `version Int`, `status PlanVersionStatus @default(DRAFT)`, `rationale String?`, `expectedWeeklyLoad Int?` (minutes/week), `fallbackStrategy String?`, `userApproved Boolean @default(false)`, `createdBy PlanAuthor @default(USER)`, `previousVersionId String? @db.Uuid`, `activeFrom DateTime?`, `activeUntil DateTime?` | `plan Plan @relation(onDelete: Cascade)`, self-relation `previousVersion PlanVersion? @relation("PlanVersionLineage", fields:[previousVersionId], references:[id], onDelete: SetNull)` + `nextVersions PlanVersion[] @relation("PlanVersionLineage")`, `routines Routine[]`, `commitments Commitment[]`; `@@unique([planId, version])`, `@@index([userId])`; **partial unique index (hand-written SQL, see below)** |
| `Routine` / `routines` | `planVersionId`, `title String`, `domain Domain`, `triggerType RoutineTriggerType @default(TIME)`, `triggerValue String?`, `frequency RoutineFrequency @default(WEEKDAYS)`, `daysOfWeek Int[]` (0=Sun…6=Sat, used when `frequency=CUSTOM`), `preferredTime String?` (`HH:mm`), `estimatedDurationMin Int`, `minimumDurationMin Int`, `fallbackBehavior String?`, `active Boolean @default(true)`, `sortOrder Int @default(0)` | `planVersion PlanVersion @relation(onDelete: Cascade)`, `commitments Commitment[]`; `@@index([planVersionId])`, `@@index([userId])` |
| `Commitment` / `commitments` | `domain Domain`, `title String`, `outcomeId String? @db.Uuid`, `planVersionId String? @db.Uuid`, `routineId String? @db.Uuid`, `scheduledStart DateTime`, `scheduledEnd DateTime?`, `importance Int @default(3)`, `commitmentType String?`, `fullVersion String?`, `shortVersion String?`, `minimumVersion String?`, `status CommitmentStatus @default(PLANNED)`, `rescheduleCount Int @default(0)`, `rescheduledFromId String? @db.Uuid`, `skipReason String?`, `userConfirmed Boolean @default(false)`, `startedAt DateTime?`, `completedAt DateTime?` | `outcome Outcome? (onDelete: SetNull)`, `planVersion PlanVersion? (onDelete: SetNull)`, `routine Routine? (onDelete: SetNull)`, self-relation `rescheduledFrom Commitment? @relation("CommitmentReschedule", onDelete: SetNull)` + `rescheduledTo Commitment[] @relation("CommitmentReschedule")`, `evidence Evidence[]`, `reflections Reflection[]`; `@@index([userId, scheduledStart])`, `@@index([userId, status])`, `@@index([planVersionId])` |
| `Evidence` / `evidence_items` | `commitmentId String? @db.Uuid`, `evidenceType String` (free label: `completion`, `partial`, `start`, `timer`, …), `source EvidenceSource`, `occurredAt DateTime @default(now())`, `quantitativeValue Float?`, `quantitativeUnit String?`, `qualitativeValue String?`, `confidence Float?` (0–1) | `commitment Commitment? (onDelete: SetNull)` — evidence outlives its commitment (PRD §103); `@@index([userId, occurredAt])`, `@@index([commitmentId])` |
| `Reflection` / `reflections` | `relatedType String` (`commitment` \| `outcome` \| `plan_version` \| `day`), `relatedId String? @db.Uuid`, `commitmentId String? @db.Uuid`, `userText String?`, `aiSummary String?`, `frictionTags String[]`, `mood Int?`, `perceivedDifficulty Int?`, `satisfaction Int?` | `commitment Commitment? (onDelete: SetNull)`; `@@index([userId, createdAt])`, `@@index([relatedType, relatedId])` |
| `DomainMode` / `domain_modes` | `domain Domain`, `mode DomainModeKind @default(GROW)`, `reason String?`, `effectiveFrom DateTime @default(now())` | `@@unique([userId, domain])` |

`User` gains: `bestSelfProfile BestSelfProfile?`, `outcomes Outcome[]`, `plans Plan[]`, `planVersions PlanVersion[]`, `routines Routine[]`, `commitments Commitment[]`, `evidence Evidence[]`, `reflections Reflection[]`, `domainModes DomainMode[]`.

Migration: `cd apps/api && npm run prisma:migrate:dev -- --name add_evolvepath_core_domain --create-only`, then append to the generated `migration.sql`:

```sql
-- One ACTIVE version per plan. Prisma cannot declare a partial index; its
-- introspection ignores partial indexes, so this statement is not reported
-- as drift by later `migrate dev` runs.
CREATE UNIQUE INDEX "plan_versions_one_active_per_plan"
  ON "plan_versions"("plan_id") WHERE "status" = 'ACTIVE';
```

then `npm run prisma:migrate:dev` (applies) and `npm run prisma:generate`. Seed (`apps/api/prisma/seed.ts`): **no change** — nothing user-specific is seeded; add a one-line comment in `main()` stating that product tables are intentionally empty after seed.

**API (backend-dev)** — n/a (no endpoints in this child). Export nothing new; `PrismaService` already exposes the generated client.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**

- `apps/api/test/db/core-domain-schema.integration.spec.ts` (new, `useMockDatabase: false`, runs against `infra/compose/test.compose.yml`'s Postgres; skip with a clear message when `POSTGRES_HOST` is unset, matching how `apps/api/test/setup.ts` guards DB specs): (a) migration applies on an empty DB (`npm run prisma:migrate` exit 0); (b) inserting two `ACTIVE` versions for one plan raises a unique-violation (`P2002`) while `DRAFT`+`ACTIVE` succeeds; (c) `@@unique([planId, version])` rejects a duplicate version number; (d) deleting a `User` cascades to all nine tables (`count == 0` afterwards); (e) deleting a `Commitment` leaves its `evidence_items` row with `commitment_id NULL`.
- `apps/api/test/mocks/prisma.mock.ts`: extend `createMockPrismaService` with the nine new delegates (`bestSelfProfile`, `outcome`, `plan`, `planVersion`, `routine`, `commitment`, `evidence`, `reflection`, `domainMode`) so E02-02..04 unit tests can stub them.

**Docs (docs-dev)**

- `CLAUDE.md` → "Database Tables": add the nine tables in one bullet each.
- `docs/ARCHITECTURE.md`: add a "Product domain" subsection listing the hierarchy and pointing at `docs/specs/domain-model.md` (written in E02-08; link it as forthcoming).

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on an empty database applies `add_evolvepath_core_domain` without error and `\dt` lists `best_self_profiles`, `outcomes`, `plans`, `plan_versions`, `routines`, `commitments`, `evidence_items`, `reflections`, `domain_modes`.
- [ ] `npm run prisma:seed` completes and every one of those tables has zero rows afterwards.
- [ ] A second `npm run prisma:migrate:dev` run immediately after proposes **no** new migration (the partial index is not reported as drift).
- [ ] Inserting a second `ACTIVE` `plan_versions` row for the same `plan_id` fails with a unique violation; a `DRAFT` alongside an `ACTIVE` succeeds.
- [ ] Deleting a user removes all their rows in the nine tables (cascade); deleting a commitment nulls `evidence_items.commitment_id` instead of deleting evidence.
- [ ] `npx prisma validate` and `npm run typecheck` in `apps/api` pass; the generated client exposes `prisma.planVersion`, `prisma.evidence`, etc.
- [ ] `apps/api/test/mocks/prisma.mock.ts` exposes the nine new delegates and the existing unit suite still passes.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (enum member names and table names byte-identical to the table above — later children and `docs/specs/domain-model.md` cite them)
- [ ] Error handling: migration is idempotent under Prisma's ledger; no data backfill needed (all tables new)
- [ ] Observability: n/a beyond Prisma's migration log
- [ ] Security: every table has `user_id` with `ON DELETE CASCADE`; no column stores secrets or free-text PII beyond what the user typed about themselves
- [ ] Config & secrets: no new env vars
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–4.
2. `psql … -c "\d plan_versions"` → shows `plan_versions_one_active_per_plan` as `UNIQUE, btree (plan_id) WHERE status = 'ACTIVE'`.
3. `psql … -c "INSERT INTO plans (id, user_id, outcome_id, created_at, updated_at) VALUES (...)"` is not needed; instead run `cd apps/api && npx prisma studio` and confirm the nine models appear with zero rows.
4. `docker compose … exec api npm run prisma:migrate:dev -- --name probe` → prints "Already in sync, no schema change or pending migration was found." Delete nothing (no migration file was created).

#### Out of scope

- Endpoints, DTOs, services (E02-02..04).
- `UserProfile`/timezone (E04-01); `Obstacle`, `MemoryInsight` (E06-01); `FocusSession` (E07-02); `FamilyMember`/`Ritual` (E08-01); workout tables (E09-01).
- Backfilling or migrating any existing data (there is none).

#### Notes for the implementing agent

- Use `npm run prisma:migrate:dev -- --name add_evolvepath_core_domain --create-only`, never bare `npx prisma migrate dev`: the npm scripts assemble `DATABASE_URL` from the `POSTGRES_*` vars (`apps/api/src/common/database-url.ts`).
- Copy the header-comment style of `Credential` / `NotificationDelivery` in `schema.prisma`: one block explaining why `Evidence.commitmentId` is `SetNull` (PRD §103 "old commitments remain historical evidence") and why `PlanVersion` carries `userId` redundantly (ownership checks without a three-table join).
- Self-relations need explicit relation names (`"PlanVersionLineage"`, `"CommitmentReschedule"`), otherwise `prisma validate` fails with an ambiguous-relation error.
- `@db.Date` on `targetDate` is deliberate: a target date has no time of day, and a `Timestamptz` would shift by a day across timezones.
- `Evidence` is mapped to `evidence_items` because the snake_case-plural rule needs a countable noun; the Prisma model stays `Evidence` so service code reads naturally.
- Do not add `@default(uuid())` at the DB level (`20260831014110_drop_stale_uuid_defaults` removed them on purpose — Prisma generates ids client-side).

---

### E02-02 `feat(api): add Best Self, Outcomes and Domain Mode endpoints`

**Part of epic:** E02 · **Blocked by:** E02-01 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §10.2 (BestSelfProfile), §10.4 (Outcome) and §49 (Domain Modes) are the top of the hierarchy; nothing below them (plans, commitments) can be created until a user can create and own an outcome. PRD §127 (user control) requires the user to edit and archive their own objects; PRD §85/§87 require strict per-user scoping. This child adds the first ownership-scoped product module.

#### Proposed solution

Create `apps/api/src/path/` (new) — `PathModule` registered in `app.module.ts` after `NotificationsModule` — containing three feature folders with a controller, a service and Zod DTOs each, plus one shared ownership helper and one shared enum schema file.

**Data (database-dev)** — n/a (E02-01).

**API (backend-dev)**

Files (all new):

- `apps/api/src/path/path.module.ts` — imports `PrismaModule`; controllers/providers below; exports `OutcomesService` (E02-03 needs it).
- `apps/api/src/path/domain.schema.ts` — Zod mirrors of the Prisma enums: `domainSchema = z.enum(['WORK','FAMILY','HEALTH'])`, `outcomeStateSchema`, `domainModeKindSchema`, plus `DOMAINS = domainSchema.options`. A unit test asserts each equals `Object.values(Prisma.$Enums.X)` so the two can never drift.
- `apps/api/src/path/owned-resource.ts` — `export async function findOwnedOrThrow<T>(lookup: () => Promise<T | null>, what: string): Promise<T>` → throws `NotFoundException(`${what} not found`)` when `null`. Every service method that takes an id goes through it. **Never** throw 403 for another user's row: a 403 confirms the id exists.
- `apps/api/src/path/best-self/{best-self.controller.ts, best-self.service.ts, dto/upsert-best-self.dto.ts, dto/best-self-response.dto.ts}`
- `apps/api/src/path/outcomes/{outcomes.controller.ts, outcomes.service.ts, dto/create-outcome.dto.ts, dto/update-outcome.dto.ts, dto/outcome-query.dto.ts, dto/outcome-response.dto.ts}`
- `apps/api/src/path/domain-modes/{domain-modes.controller.ts, domain-modes.service.ts, dto/set-domain-mode.dto.ts, dto/domain-mode-response.dto.ts}`

Endpoints (all `@Auth()` with no permission; `userId` from `@CurrentUser('id')`; ids via `ParseUUIDPipe`):

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/me/best-self` | `@Auth()` | — | `BestSelfResponseDto` or `null` (200; `data: null` until saved) |
| PUT | `/api/me/best-self` | `@Auth()` | `UpsertBestSelfDto` | 200 `BestSelfResponseDto` (upsert on `userId`; sets `lastReviewedAt = now()`) |
| GET | `/api/outcomes` | `@Auth()` | query `OutcomeQueryDto` `{ domain?, state?, includeArchived?: boolean }` | 200 `OutcomeResponseDto[]` ordered `domain, importance desc, createdAt` — excludes `ARCHIVED` unless `includeArchived=true` or `state=ARCHIVED` |
| POST | `/api/outcomes` | `@Auth()` | `CreateOutcomeDto` | 201 `OutcomeResponseDto` |
| GET | `/api/outcomes/:id` | `@Auth()` | — | 200 `OutcomeResponseDto` (includes `planId: string \| null`, `activePlanVersion: { id, version } \| null`) |
| PATCH | `/api/outcomes/:id` | `@Auth()` | `UpdateOutcomeDto` (partial; `state` limited to `ACTIVE\|PAUSED\|COMPLETED`) | 200 `OutcomeResponseDto` |
| POST | `/api/outcomes/:id/archive` | `@Auth()` | — | 200 `OutcomeResponseDto` with `state: ARCHIVED`, `archivedAt` set; idempotent (second call 200, no new audit row) |
| GET | `/api/me/domain-modes` | `@Auth()` | — | 200 `DomainModeResponseDto[]` — always exactly three entries in order WORK, FAMILY, HEALTH; missing rows are rendered as `{ domain, mode: 'GROW', reason: null, effectiveFrom: null }` |
| PUT | `/api/me/domain-modes/:domain` | `@Auth()` | `SetDomainModeDto` `{ mode, reason? }` (`:domain` validated by `domainSchema`, 400 otherwise) | 200 `DomainModeResponseDto` (upsert on `[userId, domain]`, `effectiveFrom = now()` when mode changes) |

DTO shapes (Zod, `createZodDto`):

```ts
// upsert-best-self.dto.ts
export const upsertBestSelfSchema = z.object({
  identityStatement: z.string().trim().max(500).nullish(),
  workIdentity: z.string().trim().max(500).nullish(),
  familyIdentity: z.string().trim().max(500).nullish(),
  healthIdentity: z.string().trim().max(500).nullish(),
  sixMonthVision: z.string().trim().max(2000).nullish(),
  motivations: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  reasons: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});
// create-outcome.dto.ts
export const createOutcomeSchema = z.object({
  domain: domainSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  targetDate: z.string().date().nullish(),           // 'YYYY-MM-DD'
  importance: z.number().int().min(1).max(5).default(3),
  motivation: z.string().trim().max(1000).nullish(),
  successDefinition: z.string().trim().max(1000).nullish(),
  userConfidence: z.number().int().min(1).max(5).nullish(),
});
export const updateOutcomeSchema = createOutcomeSchema
  .omit({ domain: true })                             // domain is immutable after create
  .partial()
  .extend({ state: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
```

Response DTOs are plain classes with `@ApiProperty` (as `apps/api/src/pat/dto/pat-response.dto.ts`); dates serialised as ISO strings, `targetDate` as `YYYY-MM-DD`.

Services:

- `BestSelfService.get(userId)`, `.upsert(userId, dto)` — audit `best_self:replace` (`targetType: 'best_self_profile'`, meta `{ fields: string[] }` naming which fields are non-null; never the text).
- `OutcomesService.list(userId, query)`, `.create(userId, dto)` → audit `outcome:create` (`targetType: 'outcome'`, meta `{ domain, importance }`), `.get(userId, id)`, `.update(userId, id, dto)` → audit `outcome:update` (meta `{ changed: string[] }`), `.archive(userId, id)` → audit `outcome:archive`. Updating or archiving an `ARCHIVED` outcome via PATCH → 409 `CONFLICT` ("Outcome is archived").
- `DomainModesService.list(userId)`, `.set(userId, domain, dto)` → audit `domain_mode:set` (meta `{ domain, from, to }`).

Errors: 400 `VALIDATION_ERROR` (Zod), 404 `NOT_FOUND` for unknown **or unowned** ids, 409 `CONFLICT` for edits to archived outcomes.

OpenAPI: add a new group to `TAG_GROUPS` in `apps/api/src/openapi/tags.ts`, placed after `Account & Settings`:

```ts
{
  name: 'EvolvePath',
  tags: [
    { name: 'Best Self', description: 'The calling user\'s Best Self profile — who they are trying to become (PRD §10.2). One row per user, replaced whole.' },
    { name: 'Outcomes', description: 'Meaningful results per domain (Work, Family, Health). Every row is owned by the caller; another user\'s outcome is indistinguishable from a missing one.' },
    { name: 'Domain Modes', description: 'Per-domain posture — GROW, MAINTAIN, RECOVER or PAUSE — that later epics use to size the week.' },
  ],
},
```

**UI (frontend-dev)** — n/a (E02-06).

**Tests (testing-dev)**

- Unit (Jest, colocated): `path/domain.schema.spec.ts` (enums mirror Prisma), `path/owned-resource.spec.ts` (null → `NotFoundException` with the given noun), `path/outcomes/outcomes.service.spec.ts` (list filter excludes ARCHIVED by default; `includeArchived` includes; PATCH on archived → `ConflictException`; archive idempotent — second call writes no audit row; `findFirst` is always called with `{ id, userId }`), `path/best-self/best-self.service.spec.ts` (upsert sets `lastReviewedAt`; audit meta contains field names only), `path/domain-modes/domain-modes.service.spec.ts` (three entries always; default GROW synthesised without a DB row).
- Integration (`apps/api/test/path/outcomes.integration.spec.ts`, `createTestApp` + `prismaMock`): 401 without token; POST 201 and echo; POST with `importance: 9` → 400 `VALIDATION_ERROR`; GET `/outcomes/:id` for an id whose mocked row has a different `userId` → **404**, body has no hint of existence; PATCH `domain` → 400 (unknown key rejected by `.omit` + strict object); archive → 200 twice; PUT `/me/domain-modes/PLAY` → 400; PUT `/me/best-self` then GET returns the same payload. Serialised bodies of every response are asserted to contain no `userId` of another user.
- Docs test: `apps/api/test/openapi/openapi-document.spec.ts` continues to pass (three new tags declared and used).

**Docs (docs-dev)**

- `docs/API.md`: new top-level section "EvolvePath" after "Settings" with subsections Best Self, Outcomes, Domain Modes — method, path, auth, request/response examples, error table (400/401/404/409).
- `CLAUDE.md` → "API Endpoints (MVP)": add "Best Self", "Outcomes", "Domain Modes" blocks in the same terse style.

#### Acceptance criteria

- [ ] `PUT /api/me/best-self` then `GET /api/me/best-self` returns the saved profile with `lastReviewedAt` set; before any PUT, GET returns `{ data: null }` with 200.
- [ ] `POST /api/outcomes` with a valid body returns 201 and the outcome is listed by `GET /api/outcomes` and `GET /api/outcomes?domain=HEALTH`.
- [ ] `POST /api/outcomes` with `importance: 0`, a missing `title`, or `domain: 'PLAY'` returns 400 `VALIDATION_ERROR` naming the field.
- [ ] `GET/PATCH /api/outcomes/:id` and `POST /api/outcomes/:id/archive` for another user's outcome return 404, byte-identical in shape to an unknown id.
- [ ] `POST /api/outcomes/:id/archive` sets `state=ARCHIVED` and `archivedAt`; the outcome disappears from the default list and reappears with `includeArchived=true`; a second archive call is a 200 no-op.
- [ ] `PATCH` on an archived outcome returns 409 `CONFLICT`.
- [ ] `GET /api/me/domain-modes` returns three entries (WORK, FAMILY, HEALTH) for a brand-new user; `PUT /api/me/domain-modes/HEALTH {mode:'RECOVER'}` persists and is reflected on the next GET.
- [ ] `audit_events` receives `outcome:create`, `outcome:update`, `outcome:archive`, `best_self:replace`, `domain_mode:set` rows with `actorUserId` set and no free text in `meta`.
- [ ] `/api/docs` renders an "EvolvePath" sidebar group containing Best Self, Outcomes and Domain Modes; `openapi-document.spec.ts` passes.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 404 for unowned rows (never 403), 409 for archived edits, 400 with field paths from Zod; no stack traces in bodies
- [ ] Observability: audit rows as listed; standard request logging; no new metrics
- [ ] Security: `@Auth()` on every route; every query includes `userId`; response DTOs never include another user's ids
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5; then mint a PAT at `/settings/tokens` and export `TOKEN=…`.
2. `curl -s -H "Authorization: Bearer $TOKEN" localhost:3535/api/me/best-self` → `{"data":null,...}`.
3. `curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"identityStatement":"Focused, present, healthy","motivations":["family"]}' localhost:3535/api/me/best-self` → 200 with `lastReviewedAt`.
4. `curl -s -X POST … -d '{"domain":"HEALTH","title":"Three strength workouts per week","importance":4}' localhost:3535/api/outcomes` → 201; note the `id`.
5. `curl -s … localhost:3535/api/outcomes?domain=HEALTH` → contains it. `curl -s -X POST … localhost:3535/api/outcomes/<id>/archive` → 200 `ARCHIVED`; list again → absent; `?includeArchived=true` → present.
6. With a second user's PAT: `GET /api/outcomes/<id>` → 404 `NOT_FOUND`.
7. `psql … -c "SELECT action, meta FROM audit_events ORDER BY created_at DESC LIMIT 5;"` → the five actions above.

#### Out of scope

- Plans, versions, routines (E02-03); commitments, evidence, reflections (E02-04).
- Restoring an archived outcome (not in the PRD; add when a screen needs it).
- AI-generated Best Self or outcomes (E04).

#### Notes for the implementing agent

- Copy `apps/api/src/pat/` for module/controller/service layout and `apps/api/src/pat/dto/create-pat.dto.ts` for `createZodDto`. Do not import class-validator.
- Ownership: `prisma.outcome.findFirst({ where: { id, userId } })` wrapped in `findOwnedOrThrow`. Do not `findUnique` by id and then compare `userId` — that is one branch away from a 403 leak.
- Register `PathModule` in `apps/api/src/app.module.ts`; register the OpenAPI group in `apps/api/src/openapi/tags.ts` **in the same commit** as the controllers or `openapi-document.spec.ts` fails.
- `GET /me/best-self` returning `null` passes through `TransformInterceptor` as `{ data: null }` — confirm with a test; if the interceptor's "already wrapped" heuristic misfires on `null`, return `{ profile: null }` instead and document it in the DTO.
- Fastify: controllers use `@Res()` only when setting cookies (`test-auth.controller.ts`); none of these routes need it.
- Audit meta must never carry user prose (`identityStatement`, `title`) — the audit table is admin-readable.

---

### E02-03 `feat(api): add Plans with versioning and Routines endpoints`

**Part of epic:** E02 · **Blocked by:** E02-02 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §10.5 defines a Plan as a persistent, versioned strategy ("every major AI-recommended change creates a new PlanVersion"); §80 requires history with a visible reason ("Changed Sep 12 · Reason: 3 repeated evening misses"); §103 requires that every active outcome has a persistent plan, that AI cannot silently modify it, and that the user can inspect why it changed. PRD §10.6 defines Routines as the repeatable behaviours a plan is made of (VISION Part VI §25: goals must become behaviours with an implementation intention and a fallback). This child implements that versioning contract so E06's mutation protocol and E10's weekly review have a target to write into.

#### Proposed solution

Extend `PathModule` with `plans/` and `routines/` feature folders. A `Plan` is the stable container (one per outcome); `PlanVersion` rows are immutable once they leave `DRAFT`; routines belong to a version, and creating a new version clones the source version's routines so history is self-contained.

**Data (database-dev)** — n/a (E02-01). Invariant enforced by DB: one ACTIVE version per plan (partial unique index).

**API (backend-dev)**

Files (new): `apps/api/src/path/plans/{plans.controller.ts, plans.service.ts, plan-versions.service.ts, dto/create-plan.dto.ts, dto/create-plan-version.dto.ts, dto/update-plan-version.dto.ts, dto/plan-response.dto.ts, dto/plan-version-response.dto.ts}`, `apps/api/src/path/routines/{routines.controller.ts, routines.service.ts, dto/create-routine.dto.ts, dto/update-routine.dto.ts, dto/routine-query.dto.ts, dto/routine-response.dto.ts}`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/outcomes/:id/plans` | `@Auth()` | `CreatePlanDto` `{ rationale?, expectedWeeklyLoad?, fallbackStrategy?, routines?: CreateRoutineInput[] (≤10) }` | 201 `PlanResponseDto` — creates `Plan` + `PlanVersion` v1 (`status: ACTIVE`, `userApproved: true`, `createdBy: USER`, `activeFrom: now`) + routines, in one `$transaction`; 409 `CONFLICT` if the outcome already has a plan; 409 if the outcome is `ARCHIVED` |
| GET | `/api/outcomes/:id/plans` | `@Auth()` | — | 200 `PlanResponseDto[]` (0 or 1 element today; array kept so a later epic can allow several without a breaking change) |
| GET | `/api/plans/:id` | `@Auth()` | — | 200 `PlanResponseDto` `{ id, outcomeId, activeVersion: PlanVersionSummary \| null, versionCount, createdAt }` |
| GET | `/api/plans/:id/versions` | `@Auth()` | — | 200 `PlanVersionSummary[]` ordered `version desc`: `{ id, version, status, rationale, createdBy, userApproved, previousVersionId, activeFrom, activeUntil, routineCount, createdAt }` |
| GET | `/api/plans/:id/versions/:version` | `@Auth()` | `:version` = integer (`ParseIntPipe`) | 200 `PlanVersionResponseDto` (summary + `expectedWeeklyLoad`, `fallbackStrategy`, `routines: RoutineResponseDto[]`) |
| POST | `/api/plans/:id/versions` | `@Auth()` | `CreatePlanVersionDto` `{ rationale: string (1–2000, required), expectedWeeklyLoad?, fallbackStrategy?, copyRoutinesFrom: 'active' \| 'none' = 'active' }` | 201 `PlanVersionResponseDto` — `version = max(version)+1`, `status: DRAFT`, `previousVersionId` = current ACTIVE version id (or the latest version when none is active), `createdBy: USER`; routines cloned (new ids, same fields, `active` preserved) when `copyRoutinesFrom='active'`; 409 if a DRAFT already exists for this plan (one draft at a time) |
| PATCH | `/api/plans/:id/versions/:version` | `@Auth()` | `UpdatePlanVersionDto` (partial of rationale/expectedWeeklyLoad/fallbackStrategy) | 200; 409 `CONFLICT` unless `status === DRAFT` |
| POST | `/api/plans/:id/versions/:version/activate` | `@Auth()` | — | 200 `PlanVersionResponseDto` — in one `$transaction`: current ACTIVE → `SUPERSEDED`, `activeUntil = now`; target DRAFT → `ACTIVE`, `activeFrom = now`, `userApproved = true`; 409 unless target is `DRAFT`; the transaction is what makes the partial unique index never fire under normal use, and a `P2002` from it is mapped to 409 rather than 500 |
| POST | `/api/plans/:id/versions/:version/reject` | `@Auth()` | `{ reason?: string }` | 200 — DRAFT → `REJECTED` (rationale kept, `reason` appended to audit meta); 409 unless DRAFT |
| GET | `/api/routines` | `@Auth()` | query `RoutineQueryDto` `{ planVersionId: uuid (required), includeInactive?: boolean }` | 200 `RoutineResponseDto[]` ordered `sortOrder, createdAt` |
| POST | `/api/routines` | `@Auth()` | `CreateRoutineDto` `{ planVersionId, title, domain?, triggerType, triggerValue?, frequency, daysOfWeek?, preferredTime?, estimatedDurationMin, minimumDurationMin, fallbackBehavior?, sortOrder? }` | 201; `domain` defaults to the outcome's domain; 409 unless the version is `DRAFT` or `ACTIVE` |
| GET | `/api/routines/:id` | `@Auth()` | — | 200 |
| PATCH | `/api/routines/:id` | `@Auth()` | `UpdateRoutineDto` (partial incl. `active`) | 200; 409 if the version is `SUPERSEDED`/`REJECTED` (history is immutable) |
| DELETE | `/api/routines/:id` | `@Auth()` | — | 204; 409 if the version is `SUPERSEDED`/`REJECTED` |

Routine DTO rules: `title` 1–200; `triggerType ∈ {TIME, EVENT}`; when `TIME`, `triggerValue` must match `^\d{2}:\d{2}$`; when `EVENT`, `triggerValue` 1–200 chars required; `frequency ∈ {DAILY, WEEKDAYS, WEEKENDS, WEEKLY, CUSTOM}`; `daysOfWeek` integers 0–6, unique, required non-empty when `frequency = CUSTOM`, must be empty otherwise; `preferredTime` `HH:mm` optional; `estimatedDurationMin` 1–480; `minimumDurationMin` 1–`estimatedDurationMin` (`superRefine`); `fallbackBehavior` ≤ 500.

Services:

- `PlansService.createForOutcome(userId, outcomeId, dto)`, `.listForOutcome`, `.get(userId, planId)`.
- `PlanVersionsService.list`, `.get(userId, planId, version)`, `.createDraft(userId, planId, dto, author: PlanAuthor = 'USER')` — the `author` parameter exists so E06 can create AI-authored drafts through the same code path; **no route sets it**; `.update`, `.activate`, `.reject`.
- `RoutinesService.list/create/get/update/remove` with a private `assertVersionEditable(version)`.
- Audit: `plan:create` (targetType `plan`), `plan_version:create` (targetType `plan_version`, meta `{ planId, version, previousVersionId, createdBy, routinesCopied }`), `plan_version:activate` (meta `{ planId, version, supersededVersion: number \| null }`), `plan_version:reject`, `routine:create`, `routine:update`, `routine:delete`. Audit `meta` never carries `rationale` text.

OpenAPI: add to the `EvolvePath` group in `tags.ts`: `{ name: 'Plans', description: 'Versioned strategies for an outcome. Versions are append-only: activating a draft supersedes the current version and both stay readable, with the rationale that explains the change (PRD §80).' }` and `{ name: 'Routines', description: 'Repeatable behaviours belonging to one plan version — trigger, frequency, ideal and minimum duration, and a fallback.' }`.

**UI (frontend-dev)** — n/a (E02-06).

**Tests (testing-dev)**

- Unit: `plan-versions.service.spec.ts` — `createDraft` numbers `max+1`, sets `previousVersionId` to the ACTIVE id, clones routines with new ids and preserved fields, refuses a second DRAFT (409); `activate` runs `$transaction` with exactly two `update` calls in order (supersede, then activate), sets `activeFrom`/`activeUntil`, maps `P2002` to `ConflictException`; `activate` on non-DRAFT → 409; `reject` on ACTIVE → 409. `routines.service.spec.ts` — DTO `superRefine` cases (TIME needs `HH:mm`, CUSTOM needs `daysOfWeek`, minimum ≤ estimated), edit on SUPERSEDED → 409. `plans.service.spec.ts` — v1 created ACTIVE+approved inside one transaction; second plan for the same outcome → 409; archived outcome → 409.
- Integration `apps/api/test/path/plans.integration.spec.ts`: create outcome → create plan (201, `activeVersion.version === 1`) → POST version (201, `status DRAFT`, `version 2`, `previousVersionId` = v1 id, routines cloned) → GET `/versions/1` still 200 with its routines (v1 stays readable) → activate v2 → GET `/versions` shows `[v2 ACTIVE, v1 SUPERSEDED]` with `activeUntil` on v1 → PATCH v1 → 409 → other user's `GET /plans/:id` → 404 → activate v1 again → 409 (not DRAFT). `apps/api/test/path/routines.integration.spec.ts`: create/list/update/delete; delete on a routine of a SUPERSEDED version → 409; `GET /routines` without `planVersionId` → 400.

**Docs (docs-dev)**

- `docs/API.md` "EvolvePath" section: Plans, Plan versions, Routines subsections with the state diagram `DRAFT → ACTIVE → SUPERSEDED`, `DRAFT → REJECTED`, and an example of `GET /plans/:id/versions` output.
- `CLAUDE.md` "API Endpoints (MVP)": Plans and Routines blocks.

#### Acceptance criteria

- [ ] `POST /api/outcomes/:id/plans` creates a plan whose v1 is `ACTIVE`, `userApproved: true`, `createdBy: USER`; a second POST for the same outcome returns 409.
- [ ] `POST /api/plans/:id/versions` returns a `DRAFT` v2 with `previousVersionId` equal to v1's id and the same routines under new ids; `GET /api/plans/:id/versions/1` still returns v1 in full.
- [ ] Activating v2 makes v1 `SUPERSEDED` with `activeUntil` set and v2 `ACTIVE` with `activeFrom` set, atomically; `GET /api/plans/:id` reports `activeVersion.version === 2`.
- [ ] At no point can two versions of one plan be `ACTIVE` (integration test attempts a racing activate against a mocked `P2002` and observes 409).
- [ ] Editing or deleting routines on a `SUPERSEDED` or `REJECTED` version returns 409; on `DRAFT`/`ACTIVE` it succeeds.
- [ ] `rationale` is required on `POST /versions` (400 when blank) and returned on every version summary so the UI can show "why it changed".
- [ ] Every plan/version/routine endpoint returns 404 for another user's ids.
- [ ] Audit rows `plan:create`, `plan_version:create`, `plan_version:activate` are written with the meta shapes above; `openapi-document.spec.ts` passes with `Plans` and `Routines` declared.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 409 for every state-machine violation with a message naming the current status; `P2002` from the partial index → 409 not 500
- [ ] Observability: audit rows above; activation logs `plan_version.activate planId=… from=v1 to=v2 user=…` at info level
- [ ] Security: `@Auth()`; all lookups scoped by `userId`; `createdBy` is never accepted from the request body
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. E02-02 manual script steps 1–4 (have `TOKEN` and an outcome `OID`).
2. `curl -s -X POST … -d '{"rationale":"Start with mornings","expectedWeeklyLoad":120,"routines":[{"title":"Morning workout","triggerType":"EVENT","triggerValue":"after morning coffee","frequency":"WEEKDAYS","preferredTime":"06:30","estimatedDurationMin":45,"minimumDurationMin":10,"fallbackBehavior":"10-minute circuit"}]}' localhost:3535/api/outcomes/$OID/plans` → 201; note `PID`.
3. `curl -s -X POST … -d '{"rationale":"Evenings slipped; move to mornings + Saturday"}' localhost:3535/api/plans/$PID/versions` → 201 `version: 2, status: DRAFT`, one cloned routine.
4. `curl -s -X POST … localhost:3535/api/plans/$PID/versions/2/activate` → 200 ACTIVE. `curl -s … localhost:3535/api/plans/$PID/versions` → v2 ACTIVE, v1 SUPERSEDED.
5. `curl -s -X PATCH … -d '{"rationale":"x"}' localhost:3535/api/plans/$PID/versions/1` → 409.
6. `psql … -c "SELECT version,status,previous_version_id IS NOT NULL AS has_prev FROM plan_versions;"` → `1 SUPERSEDED f`, `2 ACTIVE t`.

#### Out of scope

- AI-authored drafts and the accept/edit/reject proposal protocol (E06-04) — only the `author` parameter hook is provided.
- Generating commitments from routines (E05/E08); weekly load validation across domains (E10-03).
- Plan diff computation for the UI (E06's plan-diff component); E02-06 shows rationale and routine lists per version only.

#### Notes for the implementing agent

- Model the transaction on `apps/api/src/users/users.service.ts` `$transaction` usage; keep audit writes **outside** the transaction (after commit), as the notification recipe in CLAUDE.md prescribes for side effects.
- `:version` is the integer version number in URLs, not the version's uuid — it is what users see ("v2") and what `previousVersionId` links by id internally.
- The "one DRAFT at a time" rule is a service check, not a DB constraint; state this in the service comment so nobody adds a second partial index.
- Validate `planVersionId` ownership in `RoutinesService` by loading the version with `where: { id, userId }` — the routine's `userId` is set from the caller, never from the body.
- Add `Plans` and `Routines` tags in the same commit as the controllers.

---

### E02-04 `feat(api): add Commitments, Evidence and Reflections endpoints`

**Part of epic:** E02 · **Blocked by:** E02-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §10.7 defines the Commitment with nine statuses and full/short/minimum versions (VISION Part III §15: every important plan needs a fallback); §10.9 defines Evidence with explicit sources and the rule "the product should not pretend planned calendar events are completion evidence"; §10.10 defines lightweight Reflections. PRD §103: "commitments derive from the active plan; old commitments remain historical evidence." PRD P4 ("start matters") needs STARTED recorded separately from COMPLETED. This is the deterministic state machine everything in E05, E07–E11 mutates.

#### Proposed solution

Create `apps/api/src/commitments/` (new) — `CommitmentsModule`, registered in `app.module.ts` after `PathModule` — with the commitment state machine as a pure, unit-tested function, a transition endpoint that applies it, and evidence/reflection endpoints that only ever write what the user (or a later server flow) explicitly logs.

**Data (database-dev)** — n/a (E02-01).

**API (backend-dev)**

Files (new): `apps/api/src/commitments/commitments.module.ts`, `commitments/commitment-transitions.ts`, `commitments/commitment-transitions.spec.ts`, `commitments/commitments.controller.ts`, `commitments/commitments.service.ts`, `commitments/dto/{create-commitment.dto.ts, update-commitment.dto.ts, commitment-query.dto.ts, transition-commitment.dto.ts, commitment-response.dto.ts}`, `commitments/evidence/{evidence.controller.ts, evidence.service.ts, dto/create-evidence.dto.ts, dto/evidence-query.dto.ts, dto/evidence-response.dto.ts}`, `commitments/reflections/{reflections.controller.ts, reflections.service.ts, dto/create-reflection.dto.ts, dto/reflection-query.dto.ts, dto/reflection-response.dto.ts}`.

Transition matrix — `apps/api/src/commitments/commitment-transitions.ts`:

```ts
export const TERMINAL_STATUSES: ReadonlySet<CommitmentStatus> = new Set([
  'COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED',
]);
const ALLOWED: Record<CommitmentStatus, readonly CommitmentStatus[]> = {
  PLANNED: ['READY', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  READY:   ['PLANNED', 'STARTED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED'],
  STARTED: ['COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'CANCELLED'],
  COMPLETED: [], PARTIALLY_COMPLETED: [], RESCHEDULED: [], SKIPPED: [], MISSED: [], CANCELLED: [],
};
export function canTransition(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return from !== to && ALLOWED[from].includes(to);
}
export function allowedTransitions(from: CommitmentStatus): readonly CommitmentStatus[] { return ALLOWED[from]; }
```

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/commitments` | `@Auth()` | `CommitmentQueryDto` `{ from: ISO datetime (required), to: ISO datetime (required, ≤ 62 days after from), domain?, status?: CommitmentStatus[] (csv), outcomeId?, planVersionId? }` | 200 `CommitmentResponseDto[]` ordered `scheduledStart asc`; each carries `allowedTransitions`, `evidenceCount`, `rescheduledFromId`, `rescheduledToId` |
| POST | `/api/commitments` | `@Auth()` | `CreateCommitmentDto` `{ domain, title (1–200), scheduledStart, scheduledEnd? (> start), importance 1–5 = 3, commitmentType? (≤50), outcomeId?, planVersionId?, routineId?, fullVersion?, shortVersion?, minimumVersion? (each ≤ 500), userConfirmed? = false }` | 201; `outcomeId`/`planVersionId`/`routineId` must be owned (404 otherwise) and consistent (routine belongs to the version, version to the outcome's plan → 400 `VALIDATION_ERROR` otherwise); `planVersionId` must be `ACTIVE` or `DRAFT` (409 otherwise) |
| GET | `/api/commitments/:id` | `@Auth()` | — | 200 `CommitmentDetailDto` = response + `evidence: EvidenceResponseDto[]` + `reflections: ReflectionResponseDto[]` |
| PATCH | `/api/commitments/:id` | `@Auth()` | `UpdateCommitmentDto` (partial of title, scheduledStart/End, importance, commitmentType, full/short/minimumVersion, userConfirmed) | 200; 409 if status is terminal (`TERMINAL_STATUSES`); **`status` is not accepted here** (unknown key → 400) |
| POST | `/api/commitments/:id/transition` | `@Auth()` | `TransitionCommitmentDto` `{ to: CommitmentStatus, reason?: string (≤500), rescheduleTo?: ISO datetime, evidence?: { evidenceType?: string = 'completion', quantitativeValue?, quantitativeUnit?, qualitativeValue? } }` | 200 `TransitionResultDto` `{ commitment: CommitmentResponseDto, rescheduledTo: CommitmentResponseDto \| null, evidence: EvidenceResponseDto \| null }`; 409 `INVALID_TRANSITION` when `!canTransition(current, to)` with message `Cannot move a <from> commitment to <to>` |
| POST | `/api/evidence` | `@Auth()` | `CreateEvidenceDto` `{ commitmentId?, evidenceType (1–50), source: 'USER_LOG' (literal — other sources are set only by server flows), occurredAt? = now, quantitativeValue?, quantitativeUnit? (≤20), qualitativeValue? (≤2000), confidence? 0–1 }` | 201; `commitmentId` must be owned (404) |
| GET | `/api/evidence` | `@Auth()` | `EvidenceQueryDto` `{ from, to (required, ≤ 93 days), commitmentId?, source?, domain? (joins commitment) }` | 200 ordered `occurredAt desc` |
| DELETE | `/api/evidence/:id` | `@Auth()` | — | 204 (PRD §127 user control); audit `evidence:delete` |
| POST | `/api/reflections` | `@Auth()` | `CreateReflectionDto` `{ relatedType: 'commitment'\|'outcome'\|'plan_version'\|'day', relatedId? (uuid; required unless 'day'), userText? (≤4000), frictionTags?: string[] (≤10, each ≤40), mood? 1–5, perceivedDifficulty? 1–5, satisfaction? 1–5 }` — at least one of userText/tags/scores | 201; `relatedId` ownership verified per type (404) |
| GET | `/api/reflections` | `@Auth()` | `{ relatedType?, relatedId?, from?, to? }` | 200 ordered `createdAt desc`, max 200 |

Transition semantics (`CommitmentsService.transition`, one `$transaction`):

- Load with `{ id, userId }` (404). Check `canTransition` (409).
- `STARTED`: set `startedAt = now` (first time only). `COMPLETED` / `PARTIALLY_COMPLETED`: set `completedAt = now`; if `dto.evidence` present, create one `Evidence` row `{ source: 'USER_LOG', evidenceType: dto.evidence.evidenceType ?? (to === 'COMPLETED' ? 'completion' : 'partial'), occurredAt: now, commitmentId }`. **No evidence row is created without `dto.evidence`** — completion is a status; evidence is what the user logged (PRD §10.9).
- `SKIPPED`: `skipReason = dto.reason ?? null`. `CANCELLED` / `MISSED`: no extra fields.
- `RESCHEDULED`: `rescheduleTo` required (400 if absent or ≤ now − 1 min). The original row becomes `RESCHEDULED` (terminal, keeps its evidence); a **new** commitment is created copying `domain, title, importance, commitmentType, outcomeId, planVersionId, routineId, full/short/minimumVersion`, with `scheduledStart = rescheduleTo`, `scheduledEnd = rescheduleTo + (original duration)` when the original had an end, `status: PLANNED`, `rescheduledFromId = original.id`, and **`rescheduleCount = original.rescheduleCount + 1`** — the count travels with the intention, so "moved twice" is readable on the live row (E07-03 avoidance detection reads it).
- `dto.evidence` on any `to` other than COMPLETED/PARTIALLY_COMPLETED → 400. `rescheduleTo` on any `to` other than RESCHEDULED → 400.
- Audit `commitment:transition` (targetType `commitment`, meta `{ from, to, rescheduleCount, rescheduledToId, evidenceId }`) after commit. Also `commitment:create` (meta `{ domain, planVersionId, routineId, rescheduledFromId }`), `commitment:update`, `evidence:create` (meta `{ source, evidenceType, commitmentId }`), `evidence:delete`, `reflection:create` (meta `{ relatedType, relatedId }`).

Errors: 400 `VALIDATION_ERROR`; 404 `NOT_FOUND`; 409 `CONFLICT` for terminal-row edits and plan-version status; 409 `INVALID_TRANSITION` (new code — add it to `http-exception.filter.ts`'s code table only if the filter derives codes from a map; otherwise throw `new ConflictException({ code: 'INVALID_TRANSITION', message })` following `verbatim-error-body.exception.ts`).

OpenAPI: add to `EvolvePath` group: `{ name: 'Commitments', description: 'Specific future intentions with full, short and minimum versions and a nine-state lifecycle. Transitions are validated by a fixed matrix; a reschedule closes the original and opens a new commitment that carries the reschedule count.' }`, `{ name: 'Evidence', description: 'What actually happened. Written only by explicit user logs or server-side flows — never derived from a planned item (PRD §10.9).' }`, `{ name: 'Reflections', description: 'Optional, lightweight notes and scores attached to a commitment, outcome, plan version or day.' }`.

**UI (frontend-dev)** — n/a (E02-06).

**Tests (testing-dev)**

- Unit `commitment-transitions.spec.ts`: table-driven over all 9×9 pairs — asserts exactly the allowed set above, every terminal status has zero exits, `from === to` is always false, `allowedTransitions` returns the same list `canTransition` honours.
- Unit `commitments.service.spec.ts`: STARTED sets `startedAt` once; COMPLETED without `evidence` creates **no** evidence row (`prisma.evidence.create` not called); COMPLETED with `evidence` creates exactly one `USER_LOG` row inside the transaction; RESCHEDULED creates a new PLANNED row with `rescheduleCount + 1` and `rescheduledFromId`, original ends `RESCHEDULED`; RESCHEDULED without `rescheduleTo` → 400; `evidence` on SKIPPED → 400; PATCH on COMPLETED → 409; `create` with a routine from a different plan version → 400; `create` never touches `prisma.evidence`.
- Unit `evidence.service.spec.ts`: `source` other than `USER_LOG` rejected by the DTO (400); `commitmentId` of another user → 404. `reflections.service.spec.ts`: `day` without `relatedId` ok; `commitment` without `relatedId` → 400.
- Integration `apps/api/test/commitments/commitments.integration.spec.ts`: create → list by range (in/out of range) → transition PLANNED→STARTED→COMPLETED with evidence (response `evidence.source === 'USER_LOG'`, `GET /commitments/:id` shows `evidenceCount 1`) → transition COMPLETED→STARTED → 409 `INVALID_TRANSITION` → reschedule twice (second on the new row) → last row `rescheduleCount === 2`, `GET /commitments?status=RESCHEDULED` lists the two closed rows → other user → 404 on every route → `GET /commitments` without `from` → 400. `apps/api/test/commitments/evidence.integration.spec.ts`: POST with `source: 'TIMER'` → 400; list by range; DELETE 204 then 404.

**Docs (docs-dev)**

- `docs/API.md` EvolvePath section: Commitments (with the transition matrix as a table), Evidence, Reflections; add `INVALID_TRANSITION` to the "Error Codes" table.
- `CLAUDE.md` "API Endpoints (MVP)": Commitments, Evidence, Reflections blocks.

#### Acceptance criteria

- [ ] `canTransition` matches the matrix above for all 81 pairs (unit test is table-driven, not sampled).
- [ ] `POST /api/commitments/:id/transition {to:'STARTED'}` sets `startedAt`; then `{to:'COMPLETED', evidence:{qualitativeValue:'done'}}` sets `completedAt` and creates exactly one `evidence_items` row with `source USER_LOG`.
- [ ] `{to:'COMPLETED'}` **without** `evidence` creates no evidence row; creating a commitment creates no evidence row; `SELECT count(*) FROM evidence_items` stays 0 through create + READY + STARTED.
- [ ] `{to:'RESCHEDULED', rescheduleTo}` closes the original as `RESCHEDULED` and returns `rescheduledTo` — a new PLANNED commitment at the new time with `rescheduleCount` incremented and `rescheduledFromId` set; rescheduling that one again yields `rescheduleCount 2`.
- [ ] A disallowed transition (e.g. COMPLETED → STARTED, PLANNED → PLANNED) returns 409 with `code: 'INVALID_TRANSITION'`.
- [ ] `PATCH /api/commitments/:id` refuses `status` (400) and refuses edits on terminal rows (409).
- [ ] `GET /api/commitments?from&to` returns only rows in range, ordered by `scheduledStart`, each with `allowedTransitions` matching the matrix.
- [ ] `POST /api/evidence` accepts only `source: 'USER_LOG'`; `DELETE /api/evidence/:id` removes the user's own row and 404s for others'.
- [ ] Every route returns 404 for another user's ids; audit rows `commitment:create`, `commitment:transition`, `evidence:create`, `evidence:delete`, `reflection:create` are written.
- [ ] `openapi-document.spec.ts` passes with `Commitments`, `Evidence`, `Reflections` declared.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: matrix violations → 409 `INVALID_TRANSITION`; payload/state mismatches → 400 with a field path; terminal-row edits → 409
- [ ] Observability: audit rows above; transition logs `commitment.transition id=… from=… to=… user=…` at info; no user prose in logs
- [ ] Security: `@Auth()`; every lookup by `{ id, userId }`; foreign ids (`outcomeId`, `planVersionId`, `routineId`, `commitmentId`) verified against the caller before use
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. E02-03 manual script (have `TOKEN`, `PID`, active version id `VID`).
2. `curl -s -X POST … -d '{"domain":"HEALTH","title":"Upper A","scheduledStart":"<tomorrow 06:30Z>","scheduledEnd":"<tomorrow 07:15Z>","importance":4,"planVersionId":"'$VID'","minimumVersion":"10-minute circuit"}' localhost:3535/api/commitments` → 201; note `CID`; `allowedTransitions` = `["READY","STARTED","RESCHEDULED","SKIPPED","MISSED","CANCELLED"]`.
3. `curl -s -X POST … -d '{"to":"STARTED"}' localhost:3535/api/commitments/$CID/transition` → 200 `startedAt` set.
4. `curl -s -X POST … -d '{"to":"COMPLETED","evidence":{"qualitativeValue":"Finished all sets"}}' …/transition` → 200 with `evidence.source: "USER_LOG"`.
5. `curl -s -X POST … -d '{"to":"STARTED"}' …/transition` → 409 `INVALID_TRANSITION`.
6. Create a second commitment; `-d '{"to":"RESCHEDULED","rescheduleTo":"<+2 days>"}'` → 200 with `rescheduledTo.rescheduleCount: 1`; repeat on the new id → `rescheduleCount: 2`.
7. `psql … -c "SELECT status, reschedule_count FROM commitments ORDER BY created_at;"` and `SELECT source, evidence_type FROM evidence_items;` → one `USER_LOG completion`.

#### Out of scope

- Server-side flows that write `TIMER` / `APP_FLOW` / `WORKOUT_LOG` evidence (E05-02 Start flow, E07-02 focus sessions, E09-03 runner) — they call `EvidenceService.createFromFlow(userId, {...source})`, an internal method this child adds but exposes on no route.
- Automatic `MISSED` marking (E11-02 comeback loop). Nothing in E02 changes a status without a user request.
- "Make it smaller"/decomposition, pause/continue (E05-02): `STARTED → READY` is deliberately not in the matrix; E05 may extend the matrix with a test.

#### Notes for the implementing agent

- Keep the matrix in its own file with no Nest imports so it can be unit-tested and, later, copied verbatim to the web (`apps/web/src/utils/commitmentTransitions.ts` in E02-06 must agree; add a comment in both pointing at the other).
- `CommitmentStatus` type comes from `@prisma/client`; the DTO enum uses `z.enum(Object.values(CommitmentStatus))` to stay in sync.
- Range queries: parse `from`/`to` with `z.string().datetime({ offset: true })` and compare as `Date`; reject `to < from` and spans over the cap with a 400.
- Evidence `source` DTO is `z.literal('USER_LOG')` on purpose — the enum exists in Prisma for server flows, not for clients.
- Audit after commit, outside `$transaction` (see E02-03 note). Add the tags to `tags.ts` in the same commit as the controllers.
- Fastify parses query arrays from repeated keys and csv differently; accept `status` as a csv string and split in the DTO (`z.string().transform(s => s.split(','))` piped into the enum array).

---

### E02-05 `feat(web): add app shell with Today/Path/Coach/Progress/Profile navigation`

**Part of epic:** E02 · **Blocked by:** none · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → ops-dev → docs-dev

#### Problem statement

PRD §11 fixes the primary navigation as Today, Path, Coach, Progress, Profile; VISION Part VII §27 makes Today "the most important screen"; PRD §123 makes mobile the primary platform. The shell today has three destinations (Home, User Settings, Console) built for a generic admin app, and `BottomNav.tsx`'s header comment declares "four actions is the ceiling". Every later web child (E02-06, E05, E06, E11) needs its destination to exist before it can be routed.

#### Proposed solution

Replace the destination model's contents — not its mechanics — with the five product destinations, keep Console pinned for admins, add placeholder pages for Today/Coach/Progress, route Profile to the existing `/settings` hub, and prove the five-tab bottom bar fits at 360px with a pixel baseline. The five coupled breakpoint gates are not touched.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a.

**UI (frontend-dev)**

`apps/web/src/config/destinations.ts`:

- `export type DestinationKey = 'today' | 'path' | 'coach' | 'progress' | 'profile' | 'console';`
- `DESTINATION_ROUTES = { today: ['/'], path: ['/path'], coach: ['/coach'], progress: ['/progress'], profile: ['/settings'], console: ['/admin'] }`.
- `UNOWNED_ROUTES` unchanged (`/login`, `/auth/callback`, `/activate`, `/testing/login`) plus `/setup/ai-key` (added by E01-09; keep it if present).
- `DESTINATIONS` in this order with icons from `@mui/icons-material`: `today` (label "Today", `TodayIcon` = `Today`), `path` ("Path", `RouteIcon` = `Route`), `coach` ("Coach", `ForumIcon` = `Forum`), `progress` ("Progress", `InsightsIcon` = `Insights`), `profile` (label "Profile", `compactLabel` "Profile", `PersonIcon` = `Person`, `path: '/settings'`), then `console` exactly as today (`pinned: true`, `anyPermission: ['system_settings:read', 'users:read']`). `compactLabel` equals `label` for all five (all ≤ 8 characters).
- Update the file header and the `pinned` doc comment: the bottom bar now **excludes** pinned destinations (below); the user menu still lists them.

`apps/web/src/components/navigation/BottomNav.tsx`:

- `visibleDestinations = DESTINATIONS.filter(d => !d.pinned && isDestinationVisible(d, hasPermission))` — Console is not a phone tab; admins reach it from `UserMenu` (which already renders all visible destinations including pinned ones).
- `BottomNavigationAction` gets `sx={{ minWidth: 0, px: 0.5 }}` so five labelled actions fit at 360px (MUI's default `minWidth: 80` × 5 overflows). Keep `showLabels`. Replace the "FOUR ACTIONS IS THE CEILING" comment with the Material 3 rule (3–5 destinations) and the reason pinned rows are excluded.
- The `down('sm')` gate line is **unchanged** (gate 2 of 5).

`apps/web/src/App.tsx`:

- Lazy pages: `TodayPage` (`./pages/TodayPage`), `PathPage` (`./pages/PathPage`), `CoachPage`, `ProgressPage`; delete the `HomePage` import.
- Routes inside the `Layout` element: `/` → `TodayPage`, `/path` → `PathPage`, `/coach` → `CoachPage`, `/progress` → `ProgressPage`. `/settings/*` and `/admin/*` unchanged.

Pages (new, each a `Container maxWidth="lg"` + `Typography h4` title + one MUI `Card` empty state; no data fetching):

- `apps/web/src/pages/TodayPage.tsx` — greeting `Good {morning|afternoon|evening}, {user.displayName ?? 'there'}` computed from the local hour (pure helper `apps/web/src/utils/greeting.ts` `greetingFor(hour: number)`), an empty-state card "Your Path is empty" with body "Add your first outcome and the Today screen fills itself." and a `Button component={Link} to="/path"` labelled **Go to Path**; `data-testid="today-empty-state"`.
- `apps/web/src/pages/PathPage.tsx` — placeholder "Path" with text "Best Self, outcomes and plans live here." (replaced wholesale by E02-06).
- `apps/web/src/pages/CoachPage.tsx` — "Coach" + "Your coach arrives with a later release." `data-testid="coach-placeholder"`.
- `apps/web/src/pages/ProgressPage.tsx` — "Progress" + "Momentum and evidence will appear here." `data-testid="progress-placeholder"`.

Deletions: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/home/QuickActions.tsx`, `apps/web/src/components/user/UserProfileCard.tsx` (its avatar/email/roles content is already on `/settings/profile`, `UserProfilePage.tsx`), and their tests `__tests__/pages/HomePage.test.tsx`, `__tests__/components/home/QuickActions.test.tsx`, `__tests__/components/user/UserProfileCard.test.tsx`.

`apps/web/src/components/navigation/UserMenu.tsx`: no logic change; verify the destination list renders the five + Console for admins (its existing test updates labels).

`apps/web/src/components/navigation/AppBar.tsx`: no change to `isCompactWindow` (gate 5). `resolveDrillDown` is untouched here (E02-06 extends it for `/path/outcomes/:id`).

`apps/web/visual/main.tsx`: replace the `HomePage` lazy import with `TodayPage`, add `/path`, `/coach`, `/progress` routes so specs can screenshot active states; the fake user keeps `aiKey` from E01.

Responsive: <600px the bottom bar shows five labelled tabs (no Console); ≥600px the rail shows five rows in order with Console pinned at its foot for users holding either console permission; no change to `<main>` padding (gate 3).

a11y: each `BottomNavigationAction` keeps `aria-label={destination.label}`; active tab exposes `aria-current="page"` via MUI's `selected`; rail rows unchanged. Placeholder pages have exactly one `h1`.

**Tests (testing-dev)**

- `apps/web/src/__tests__/config/destinations.test.ts`: update the expected route list to include `/`, `/path`, `/coach`, `/progress`, `/settings`, `/admin…`; assert `DESTINATIONS.map(d => d.key)` equals `['today','path','coach','progress','profile','console']`; assert every non-console destination has `compactLabel.length <= 8`; `resolveActiveDestination('/settings/tokens') === 'profile'`, `('/path/outcomes/abc') === 'path'`, `('/setup/ai-key') === null`.
- `apps/web/src/__tests__/components/navigation/BottomNav.test.tsx` (extend): renders five tabs for a viewer, five (not six) for an admin — Console absent; clicking "Path" navigates to `/path`; `aria-current="page"` on the active tab; `expect(await axe(container)).toHaveNoViolations()` (import `axe` from `vitest-axe` and `'vitest-axe/extend-expect'`, as `runDataTableConformanceSuite.tsx` does).
- `apps/web/src/__tests__/components/navigation/NavigationRail.test.tsx` (extend): five rows in order, Console pinned at the foot for `system_settings:read`; axe clean in both collapsed and expanded tiers.
- `apps/web/src/__tests__/components/navigation/UserMenu.test.tsx`: update expected labels (Today, Path, Coach, Progress, Profile, Console).
- `apps/web/src/__tests__/pages/TodayPage.test.tsx` (new): greeting uses display name; empty state links to `/path`; `greetingFor` boundaries (5→morning, 12→afternoon, 18→evening) in `__tests__/utils/greeting.test.ts`.
- `apps/web/src/__tests__/App.test.tsx`: `/` renders `today-empty-state`; `/coach` and `/progress` render their placeholders.
- Visual (ops-dev runs; testing-dev authors): add `tests/visual/specs/bottom-nav.spec.ts` — viewport 360×740, `harnessUrl({ route: '/path' })`, screenshot the `BottomNav` `Paper` → baseline `bottom-nav-360px-five-tabs-chromium-linux.png`; asserts (DOM, before the screenshot) five `[role=button]` actions with visible label text and no `text-overflow` truncation (`scrollWidth <= clientWidth` on each label). Regenerate baselines for `library-rail.spec.ts` (both), `admin-hub-551x840-drilldown`, `drilldown-appbar-390px`, `console-rail-lg-expanded` inside `mcr.microsoft.com/playwright:v1.62.1-noble` using the exact `docker run` from `docs/TESTING.md`; open each diff and confirm the only change is the navigation rows before running `npm run test:update`.
- Gate check (testing-dev): `grep -n "breakpoints" apps/web/src/components/common/Layout.tsx apps/web/src/components/navigation/BottomNav.tsx apps/web/src/components/navigation/AppBar.tsx apps/web/src/components/settings/SettingsHub.tsx` shows the same five lines as on `main` — include the diff of these four files in the PR description (should be comment-only in `BottomNav.tsx`).

**Docs (docs-dev)**

- `CLAUDE.md`: in "MANDATORY: Settings UI Pattern" add one sentence to rule 5's list noting the bottom bar excludes `pinned` destinations; update the "Access Control" paragraph's mention of `/admin/users` if it references Home.
- `docs/specs/settings-ui.md` (E01-11): add a "Product destinations" subsection listing the five keys, their routes and the pinned-exclusion rule.
- `docs/ARCHITECTURE.md`: replace any "Home" mention in the frontend section with the five destinations.

#### Acceptance criteria

- [ ] On a 360×740 viewport the bottom bar shows exactly five labelled tabs — Today, Path, Coach, Progress, Profile — with no label truncation, and the pixel baseline `bottom-nav-360px-five-tabs` matches inside the pinned container.
- [ ] An admin on a phone sees the same five tabs (no Console) and finds Console in the avatar menu; at ≥600px the rail shows the five rows and Console pinned at the foot.
- [ ] `/` renders the Today placeholder with a greeting and a **Go to Path** button; `/path`, `/coach`, `/progress` render their placeholders; `/settings/*` highlights the Profile tab.
- [ ] `destinations.test.ts` passes against the live `App.tsx` route list: every route owned exactly once or listed as unowned.
- [ ] `git diff main -- apps/web/src/components/common/Layout.tsx apps/web/src/components/navigation/AppBar.tsx apps/web/src/components/settings/SettingsHub.tsx` is empty and the `BottomNav.tsx` diff contains no change to the `useMediaQuery(theme.breakpoints.down('sm'))` line.
- [ ] axe reports zero violations for `BottomNav`, `NavigationRail` (both tiers) and each placeholder page.
- [ ] All existing visual baselines that include navigation are regenerated in `mcr.microsoft.com/playwright:v1.62.1-noble` and the suite passes; hub-only baselines are unchanged.
- [ ] `HomePage`, `QuickActions`, `UserProfileCard` and their tests are removed; `npm run typecheck` and `npm run test:run` in `apps/web` pass.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: unknown routes still fall through to `/`; placeholders render without any API call
- [ ] Observability: n/a
- [ ] Security: Console gating unchanged (`anyPermission`), `RequirePermission` wrappers on `/admin/*` untouched; new routes sit inside `ProtectedRoute` → `RequireAiKey`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–6.
2. Chrome DevTools → device toolbar → 360×740: bottom bar shows five tabs; tap each and confirm the URL and highlighted tab; open the avatar menu as an admin and confirm **Console** is there.
3. Widen to 700px: bottom bar disappears at exactly 600px and the rail appears; nothing renders both at 599/600/601px.
4. Navigate to `/settings/tokens`: Profile is highlighted in the rail/bottom bar.
5. `cd tests/visual && npm test` inside the pinned container (docs/TESTING.md command) → all green.

#### Out of scope

- Any content on Today/Coach/Progress (E05, E06, E11).
- Renaming `/settings` to `/profile` — the destination is labelled Profile but keeps the hub route so `USER_SETTINGS_SECTIONS`, the AppBar drill-down titles and bookmarks stay valid.
- Hiding the bottom bar during a workout (PRD §11; E09-08).
- Changing any of the five coupled breakpoint gates.

#### Notes for the implementing agent

- Do not add a sixth entry to `DESTINATIONS` for anything; Console stays the only `pinned` destination and the only permission-gated one.
- `resolveActiveDestination` needs no change: `owns('/settings', '/settings/tokens')` already returns true and `/` stays exact-match.
- Search for `'home'` usages before deleting (`UserMenu.tsx`, its test, `destinations.test.ts`, `QuickActions.test.tsx`) — the `DestinationKey` union change makes TypeScript flag the rest.
- The visual harness `apps/web/visual/main.tsx` imports `HomePage`; swap it or the harness build fails and every baseline "diff" is really a blank page.
- Run baselines only via the `docker run … mcr.microsoft.com/playwright:v1.62.1-noble` command in `docs/TESTING.md` (mount at the same absolute path, `--user $(id -u):$(id -g)`, invoke `tests/visual/node_modules/.bin/playwright`); never `npx playwright` from the root.
- `vitest-axe` matchers: `import 'vitest-axe/extend-expect'` at the top of each spec that uses `toHaveNoViolations` (not registered globally in `__tests__/setup.ts`).

---

### E02-06 `feat(web): add Path screen with outcome, plan version and routine management`

**Part of epic:** E02 · **Blocked by:** E02-04, E02-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §9 says the hierarchy "must be represented explicitly in the product" and VISION Part VI §24 that it "should be visible throughout the experience"; PRD §80/§103 require the user to inspect plan history and why it changed; PRD §127 gives the user control over their objects. With E02-02..04 in place the API can hold a full Path, but the only way to build one is `curl`. The Path screen is the deterministic surface (PRD §123: "web is useful for deeper review, planning") that E04's onboarding will later fill automatically and E06's proposals will later modify.

#### Proposed solution

Replace the E02-05 `PathPage` placeholder with the real hierarchy view, plus an outcome detail page at `/path/outcomes/:id` holding the plan, its versions, routines and upcoming commitments. Phones get stacked cards and a drill-down; ≥600px gets a three-column domain grid and an inline detail layout.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E02-02..04 as specified).

**UI (frontend-dev)**

Types (`apps/web/src/types/index.ts`, new exports): `Domain`, `OutcomeState`, `PlanVersionStatus`, `PlanAuthor`, `CommitmentStatus`, `EvidenceSource`, `DomainModeKind`, `RoutineTriggerType`, `RoutineFrequency` (string unions mirroring E02-01), `BestSelfProfile`, `Outcome`, `OutcomeInput`, `Plan`, `PlanVersionSummary`, `PlanVersion`, `Routine`, `RoutineInput`, `Commitment`, `CommitmentInput`, `TransitionInput`, `TransitionResult`, `Evidence`, `DomainMode`.

API functions (`apps/web/src/services/api.ts`, using the existing `api` instance): `getBestSelf`, `putBestSelf`, `getOutcomes(params?: { domain?, includeArchived? })`, `createOutcome`, `getOutcome(id)`, `updateOutcome(id, patch)`, `archiveOutcome(id)`, `getDomainModes`, `setDomainMode(domain, body)`, `getPlansForOutcome(outcomeId)`, `createPlan(outcomeId, body)`, `getPlanVersions(planId)`, `getPlanVersion(planId, version)`, `createPlanVersion(planId, body)`, `activatePlanVersion(planId, version)`, `rejectPlanVersion(planId, version)`, `getRoutines(planVersionId)`, `createRoutine`, `updateRoutine`, `deleteRoutine`, `getCommitments({ from, to, outcomeId? })`, `createCommitment`, `transitionCommitment(id, body)`.

Hooks (`apps/web/src/hooks/`, new, same shape as `usePersonalAccessTokens.ts`: `{ data, isLoading, error, refresh, <mutations> }`): `useBestSelf.ts`, `useOutcomes.ts` (`{ includeArchived }` option), `useOutcome.ts` (`id` → outcome + plan + versions + active version routines, one `refresh`), `useDomainModes.ts`, `useOutcomeCommitments.ts` (`outcomeId`, range = today → +14 days).

Pure helper `apps/web/src/utils/commitmentTransitions.ts` — a verbatim copy of the E02-04 matrix (`allowedTransitions`) with a comment pointing at `apps/api/src/commitments/commitment-transitions.ts`; the UI still uses `commitment.allowedTransitions` from the API when present and the local copy only for optimistic rendering.

Routes (`apps/web/src/App.tsx`): `/path` → `PathPage`, `/path/outcomes/:id` → `OutcomeDetailPage` (both inside the `Layout` element; owned by `path` via `DESTINATION_ROUTES`).

`apps/web/src/components/navigation/AppBar.tsx`: extend `resolveDrillDown` with one non-settings entry — pathname matching `^/path/outcomes/[^/]+$` → `{ title: 'Outcome', up: '/path' }` — so the compact bar shows a back arrow on the detail page. `isCompactWindow` (gate 5) is unchanged; the drill-down table is data, not a gate.

Components (`apps/web/src/components/path/`, new):

- `BestSelfCard.tsx` `{ profile: BestSelfProfile | null; onEdit(): void }` — identity statement as headline, work/family/health identity lines, six-month vision, "Last reviewed <date>"; empty state "Who are you becoming?" with **Edit Best Self**.
- `BestSelfDialog.tsx` `{ open; initial; onClose; onSave(input) }` — MUI `Dialog`, `fullScreen` below `sm`; text fields for the five statements, chip inputs for motivations/reasons (max 10).
- `DomainSection.tsx` `{ domain; mode: DomainMode; outcomes: Outcome[]; onAddOutcome; onChangeMode; onOpenOutcome }` — header "Work | Family | Health" with a `DomainModeChip` (click → menu GROW/MAINTAIN/RECOVER/PAUSE → `setDomainMode`), outcome cards, **Add outcome** button; empty text per domain ("No Work outcome yet").
- `OutcomeCard.tsx` `{ outcome; onOpen }` — title, importance as 1–5 filled dots with `aria-label="Importance 4 of 5"` (not colour-only, PRD §122), target date, state `Chip`, "Plan v2 · active" line or "No plan yet".
- `OutcomeFormDialog.tsx` `{ open; mode: 'create' | 'edit'; domain; initial?; onClose; onSave }` — title (required), description, target date (`<input type="date">` via MUI `TextField type="date"`), importance slider 1–5 with marks, success definition, confidence 1–5; `domain` shown read-only in edit mode.
- `ArchiveOutcomeDialog.tsx` — confirm text "Archived outcomes stay in your history and can be shown with 'Show archived'."
- `PlanSummaryCard.tsx` `{ plan: Plan | null; activeVersion; onCreatePlan; onNewVersion }` — "Plan v2 · ACTIVE since <date>", rationale, expected weekly load, fallback strategy; when no plan: **Create plan** button.
- `CreatePlanDialog.tsx` (rationale optional, weekly load, fallback) and `CreatePlanVersionDialog.tsx` (title "Why is the plan changing?", rationale **required**, weekly load, fallback, checkbox "Copy routines from the active version" default on).
- `PlanVersionHistory.tsx` `{ versions: PlanVersionSummary[]; onActivate(version); onReject(version); onOpen(version) }` — MUI `Timeline`-free vertical list (no lab dependency): each row "v2 · DRAFT · created <date> by You", rationale in full, `activeFrom`/`activeUntil` when set, routine count; DRAFT rows show **Activate** and **Reject**; expanded row loads `getPlanVersion` and lists its routines read-only (superseded versions are inspectable, PRD §80).
- `RoutineList.tsx` `{ routines; editable: boolean; onAdd; onEdit; onToggleActive; onDelete }` and `RoutineFormDialog.tsx` — title, trigger type toggle (Time → time picker `HH:mm`; Event → text "after morning coffee"), frequency select, day-of-week toggle buttons when CUSTOM, preferred time, estimated/minimum minutes (minimum ≤ estimated validated client-side too), fallback behaviour.
- `CommitmentList.tsx` `{ commitments; onAdd; onTransition }` — rows: title, `scheduledStart` in local time (`Intl.DateTimeFormat`), importance dots, `CommitmentStatusChip` with a menu of `allowedTransitions` (labels: Ready, Start, Complete, Partially complete, Reschedule, Skip, Missed, Cancel), "rescheduled ×N" when `rescheduleCount > 0`, "N evidence · <sources>" when `evidenceCount > 0`.
- `CommitmentFormDialog.tsx` — title, start/end (`TextField type="datetime-local"`), importance, full/short/minimum version fields, optional routine select (from the active version's routines).
- `TransitionDialog.tsx` `{ to; onConfirm(input) }` — for `COMPLETED`/`PARTIALLY_COMPLETED`: "Log what happened" with an optional text field and optional number+unit; a helper line "Leave empty to record the status without evidence."; for `RESCHEDULED`: datetime picker (required); for `SKIPPED`: optional reason; others: plain confirm.

Pages:

- `apps/web/src/pages/PathPage.tsx` — loads best self, domain modes, outcomes (`includeArchived` toggle `Switch` "Show archived", state in `useState`); layout: `BestSelfCard` full width, then `Grid container spacing={2}` with three `DomainSection`s at `size={{ xs: 12, sm: 6, md: 4 }}`. Below `sm` the sections stack as cards and outcome click navigates to the detail route; at/above `sm` the same navigation happens (detail is its own page at every width — one routing model, two layouts).
- `apps/web/src/pages/OutcomeDetailPage.tsx` — header (title, domain, state chip, **Edit**, **Archive** menu), `PlanSummaryCard`, `RoutineList` (editable when the active version is `ACTIVE`/`DRAFT`), `CommitmentList` (next 14 days for this outcome, **Add commitment**), `PlanVersionHistory`. ≥`md`: two columns (plan+routines | history+commitments) via `Grid size={{ xs: 12, md: 7 }}` / `{ xs: 12, md: 5 }`; below: single column. Archived outcome: all mutating controls disabled with a banner "This outcome is archived".
- Loading: `LoadingSpinner`; errors: MUI `Alert` with the API message; 404 from the API → an inline "Outcome not found" state with a link back to `/path` (never a redirect loop).

Responsive summary at `sm` (600px): dialogs `fullScreen` below, modal above; domain grid 1 → 2 → 3 columns (xs/sm/md); detail page 1 → 2 columns at `md`; all via `Grid`/`useMediaQuery` inside these components — none of the five coupled gates is edited.

a11y: every dialog has `aria-labelledby` on its title; status chip menu is a `Menu` opened by a button with `aria-haspopup="menu"` and `aria-label="Change status of <title>"`; importance dots carry text alternatives; colour is never the only carrier of state (chips include the word); touch targets ≥ 44px on list rows (`ListItemButton` default); form errors are announced via `helperText` + `error`.

**Tests (testing-dev)**

- MSW handlers (`apps/web/src/__tests__/mocks/handlers.ts` + `mocks/data.ts`): stateful in-memory stores for best self, outcomes, plans/versions, routines, commitments, evidence; `transition` handler applies the local matrix and returns 409 `INVALID_TRANSITION` otherwise; reschedule returns `rescheduledTo` with `rescheduleCount + 1`.
- Hook tests (`__tests__/hooks/useOutcomes.test.ts`, `useOutcome.test.ts`, `useBestSelf.test.ts`): load, create-then-refresh, error surfaces.
- Component tests (`__tests__/components/path/*.test.tsx`): `OutcomeFormDialog` validation (empty title blocked; importance default 3); `RoutineFormDialog` (minimum > estimated shows error; CUSTOM requires a day); `PlanVersionHistory` shows rationale for every version and Activate only on DRAFT; `CommitmentList` menu lists exactly `allowedTransitions`; `TransitionDialog` for COMPLETED submits `evidence` only when text/number entered; axe on `PathPage` and `OutcomeDetailPage` renders (`toHaveNoViolations`).
- Page tests (`__tests__/pages/PathPage.test.tsx`, `OutcomeDetailPage.test.tsx`): create outcome → card appears; archive → disappears → "Show archived" → reappears with ARCHIVED chip; create plan → "Plan v1 · ACTIVE"; new version → DRAFT row → Activate → v1 shows SUPERSEDED; add commitment → Start → Complete with note → "1 evidence · USER_LOG"; 404 outcome → "Outcome not found".
- Wire tests: `createPlanVersion` sends `{ rationale, copyRoutinesFrom: 'active' }`; `transitionCommitment` for RESCHEDULED sends `rescheduleTo` as ISO with offset.
- `destinations.test.ts`: `/path/outcomes/:id` is owned by `path` only.
- AppBar test: `/path/outcomes/x` at compact width shows back arrow with title "Outcome" → navigates to `/path`.

**Docs (docs-dev)**

- `CLAUDE.md`: "Repository Structure" — add `components/path/` and the two pages; "Common Patterns" — new "Adding a Path resource" (types → api.ts → hook → component → MSW handler → test).
- `docs/ARCHITECTURE.md` frontend section: Path screen hierarchy and the one-routing-model/two-layouts rule.

#### Acceptance criteria

- [ ] `/path` shows Best Self, three domain sections with mode chips, and outcome cards; creating an outcome via the form makes its card appear and it is still there after a full reload.
- [ ] Editing Best Self persists and the card shows "Last reviewed" with today's date.
- [ ] Archiving hides the outcome; "Show archived" reveals it with an ARCHIVED chip and every mutating control disabled.
- [ ] Opening an outcome on a <600px viewport navigates to `/path/outcomes/:id` with a back arrow titled "Outcome" in the top bar; at ≥900px the detail page renders two columns.
- [ ] Creating a plan shows "Plan v1 · ACTIVE"; creating a new version requires a rationale and shows a DRAFT row whose rationale is visible; Activate makes it ACTIVE and marks v1 SUPERSEDED while v1's routines remain viewable in the history.
- [ ] Routines can be added/edited/deactivated on the active version; the editor rejects minimum > estimated and CUSTOM without days before any request is sent.
- [ ] A commitment's status menu offers exactly the API's `allowedTransitions`; Complete with a note produces "1 evidence · USER_LOG"; Complete with an empty dialog produces COMPLETED with no evidence; Reschedule produces a new PLANNED row labelled "rescheduled ×1".
- [ ] axe reports zero violations on `PathPage` and `OutcomeDetailPage` in Vitest; all dialogs are keyboard-operable (Tab/Escape).
- [ ] No change to the five coupled breakpoint gates (`git diff` of `Layout.tsx`, `BottomNav.tsx`, `SettingsHub.tsx` is empty; `AppBar.tsx` diff touches only `resolveDrillDown`).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: API errors rendered in `Alert`s with the server message; 404 → inline not-found state; 409 `INVALID_TRANSITION` → snackbar "That change is no longer possible" and a refresh
- [ ] Observability: n/a (client)
- [ ] Security: no client-side authorization decisions — the API's 404 is the only truth; no ids of other users ever requested
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–15 verbatim (this child is what they exercise).
2. Additionally, at 360px width: open an outcome, press the back arrow → `/path` with the Health section scrolled into view (scroll restoration via `useScrollRestoration`).
3. Keyboard only: Tab to an outcome card, Enter opens it; Tab to the status chip, Enter opens the menu, arrow to **Start**, Enter → STARTED.

#### Out of scope

- Today's next-best-action, Start flow, quick add (E05); Coach proposals and plan diffs (E06); momentum/evidence timeline (E11).
- Reflections UI (the API exists; E05-03 adds the end-of-day reflection surface).
- Drag-and-drop ordering of routines (`sortOrder` is set by creation order only).

#### Notes for the implementing agent

- Copy structure from `apps/web/src/pages/UserTokensPage.tsx` + `hooks/usePersonalAccessTokens.ts` for the load/mutate/refresh hook shape and from `pages/Admin/EmailSettingsPage.tsx` for form + `Alert` handling.
- Use `Grid` (MUI v7+ `size` prop, as `HomePage` did) — not the deprecated `Grid2`/`item` API.
- Do not add `@mui/lab` or `@mui/x-date-pickers`; native `date`/`datetime-local` inputs via `TextField` keep the bundle and the a11y story simple. Convert `datetime-local` values to ISO with offset before sending.
- Keep `resolveDrillDown`'s new entry data-driven (a small `PRODUCT_DRILLDOWNS` array) so E05/E09 can add `/today/...` rows without touching the gate.
- MSW handlers must model the transition matrix or the page tests will pass against behaviour the API rejects.
- `useScrollRestoration` already exists; call it in `PathPage` so the back navigation lands where the user left.

---

### E02-07 `feat(web): add PWA baseline with manifest, icons and app-shell service worker`

**Part of epic:** E02 · **Blocked by:** E02-05 · **Component:** web, infra · **Priority:** P0 · **Agents:** frontend-dev → ops-dev → testing-dev → docs-dev

#### Problem statement

PRD §123: "the primary platform should be mobile because behaviour intervention often occurs near the moment of action"; PRD §121 anticipates intermittent connectivity for workout logging; E12-04 needs a service worker to receive web push. The web app has no manifest, no icons, no `theme-color` and no service worker, so it cannot be installed to a home screen and every launch is a full network round trip for the shell.

#### Proposed solution

Add a static web manifest and icon set, wire them into `index.html`, and generate an app-shell-only service worker with `vite-plugin-pwa` that is registered in production builds only. No runtime data caching.

Why `vite-plugin-pwa` (and not a hand-written `sw.js`): it generates a Workbox precache manifest from the actual Vite build output (hashed asset names change every build; a hand-written list goes stale on the first deploy), injects the registration helper, handles the `autoUpdate` reload semantics, and E12-04 can extend the same worker with a push handler via `injectManifest` later. A hand-written worker would re-implement precache versioning by hand — the exact class of bug the plugin exists to remove.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a.

**UI (frontend-dev)**

- `apps/web/package.json`: devDependencies `vite-plugin-pwa` (pin the current major compatible with Vite 8) and `sharp` (icon rasterisation, dev-only); script `"icons": "node scripts/generate-icons.mjs"`.
- `apps/web/public/icons/icon.svg` (new, hand-authored: a simple path/route mark on the theme primary colour, 512 viewBox, safe zone respected for maskable use).
- `apps/web/scripts/generate-icons.mjs` (new): reads `icon.svg`, writes `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` (10% padding on a solid background for the maskable ones), `public/apple-touch-icon.png` (180×180, opaque). Commit the generated PNGs; the script exists for regeneration.
- `apps/web/public/manifest.webmanifest` (new):

  ```json
  {
    "name": "EvolvePath",
    "short_name": "EvolvePath",
    "description": "One coach for Work, Family and Health.",
    "id": "/",
    "start_url": "/",
    "scope": "/",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#121212",
    "theme_color": "#121212",
    "icons": [
      { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
      { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
      { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
      { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml" }
    ]
  }
  ```

  `name`/`short_name` are literals (the `%APP_NAME%` plugin only transforms `index.html`); a unit test asserts they equal `APP_NAME` from `@app/shared` so a fork that renames the product fails a test instead of shipping a mismatched install name. `theme_color`/`background_color` equal the dark theme's `background.default` from `apps/web/src/theme/index.ts` — read the real value and use it.
- `apps/web/index.html` `<head>`: `<link rel="manifest" href="/manifest.webmanifest" />`, `<meta name="theme-color" content="<same value>" />`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`, `<meta name="apple-mobile-web-app-capable" content="yes" />`, `<meta name="mobile-web-app-capable" content="yes" />`.
- `apps/web/vite.config.ts`: add `VitePWA({ registerType: 'autoUpdate', manifest: false, injectRegister: null, includeAssets: ['fonts/*', 'icons/*', 'apple-touch-icon.png', 'manifest.webmanifest'], workbox: { globPatterns: ['**/*.{js,css,html,woff2}'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//], runtimeCaching: [], cleanupOutdatedCaches: true }, devOptions: { enabled: false } })` to `plugins`. `manifest: false` because the manifest is a static file; `injectRegister: null` because registration is explicit below; `runtimeCaching: []` is the "app shell only" rule — no `/api` response is ever cached.
- `apps/web/src/pwa/registerServiceWorker.ts` (new): `export function registerServiceWorker(): void { if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return; void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })); }` — dynamic import behind the `PROD` check so Vitest (jsdom, `PROD=false`) and the visual harness never resolve the virtual module. Add `/// <reference types="vite-plugin-pwa/client" />` to `apps/web/src/vite-env.d.ts`.
- `apps/web/src/main.tsx`: call `registerServiceWorker()` after `createRoot(...).render(...)`.
- `apps/web/nginx.conf`: add before the hashed-asset rule: `location = /sw.js { add_header Cache-Control "no-cache"; }`, `location = /manifest.webmanifest { types { application/manifest+json webmanifest; } add_header Cache-Control "no-cache"; }`, and `location = /index.html { add_header Cache-Control "no-cache"; }`. Without these the one-year `immutable` rule would pin an old worker forever.
- `apps/web/Dockerfile`: no change expected (build output already copied); verify `dist/sw.js` and `dist/workbox-*.js` land in the image.

Why Vitest and the visual harness are unaffected: `vitest.config.ts` is its own `defineConfig` (it does not import `vite.config.ts`), so the plugin never loads under Vitest; `apps/web/visual/vite.config.ts` is likewise separate; the only runtime reference is the dynamic import in `registerServiceWorker`, which is short-circuited by `import.meta.env.PROD === false` in both. A Vitest test asserts `registerServiceWorker()` performs no dynamic import when `PROD` is false (spy on `navigator.serviceWorker` — it must not be touched).

**Tests (testing-dev)**

- `apps/web/src/__tests__/pwa/manifest.test.ts` (new): parse `public/manifest.webmanifest`; assert `name === APP_NAME`, `display === 'standalone'`, `start_url === '/'`, both 192 and 512 icons present with a `maskable` pair, every `src` exists on disk, `theme_color` equals `index.html`'s `<meta name="theme-color">` and the theme's dark `background.default`.
- `apps/web/src/__tests__/pwa/registerServiceWorker.test.ts`: with `import.meta.env.PROD` stubbed false → no call to `navigator.serviceWorker.register` and no thrown error when `serviceWorker` is undefined.
- `apps/web/src/__tests__/infra/nginx-sw-cache.test.ts` (new, same style as `nginx-upstream-port.test.ts`): `nginx.conf` contains the `sw.js`, `manifest.webmanifest` and `index.html` `no-cache` locations **before** the hashed-asset regex block.
- Build check (ops-dev): `cd apps/web && npm run build` produces `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest`, `dist/icons/*`; `grep -c '"/api/' dist/sw.js` → `0` (no API URL precached); `grep -c 'index.html' dist/sw.js` → ≥1.
- Visual suite unchanged (no baseline touches); `npm run test:run` unchanged in count except the new specs.

**Docs (docs-dev)**

- `docs/ARCHITECTURE.md`: "PWA" subsection — what is precached (shell only), update strategy (`autoUpdate`, reload on next navigation), what is deliberately not cached (`/api/*`), and where E12-04 will extend the worker.
- `docs/deployment/vps.md`: note that `sw.js`/manifest must be served with `no-cache` (the app's nginx does this; a host proxy must not override `Cache-Control` for those paths).
- `CLAUDE.md` "Repository Structure": `public/manifest.webmanifest`, `public/icons/`, `scripts/generate-icons.mjs`, `src/pwa/`.

#### Acceptance criteria

- [ ] `npm run build && npm run preview` in `apps/web`, opened in Chrome: DevTools → Application → Manifest shows name, 192/512 icons incl. maskable, no warnings; "Installability" reports installable; Lighthouse PWA "Installable" passes.
- [ ] After first load in production mode, DevTools → Application → Service Workers shows `sw.js` activated; going offline and reloading `/` still renders the shell (login page or app frame) — `/api` calls fail visibly, nothing is served from cache for them.
- [ ] `dist/sw.js` precaches `index.html`, hashed `js`/`css` and `woff2` only; it contains no `/api/` entries and no runtime caching routes.
- [ ] In `npm run dev` and in Vitest no service worker is registered and no `virtual:pwa-register` import is attempted (test asserts).
- [ ] `apps/web/nginx.conf` serves `/sw.js`, `/manifest.webmanifest`, `/index.html` with `Cache-Control: no-cache` and `manifest.webmanifest` with `application/manifest+json`.
- [ ] `apps/web/index.html` carries `rel="manifest"`, `theme-color`, and `apple-touch-icon`; `theme_color` matches the theme's dark background.
- [ ] Visual baselines are byte-identical to before this child (no harness change); `npm run test:run` and `npm run typecheck` in `apps/web` pass.
- [ ] iOS Safari "Add to Home Screen" uses the 180px apple-touch-icon and opens standalone (manual check).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: registration failures are caught and logged at `console.warn` only; the app never blocks on the worker
- [ ] Observability: n/a
- [ ] Security: worker scope `/`; no API responses or tokens ever cached (`runtimeCaching: []`, `navigateFallbackDenylist` for `/api`); no third-party assets
- [ ] Config & secrets: none; `sharp` is dev-only and not in the production image
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. `cd apps/web && npm ci && npm run icons` → `public/icons/*.png` regenerate identically (`git status` clean).
2. `npm run build && npm run preview` → open the printed URL in Chrome; Application → Manifest / Service Workers as in the acceptance criteria; install the app from the omnibox icon; launch it: it opens standalone with the theme colour title bar.
3. DevTools → Network → Offline → reload the installed app → shell renders; `/api/auth/me` fails in the console; no cached API data appears.
4. Epic script step 18 through the compose stack (nginx path): `curl -sI localhost:3535/sw.js | grep -i cache-control` → `no-cache`; `curl -sI localhost:3535/manifest.webmanifest | grep -i content-type` → `application/manifest+json`.
5. `npm run dev` → Application → Service Workers is empty.

#### Out of scope

- Offline data, background sync, queued writes (E09-08 for workout set logs).
- Web push subscription and the push event handler (E12-04, which switches the plugin to `injectManifest` if it needs custom worker code).
- Install prompts/banners in the UI ("Add EvolvePath to your home screen") — later, once Today exists.
- Splash-screen images for iOS.

#### Notes for the implementing agent

- Pin `vite-plugin-pwa` to an exact version; confirm its peer range includes Vite 8 before installing (check the package's `peerDependencies` in the registry; if not yet compatible, use the plugin's `workbox-build` directly in a small Vite plugin and say so in the PR).
- `virtual:pwa-register` only exists inside a Vite build with the plugin active; never import it statically anywhere under `src/` — the dynamic import behind `import.meta.env.PROD` is the whole isolation story for Vitest and the visual harness.
- Do not enable `devOptions.enabled`: a dev worker caching the Vite dev server's modules is the classic "my change doesn't show up" trap.
- The `%APP_NAME%` transform does not touch `manifest.webmanifest`; the manifest test is what keeps the literal honest.
- The visual harness (`apps/web/visual/vite.config.ts`) must **not** get the plugin; it shares `public/` so the manifest and icons are simply served there as static files, which is harmless.

---

### E02-08 `test(tests): E02 end-to-end verification`

**Part of epic:** E02 · **Blocked by:** E02-01, E02-02, E02-03, E02-04, E02-05, E02-06, E02-07 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → ops-dev → docs-dev

#### Problem statement

The epic's promise (PLAN "each epic is testable end to end: DB + API + UI") needs a repeatable proof that survives the next epic's changes: a browser drives the real shell and Path screen against the real API and database, with the E01 key gate satisfied through the fake OpenAI server. PRD §103's plan-versioning guarantees and §10.9's evidence rule must be asserted where they are observable — on the Path screen and in the database — not only in unit tests. The domain model also needs its spec document so E04–E11 build on the written contract rather than on reading Prisma.

#### Proposed solution

Add Playwright e2e specs under `tests/e2e/specs/` covering navigation and the full Path flow (with an axe pass on each screen), write `docs/specs/domain-model.md`, finish `docs/API.md`, and link the epic spec from `docs/epics/README.md`.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a. (If E01-10's `withAiKey` option on `TestLoginDto` is missing, this child is blocked, not worked around.)

**UI (frontend-dev)** — n/a beyond adding stable `data-testid`s where the specs below need them (listed under Tests); no behaviour change.

**Tests (testing-dev)**

`tests/e2e/package.json`: add devDependency `@axe-core/playwright`. `tests/e2e/playwright.config.ts`: add a second project `{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }` and change `webServer.command` to `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up` (the gate needs the fake provider for the key test).

`tests/e2e/helpers/auth.helper.ts`: `loginAsTestUser` gains `withAiKey?: boolean` (E01-10 adds the DTO field and a hidden checkbox `[data-testid="test-with-ai-key"]` on `/testing/login`; if E01-10 implemented it as a query param, follow that — do not fork the helper). Add `helpers/path.helper.ts` with `uniqueEmail(prefix)` (`${prefix}-${Date.now()}@test.local`, so parallel runs never share rows) and `tomorrowAt(hour, minute)` returning a `datetime-local` string.

`tests/e2e/specs/navigation.spec.ts` (new):

1. `loginAsTestUser(page, { email: uniqueEmail('nav'), withAiKey: true })` → URL `/`; `today-empty-state` visible.
2. Project `mobile-chromium`: bottom bar has five `[role=button]` with names Today, Path, Coach, Progress, Profile and no Console; tap Path → `/path`; tab has `aria-current="page"`.
3. Project `chromium` (desktop): rail lists the five; as admin (`role: 'admin'`) Console appears at the rail foot; on mobile as admin Console is absent from the bar and present in the avatar menu (`[data-testid="user-menu"]`).
4. `AxeBuilder({ page }).analyze()` on `/`, `/path`, `/coach`, `/progress` → `violations` filtered to `impact in ['serious','critical']` is empty.

`tests/e2e/specs/path.spec.ts` (new) — one `test.describe.serial` per fresh user (`uniqueEmail('path')`, `withAiKey: true`):

1. **Best Self**: `/path` → click `[data-testid="best-self-edit"]` → fill identity statement "Focused, present, healthy" and six-month vision → Save → card shows the statement; reload → still shown.
2. **Outcome**: in the Health section click `[data-testid="add-outcome-HEALTH"]` → title "Three strength workouts per week", importance 4 → Save → card visible; reload → visible.
3. **Plan**: open the card → `/path/outcomes/<id>` → **Create plan** with rationale "Start with mornings" → text "Plan v1 · ACTIVE".
4. **Routine**: **Add routine** → "Morning workout", EVENT "after morning coffee", WEEKDAYS, 45/10, fallback "10-minute circuit" → Save → listed.
5. **Version**: **New version** → rationale "Evenings slipped; move to mornings + Saturday" → Save → history row "v2 · DRAFT" containing the rationale and "1 routine"; **Activate** → "v2 · ACTIVE", "v1 · SUPERSEDED"; expand v1 → still shows "Morning workout".
6. **Commitment**: **Add commitment** → "Upper A", `tomorrowAt(6,30)`–`tomorrowAt(7,15)`, importance 4, minimum "10-minute circuit" → Save → row with PLANNED chip.
7. **Transition + evidence**: status menu → items exactly Ready, Start, Reschedule, Skip, Missed, Cancel; choose **Start** → STARTED; menu → **Complete** → dialog → note "Finished all sets" → Save → COMPLETED and "1 evidence · USER_LOG" visible on the row.
8. **Reschedule count**: add a second commitment; **Reschedule** → +2 days → original row RESCHEDULED, new row "rescheduled ×1"; reschedule the new row again → "rescheduled ×2".
9. **Invalid transition guard**: the COMPLETED row's status button is disabled (no allowed transitions).
10. **Archive**: outcome menu → **Archive** → confirm → `/path` no longer lists it; toggle **Show archived** → listed with ARCHIVED chip.
11. **Isolation**: capture the outcome URL; in a new `browser.newContext()`, log in as `uniqueEmail('other')` with `withAiKey: true`; `page.goto(url)` → text "Outcome not found"; `request.get('/api/outcomes/<id>')` with that context's cookies/token → 404.
12. **DB assertions** through the API rather than psql (the e2e host has no DB client): `GET /api/plans/<planId>/versions` → `[{version:2,status:'ACTIVE'},{version:1,status:'SUPERSEDED', activeUntil: not null}]`; `GET /api/evidence?from&to` → exactly one row, `source: 'USER_LOG'`; `GET /api/commitments?from&to&status=RESCHEDULED` → two rows. Tokens for these calls come from the page's `localStorage` access token or by minting a PAT via `POST /api/pat` from the page context.
13. `AxeBuilder` on `/path` (populated) and `/path/outcomes/<id>` → no serious/critical violations, on both projects.

`data-testid`s to add in E02-06 components if missing: `best-self-edit`, `add-outcome-<DOMAIN>`, `outcome-card-<id>`, `create-plan`, `new-plan-version`, `activate-version-<n>`, `add-routine`, `add-commitment`, `commitment-status-<id>`, `show-archived`, `outcome-archive`.

ops-dev: run `cd tests/e2e && npm ci && npx playwright install chromium && npx playwright test navigation.spec.ts path.spec.ts` against the compose stack with the fake provider; attach the HTML report path to the PR.

**Docs (docs-dev)**

- `docs/specs/domain-model.md` (new): the hierarchy diagram (mermaid), every enum with members and meaning, each table with its purpose and key invariants (one plan per outcome, one ACTIVE version per plan via partial index, versions immutable after DRAFT, routines belong to a version and are cloned on new versions, RESCHEDULED closes the row and carries `rescheduleCount` to the successor, evidence outlives commitments and is never derived from planned items, `createdBy` is server-set), the transition matrix table, ownership rule (404 never 403), audit action list, the URL conventions (`:version` is the integer), and "Extending the model" guidance for E04–E11 (which tables they add, which they must not modify). Link PRD §9, §10, §80, §103.
- `docs/API.md`: verify the EvolvePath section from E02-02..04 is complete and consistent (paths, codes, `INVALID_TRANSITION`), add a "Product resources" paragraph under "Authentication" explaining the ownership/404 rule.
- `docs/TESTING.md`: E2E section — the `mobile-chromium` project, `@axe-core/playwright` usage, the fake-provider compose file in `webServer`, the `withAiKey` login option, and "how to run only E02's specs".
- `docs/epics/README.md`: in the E02 row add "Verified by `tests/e2e/specs/path.spec.ts`, `navigation.spec.ts`; spec `docs/specs/domain-model.md`". `docs/epics/E02-product-shell-domain-model.md`: add a "Verification" line under the epic body's manual script pointing at the two specs.
- `CLAUDE.md`: "Testing Requirements" — add "E2E: every epic ships Playwright specs under `tests/e2e/specs/` proving its flow against the fake OpenAI server" and the `docs/specs/domain-model.md` link under "Architecture Principles" or "Common Patterns".

#### Acceptance criteria

- [ ] `cd tests/e2e && npx playwright test navigation.spec.ts path.spec.ts` passes on both `chromium` and `mobile-chromium` against `base+dev+fake-openai` compose, from a clean database, twice in a row (no leftover-state dependence).
- [ ] The Path flow spec proves: Best Self persists; outcome persists across reload; plan v1 ACTIVE; v2 DRAFT with rationale → ACTIVE with v1 SUPERSEDED and still readable; commitment STARTED → COMPLETED with one `USER_LOG` evidence visible on Path; COMPLETED without evidence creates none; reschedule twice → "rescheduled ×2"; archive hides then "Show archived" reveals.
- [ ] Another user opening the outcome URL sees "Outcome not found" and the API returns 404.
- [ ] axe (`@axe-core/playwright`) reports no serious/critical violations on `/`, `/path`, `/path/outcomes/:id`, `/coach`, `/progress` at desktop and Pixel 7 sizes.
- [ ] `docs/specs/domain-model.md` exists, is linked from `docs/epics/README.md`, `CLAUDE.md` and `docs/ARCHITECTURE.md`, and every enum member and table name in it matches `schema.prisma` (a Jest test `apps/api/test/docs/domain-model-doc.spec.ts` greps the doc for each Prisma enum member and table `@@map`).
- [ ] `docs/API.md` documents every E02 endpoint with method, path, request, response and error codes including `INVALID_TRANSITION`.
- [ ] `docs/TESTING.md` explains how to run the E02 specs and the mobile project.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: specs fail with actionable messages (locators named by `data-testid`; API assertions print the body on mismatch)
- [ ] Observability: Playwright HTML report + trace on first retry retained (`trace: 'on-first-retry'` already set)
- [ ] Security: specs use unique throwaway emails; no real keys (fake provider accepts `sk-test-…`); no production URLs
- [ ] Config & secrets: `BASE_URL` env respected; no new secrets
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–4 (stack up with fake provider, migrated, seeded).
2. `cd tests/e2e && npm ci && npx playwright install chromium`.
3. `npx playwright test navigation.spec.ts path.spec.ts --project=chromium --project=mobile-chromium` → all passed; `npx playwright show-report` → open a `path.spec.ts` trace and confirm the "v1 · SUPERSEDED" and "1 evidence · USER_LOG" screenshots.
4. `psql … -c "SELECT count(*) FROM evidence_items WHERE source='USER_LOG';"` → equals the number of completed runs of the spec (one per run).
5. Open `docs/specs/domain-model.md` and cross-check the enum lists against `apps/api/prisma/schema.prisma` by eye; `cd apps/api && npm test -- domain-model-doc` → passes.

#### Out of scope

- CI workflow files (declined for now — see PLAN "Cross-cutting items"); the specs are run locally and in the PR description.
- Visual pixel baselines (E02-05 covers the navigation baselines; e2e asserts behaviour, not pixels).
- E2E coverage for reflections and domain modes (API-level integration tests in E02-02/E02-04 cover them; a screen for reflections arrives in E05).

#### Notes for the implementing agent

- Reuse `tests/e2e/fixtures/auth.fixture.ts`'s `test.extend` pattern to add a `pathUserPage` fixture that logs in with `withAiKey: true` and a unique email, so both specs share it.
- The `webServer` block uses `reuseExistingServer: true`; when the stack is already running with the fake provider, Playwright does not start a second one.
- Playwright cannot read the DB; assert through the API with the page's token (`await page.evaluate(() => localStorage.getItem('access_token'))` — confirm the key name in `apps/web/src/services/api.ts`) or mint a PAT through `POST /api/pat` from the page's `fetch`.
- Time inputs: `datetime-local` wants `YYYY-MM-DDTHH:mm` in the browser's local zone; Playwright's Chromium runs in the host zone — compute `tomorrowAt` from `new Date()` in the test, not in UTC.
- Keep every locator on `data-testid` or accessible role+name; never on MUI class names.
- `docs/epics/README.md` is written by the main agent; only add the "Verified by" line to the E02 row, do not restructure the file.
