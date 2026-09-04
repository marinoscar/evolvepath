# E04 — Onboarding: Best Self → First Path

<!-- epic-meta: slug=onboarding-first-path phase=2 -->
<!-- epic-issue: #99 -->

> GitHub epic: [#99](https://github.com/marinoscar/evolvepath/issues/99)

## Epic

### Goal
A brand-new user goes from "Become who you want to be" to an approved, persisted first Path in 5–8 minutes (PRD §19): a Best Self statement, one outcome per selected domain, at most three behavior commitments for the first week (PRD §70), a coaching style, a notification decision, and a first next action on Today. The AI drafts the plan through the `planner` persona; the user edits and approves it; nothing is written to the domain tables until approval (PRD §15). The flow completes with the AI down (PRD §120), resumes after a refresh, and is the second gate every signed-in user passes after the BYOK key setup (E01-09 (#29)).

### Background
- VISION Part XIV (§43 "Start With the Person, Not the Habits", §44 "Progressive Profiling"): ask who the user wants to become, learn only enough to build a safe first plan, learn the rest from behavior.
- PRD §20 fixes the nine screens (Promise → Six-month vision → Domain reflection → Current reality → Time reality → Health baseline → Coaching style → AI plan proposal → Notification value exchange); §21 defers further questions to progressive profiling; §70–§72 cap the first plan at 3 behaviors and require a 1–5 confidence check that reduces the plan when low; §102 is the acceptance list this epic must satisfy; §10.1 names the `UserProfile` fields (timezone, locale, onboarding state, default coaching style, quiet hours).
- Builds on E01: `AiGatewayService.invoke({persona:'planner', …, schema, schemaName})` (`apps/api/src/ai/gateway/ai-gateway.service.ts`) returning `{ok:true, output}` / `{ok:false, error}`; `RequireAiKey` (`apps/web/src/components/common/RequireAiKey.tsx`) and the `/setup/ai-key` full-screen page outside `Layout`; `GET /api/auth/me` carrying `aiKey:{configured,hint}` (E01-05 (#25)) — `onboarding:{completed}` follows the same pattern; the fake OpenAI server `tools/fake-openai/server.mjs` + `infra/compose/fake-openai.compose.yml` (E01-10 (#30)) for e2e.
- Builds on E02-01 (#36)'s domain schema (`apps/api/prisma/schema.prisma`): `BestSelfProfile`, `Outcome` (domain enum `WORK|FAMILY|HEALTH`), `Plan` + `PlanVersion` (`status`, `rationale`, `userApproved`, `createdBy USER|AI`), `Routine` (trigger type/value, frequency, estimated/minimum minutes, `fallbackBehavior`), `Commitment` (status enum starting at `PLANNED`, full/short/minimum versions), `DomainMode`. E02-05 (#51)'s shell already routes `/` to the Today placeholder.
- Codebase facts: `apps/web/src/App.tsx` mounts `ProtectedRoute` → (`/activate`, `/setup/ai-key` exempt) → `RequireAiKey` → `NotificationProvider` + `Layout`; `apps/web/src/contexts/AuthContext.tsx` exposes `user` and `refreshUser()`; `apps/api/src/auth/auth.service.ts` `getCurrentUser(userId)` builds the `/auth/me` payload and `apps/api/src/auth/dto/auth-user.dto.ts` (`CurrentUserDto`) documents it; per-user endpoints are plain `@Auth()` with ownership in the query (`apps/api/src/settings/user-settings/user-settings.controller.ts`); audit rows are direct `prisma.auditEvent.create` calls (`apps/api/src/email/email-settings.service.ts`); the test login DTO is `apps/api/src/test-auth/dto/test-login.dto.ts` and the Playwright helper `tests/e2e/helpers/auth.helper.ts` drives `/testing/login`; the browser-permission prompt already lives behind a click in `apps/web/src/pages/UserNotificationsPage.tsx` via `requestBrowserNotificationPermission` (`apps/web/src/services/browserNotifications.ts`).
- Spec file produced by this epic: `docs/specs/onboarding.md` (E04-06 (#107)).

### Scope
- [ ] #100 feat(db): add user_profiles with onboarding state and expose onboarding status on /auth/me (E04-01)
- [ ] #101 feat(api): add onboarding endpoints with AI plan proposal, confidence check, approve and skip-ai templates (E04-02)
- [ ] #102 feat(web): add the onboarding wizard at /onboarding with per-step persistence (E04-03)
- [ ] #104 feat(web): add the first-Path proposal review screen with inline edits and confidence check (E04-04)
- [ ] #106 feat(web): gate the app shell behind onboarding completion after the AI key gate (E04-05)
- [ ] #107 test(tests): E04 end-to-end verification (E04-06)

### Out of scope
- Voice input for the six-month vision (PRD §125, P1) — text only; the UI leaves room for a mic button but ships none.
- Calendar integration (PRD §69), wearables, social features.
- Progressive profiling questions after onboarding (PRD §21) — E06 memory / E10 weekly review own those.
- Workout program generation (E09): the health "routine" here is a behavior commitment (e.g. three 30-minute strength sessions), not a program with exercises.
- Push notifications (E12) — step 9 only explains and requests the browser permission that already exists.
- Re-running onboarding for a completed user (a later "Reset my Path" belongs to E10 planning).
- Family member records (E08) — the family reflection is free text only.

### Sequencing
- E04-01 (#100) first (schema + `/auth/me`). E04-02 (#101) depends on E04-01 (#100) and on E01-06 (#26) (gateway) and E02-01 (#36)/02/03/04 (domain tables + services to persist into).
- E04-03 (#102) and E04-05 (#106) can start against MSW as soon as E04-01 (#100)'s `User.onboarding` type is agreed; E04-04 (#104) depends on E04-02 (#101)'s proposal contract and E04-03 (#102)'s wizard shell.
- Critical path: E04-01 (#100) → E04-02 (#101) → E04-04 (#104) → E04-06 (#107). E04-03 (#102) and E04-05 (#106) run in parallel with E04-02 (#101).
- E04-06 (#107) last; it needs the fake OpenAI server from E01-10 (#30) and the Today placeholder from E02-05 (#51).

### Manual end-to-end verification
1. Fresh clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, and the `OPENAI_BASE_URL` override from `infra/compose/fake-openai.compose.yml`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed` (confirm `add_user_profiles` is applied in the migrate output).
3. Open http://localhost:3535/testing/login. Email `newbie@test.local`, role `viewer`, leave "Seed OpenAI key" (E01-10 (#30)) checked and untick "Mark onboarding complete" (E04-06 (#107)). Submit.
4. Observe: you land on http://localhost:3535/onboarding step 1 ("Become who you want to be." / `Build my Path`). Try http://localhost:3535/ and http://localhost:3535/settings — both bounce back to `/onboarding`. http://localhost:3535/settings/ai-key also bounces (gated by both gates).
5. Step 2: type "I want to stop wasting mornings, be more present with my family, and get back in shape." → Next. Refresh the browser: the wizard reopens on step 3 (state was saved by `PATCH /api/onboarding/answers`).
6. Step 3: select Work, Family, Health; fill each reflection. Step 4: tick "I procrastinate" and "I make plans that are too ambitious". Step 5: slider to 45 minutes. Step 6 (shown because Health is selected): Beginner, 3 days, 30 min, equipment "Dumbbells", no limitations. Step 7: Balanced.
7. Step 8: a spinner, then "Your first Path" with a Best Self statement, one outcome under each of Work / Family / Health, at most three routines, and first-week commitments with times. Copy "I intentionally kept this smaller than what you asked for…" is visible. Edit one commitment's time inline. Answer the confidence question with 2 → a new, smaller proposal replaces the old one (fewer routines or shorter minimums). Answer 4. Click `Start this Path`.
8. Step 9: the value-exchange text, then `Allow notifications` → browser prompt → grant or dismiss; `Finish` either way. You land on http://localhost:3535/ (Today placeholder from E02-05 (#51)) showing the three commitments.
9. Sign out, sign in again as `newbie@test.local`: you land on `/` directly; `/onboarding` redirects to `/`.
10. Repeat 3–7 with a second user but stop `fake-openai` first (`docker compose stop fake-openai`). Step 8 shows "The coach is unavailable right now" with `Continue without AI` → a template Path appears (Work: "Start the most important task before email, 3 mornings"; Family: "Phone-free dinner Tue/Thu/Sun"; Health: "Three 30-minute strength sessions") → approve → Today.
11. DB checks with `psql` against the `.env` database (`psql "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"`):
    - `select onboarding_step, onboarding_completed_at, coaching_style, weekday_minutes, obstacles, pending_proposal is null as cleared from user_profiles;` → `DONE`, a timestamp, `BALANCED`, `45`, the two obstacles, `cleared = true`.
    - `select domain, title from outcomes where user_id = '<id>';` → three rows, one per domain.
    - `select version, status, created_by, user_approved from plan_versions where user_id = '<id>';` → `1 | ACTIVE | AI | true` per plan (second user: `created_by = USER`).
    - `select count(*) from routines where user_id = '<id>';` → ≤ 3. `select count(*) from commitments where user_id = '<id>' and status = 'PLANNED';` → ≥ 3 within the next 7 days.
    - `select action, meta from audit_events where action = 'onboarding:approved';` → one row per user with `{source:'ai'|'template', outcomes, routines, commitments}`.
    - `select persona, status from ai_invocations where persona = 'planner';` → `succeeded` rows for user 1 (two if you re-proposed), a `failed` row for user 2.

## Child issues

### E04-01 `feat(db): add user_profiles with onboarding state and expose onboarding status on /auth/me` — #100

**Part of epic:** E04 · **Blocked by:** E01-05 (#25), E02-01 (#36) · **Component:** database, api · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §10.1 defines a `UserProfile` (timezone, locale, onboarding state, default coaching style, quiet hours) that the foundation does not have: `users` carries identity only and `user_settings` is a free-form JSONB document owned by the settings UI. Onboarding (PRD §20), the coaching style (PRD §20 step 7), the time reality (step 5) and the health baseline (step 6) need typed, queryable columns — E05's next-best-action sizing reads `weekdayMinutes`, E12's decision engine reads quiet hours, and the web app needs a single boolean on `/auth/me` to gate the shell (E04-05 (#106)) without a second request, exactly as `aiKey` does (E01-05 (#25)).

#### Proposed solution
Add a `user_profiles` table (one row per user, created lazily on first read), a `UserProfileService` that owns it, and `onboarding: { completed }` on `GET /api/auth/me`.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`:

```prisma
enum OnboardingStep {
  PROMISE
  VISION
  DOMAINS
  REALITY
  TIME
  HEALTH_BASELINE
  COACHING_STYLE
  PROPOSAL
  NOTIFICATIONS
  DONE
}

enum CoachingStyle {
  GENTLE
  BALANCED
  DIRECT
}

model UserProfile {
  id                    String          @id @default(uuid()) @db.Uuid
  userId                String          @unique @map("user_id") @db.Uuid
  timezone              String          @default("UTC")
  locale                String          @default("en")
  onboardingStep        OnboardingStep  @default(PROMISE) @map("onboarding_step")
  onboardingCompletedAt DateTime?       @map("onboarding_completed_at") @db.Timestamptz
  coachingStyle         CoachingStyle   @default(BALANCED) @map("coaching_style")
  weekdayMinutes        Int?            @map("weekday_minutes")
  quietHoursStart       String?         @map("quiet_hours_start") // "HH:mm"
  quietHoursEnd         String?         @map("quiet_hours_end")   // "HH:mm"
  obstacles             String[]        @default([])
  sixMonthVision        String?         @map("six_month_vision")
  selectedDomains       Domain[]        @default([]) @map("selected_domains") // E02-01 (#36)'s enum
  domainReflections     Json?           @map("domain_reflections")           // {work?,family?,health?}
  healthBaseline        Json?           @map("health_baseline")
  pendingProposal       Json?           @map("pending_proposal")
  confidenceScore       Int?            @map("confidence_score")
  createdAt             DateTime        @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime        @updatedAt @map("updated_at") @db.Timestamptz

  user User @relation("UserProfile", fields: [userId], references: [id], onDelete: Cascade)

  @@index([onboardingStep])
  @@map("user_profiles")
}
```

Add `profile UserProfile? @relation("UserProfile")` to `model User`. `Domain` is the enum E02-01 (#36) introduced for `Outcome.domain` — reuse it, do not declare a second one. Migration: `npm run prisma:migrate:dev -- --name add_user_profiles`. Seed: none (rows are created lazily; `prisma/seed.ts` untouched).

JSON columns are typed with Zod at the boundary in `apps/api/src/user-profile/user-profile.schema.ts` (new):
- `healthBaselineSchema = z.object({ experience: z.enum(['NONE','BEGINNER','INTERMEDIATE','ADVANCED']), daysPerWeek: z.number().int().min(1).max(7), minutesPerSession: z.number().int().min(10).max(120), equipment: z.array(z.string().max(60)).max(20), preferences: z.string().max(500).optional(), limitations: z.string().max(500).optional() })`
- `domainReflectionsSchema = z.object({ work: z.string().max(1000).optional(), family: z.string().max(1000).optional(), health: z.string().max(1000).optional() })`
- `quietHoursTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)`
- `OBSTACLE_OPTIONS` = the PRD §20 step-4 list as stable keys: `PROCRASTINATE, TOO_AMBITIOUS, FORGET, SCHEDULE_CHANGES, LOSE_MOTIVATION, OVERWHELMED, DONT_KNOW_WHAT, OTHER`; `obstacles` is validated as `z.array(z.enum(OBSTACLE_OPTIONS)).max(8)`.
- `pendingProposal` is validated by E04-02 (#101)'s `onboardingProposalSchema`; this issue only declares the column.

**API (backend-dev)** — new module `apps/api/src/user-profile/` (new): `user-profile.module.ts` (imports `PrismaModule`; exports `UserProfileService`; not global), `user-profile.service.ts` with:
- `getOrCreate(userId): Promise<UserProfile>` — `prisma.userProfile.upsert({ where:{userId}, create:{userId}, update:{} })`.
- `isOnboardingComplete(userId): Promise<boolean>` — `findUnique` select `onboardingCompletedAt`; `null` row → `false` (no upsert on a read path that `/auth/me` hits on every boot).
- `update(userId, patch)` — typed partial used by E04-02 (#101).

`AuthModule` imports `UserProfileModule`; `AuthService.getCurrentUser` adds `onboarding: { completed: await this.userProfile.isOnboardingComplete(userId) }` next to `aiKey`; `CurrentUserDto` gains a nested `OnboardingStatusDto { completed: boolean }` with `@ApiProperty`. No new endpoints, no new permissions, no new OpenAPI tag.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/auth/me` | existing `@Auth()` | — | existing body + `onboarding: { completed: boolean }` |

**UI (frontend-dev)** — `apps/web/src/types/index.ts`: `User.onboarding: { completed: boolean }` **required** (a fixture that omits it fails to compile, which is the point). `apps/web/src/__tests__/mocks/data.ts` `mockUsers` and `apps/web/visual/main.tsx`'s fake user gain `onboarding: { completed: true }`. Nothing renders it yet (E04-05 (#106)).

**Tests (testing-dev)**
- `apps/api/src/user-profile/user-profile.service.spec.ts` (new): `getOrCreate` upserts once and returns the row; `isOnboardingComplete` is `false` with no row, `false` with `onboardingCompletedAt: null`, `true` with a timestamp; no write on the read path (assert `upsert` not called).
- `apps/api/src/auth/auth.service.spec.ts`: `getCurrentUser` includes `onboarding.completed` from the service (both values).
- `apps/api/test/auth.integration.spec.ts` (extend or create with `createTestApp({ useMockDatabase: true })` from `test/helpers/test-app.helper.ts`): `GET /api/auth/me` body has `onboarding.completed === false` for a fresh mock user.
- `apps/web`: `npm run typecheck` is the test — every `User` fixture must declare `onboarding`.

**Docs (docs-dev)** — `docs/API.md` (`GET /auth/me` example gains `onboarding`), `CLAUDE.md` "Database Tables" (`user_profiles`), `docs/ARCHITECTURE.md` data-model list.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates `user_profiles` with the enums above and a unique `user_id` FK cascading on user delete
- [ ] No `user_profiles` row exists for a user who has never hit an onboarding endpoint; `GET /api/auth/me` still returns `onboarding.completed === false` and creates no row
- [ ] `GET /api/auth/me` returns `onboarding.completed === true` once `onboardingCompletedAt` is set
- [ ] `UserProfileService.getOrCreate` is idempotent (two calls, one row)
- [ ] `healthBaselineSchema` rejects `daysPerWeek: 8` and `minutesPerSession: 5`; `quietHoursTime` rejects `"9:00"` and `"24:00"`
- [ ] `apps/web` typecheck fails if a `User` fixture lacks `onboarding`, and passes on the branch
- [ ] Existing `apps/api` and `apps/web` suites pass unchanged apart from the fixture additions

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: the read path never throws for a missing profile; upsert races on `getOrCreate` are absorbed by the unique constraint (catch `P2002`, re-read)
- [ ] Observability: no new log lines on the `/auth/me` path (it runs on every app boot)
- [ ] Security: profile rows are only ever addressed by the caller's own `userId`; no admin listing endpoint
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–2; confirm `\d user_profiles` in `psql` shows the columns and both enums.
2. Log in at http://localhost:3535/testing/login as `profile@test.local`; `curl -H "Authorization: Bearer <token>" http://localhost:3535/api/auth/me` → `"onboarding":{"completed":false}`; `select count(*) from user_profiles;` is unchanged.
3. `update user_profiles set onboarding_completed_at = now() where user_id = '<id>';` (insert a row first if none) → the same curl returns `completed: true`.

#### Out of scope
- Onboarding endpoints (E04-02 (#101)), any UI (E04-03 (#102)..05)
- Quiet-hours editing UI (E12-05 (#68)); `quietHoursStart/End` are declared now so E12 does not migrate twice
- Timezone auto-detection endpoint — set by `POST /onboarding/start` in E04-02 (#101)

#### Notes for the implementing agent
- Follow `UserSettings` (`schema.prisma`) for the one-row-per-user shape and `@map` naming; follow `apps/api/src/settings/user-settings/user-settings.service.ts` for the lazy-create pattern.
- `Domain[]` with `@default([])` requires the `Domain` enum from E02-01 (#36) to exist; if E02-01 (#36) named it differently (e.g. `LifeDomain`), use that name and say so in the PR — never introduce a parallel enum.
- Run `npm run prisma:generate` after the schema change; use `npm run prisma:migrate:dev`, never bare `npx prisma`.
- Mirror the `aiKey` wiring in `AuthService.getCurrentUser` (E01-05 (#25)) — same shape, same DTO style, same spec cases.
- Pitfall: `AuthModule` importing `UserProfileModule` must not create a cycle; `UserProfileModule` imports only `PrismaModule`.

---

### E04-02 `feat(api): add onboarding endpoints with AI plan proposal, confidence check, approve and skip-ai templates` — #101

**Part of epic:** E04 · **Blocked by:** E04-01 (#100), E01-06 (#26), E02-02 (#39), E02-03 (#42), E02-04 (#47) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
The onboarding answers (PRD §20 steps 2–7) must be saved per step so a refresh resumes; the Planning Reasoner (PRD §14.2) must turn them into a first Path that respects the ≤3-behavior guardrail (PRD §70) and the confidence check (PRD §72); the proposal must not touch domain tables until the user approves (PRD §15 mutation protocol); and the flow must complete when the model is unavailable (PRD §120). None of that exists — the API has no onboarding module and no `planner` call site.

#### Proposed solution
New module `apps/api/src/onboarding/` (new): `onboarding.module.ts` (imports `PrismaModule`, `UserProfileModule`, `AiModule`; registered in `app.module.ts`), `onboarding.controller.ts`, `onboarding.service.ts` (answers, approve, audit), `onboarding-proposal.service.ts` (prompt + gateway call + guardrails), `onboarding-proposal.schema.ts` (Zod contract), `onboarding-templates.ts` (deterministic skip-AI templates), `dto/{start-onboarding,patch-answers,confidence,approve-onboarding}.dto.ts` via `createZodDto` (as `test-login.dto.ts`), `dto/onboarding-state-response.dto.ts`.

**Data (database-dev)** — n/a (columns from E04-01 (#100); writes into E02-01 (#36)'s tables).

**API (backend-dev)** — all routes plain `@Auth()`; the profile row is the caller's own (`userId` from `@CurrentUser('id')`). OpenAPI tag `Onboarding` added to `apps/api/src/openapi/tags.ts` in the product group E02-02 (#39) introduced for Best Self / Outcomes (place it directly after `Best Self`).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/onboarding` | `@Auth()` | — | `OnboardingState`: `{ step, completed, answers:{ sixMonthVision, domains, domainReflections, obstacles, weekdayMinutes, healthBaseline, coachingStyle }, pendingProposal, confidenceScore }` |
| POST | `/api/onboarding/start` | `@Auth()` | `{ timezone: string, locale?: string }` | `OnboardingState`; sets `timezone`/`locale`, `onboardingStep = VISION` if still `PROMISE`; 409 `ONBOARDING_ALREADY_COMPLETED` when done |
| PATCH | `/api/onboarding/answers` | `@Auth()` | merge patch: `{ step?: OnboardingStep, sixMonthVision?, domains?: Domain[] (non-empty, unique), domainReflections?, obstacles?, weekdayMinutes?: 5..240, healthBaseline?, coachingStyle? }` | `OnboardingState`; `step` (≠ `DONE`) records where the client now is; 409 when completed |
| POST | `/api/onboarding/propose` | `@Auth()` | `{}` | 200 `{ proposal, source:'ai' }` and stores `pendingProposal`; 412 `AI_KEY_REQUIRED`; 503 `AI_UNAVAILABLE {code,message,retryable}`; 400 `ONBOARDING_INCOMPLETE` if `sixMonthVision` or `domains` missing |
| POST | `/api/onboarding/confidence` | `@Auth()` | `{ score: 1..5 }` | 200 `{ proposal, reproposed: boolean, source }`; stores `confidenceScore`; when `score ≤ 2` re-invokes the planner with the reduce-load instruction and replaces `pendingProposal` (template source: applies `reduceTemplate()` instead) |
| POST | `/api/onboarding/approve` | `@Auth()` | `{ proposal: OnboardingProposal }` (the pending one, possibly edited) | 201 `{ bestSelfId, outcomeIds[], planVersionIds[], routineIds[], commitmentIds[] }`; 409 `ONBOARDING_ALREADY_COMPLETED` on a second call; 400 `PROPOSAL_INVALID` (schema / guardrail / window) |
| POST | `/api/onboarding/skip-ai` | `@Auth()` | `{}` | 200 `{ proposal, source:'template' }`; stores `pendingProposal` |

Zod contract (`onboarding-proposal.schema.ts`, also the gateway `schema` with `schemaName: 'onboarding_proposal'`):

```ts
export const onboardingProposalSchema = z.object({
  bestSelf: z.object({
    identityStatement: z.string().min(10).max(300),
    workIdentity: z.string().max(200).optional(),
    familyIdentity: z.string().max(200).optional(),
    healthIdentity: z.string().max(200).optional(),
    sixMonthVision: z.string().max(1000),
  }),
  outcomes: z.array(z.object({
    domain: domainEnum, title: z.string().max(120),
    whyItMatters: z.string().max(400), successDefinition: z.string().max(400),
  })).max(3),
  routines: z.array(z.object({
    domain: domainEnum, title: z.string().max(120),
    triggerType: z.enum(['AFTER', 'AT_TIME', 'WEEKDAYS']), triggerValue: z.string().max(80),
    frequency: z.string().max(40), idealMinutes: z.number().int().min(5).max(120),
    minimumMinutes: z.number().int().min(2).max(60), fallbackBehavior: z.string().max(200),
  })).max(3),
  firstWeekCommitments: z.array(z.object({
    domain: domainEnum, title: z.string().max(120), scheduledStart: z.string().datetime(),
    durationMinutes: z.number().int().min(5).max(180),
    fullVersion: z.string().max(200), shortVersion: z.string().max(200), minimumVersion: z.string().max(200),
  })).min(1).max(12),
  rationale: z.string().max(800),
  reducedFromRequest: z.boolean(),
});
```

Deterministic guardrails (`OnboardingProposalService.validate(proposal, answers)`, applied to AI output, templates and the edited proposal at approve): outcomes ≤ 1 per selected domain and only for selected domains; `routines.length ≤ 3` (PRD §70); `minimumMinutes ≤ idealMinutes`; every commitment's `scheduledStart` within `[now − 1 day, now + 8 days]` in the user's timezone; commitment domains ⊆ selected domains; sum of commitment `durationMinutes` on any single weekday ≤ `weekdayMinutes` when set (violations → 400 `PROPOSAL_INVALID` with a `details[]` list at approve; for AI output → `{ok:false}` treatment, i.e. 503 with `code:'schema'`).

Gateway call: `this.ai.invoke({ persona: 'planner', userId, promptVersion: 'onboarding-proposal.v1', instructions: ONBOARDING_INSTRUCTIONS, input: { today, timezone, answers, reduceLoad?: true, previousProposal? }, schema: onboardingProposalSchema, schemaName: 'onboarding_proposal' })`. `ONBOARDING_INSTRUCTIONS` (constant in `onboarding-proposal.service.ts`) states: one outcome per selected domain, ≤3 routines total, first-week commitments only inside the next 7 days with times inside the user's `weekdayMinutes`, write full/short/minimum versions, be conservative — the plan must survive a bad week; when `reduceLoad` is true: cut total weekly minutes by at least a third or drop one routine, keep the domains, set `reducedFromRequest: true`. Error mapping: `no_user_key` → 412 `AI_KEY_REQUIRED` (reuse `AiKeyRequiredException` from `apps/api/src/ai/gateway/ai-errors.ts`); everything else → 503 `AI_UNAVAILABLE` with `retryable` true for `rate_limit|timeout|network|provider` and false for `ai_disabled|no_model|schema|refusal`.

Templates (`onboarding-templates.ts`, pure, exported `buildTemplateProposal(answers, now, timezone)` and `reduceTemplate(proposal)`): per selected domain — Work: outcome "Protect my most important work", routine "Start the most important task before email" `WEEKDAYS`/`Mon,Wed,Fri`, ideal 25 / minimum 10, fallback "Open the task and write the first sentence"; Family: outcome "Be present with the people I care about", routine "Phone-free dinner" `WEEKDAYS`/`Tue,Thu,Sun`, ideal 30 / minimum 10, fallback "Ten minutes of undivided attention"; Health: outcome "Train consistently", routine "Three 30-minute strength sessions" `WEEKDAYS`/`Mon,Wed,Sat` (or the user's `healthBaseline.daysPerWeek` capped at 3 and `minutesPerSession`), minimum 10, fallback "A 10-minute walk". Commitments: the next 7 days' occurrences at 07:30 (Work), 18:30 (Family), 07:00 (Health) local time, clamped to `weekdayMinutes`. `bestSelf.identityStatement` is composed from the selected domains ("I start important work before I become reactive. I give my family protected attention. I train consistently.") and `sixMonthVision` is echoed. `rationale` explains it is a starting template. `reduceTemplate` drops the routine with the highest `idealMinutes × sessions` and halves the remaining commitments' durations (min 10).

Approve (`OnboardingService.approve(userId, proposal)`), one `prisma.$transaction`: re-validate; 409 if `onboardingCompletedAt` is set; create `BestSelfProfile` (E02-02 (#39) service or direct create — identity statements + vision); per outcome create `Outcome` (`state` active, `successDefinition`), a `Plan` and its `PlanVersion` `{ version: 1, status: 'ACTIVE', createdBy: source === 'ai' ? 'AI' : 'USER', userApproved: true, rationale: proposal.rationale, expectedWeeklyLoad: sum of that domain's routine minutes × sessions, fallbackStrategy: joined fallbacks }`; per routine create `Routine` under the domain's plan; per commitment create `Commitment` `{ status: 'PLANNED', scheduledStart, durationMinutes, full/short/minimumVersion, routineId when the title matches a routine }`; `DomainMode` rows `GROW` for selected domains; profile `onboardingStep = DONE`, `onboardingCompletedAt = now()`, `pendingProposal = null`; audit `prisma.auditEvent.create({ action: 'onboarding:approved', targetType: 'user_profile', targetId: profile.id, meta: { source, outcomes, routines, commitments, edited: boolean, confidenceScore } })` — after the transaction. `source` is taken from the stored `pendingProposal` (`'ai'`/`'template'`), not from the request body. Idempotency decision: the second call returns **409 `ONBOARDING_ALREADY_COMPLETED`** (not a silent no-op) so a client that raced two submits can tell; the UI treats 409 as "already done" and navigates to `/`.

Log one line per propose/approve (`Onboarding propose user=<id> source=<ai|template> routines=<n> commitments=<n> reduced=<bool>`), never the answers.

**UI (frontend-dev)** — n/a here; `services/api.ts` functions are added by E04-03 (#102) (`getOnboardingState`, `startOnboarding`, `patchOnboardingAnswers`, `proposeOnboarding`, `submitOnboardingConfidence`, `approveOnboarding`, `skipOnboardingAi`).

**Tests (testing-dev)**
- `onboarding-proposal.schema.spec.ts`: accepts the fake server's fixture; rejects 4 routines, 2 outcomes for one domain, `minimumMinutes > idealMinutes`, a `scheduledStart` 30 days out.
- `onboarding-templates.spec.ts`: each domain subset yields exactly one outcome and one routine per domain; commitments fall inside 7 days in `America/Costa_Rica` and `Asia/Tokyo`; `reduceTemplate` lowers total minutes and keeps ≥1 commitment; output passes `onboardingProposalSchema` and the guardrails.
- `onboarding-proposal.service.spec.ts` (gateway mocked): calls `invoke` with `persona:'planner'`, `promptVersion:'onboarding-proposal.v1'`, `schemaName:'onboarding_proposal'`; `reduceLoad` present only for confidence ≤ 2; `{ok:false, code:'no_user_key'}` → 412; `{ok:false, code:'timeout'}` → 503 `retryable:true`; `{ok:true}` with a guardrail-violating output → 503 `code:'schema'` and nothing stored.
- `onboarding.service.spec.ts`: `approve` writes inside one `$transaction` (spy), sets `DONE`/`onboardingCompletedAt`, clears `pendingProposal`, audits once with `source` from the stored proposal; second call → 409; `PATCH` rejects `step: 'DONE'` and an empty `domains`.
- `apps/api/test/onboarding.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true })` + `overrideProviders` for `AiGatewayService`): 401 unauthenticated on every route; `start` → `PATCH` → `GET` round-trip preserves answers; `propose` with stubbed `{ok:true}` stores `pendingProposal` and creates zero `outcome`/`commitment` rows; `approve` creates rows and returns ids; `approve` again → 409; `skip-ai` works with the gateway stub returning `{ok:false}`.

**Docs (docs-dev)** — `docs/API.md` new "Onboarding" section (all 7 routes, error codes); `CLAUDE.md` "API Endpoints" list; `docs/specs/onboarding.md` is written by E04-06 (#107) — leave a TODO pointer in the PR, not a partial file.

#### Acceptance criteria
- [ ] `POST /api/onboarding/start` creates the profile row, stores `timezone`/`locale`, and moves `onboardingStep` to `VISION`
- [ ] `PATCH /api/onboarding/answers` merges partial answers; unknown keys are rejected (400) and `GET /api/onboarding` returns the merged state after a new login
- [ ] `POST /api/onboarding/propose` returns a proposal with one outcome per selected domain and ≤3 routines, and stores it only on `user_profiles.pending_proposal` — `outcomes`, `plans`, `routines`, `commitments` gain no rows
- [ ] `POST /api/onboarding/confidence {score:2}` returns `reproposed: true` and a proposal with fewer total weekly minutes than the previous one; `{score:4}` returns `reproposed: false`
- [ ] `POST /api/onboarding/approve` persists Best Self, outcomes, plan v1 (`ACTIVE`, `userApproved: true`, `createdBy` per source), routines and first-week commitments atomically, sets `onboardingCompletedAt`, clears `pendingProposal`, and writes one `onboarding:approved` audit row
- [ ] A second `approve` returns 409 `ONBOARDING_ALREADY_COMPLETED` and creates nothing
- [ ] An edited proposal that adds a fourth routine is rejected with 400 `PROPOSAL_INVALID` and a `details[]` entry naming the guardrail
- [ ] `POST /api/onboarding/skip-ai` returns a valid template proposal without calling the gateway, and `approve` accepts it with `createdBy: USER`
- [ ] With no user key, `propose` returns 412 `AI_KEY_REQUIRED`; with the fake server forcing `timeout`, 503 `AI_UNAVAILABLE` with `retryable: true`
- [ ] No answers, vision text or proposal content appear in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures never surface as 500; every 4xx carries a stable `code`; `$transaction` failures roll back completely and leave `onboardingCompletedAt` null
- [ ] Observability: one log line per propose/approve as specified; the gateway writes the `ai_invocations` row; audit `onboarding:approved`
- [ ] Security: all routes `@Auth()`; every query scoped by the caller's `userId`; `source` never trusted from the body; proposal text is user-generated content — stored, never interpreted
- [ ] Config & secrets: none new; the timezone is validated with `Intl.DateTimeFormat(undefined, { timeZone })` in a try/catch (400 `INVALID_TIMEZONE`)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–3, then obtain a token (`/testing/login` sets one; copy from devtools or use `appctl login`).
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"timezone":"America/Costa_Rica"}' http://localhost:3535/api/onboarding/start` → `step: "VISION"`.
3. `curl -X PATCH … -d '{"step":"DOMAINS","sixMonthVision":"Stop wasting mornings, be present at dinner, get back in shape","domains":["WORK","FAMILY","HEALTH"],"weekdayMinutes":45,"coachingStyle":"BALANCED"}' http://localhost:3535/api/onboarding/answers` → merged state.
4. `curl -X POST … http://localhost:3535/api/onboarding/propose` → proposal; `select count(*) from outcomes;` unchanged; `select pending_proposal->'routines' from user_profiles;` shows ≤3.
5. `curl -X POST … -d '{"score":2}' …/confidence` → `reproposed: true`. `-d '{"score":4}'` → `false`.
6. `curl -X POST … -d "{\"proposal\": $(curl … /api/onboarding | jq .data.pendingProposal)}" …/approve` → 201 with ids; repeat → 409.
7. `docker compose stop fake-openai`; new user; steps 2–3; `propose` → 503; `skip-ai` → template; `approve` → 201; `select created_by from plan_versions` → `USER`.

#### Out of scope
- Any UI (E04-03 (#102)/04), the route gate (E04-05 (#106)), e2e (E04-06 (#107))
- Editing outcomes/plans after approval (E02-06 (#56) Path screen, E06 proposals)
- Notification preferences — step 9 is client-only (browser permission) in this epic

#### Notes for the implementing agent
- Gateway contract and error codes: `apps/api/src/ai/gateway/ai-gateway.types.ts`, `ai-errors.ts` (E01-06 (#26)). Never call the provider directly and never catch-and-rethrow gateway results as 500.
- Persist through E02's services where they exist (`apps/api/src/best-self/`, `apps/api/src/outcomes/`, `apps/api/src/plans/`, `apps/api/src/commitments/` per E02-02 (#39)..04) if they accept a `tx` client; otherwise use `prisma` directly inside the `$transaction` — do not nest a service's own `$transaction` inside yours.
- Field names on `PlanVersion`/`Routine`/`Commitment` are E02-01 (#36)'s; check `schema.prisma` before writing the create payloads rather than trusting this text.
- Zod via `nestjs-zod` `createZodDto` (see `apps/api/src/test-auth/dto/test-login.dto.ts`); no class-validator. Fastify, not Express: no `res.json`.
- Audit pattern: `apps/api/src/email/email-settings.service.ts` (`prisma.auditEvent.create` with `action '<domain>:<verb>'`).
- Register the `Onboarding` tag in `apps/api/src/openapi/tags.ts` or `test/openapi/openapi-document.spec.ts` fails on the undeclared tag.
- Dates: compute "the next 7 days" in the user's timezone with `Intl.DateTimeFormat` parts or the `date-fns-tz` dependency only if E02 already added one — do not add a date library for this issue alone.

---

### E04-03 `feat(web): add the onboarding wizard at /onboarding with per-step persistence` — #102

**Part of epic:** E04 · **Blocked by:** E04-01 (#100), E04-02 (#101) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §19 says onboarding "must not feel like a form" and must take 5–8 minutes; PRD §20 fixes nine screens; PRD §123 makes the phone the primary device. The web app has no onboarding surface at all — a new user today lands on the Today placeholder with nothing in it. The wizard must save each step (PRD §102: "the initial plan must persist after session ends" starts with the answers persisting) so a refresh or a phone lock resumes where the user left off.

#### Proposed solution
A full-screen page `apps/web/src/pages/OnboardingPage.tsx` (new) at `/onboarding`, mounted like `/setup/ai-key` (inside `ProtectedRoute` and `RequireAiKey`, outside `NotificationProvider`/`Layout` — E04-05 (#106) finalises the tree). It renders a `MobileStepper`-style progress (dots on `< sm`, a labelled `Stepper` on `≥ sm`), a `Back` button on every step after the first, and one component per step under `apps/web/src/components/onboarding/` (new):

| # | `OnboardingStep` | Component | Content (PRD §20) | Saved via `PATCH /onboarding/answers` |
|---|---|---|---|---|
| 1 | `PROMISE` | `PromiseStep` | "Become who you want to be." + explainer; CTA `Build my Path` | `POST /onboarding/start` with `Intl.DateTimeFormat().resolvedOptions().timeZone` and `navigator.language` |
| 2 | `VISION` | `VisionStep` | multiline `TextField` (min 20 chars to continue), helper text; no mic | `{ step:'DOMAINS', sixMonthVision }` |
| 3 | `DOMAINS` | `DomainsStep` | three selectable `Card`s (Work / Family / Health) with the §20 prompts; each selected card expands a reflection `TextField`; ≥1 selected to continue | `{ step:'REALITY', domains, domainReflections }` |
| 4 | `REALITY` | `RealityStep` | "What usually gets in the way?" — 8 `Chip`s (`OBSTACLE_OPTIONS` labels), multi-select; `OTHER` reveals a short text field | `{ step:'TIME', obstacles }` |
| 5 | `TIME` | `TimeRealityStep` | `Slider` 10–120 min (step 5) with marks 15/30/45/60/90 and the §20 question; shows "≈ N hours a week" | `{ step: HEALTH selected ? 'HEALTH_BASELINE' : 'COACHING_STYLE', weekdayMinutes }` |
| 6 | `HEALTH_BASELINE` | `HealthBaselineStep` (only when `HEALTH` ∈ domains) | experience radio, days/week (1–7 toggle buttons), minutes/session slider, equipment chips (None, Dumbbells, Barbell, Bands, Gym, Bike/Treadmill), preferences text, limitations text with the "avoid medical detail" hint | `{ step:'COACHING_STYLE', healthBaseline }` |
| 7 | `COACHING_STYLE` | `CoachingStyleStep` | radio group with the three §20 descriptions (Gentle / Balanced / Direct) | `{ step:'PROPOSAL', coachingStyle }` |
| 8 | `PROPOSAL` | `ProposalStep` — **E04-04 (#104)** | proposal review | E04-04 (#104) |
| 9 | `NOTIFICATIONS` | `NotificationValueStep` | the §20 value-exchange paragraph, then `Allow notifications` (calls `requestBrowserNotificationPermission` from `services/browserNotifications.ts`, refreshes via `useBrowserNotificationPermission`) and `Not now`; `Finish` → `refreshUser()` → `navigate('/')` | none (client-only) |

State: `useOnboarding()` hook in `apps/web/src/hooks/useOnboarding.ts` (new) loads `GET /onboarding` on mount, exposes `{ state, isLoading, error, start, saveAnswers, propose, submitConfidence, approve, skipAi }`; every `saveAnswers` optimistically advances the local step and reverts with an inline error `Alert` on failure. On mount the wizard jumps to `state.step` (a `DONE` state navigates to `/`). `Back` moves the local step only and does not PATCH (the previous answers are already saved; moving forward again re-saves). `apps/web/src/services/api.ts` gains the seven functions listed in E04-02 (#101); `apps/web/src/types/index.ts` gains `OnboardingStep`, `OnboardingState`, `OnboardingAnswers`, `HealthBaseline`, `CoachingStyle`, `OnboardingProposal`, `ObstacleKey`.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E04-02 (#101)).

**UI (frontend-dev)** — route `<Route path="/onboarding" element={<OnboardingPage />} />` in `apps/web/src/App.tsx` next to `/setup/ai-key`. No registry card (it is not a settings page). Layout: a centred `Container maxWidth="sm"`, the step content in a `Card` ≥ `sm` and edge-to-edge below `sm`; the primary CTA is a full-width `Button` pinned to the bottom below `sm` (safe-area padding) and inline ≥ `sm`. Keyboard: `Enter` in single-line fields advances; focus moves to the step heading on each step change (`tabIndex={-1}` + `ref.focus()`); the stepper announces "Step N of 9" via `aria-live="polite"`; chips are `role="checkbox"` with `aria-checked`. No use of the five coupled breakpoint gates — the page is outside `Layout`.

**Tests (testing-dev)** — `apps/web/src/__tests__/pages/OnboardingPage.test.tsx` (new, MSW handlers in `__tests__/mocks/handlers.ts` with mutable onboarding state): renders step 1 for a fresh state; `Build my Path` POSTs `start` with a timezone and shows step 2; `Next` on step 2 is disabled under 20 chars and PATCHes `{step:'DOMAINS', sixMonthVision}`; step 3 requires ≥1 domain; step 5 → step 7 skips 6 when Health is not selected; remount with `state.step:'TIME'` opens step 5; `Back` from step 5 shows step 4 without a PATCH; a failed PATCH shows the error and stays on the step; `useOnboarding.test.ts` (new) covers optimistic advance/revert. Wire test `OnboardingPage.wire.test.tsx` asserts the exact PATCH bodies per step.

**Docs (docs-dev)** — `docs/specs/onboarding.md` (E04-06 (#107) writes it; this issue adds its screen table to the PR description).

#### Acceptance criteria
- [ ] A user with `onboarding.completed === false` visiting `/onboarding` sees step 1 with the §20 copy and `Build my Path`
- [ ] Each of steps 2–7 saves its answers with the specified PATCH body before the next step renders; a refresh reopens the wizard at the saved step with the previous answers filled in
- [ ] Step 6 appears only when Health was selected on step 3
- [ ] `Back` works on every step after the first and preserves entered values
- [ ] On a 375px-wide viewport, no horizontal scroll, the CTA is reachable without scrolling past the keyboard, and the stepper shows dots; at 1024px the labelled stepper shows
- [ ] Step 9 explains before prompting; the browser permission prompt fires only on the `Allow notifications` click; `Finish` lands on `/` regardless of the permission outcome
- [ ] A user with `onboarding.completed === true` visiting `/onboarding` is redirected to `/`
- [ ] axe (`vitest-axe` as used by E02-05) reports no violations on any step

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: network/API failures render an inline `Alert` with a retry, never a blank page; a 409 from `start`/`answers` (already completed) navigates to `/`
- [ ] Observability: none beyond API logs
- [ ] Security: no answers stored in `localStorage`/`sessionStorage` — the server is the only state
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–6 (steps 7–8 need E04-04 (#104); until then, step 8 shows the "proposal coming in E04-04 (#104)" placeholder).
2. Resize to 375px (devtools device toolbar): repeat steps 2–7 — dots stepper, pinned CTA, no horizontal scroll.
3. On step 5, press `Back` twice, then `Next` twice: values are preserved and `PATCH` fires on each forward move (network tab).

#### Out of scope
- The proposal screen (E04-04 (#104)) and the route gate (E04-05 (#106))
- Voice input, images/attachments in onboarding
- Quiet-hours selection (E12-05 (#68))

#### Notes for the implementing agent
- Full-screen page pattern: `apps/web/src/pages/AiKeySetupPage.tsx` (E01-08 (#28)/09) and `apps/web/src/pages/ActivateDevicePage.tsx`.
- Permission prompt pattern to copy verbatim: `handleRequestPermission` in `apps/web/src/pages/UserNotificationsPage.tsx` (request inside the click handler, `refresh()` in `finally`, `useIsMounted` guard). Never call `Notification.requestPermission()` on mount.
- Add the MSW handlers next to the email-settings ones in `apps/web/src/__tests__/mocks/handlers.ts`; the mutable-state pattern is already there.
- Pitfall: `AuthContext.refreshUser()` must run before `navigate('/')` on `Finish`, or E04-05 (#106)'s gate bounces the user straight back to `/onboarding`.
- Pitfall: this page is outside `Layout`, so do not import `useMediaQuery(down('sm'))` from the shell gates; a local `useMediaQuery` for dots-vs-labels is fine and is not one of the five coupled gates.

---

### E04-04 `feat(web): add the first-Path proposal review screen with inline edits and confidence check` — #104

**Part of epic:** E04 · **Blocked by:** E04-02 (#101), E04-03 (#102) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §20 step 8 shows "Your first Path" — one outcome per domain, one initial commitment/routine each, the sentence "I intentionally kept this smaller than what you asked for. I want the first plan to survive a bad week.", `Start this Path` and `Adjust`. PRD §72 requires the 1–5 confidence question before activating a major plan and a reduced plan when the answer is low; PRD §102 requires that the user can modify the plan before approving; PRD §120 requires the flow to work with AI down. Without this screen the wizard cannot complete.

#### Proposed solution
`apps/web/src/components/onboarding/ProposalStep.tsx` (new) rendered by `OnboardingPage` for `onboardingStep === 'PROPOSAL'`, plus `ProposalSection.tsx`, `CommitmentEditRow.tsx`, `ConfidenceQuestion.tsx` (new) in the same folder.

Flow inside the step:
1. On entry with no `pendingProposal`: call `propose()`. Show a skeleton with "Building your first Path…" (`aria-busy`). On 503: an `Alert` "The coach is unavailable right now" with `Try again` and `Continue without AI` (→ `skipAi()`); on 412: link to `/settings/ai-key` (rare — the gate should have caught it).
2. Render the proposal: heading "Your first Path"; a Best Self card (`identityStatement` large, the per-domain identities as secondary lines); one `ProposalSection` per selected domain with the outcome (title + `whyItMatters` + `successDefinition`), its routine(s) (title, trigger, ideal/minimum minutes, fallback), and its first-week commitments; then the rationale quote (verbatim `proposal.rationale`, prefixed with the §20 sentence "I intentionally kept this smaller than what you asked for. I want the first plan to survive a bad week." when `reducedFromRequest` is true, otherwise only the rationale); `source === 'template'` shows a small "Starting template — the coach will refine this once it is back" chip.
3. `Adjust` toggles edit mode: each commitment row becomes `CommitmentEditRow` (title `TextField`, date-time picker limited to the next 7 days, duration `Select` 5–120). Routines and outcomes are read-only in this epic. `Remove` on a commitment is allowed down to one. Edits are local until approve; the `edited` flag is derived by deep-equality against the stored proposal.
4. `ConfidenceQuestion`: "How confident are you that you can do this in a difficult week?" with five `ToggleButton`s (1–5, labelled ends "Not at all" / "Very"). Selecting calls `submitConfidence(score)`; when the response has `reproposed: true` the screen replaces the proposal, discards local edits with a snackbar "I made it smaller — take another look", and re-asks the question once (a second ≤2 does not loop: the API reduces again but the UI proceeds).
5. `Start this Path` (disabled until a confidence score is set) calls `approve(proposal)`; on 201 PATCHes nothing (the API already set `DONE`) and advances to step 9; on 409 navigates to `/`; on 400 `PROPOSAL_INVALID` shows the `details[]` under the offending section.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E04-02 (#101) contract).

**UI (frontend-dev)** — no new route (part of `/onboarding`). Responsive: sections stack in one column at every width (the page is `maxWidth="sm"`); commitment rows are a card each below `sm` and a compact row ≥ `sm`. a11y: sections are `<section aria-labelledby>`; confidence buttons form a `radiogroup`; the rationale is a `<blockquote>`; the re-proposal swap is announced through `aria-live`. `apps/web/src/types/index.ts` gains `OnboardingProposal` sub-types if E04-03 (#102) has not already.

**Tests (testing-dev)** — `apps/web/src/__tests__/components/onboarding/ProposalStep.test.tsx` (new, MSW): proposes on mount and renders one section per domain; shows the §20 sentence only when `reducedFromRequest`; 503 shows both recovery buttons and `Continue without AI` renders the template with the chip; `Adjust` → edit a commitment time → `Start this Path` sends the edited `scheduledStart` (wire assertion) and the section count unchanged; confidence 2 → MSW returns `reproposed:true` → new proposal rendered, snackbar shown; `Start this Path` disabled until a score is chosen; 409 on approve navigates to `/`; 400 with `details` renders them.

**Docs (docs-dev)** — `docs/specs/onboarding.md` (E04-06 (#107)) describes the confidence loop; add the copy strings to the PR so docs-dev can quote them.

#### Acceptance criteria
- [ ] Entering step 8 fetches a proposal and renders "Your first Path" with the Best Self statement, one outcome per selected domain, routines and first-week commitments
- [ ] With the fake server forcing `timeout`, the step offers `Try again` and `Continue without AI`; the latter renders the deterministic template and approval succeeds
- [ ] `Adjust` lets the user change a commitment's title, time (within 7 days) and duration, and remove commitments down to one; the approved data reflects the edits
- [ ] A confidence answer of 1 or 2 replaces the proposal with a smaller one and shows the snackbar; 3–5 keeps it
- [ ] `Start this Path` is disabled until a confidence score is chosen and advances to step 9 on success
- [ ] The "I intentionally kept this smaller than what you asked for…" sentence appears when `reducedFromRequest` is true
- [ ] Nothing is persisted to outcomes/plans/commitments until `Start this Path` (verified by E04-06 API check)
- [ ] Works at 375px and 1024px with no horizontal scroll; axe passes

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 412/503/400/409 each have a distinct, actionable UI state; proposal fetch failures never lose already-saved answers
- [ ] Observability: none client-side
- [ ] Security: the proposal is rendered as text (no HTML), including AI-generated strings
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–8 with the fake server up; confirm the edited time survives in `select scheduled_start from commitments`.
2. Epic script step 10 (fake server stopped) for the template path.
3. On step 8 answer 1 → observe the re-proposal and snackbar; answer 5 → `Start this Path` enables.

#### Out of scope
- Editing outcomes and routines before approval (Path screen E02-06 (#56) and E06 proposals handle later edits)
- Diff rendering between proposals (E06-07 (#86)'s proposal cards)
- Persisting the confidence score anywhere but `user_profiles.confidence_score`

#### Notes for the implementing agent
- The date-time input: use MUI's native `type="datetime-local"` `TextField` with `min`/`max` attributes rather than adding `@mui/x-date-pickers` unless E02 already added it.
- Deep-equality for `edited`: a small local helper; do not add lodash.
- Keep copy strings in `apps/web/src/components/onboarding/copy.ts` (new) so E04-06 (#107)'s e2e spec and docs quote one source.
- Pitfall: after `approve` succeeds, do not call `refreshUser()` yet — step 9 still needs to render inside the wizard; E04-03 (#102)'s `Finish` handler refreshes and navigates.

---

### E04-05 `feat(web): gate the app shell behind onboarding completion after the AI key gate` — #106

**Part of epic:** E04 · **Blocked by:** E04-01 (#100), E04-03 (#102), E01-09 (#29) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §102 lists "see Today screen" as the last onboarding outcome, and PRD §101 (Day 0) has the user arrive at Today only after their first Path exists. Today with no commitments is an empty screen and Path with no Best Self is an empty tree. The route tree in `apps/web/src/App.tsx` gates on authentication (`ProtectedRoute`) and on the OpenAI key (`RequireAiKey`, E01-09 (#29)) but nothing sends a signed-in, keyed, un-onboarded user to `/onboarding`.

#### Proposed solution
`apps/web/src/components/common/RequireOnboarding.tsx` (new), a sibling of `RequireAiKey`:

```tsx
export function RequireOnboarding() {
  const { user } = useAuth();
  const location = useLocation();
  if (user && !user.onboarding.completed) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
```

Route tree in `App.tsx` becomes:

```
<Route element={<ProtectedRoute />}>            // signed in?
  <Route path="/activate" … />                  // exempt from both gates
  <Route path="/setup/ai-key" … />              // exempt from both gates
  <Route element={<RequireAiKey />}>            // key configured?
    <Route path="/onboarding" element={<OnboardingPage />} />   // exempt from RequireOnboarding only
    <Route element={<RequireOnboarding />}>     // first Path approved?
      <Route element={<NotificationProvider><Layout /></NotificationProvider>}>
        … all shell routes, including /settings/ai-key and /admin/*
      </Route>
    </Route>
  </Route>
</Route>
```

Ordering rules, stated in a comment block in `App.tsx` in the style of the existing ones: (1) `ProtectedRoute` before everything — an anonymous user never sees a setup page; (2) `RequireAiKey` before `RequireOnboarding` — step 8 needs the key, so a user without one must fix that first; (3) `/onboarding` sits inside `RequireAiKey` and outside `RequireOnboarding`, so removing the key mid-onboarding bounces to `/setup/ai-key` and returns via `state.from`; (4) `/settings/ai-key` stays inside both gates — an un-onboarded user manages the key at `/setup/ai-key`; (5) admins are gated too (no role exemption) — an admin who has not onboarded is still a user of the product. `OnboardingPage` itself redirects a completed user to `/` (E04-03 (#102)), so the exemption cannot be used to re-run onboarding.

The visual harness `apps/web/visual/main.tsx` fake user gets `onboarding: { completed: true }` (E04-01 (#100) added the field; confirm here) and a new `?onboarding=incomplete` harness param is **not** added — the wizard is covered by Vitest, not visual baselines.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a.

**UI (frontend-dev)** — `RequireOnboarding.tsx` as above; `App.tsx` tree; comment block. No registry change, no `DESTINATIONS` change (the wizard is not a destination). The five coupled breakpoint gates are untouched.

**Tests (testing-dev)**
- `apps/web/src/__tests__/components/common/RequireOnboarding.test.tsx` (new, modelled on `RequireAiKey.test.tsx` / `ProtectedRoute.test.tsx`): renders the outlet when `completed: true`; navigates to `/onboarding` with `state.from` when `false`; renders nothing (no redirect loop) when `user` is null (ProtectedRoute's job).
- `apps/web/src/__tests__/App.test.tsx` route-order cases with a mocked `AuthContext` value: (a) anonymous → `/login` for `/`, `/onboarding`, `/setup/ai-key`; (b) signed in, no key, not onboarded → `/setup/ai-key` for `/` and for `/onboarding`; (c) key, not onboarded → `/onboarding` for `/`, `/settings`, `/settings/ai-key`, `/admin/settings`; `/onboarding` renders; `/activate` renders; (d) key + onboarded → `/` renders `HomePage`; `/onboarding` redirects to `/`; (e) no key + onboarded → `/setup/ai-key`.
- `apps/web/src/__tests__/pages/OnboardingPage.test.tsx`: the completed-user redirect (if not already in E04-03 (#102)).

**Docs (docs-dev)** — `docs/specs/settings-ui.md` gains a short "Route gates" subsection listing the three gates and their exemptions (or `docs/specs/onboarding.md` §Gating in E04-06 (#107) with a cross-link — pick one, cross-link from the other); `CLAUDE.md` "Architecture Principles" gets one line: "Route gates: `ProtectedRoute → RequireAiKey → RequireOnboarding → Layout`; exemptions `/activate`, `/setup/ai-key`, `/onboarding`."

#### Acceptance criteria
- [ ] A signed-in user with a key and `onboarding.completed === false` is redirected from `/`, `/settings`, `/settings/ai-key` and `/admin/settings` to `/onboarding`
- [ ] The same user can open `/onboarding` and `/activate` directly
- [ ] A signed-in user without a key is redirected to `/setup/ai-key` from `/onboarding` (key gate wins)
- [ ] After `Finish` (which calls `refreshUser()`), `/` renders the Today placeholder without a reload
- [ ] A completed user visiting `/onboarding` lands on `/`
- [ ] An anonymous visitor to `/onboarding` lands on `/login` and returns to `/onboarding` after signing in (via `state.from` → `auth_return_url`)
- [ ] All five route-order test groups pass; `Layout.test.tsx` and the visual baselines are unchanged

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: `user.onboarding` missing at runtime (older API) is treated as `completed: true` with a `console.warn` — never a redirect loop
- [ ] Observability: none
- [ ] Security: gating is UX only; every API route remains independently authorised
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 3–4 (bounces from `/`, `/settings`, `/settings/ai-key`).
2. While on `/onboarding`, open `/settings/ai-key` in the URL bar → bounced to `/onboarding`. Remove the key via `curl -X DELETE …/api/me/ai-key`, reload → `/setup/ai-key`; re-add → back on `/onboarding` at the saved step.
3. Complete onboarding (E04-04 (#104)) → `/`; type `/onboarding` → `/`.

#### Out of scope
- Any change to `ProtectedRoute` or `RequireAiKey` behaviour
- Role-based exemptions
- Server-side redirects

#### Notes for the implementing agent
- Copy `apps/web/src/components/common/RequireAiKey.tsx` (E01-09 (#29)) and its test file; the shape and the `state={{ from }}` convention are identical.
- `App.tsx` comment blocks are load-bearing documentation in this repo — write the ordering rationale there, matching the existing tone.
- Do not touch `Layout.tsx`, `BottomNav`, `SettingsHub.tsx`, `AppBar.tsx` (the five coupled gates).
- Pitfall: `NotificationProvider` must stay inside `RequireOnboarding` so the SSE stream is not opened for a user still in the wizard (one mount point rule in `App.tsx`).

---

### E04-06 `test(tests): E04 end-to-end verification` — #107

**Part of epic:** E04 · **Blocked by:** E04-02 (#101), E04-04 (#104), E04-05 (#106), E01-10 (#30), E02-05 (#51) · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → backend-dev → docs-dev

#### Problem statement
Every epic must be provable end to end (DB + API + UI) against the fake OpenAI server (E01-10 (#30)). PRD §102's acceptance list — define desired self, choose domains, receive/modify/approve a plan, select coaching style, configure notifications, see Today, and "the initial plan must persist after session ends" — needs one Playwright run that exercises the real API, the real database and the wizard, plus the spec document the next epics (E05 Today, E12 quiet hours) will read.

#### Proposed solution
**Test login switch.** `apps/api/src/test-auth/dto/test-login.dto.ts` gains `withOnboarding: z.boolean().optional().default(true)`; `TestAuthService.loginAsTestUser` (non-production only, as with E01-10 (#30)'s `withAiKey`) calls `UserProfileService.getOrCreate` and, when `withOnboarding`, sets `onboardingStep: 'DONE'`, `onboardingCompletedAt: now()` so **every existing spec still lands on `/`**; `false` leaves the profile fresh. `apps/web/src/pages/TestLoginPage.tsx` adds a checkbox "Mark onboarding complete" (`data-testid="test-with-onboarding"`, default checked). `tests/e2e/helpers/auth.helper.ts` `TestUserOptions` gains `withOnboarding?: boolean` (default `true`); `loginAsTestUser` unticks the box when `false` and waits for `/onboarding` instead of `/`.

**Fake server fixture.** `tools/fake-openai/server.mjs` (E01-10 (#30)) gains a canned response for `schemaName === 'onboarding_proposal'` (selected by the `text.format.name` in the request): a valid proposal for `WORK`/`FAMILY`/`HEALTH` with 3 routines and 3 commitments dated relative to "now" (the server computes them so the 7-day window always holds); when the request `input` contains `reduceLoad: true` it returns 2 routines with `reducedFromRequest: true`. Header `x-fake-behaviour: timeout` still forces the failure path.

**Spec** `tests/e2e/specs/onboarding.spec.ts` (new):
1. `completes onboarding with the AI proposal and lands on Today with persisted commitments` — `loginAsTestUser(page, { email: 'onboard-<runId>@test.local', withAiKey: true, withOnboarding: false })` → expect `/onboarding` and the §20 promise copy → `Build my Path` → vision text → select all three domains + reflections → obstacles `PROCRASTINATE`, `TOO_AMBITIOUS` → slider 45 → health baseline (Beginner, 3 days, 30 min, Dumbbells) → Balanced → step 8 renders "Your first Path" with three sections → API check via `page.request.get('/api/onboarding')`: `pendingProposal` present; `page.request.get('/api/commitments?from=…&to=…')` (E02-04 (#47)) returns 0 → confidence 4 → `Start this Path` → step 9 → `Not now` → `Finish` → `/` renders the Today placeholder → API: `/api/commitments` returns 3 `PLANNED` in the next 7 days; `/api/auth/me` `onboarding.completed === true` → `page.reload()` → still `/` (persistence after session).
2. `resumes at the saved step after a reload` — stop after step 4, `page.reload()`, expect step 5.
3. `low confidence yields a smaller proposal` — reach step 8, answer 2, expect the "I made it smaller" snackbar and 2 routines rendered; answer 4; approve.
4. `edits a commitment before approving` — `Adjust`, change the first commitment's duration to 15, approve, API check `durationMinutes === 15`.
5. `completes without AI via the template path` — route `**/v1/responses` through `page.route` to return 503 (or set `x-fake-behaviour` via the E01-10 (#30) mechanism) → step 8 shows `Continue without AI` → template renders → approve → `/` with 3 commitments; API `/api/plans/...` shows `createdBy: 'USER'`.
6. `gate order` — `withAiKey: false, withOnboarding: false` → `/setup/ai-key`; then a `withAiKey: true, withOnboarding: true` user visiting `/onboarding` → `/`.

Cleanup: each test uses a unique email; no teardown needed (test DB is disposable) — same convention as `ai-key-gate.spec.ts`.

**Data (database-dev)** — n/a.

**API (backend-dev)** — `withOnboarding` on the test login DTO/service (non-production module only); no production surface changes.

**UI (frontend-dev)** — the `TestLoginPage` checkbox only.

**Tests (testing-dev)** — the six Playwright cases above; `apps/api/src/test-auth/test-auth.service.spec.ts`: `withOnboarding` default marks the profile done, `false` leaves it fresh; `apps/web/src/__tests__/pages/TestLoginPage.test.tsx` (extend if present): checkbox default checked and posted as `withOnboarding`.

**Docs (docs-dev)** — `docs/specs/onboarding.md` (new): purpose + PRD/VISION refs; the nine screens with their `OnboardingStep` values and PATCH bodies; the `user_profiles` columns and JSON schemas; the proposal Zod contract and guardrails; the confidence loop; the template fallback; the approve transaction and idempotency (409) decision; the route gate order and exemptions; rejected alternatives (proposal in domain tables with a `draft` flag — rejected because every list query would need a filter; onboarding state in `user_settings` JSONB — rejected because E05/E12 need typed columns); testing notes. `docs/API.md` (Onboarding section, `withOnboarding` under Test Authentication); `docs/TESTING.md` ("E2E Testing with Playwright": fake server + `withOnboarding` + how to run `onboarding.spec.ts`); `docs/epics/README.md` back-link row for E04 → `docs/specs/onboarding.md`; `CLAUDE.md` endpoint list if E04-02 (#101) did not already.

#### Acceptance criteria
- [ ] `tests/e2e/specs/onboarding.spec.ts` passes against `base + dev + fake-openai` compose with a migrated, seeded database
- [ ] Every pre-existing e2e spec passes unchanged (the `withOnboarding` default keeps them landing on `/`)
- [ ] Case 1 proves zero commitments before approval and exactly 3 `PLANNED` commitments after, through the API
- [ ] Case 5 completes onboarding with the AI failing and the resulting plan version has `createdBy: 'USER'`
- [ ] Case 2 proves resume after reload; case 4 proves the edited duration persisted
- [ ] `docs/specs/onboarding.md` exists and is linked from `docs/epics/README.md` and `docs/API.md`
- [ ] `docs/TESTING.md` documents how to run the onboarding e2e locally

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: the spec fails loudly (no `test.skip`) when the fake server is unreachable — assert `/api/health/ready` and the fake `/v1/models` first
- [ ] Observability: none
- [ ] Security: `withOnboarding` is only reachable through the non-production `TestAuthModule` (`app.module.ts` conditional registration)
- [ ] Config & secrets: none new; documents `OPENAI_BASE_URL` from `fake-openai.compose.yml`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–2.
2. `cd tests/e2e && npx playwright test specs/onboarding.spec.ts --reporter=list` → 6 passed.
3. `npx playwright test` → the full suite passes, including `auth.spec.ts` and `ai-key-gate.spec.ts`.
4. Run the epic script steps 3–11 by hand once and compare the DB checks with what the spec asserted.

#### Out of scope
- CI workflow (declined for this roadmap; local runs only)
- Visual baselines for the wizard
- Load/latency testing of the planner call

#### Notes for the implementing agent
- Follow `tests/e2e/specs/ai-key-gate.spec.ts` (E01-10 (#30)) for the fake-server setup, `withAiKey` plumbing through `TestLoginPage` and `auth.helper.ts`, and the API-check style with `page.request`.
- The fake server must keep returning `gpt-5.4` in `/v1/models` so the admin default model set in E01's manual script still resolves; add the onboarding canned response without changing existing behaviours.
- Pitfall: Playwright's `page.fill` on the MUI `Slider` does not work — use keyboard arrows on the thumb or `page.locator('[role=slider]').press('ArrowRight')` in a loop.
- Pitfall: the browser notification prompt in step 9 blocks headless runs if triggered — the spec clicks `Not now`, never `Allow notifications`.
- Write `docs/specs/onboarding.md` in the voice of `docs/specs/vps-deploy.md` (decisions and rejected alternatives, not a tutorial).

---
