# E10 — Weekly Review & Weekly Planning

<!-- epic-meta: slug=weekly-review-planning phase=4 -->

## Epic

### Goal

Close the PRD §135 weekly loop — *review plan → compare planned vs done → identify friction → learn pattern → adjust plan → approve next week* — as a product ritual rather than a chat. Every week EvolvePath compares what was planned with what actually happened (VISION Part VIII §29), a deterministic aggregation produces the numbers, the `weekly_reviewer` persona produces the PRD §14.6 six outputs (what worked, what did not, patterns, proposed changes, keep unchanged, do not add yet), and any proposed change travels through E06's mutation protocol so the user — never the model — creates the next plan version (PRD §15). The same screen then runs the PRD §50 seven-step Weekly Planning flow: constraints, one primary focus, domain modes (PRD §49), proposed commitments, the PRD §48 cross-domain load check ("you already have eight recurring commitments"), and **Approve next week**, which materialises next week's commitments so Monday's Today screen is already populated. When this epic closes, "a failed plan is information" (VISION §29, principle P5) is a weekly, testable behaviour of the product.

### Background

- **What exists by E10 (dependency graph E01→…→E09→E10).** Domain state from E02: `Outcome`, `Plan`/`PlanVersion` (`DRAFT|ACTIVE|SUPERSEDED|REJECTED`, `createdBy USER|AI`, `previousVersionId`, `rationale`), `Routine` (belongs to a `PlanVersion`; `frequency DAILY|WEEKDAYS|WEEKENDS|WEEKLY|CUSTOM`, `daysOfWeek Int[]`, `preferredTime 'HH:mm'`, `estimatedDurationMin`, `minimumDurationMin`, `fallbackBehavior`, `active`), `Commitment` (nine-state `CommitmentStatus`, `rescheduleCount` carried onto the new row by E02-04's reschedule, `routineId`, `planVersionId`, `scheduledStart`), `Evidence` (`source USER_LOG|TIMER|WORKOUT_LOG|APP_FLOW`), `Reflection` (`relatedType 'day'`, `frictionTags String[]`, E05-03), `DomainMode` (`GROW|MAINTAIN|RECOVER|PAUSE`, `PUT /api/me/domain-modes/:domain`, `DomainModesService.set`, E02-02). E05-02 adds `Commitment.versionUsed FULL|SHORT|MINIMUM`, `startedAt`, `minutesSpent` and the `fallback` action — the aggregation reads those columns. E07-02 adds `focus_sessions`, E09 adds `workout_sessions`; E07-05 (`GET /work/summary`) and E08-03 (`GET /family/summary`) compute per-domain weekly numbers for their own screens — E10 does **not** call those endpoints, it reads the same tables in one pure function so the three domains are aggregated identically (PRD §14.6 "domain balance").
- **Profile.** `user_profiles` (E04-01): `timezone`, `coachingStyle GENTLE|BALANCED|DIRECT`, `weekdayMinutes`, `onboardingCompletedAt`; `UserProfileService.getOrCreate/update`. E04 shipped no general `PATCH /me/profile`; the review day/time settings this epic adds get their own endpoints in the weekly module.
- **AI.** `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` (E01-06, `apps/api/src/ai/gateway/ai-gateway.service.ts`) returns `{ok:true, invocationId, output}` or `{ok:false, invocationId, error:{code,message}}` and never throws for provider problems. `weekly_reviewer` is already in `apps/api/src/ai/ai-personas.ts` (E01-02, tier `reasoning`). Context comes from `ContextAssemblerService.assemble(userId, 'planner')` + `renderForPrompt` (E06-02); prompts are versioned constants (`apps/api/src/coach/prompts/coach.prompt.ts` is the model). Chain of thought is never stored (PRD §88).
- **Mutation protocol.** `ProposalsService.createFromSource(userId, sourceKind, {planId, summary, changes, invocationId})` (E06-04, `apps/api/src/coach/proposals/proposals.service.ts`) with `sourceKind: 'WEEKLY_REVIEW'` (enum member already declared in E06-01's `ProposalSourceKind`), `planChangeSchema` (`apps/api/src/coach/proposals/plan-change.schema.ts`), and `POST /api/proposals/:id/accept|edit|reject`. The web `PlanChangeDiff` and `ProposalCard` components (`apps/web/src/components/coach/`, E06-07) are exported for this epic. `PatternAnalysisService.proposeInsights(userId)` (E06-05) is the hook E10 calls after each review.
- **Scheduling.** `@nestjs/schedule` is registered (`ScheduleModule` in `apps/api/src/app.module.ts`); the pattern to copy is `apps/api/src/auth/tasks/token-cleanup.task.ts` (`@Cron(CronExpression.EVERY_DAY_AT_3AM)` on an `@Injectable()` task class registered in its module's `providers`).
- **Local time.** `apps/api/src/today/local-date.ts` (E05-01) has `localDate(now, timeZone)` and `localDayBounds` built on `Intl.DateTimeFormat`, no date library. Weeks in this epic are **Monday-start, in the user's timezone**, and are addressed by the local Monday as a `'YYYY-MM-DD'` string (the same representation E05-03 chose for `daily_check_ins.dateLocal`).
- **Notifications.** `NotificationsService.notify(eventKey, userId, data)` is detached and never throws; `findEvent(key)` (`apps/api/src/notifications/notification-events.ts`) answers whether an event is registered. E12-02 registers the coaching events including `coach.weekly_review_ready` (PRD §60 N8 "Your week is ready to review"); E10 calls `notify` only when `findEvent` finds it.
- **Web shell.** `DESTINATIONS` (E02-05, `apps/web/src/config/destinations.ts`): `progress` owns `/progress` (placeholder `ProgressPage`, E11 makes it real). Every route under `/progress/*` is already owned by `progress`, so this epic adds routes without touching `DESTINATION_ROUTES`. Settings cards live in `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`) and render through `SettingsHub`; the compact AppBar drill-down table is `resolveDrillDown` in `apps/web/src/components/navigation/AppBar.tsx` (E02-06 added the first non-settings entry). The five coupled breakpoint gates (CLAUDE.md rule 5) are not touched.
- **Patterns to copy.** Ownership-checked per-user resources: `apps/api/src/pat/` (plain `@Auth()`, own rows only; `apps/api/src/path/owned-resource.ts` from E02-02). Audit: direct `prisma.auditEvent.create` as in `apps/api/src/email/email-settings.service.ts`. Zod DTOs via `createZodDto` (`apps/api/src/email/dto/update-email-settings.dto.ts`). OpenAPI tags in `apps/api/src/openapi/tags.ts` (`EvolvePath` group created by E02). Integration harness `apps/api/test/helpers/test-app.helper.ts` (`createTestApp({ overrideProviders })`). Fake OpenAI server `tools/fake-openai/server.mjs` + `scenarios/` (E01-10, E06-09).
- Design rationale and rejected alternatives are written by E10-05 in `docs/specs/weekly-review.md` (new).

### Scope

- [ ] E10-01 `feat(db): add weekly reviews, weekly plans and review-rhythm profile fields`
- [ ] E10-02 `feat(api): add weekly review generation with deterministic aggregation, reviewer persona and scheduled runs`
- [ ] E10-03 `feat(api): add weekly planning flow with constraints, domain modes, load check and approve`
- [ ] E10-04 `feat(web): add Weekly Review screen, Weekly Planning wizard and Weekly rhythm settings`
- [ ] E10-05 `test(tests): E10 end-to-end verification`

### Out of scope

- Momentum states, consistency runs, recovery latency and the Progress screen itself (E11). The review shows planned-vs-done counts, never a momentum label or a score of worth (VISION §30).
- The `coach.weekly_review_ready` event definition, browser/push copy and quiet-hour policy (E12-02/E12-03). E10 only calls `notify()` when the event exists.
- Automatic `MISSED` marking of stale commitments (E11-02 comeback loop). Until then, past `PLANNED`/`READY` rows are aggregated as `unresolved`, not `missed`.
- Calendar import of fixed events (PRD §69, later V1/V2); constraints are typed by the user.
- AI-worded commitment titles in weekly planning (the `planner` persona). Materialisation is deterministic from routines; wording help is a P1 follow-up noted in E10-03.
- Editing routines or plan versions from the review screen beyond accepting/editing/rejecting proposals (Path, E02-06, owns that).
- Multi-week look-back trends, exports, sharing (PRD §78, §79 later).

### Sequencing

- **Critical path:** E10-01 → E10-02 → E10-03 → E10-04 → E10-05.
- E10-02 and E10-03 both extend `apps/api/src/weekly/` (`WeeklyModule`, `tags.ts`, `docs/API.md`); run them sequentially to avoid merge conflicts. E10-03's pure `materialize-week.ts` and `load-check.ts` can be written before E10-02 lands, but its module wiring waits.
- E10-04 needs both API children (the screen renders a review; the wizard drives a plan). Its settings page needs only E10-02's `/weekly/settings`.
- E10-05 is last and additionally depends on E01-10 (fake server) and E06-09's scenario matcher.

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`, leave `WEEKLY_LOAD_SOFT_CAP` unset (default 8).
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build`. Second shell: `docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:migrate` then `… exec api npm run prisma:seed`. Expect `add_weekly_reviews` in the applied list; `psql … -c '\dt'` lists `weekly_reviews`, `weekly_plans`; `\d user_profiles` shows `weekly_review_weekday` (default 0) and `weekly_review_time` (default `17:00`).
3. http://localhost:3535/testing/login → `week-owner@test.local`, role `contributor`, AI-key checkbox ticked (E01-10), "Mark onboarding complete" ticked (E04-06). You land on `/`.
4. Seed this week through the API (`evopath login`, then `evopath api …` as in E05's script, or `curl` with the bearer token): a HEALTH outcome → `POST /api/outcomes/:id/plans` with one routine "Strength workout" (`frequency CUSTOM`, `daysOfWeek [1,3,6]`, `preferredTime '18:30'`, 40/15 min, fallback "10-minute circuit") and a WORK outcome with routine "Morning focus block" (`WEEKDAYS`, `07:30`, 50/10 min). Create this week's commitments dated Monday–today: five WORK at 07:30 (complete four via `POST /api/commitments/:id/actions/complete`, skip one with reason `TOO_MUCH`), three HEALTH at 18:30 (complete one, `fallback {version:'minimum'}` + complete a second, reschedule the third twice via `actions/reschedule`), three FAMILY quick-adds at 19:00 (complete two, skip one `UNEXPECTED_CONFLICT`). Add one day reflection `POST /api/today/reflection {quickOption:'BAD_TIMING'}`.
5. `curl -X POST …/api/weekly/reviews/generate -d '{}'` → 200 with `status: 'READY'`, `aggregates.domains.WORK.completed = 4`, `aggregates.domains.WORK.planned = 5`, `aggregates.domains.HEALTH.fallbackUsed = 1`, `aggregates.rescheduleLeaders[0].rescheduleCount = 2`, `aiSummary.source = 'ai'`, `proposalIds.length = 1`. `psql`: `SELECT status, week_start, jsonb_array_length(ai_summary->'patterns') FROM weekly_reviews;` → `READY`, this Monday, ≥ 1; `SELECT source_kind, status FROM plan_change_proposals;` → `WEEKLY_REVIEW`, `PROPOSED`; `SELECT count(*) FROM ai_invocations WHERE persona='weekly_reviewer';` → 1.
6. Open http://localhost:3535/progress/week — **Your Week** shows three tiles "Work 4 / 5", "Family 2 / 3", "Health 2 / 3"; sections **What worked**, **What got in the way**, **Pattern** (one card labelled *Observation* with an *Inference* and *Recommendation* line and a confidence chip), **Recommendation** with one proposal card ("Move Wednesday workout to Saturday morning") rendering the `PlanChangeDiff` table with **Accept / Edit / Keep current plan**, and **Next week** with the **Approve next week** CTA. The **Keep unchanged** and **Not yet** lists appear under Recommendation.
7. Click **Accept** → chip "Plan updated (v2)". `/path` → HEALTH outcome → history shows v2 ACTIVE (rationale contains the summary), v1 SUPERSEDED. `psql`: `SELECT status FROM plan_change_proposals;` → `ACCEPTED`.
8. Back on `/progress/week`, click **Approve next week** → wizard at `/progress/week/plan`. Step 1 *Constraints*: add travel day = next Wednesday, fixed event "Dentist" next Friday 10:00–11:00. Step 2 *Focus*: "Ship the proposal draft". Step 3 *Domain modes*: set FAMILY → MAINTAIN. Step 4 *Commitments*: list grouped by day shows WORK Mon/Tue/Thu/Fri (Wednesday absent — travel day), HEALTH Mon/Sat (Saturday from the accepted v2 move), summary "2 recurring commitments · ~4h 20m". **Add commitment** seven times (any domain, `recurring` ticked) → after the 9th recurring item an alert appears: "You already have 9 recurring commitments this week. I recommend replacing something rather than adding another habit." Remove one → alert disappears. Step 5 *Approve* → **Approve next week**.
9. `psql`: `SELECT status, approved_at, domain_modes->>'FAMILY' FROM weekly_plans;` → `APPROVED`, non-null, `MAINTAIN`; `SELECT mode FROM domain_modes WHERE domain='FAMILY';` → `MAINTAIN`; `SELECT status FROM weekly_reviews;` → `APPROVED`; `SELECT count(*) FROM commitments WHERE scheduled_start >= '<next Monday 00:00 local as UTC>' AND status='PLANNED';` → 6 (4 WORK + 2 HEALTH) plus the extras you kept; `SELECT action FROM audit_events WHERE action LIKE 'weekly_%' ORDER BY created_at;` → `weekly_review:generate`, `weekly_plan:create`, `weekly_plan:update` ×3, `weekly_plan:propose`, `weekly_plan:approve`.
10. `/path` → WORK outcome → **Upcoming commitments** lists next week's four focus blocks. Wait until next Monday (or trust step 9): `/` shows "Morning focus block" as the Next Best Action.
11. Re-run step 5's `generate` → 409 `WEEKLY_REVIEW_APPROVED`. Approve nothing else; `curl -X POST …/api/weekly/plans -d '{}'` for the same week → 409 `WEEKLY_PLAN_APPROVED`.
12. Settings: `/settings` → card **Weekly rhythm** → set day *Friday*, time *16:00* → Save → `psql`: `SELECT weekly_review_weekday, weekly_review_time FROM user_profiles;` → `5`, `16:00`. The page shows "Next review: Friday 16:00 (<timezone>)".
13. AI down: `docker compose … stop fake-openai`; `curl -X POST …/api/weekly/reviews/generate -d '{"weekStart":"<last Monday>"}'` → 200, `status READY`, `aiSummary.source = 'template'`, `proposalIds = []`, `whatWorked` non-empty (numbers-only sentences). `/progress/week?weekStart=<last Monday>` renders with the caption "Summary written from your numbers — the coach was unavailable". `docker compose … start fake-openai`.
14. Cron: `docker compose … exec api sh -c "grep -c 'Weekly review sweep' /proc/1/fd/1 || true"` is not observable directly; instead set the profile day/time to the current local weekday and the current hour via step 12, wait for the next `:00`, then `psql`: `SELECT trigger FROM audit_events WHERE action='weekly_review:generate' ORDER BY created_at DESC LIMIT 1;` → meta `trigger: 'cron'` (the API log shows `Weekly review sweep candidates=1 generated=1`).
15. Resize below 600px: tiles stack, the wizard's stepper turns vertical, BottomNav stays visible, the AppBar shows a back arrow titled "Your Week" on `/progress/week` and "Plan next week" on `/progress/week/plan`.

## Child issues

### E10-01 `feat(db): add weekly reviews, weekly plans and review-rhythm profile fields`

**Part of epic:** E10 · **Blocked by:** none (needs E02-01, E04-01, E06-01 merged) · **Component:** database, api · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §50 makes weekly planning "a core ritual" on a "recommended day/time chosen by user", PRD §51 fixes the review screen's structure, and PRD §14.6 fixes the six reviewer outputs. None of that has a home: there is no table that says which week was reviewed, what the numbers were, what the coach concluded, which proposals came out of it, or what the user approved for next week — and `user_profiles` (E04-01) has no review day/time. Without durable rows the review cannot be regenerated safely, cannot be scheduled, and "approve next week" has nothing to approve.

#### Proposed solution

Two tables keyed by `(userId, weekStart)`, two enums, two profile columns, one migration, and the Zod schemas that type every JSON column at the boundary.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`, new block `// Weekly review & planning (epic E10)` after E06's models:

```prisma
enum WeeklyReviewStatus { GENERATING READY APPROVED SKIPPED }
enum WeeklyPlanStatus   { DRAFT APPROVED }

model WeeklyReview {
  id            String             @id @default(uuid()) @db.Uuid
  userId        String             @map("user_id") @db.Uuid
  weekStart     String             @map("week_start") @db.VarChar(10)   // local Monday, 'YYYY-MM-DD'
  status        WeeklyReviewStatus @default(GENERATING)
  aggregates    Json               @default("{}")                       // weekAggregatesSchema
  aiSummary     Json?              @map("ai_summary")                   // weeklyReviewSummarySchema
  proposalIds   String[]           @default([]) @map("proposal_ids")    // PlanChangeProposal ids; no FK (E06-04 expires/prunes)
  invocationId  String?            @map("invocation_id")                // ai_invocations id; plain string (telemetry, prunable)
  generatedAt   DateTime?          @map("generated_at") @db.Timestamptz
  approvedAt    DateTime?          @map("approved_at") @db.Timestamptz
  createdAt     DateTime           @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime           @updatedAt @map("updated_at") @db.Timestamptz
  user          User               @relation("UserWeeklyReviews", fields: [userId], references: [id], onDelete: Cascade)
  plans         WeeklyPlan[]       @relation("WeeklyPlanReview")
  @@unique([userId, weekStart])
  @@index([userId, status])
  @@map("weekly_reviews")
}

model WeeklyPlan {
  id                  String           @id @default(uuid()) @db.Uuid
  userId              String           @map("user_id") @db.Uuid
  weekStart           String           @map("week_start") @db.VarChar(10)
  reviewId            String?          @map("review_id") @db.Uuid
  primaryFocus        String?          @map("primary_focus")            // ≤ 200 chars (Zod)
  constraints         Json             @default("{}")                   // weeklyPlanConstraintsSchema
  domainModes         Json             @default("{}") @map("domain_modes") // weeklyDomainModesSchema
  proposal            Json?                                             // weeklyPlanProposalSchema (E10-03)
  status              WeeklyPlanStatus @default(DRAFT)
  approvedAt          DateTime?        @map("approved_at") @db.Timestamptz
  createdAt           DateTime         @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime         @updatedAt @map("updated_at") @db.Timestamptz
  user                User             @relation("UserWeeklyPlans", fields: [userId], references: [id], onDelete: Cascade)
  review              WeeklyReview?    @relation("WeeklyPlanReview", fields: [reviewId], references: [id], onDelete: SetNull)
  @@unique([userId, weekStart])
  @@index([userId, status])
  @@map("weekly_plans")
}
```

`User` gains `weeklyReviews WeeklyReview[] @relation("UserWeeklyReviews")` and `weeklyPlans WeeklyPlan[] @relation("UserWeeklyPlans")`. `UserProfile` (E04-01) gains:

```prisma
  weeklyReviewWeekday Int    @default(0)       @map("weekly_review_weekday") // 0 = Sunday … 6 = Saturday
  weeklyReviewTime    String @default("17:00") @map("weekly_review_time")    // 'HH:mm' local
```

Migration: `cd apps/api && npm run prisma:migrate:dev -- --name add_weekly_reviews`, then hand-append to the generated SQL a check constraint Prisma cannot express: `ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_weekly_review_weekday_range" CHECK ("weekly_review_weekday" BETWEEN 0 AND 6);` (introspection ignores check constraints, so it is not reported as drift). `npm run prisma:generate`. Seed (`apps/api/prisma/seed.ts`): no change.

Zod boundary file `apps/api/src/weekly/weekly.schema.ts` (new):

```ts
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);          // 'YYYY-MM-DD'
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const domainEnum = z.enum(['WORK','FAMILY','HEALTH']);            // mirrors Prisma `Domain` (E02-01)
export const domainModeEnum = z.enum(['GROW','MAINTAIN','RECOVER','PAUSE']);
export const domainCountsSchema = z.object({ planned: z.number().int(), completed: z.number().int(), partial: z.number().int(), missed: z.number().int(), unresolved: z.number().int(), skipped: z.number().int(), rescheduled: z.number().int(), started: z.number().int(), fallbackUsed: z.number().int(), minutesPlanned: z.number().int(), minutesSpent: z.number().int(), completionRate: z.number().min(0).max(1) });
export const timeWindowEnum = z.enum(['early_morning','morning','midday','afternoon','evening','night']);
export const weekAggregatesSchema = z.object({
  weekStart: isoDate, timezone: z.string(), coverage: z.object({ from: z.string().datetime(), to: z.string().datetime(), partial: z.boolean() }),
  domains: z.object({ WORK: domainCountsSchema, FAMILY: domainCountsSchema, HEALTH: domainCountsSchema }),
  totals: domainCountsSchema,
  timeWindows: z.array(z.object({ window: timeWindowEnum, planned: z.number().int(), completed: z.number().int(), successRate: z.number().min(0).max(1) })),
  weekdays: z.array(z.object({ weekday: z.number().int().min(0).max(6), planned: z.number().int(), completed: z.number().int() })).length(7),
  rescheduleLeaders: z.array(z.object({ commitmentId: z.string().uuid(), title: z.string(), domain: domainEnum, rescheduleCount: z.number().int() })).max(5),
  focusStarts: z.object({ planned: z.number().int(), started: z.number().int(), completed: z.number().int() }),
  workouts: z.object({ planned: z.number().int(), completed: z.number().int(), fallbackUsed: z.number().int(), sessionsLogged: z.number().int() }),
  frictionTags: z.array(z.object({ tag: z.string(), count: z.number().int() })),
});
export const reviewPatternSchema = z.object({ observation: z.string().min(1).max(240), inference: z.string().max(240).nullable(), recommendation: z.string().max(240).nullable(), confidence: z.number().min(0).max(1), domain: domainEnum.nullable() });
export const weeklyReviewOutputSchema = z.object({
  whatWorked: z.array(z.string().min(1).max(240)).max(5),
  whatDidNot: z.array(z.string().min(1).max(240)).max(5),
  patterns: z.array(reviewPatternSchema).max(3),
  proposedChanges: z.array(z.object({ planId: z.string().uuid(), summary: z.string().min(1).max(300), changes: z.array(planChangeSchema).min(1).max(10) })).max(3), // planChangeSchema from E06-04
  keepUnchanged: z.array(z.string().min(1).max(240)).max(5),
  doNotAddYet: z.array(z.string().min(1).max(240)).max(3),
});
export const weeklyReviewSummarySchema = weeklyReviewOutputSchema.extend({ source: z.enum(['ai','template']), promptVersion: z.string().nullable(), generatedAt: z.string().datetime() });
export const weeklyPlanConstraintsSchema = z.object({
  travelDays: z.array(isoDate).max(7).default([]),
  fixedEvents: z.array(z.object({ date: isoDate, title: z.string().min(1).max(120), startTime: hhmm.nullable(), endTime: hhmm.nullable() })).max(20).default([]),
  notes: z.string().max(500).nullable().default(null),
});
export const weeklyDomainModesSchema = z.object({ WORK: domainModeEnum, FAMILY: domainModeEnum, HEALTH: domainModeEnum }).partial();
```

Export inferred types (`WeekAggregates`, `WeeklyReviewOutput`, `WeeklyReviewSummary`, `WeeklyPlanConstraints`, `WeeklyDomainModes`). `weeklyPlanProposalSchema` is declared by E10-03 in the same file.

**API (backend-dev)** — no endpoints. Add the two Prisma delegates to `apps/api/test/mocks/prisma.mock.ts` (`weeklyReview`, `weeklyPlan`) and extend `UserProfileService.update` (E04-01) so the typed partial accepts `weeklyReviewWeekday` and `weeklyReviewTime`. Run `npm run prisma:generate` and `npm run typecheck`.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**
- `apps/api/src/weekly/weekly.schema.spec.ts` (new): `weekAggregatesSchema` accepts a full fixture and rejects `completionRate: 1.2`, a `weekdays` array of length 6, a `rescheduleLeaders` array of 6; `weeklyReviewOutputSchema` rejects a pattern without `observation`, a `proposedChanges` entry with an empty `changes` array, a `planId` that is not a uuid; `weeklyPlanConstraintsSchema` defaults `travelDays`/`fixedEvents` to `[]` and rejects `date: '2026-9-1'`; `hhmm` rejects `24:00`.
- `apps/api/test/prisma/weekly-schema.integration.spec.ts` (new, real DB as in E02-01's schema spec): create user → review → plan with `reviewId`; second review with the same `(userId, weekStart)` → `P2002`; deleting the review sets `weekly_plans.review_id` to null; deleting the user cascades both tables; `weekly_review_weekday = 7` on `user_profiles` raises a check-constraint violation; defaults read back as `GENERATING`, `DRAFT`, `{}`, `[]`, `0`, `'17:00'`.
- Existing `apps/api/test/openapi/openapi-document.spec.ts` still passes (no controllers added).

**Docs (docs-dev)** — `CLAUDE.md` "Database Tables": add `weekly_reviews`, `weekly_plans` (one line each) and note the two new `user_profiles` columns; `docs/ARCHITECTURE.md` data-model list.

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on a clean database applies `add_weekly_reviews` with no manual step; `\dt` lists `weekly_reviews` and `weekly_plans`; `\d user_profiles` shows `weekly_review_weekday integer default 0` and `weekly_review_time text default '17:00'`.
- [ ] A second `npm run prisma:migrate:dev` immediately afterwards proposes no new migration (the check constraint is not drift).
- [ ] Two reviews for the same user and `week_start` are rejected by the unique index; two users may share a `week_start`.
- [ ] Deleting a user removes their reviews and plans; deleting a review leaves its plan with `review_id NULL`.
- [ ] `weekly_review_weekday` outside 0–6 is rejected by the database, not only by Zod.
- [ ] `aggregates`, `ai_summary`, `constraints`, `domain_modes`, `proposal` are `jsonb`; `proposal_ids` is `text[]`.
- [ ] `apps/api/src/weekly/weekly.schema.ts` exports every schema listed above and its spec passes; `npm run typecheck` passes in `apps/api`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (enum members, table and column names byte-identical to the block above — E10-02..05 and `docs/specs/weekly-review.md` cite them)
- [ ] Error handling: n/a (schema only); migration is forward-only and idempotent under `prisma migrate deploy`
- [ ] Observability: n/a
- [ ] Security: both tables carry `user_id` with `ON DELETE CASCADE`; JSON columns hold product data only (no email, no free text beyond what the user typed as constraints/focus)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–2.
2. `psql … -c '\d weekly_reviews'` → unique index on `(user_id, week_start)`, `ai_summary jsonb`, `proposal_ids text[]`; `\d weekly_plans` → FK `review_id` with `ON DELETE SET NULL`.
3. `psql … -c "UPDATE user_profiles SET weekly_review_weekday = 9"` → `ERROR: … violates check constraint "user_profiles_weekly_review_weekday_range"`.
4. `docker compose … exec api npm run prisma:migrate:dev -- --name probe` → "Already in sync".

#### Out of scope

- Services, endpoints, the cron task (E10-02); materialisation and load check (E10-03).
- A `weekStartsOn` preference (weeks are Monday-start; a Sunday-start option is P1 and would be one more profile column).
- Backfilling reviews for weeks before the migration.

#### Notes for the implementing agent

- `weekStart` is a `'YYYY-MM-DD'` **string**, not `@db.Date`: a `Date` column round-trips through Prisma as UTC midnight and shifts by a day for users west of Greenwich; E05-03 made the same call for `daily_check_ins.date_local`. Validate it with `isoDate` at every boundary.
- `proposalIds` is deliberately a string array without a FK: E06-04 marks proposals `EXPIRED` lazily and they may be pruned; the review must survive that. Write a short comment above the model in the style of the `PlanChangeProposal` comment (E06-01).
- `weeklyReviewOutputSchema` imports `planChangeSchema` from `apps/api/src/coach/proposals/plan-change.schema.ts` (E06-04) — do not redeclare the change shape.
- Use `npm run prisma:migrate:dev -- --name add_weekly_reviews --create-only` first, append the `CHECK`, then apply. Never bare `npx prisma`.
- Self-explanatory `@map` snake_case on every column, `@@map` plural tables, `@db.Timestamptz` on every `DateTime` — the E02-01 conventions.

---

### E10-02 `feat(api): add weekly review generation with deterministic aggregation, reviewer persona and scheduled runs`

**Part of epic:** E10 · **Blocked by:** E10-01, E06-02, E06-04, E06-05, E05-02, E05-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

VISION §29: every week the product must compare "what we planned" with "what actually happened" and then help answer what worked, what did not, what patterns are emerging, what should stay, what should change and what should not be added yet. PRD §14.6 fixes those six outputs and the reviewer's inputs (plan, commitments, evidence, misses, reasons, workouts, notification interactions, domain balance); PRD §14.4 requires patterns to distinguish observation, inference and recommendation; PRD §29 gives the Work example ("4 of 5 focus sessions before 9 AM, 1 of 4 after 4 PM"); PRD §50 step 1 and §135 start the weekly loop from this review on a user-chosen day/time. PRD §120 requires the numbers when the model is down, and PRD §15 forbids the reviewer from changing plans itself. Nothing computes any of this today.

#### Proposed solution

A new `apps/api/src/weekly/` module: a pure aggregation function, a `weekly_reviewer` invocation with a strict six-output contract whose `proposedChanges` become `PlanChangeProposal`s through E06-04, a template fallback, an hourly sweep that generates reviews at each user's local review time, on-demand generation, and the review-rhythm settings endpoints.

**Data (database-dev)** — n/a (E10-01).

**API (backend-dev)**

Files (all new unless marked):
- `apps/api/src/weekly/weekly.module.ts` — imports `PrismaModule`, `AiModule`, `CoachModule` (for `ContextAssemblerService`, `ProposalsService`, `PatternAnalysisService` — add them to `CoachModule.exports` if E06 did not), `UserProfileModule`, `NotificationsModule`; providers `AggregationService`, `WeeklyReviewService`, `WeeklySettingsService`, `WeeklyReviewTask`; controllers `WeeklyReviewController`, `WeeklySettingsController`; exports `WeeklyReviewService`, `AggregationService`. Register in `app.module.ts`.
- `apps/api/src/weekly/week-bounds.ts` — pure: `weekStartFor(now: Date, timeZone: string): string` (local Monday `'YYYY-MM-DD'`, via `localDate` from `apps/api/src/today/local-date.ts` and `Intl` weekday), `weekBounds(weekStart: string, timeZone: string): { start: Date; end: Date }` (local Monday 00:00 → next Monday 00:00, `end` exclusive; built from `localDayBounds`), `addDays(isoDate, n)`, `localTimeParts(now, timeZone): { weekday: 0..6; hour; minute }`, `defaultReviewWeek(now, timeZone): string` — **Mon/Tue → previous week, Wed–Sun → the week in progress** (a Monday-morning review looks back; a Friday review covers the working week).
- `apps/api/src/weekly/aggregation.service.ts` — `AggregationService.load(userId, weekStart): Promise<AggregationInput>` (Prisma reads, `Promise.all`) and the **pure** `export function aggregateWeek(input: AggregationInput, opts: { now: Date; timeZone: string; weekStart: string }): WeekAggregates` where
  ```ts
  export interface AggregationInput {
    commitments: Array<Pick<Commitment,'id'|'domain'|'title'|'status'|'scheduledStart'|'scheduledEnd'|'rescheduleCount'|'routineId'|'versionUsed'|'startedAt'|'minutesSpent'> & { estimatedMinutes: number | null }>; // scheduledStart inside weekBounds
    evidence: Array<Pick<Evidence,'commitmentId'|'source'|'evidenceType'|'occurredAt'|'quantitativeValue'>>;
    reflections: Array<Pick<Reflection,'relatedType'|'frictionTags'|'createdAt'>>;
    focusSessions: Array<{ commitmentId: string | null; startedAt: Date; endedAt: Date | null; plannedMinutes: number }>;   // E07-02 `focus_sessions`
    workoutSessions: Array<{ commitmentId: string | null; startedAt: Date; finishedAt: Date | null; variant: 'FULL'|'SHORT'|'MINIMUM' | null }>; // E09-01 `workout_sessions`
  }
  ```
  Rules (all deterministic, documented in `docs/specs/weekly-review.md` by E10-05): `coverage.to = min(weekEnd, now)`, `coverage.partial = now < weekEnd`; rows with `scheduledStart > coverage.to` are excluded entirely (still upcoming). Per domain and in `totals`: `planned` = rows with status ∉ {`CANCELLED`, `RESCHEDULED`} (a rescheduled intention is counted once, on its live row); `completed` = `COMPLETED`; `partial` = `PARTIALLY_COMPLETED`; `missed` = `MISSED`; `unresolved` = `PLANNED|READY` with `scheduledStart < now`; `skipped` = `SKIPPED`; `rescheduled` = rows with status `RESCHEDULED` (closed originals); `started` = rows with `startedAt` set; `fallbackUsed` = `versionUsed ∈ {SHORT, MINIMUM}` among completed/partial; `minutesPlanned` = Σ `estimatedMinutes` (from `scheduledEnd − scheduledStart`, else the routine's `estimatedDurationMin`, else 0) over planned; `minutesSpent` = Σ `minutesSpent ?? 0`; `completionRate = planned ? (completed + 0.5 × partial) / planned : 0`. `timeWindows` bucket by local hour of `scheduledStart`: `early_morning` < 07, `morning` 07–11, `midday` 12–13, `afternoon` 14–17, `evening` 18–21, `night` ≥ 22; `successRate = (completed + partial) / planned` per window (0 when none). `weekdays` seven entries Sunday-first. `rescheduleLeaders` = live rows with `rescheduleCount ≥ 1`, sorted `rescheduleCount desc, title asc`, top 5. `focusStarts` counts WORK rows: `planned`, `started` (any `startedAt` or a focus session), `completed`. `workouts`: HEALTH rows `planned`/`completed`/`fallbackUsed` + `sessionsLogged = workoutSessions.length`. `frictionTags` = counts of every tag across `reflections` (day and commitment), sorted `count desc, tag asc`. Output must satisfy `weekAggregatesSchema` (assert in the service; a violation is a programming error → log + throw).
- `apps/api/src/weekly/contracts/weekly-review.contract.ts` — re-exports `weeklyReviewOutputSchema` as the gateway `schema` with `schemaName: 'weekly_review'`; `guardReviewOutput(output, allowed: { planIds: Set<string>; routineIds: Set<string>; commitmentIds: Set<string> }): { output: WeeklyReviewOutput; dropped: number }` — removes any `proposedChanges` entry whose `planId` or any `changes[].target.id` is not in the allowed sets (hallucination guard, PRD §90); never throws.
- `apps/api/src/weekly/prompts/weekly-reviewer.prompt.ts` — `export const WEEKLY_REVIEWER_PROMPT_VERSION = 'weekly_reviewer.v1'`; `buildWeeklyReviewerInstructions({ style }): string`: role (a coach reviewing one week against its plan, PRD §14.6); "authoritative data" block (the aggregates and context are the only truth; every id in `proposedChanges` must appear in the context; never claim a completion the numbers do not show); the six outputs with limits; pattern rule — each pattern is an **observation** in numbers, an optional **inference**, an optional **recommendation**, and a `confidence` (PRD §14.4); at most **one or two** proposed changes and they must reduce or move before they add (PRD §51 "Recommendation: one or two changes", VISION §29 example); `doNotAddYet` must be honest when `totals.planned ≥ WEEKLY_LOAD_SOFT_CAP`; tone block per `coachingStyle` copied from `apps/api/src/coach/prompts/coach.prompt.ts`; anti-manipulation and no-shame rules (PRD §129, VISION §12); no motivational speeches.
- `apps/api/src/weekly/weekly-review-templates.ts` — pure `buildTemplateSummary(aggregates, opts: { softCap: number }): WeeklyReviewOutput`: `whatWorked` = one sentence per domain with `completionRate ≥ 0.75` and `planned ≥ 1` ("Health: 3 of 3 workouts done") plus the best `timeWindow` with `planned ≥ 3`; `whatDidNot` = domains `< 0.5` with `planned ≥ 2`, the top reschedule leader ("'Strength workout' was moved 2 times"), the top friction tag; `patterns` = one observation when the best and worst windows (each `planned ≥ 3`) differ by ≥ 0.4 in `successRate` ("4 of 5 morning commitments done, 1 of 4 in the evening"), `inference: null`, `recommendation: null`, `confidence: 0.5`; `proposedChanges: []` (a template never proposes plan changes); `keepUnchanged` = the `whatWorked` domains; `doNotAddYet` = `["Nothing new this week — you already have N recurring commitments."]` when `totals.planned ≥ softCap`, else `[]`.
- `apps/api/src/weekly/weekly-review.service.ts` — `WeeklyReviewService`:
  - `generate(userId, { weekStart?, trigger: 'cron' | 'manual' }): Promise<WeeklyReviewDetail>` — `weekStart ??= defaultReviewWeek(now, tz)`; 400 `INVALID_WEEK_START` unless `isoDate` and a Monday; load existing row: `APPROVED` → 409 `WEEKLY_REVIEW_APPROVED`; `GENERATING` younger than 15 min → 409 `WEEKLY_REVIEW_IN_PROGRESS`; else upsert `status: GENERATING`. Then: `aggregates = aggregateWeek(await aggregation.load(...))`; `ctx = contextAssembler.assemble(userId, 'planner')`; `previous` = last `READY|APPROVED` review's `keepUnchanged`/`doNotAddYet`; `result = ai.invoke({ persona: 'weekly_reviewer', userId, promptVersion: WEEKLY_REVIEWER_PROMPT_VERSION, instructions, input: { weekStart, aggregates, context: renderForPrompt(ctx), previous }, schema: weeklyReviewOutputSchema, schemaName: 'weekly_review', reasoningEffort: 'medium' })`. `ok:true` → `guardReviewOutput` with ids from `ctx` → for each surviving `proposedChanges[i]`: `proposals.createFromSource(userId, 'WEEKLY_REVIEW', { planId, summary, changes, invocationId })` (each in its own try/catch — a 422 from the protocol drops that proposal and logs `weekly.review.proposal_rejected`) → `aiSummary = { ...output, proposedChanges: <kept>, source: 'ai', promptVersion, generatedAt }`. `ok:false` (any code, incl. `no_user_key`) → `aiSummary = { ...buildTemplateSummary(aggregates), source: 'template', promptVersion: null, generatedAt }`, `proposalIds: []`. Persist `status: READY`, `aggregates`, `aiSummary`, `proposalIds`, `invocationId`, `generatedAt`. After commit: `if (findEvent('coach.weekly_review_ready')) void notifications.notify('coach.weekly_review_ready', userId, { weekStart, link: '/progress/week?weekStart=' + weekStart })`; `void patternAnalysis.proposeInsights(userId).catch(log)`; audit `weekly_review:generate` `meta { weekStart, trigger, source, proposalCount, droppedProposals, invocationId, coveragePartial }`. Wrap the whole body so any thrown error resets the row to the previous status (or deletes a freshly created `GENERATING` row) — a review is never left `GENERATING` by an exception. Log `Weekly review user=<id> week=<weekStart> trigger=<t> source=<ai|template> proposals=<n> latencyMs=<ms>`; never the summary text.
  - `list(userId, { weekStart?, limit = 12 })`, `current(userId)` (latest by `weekStart desc`, `null` when none), `get(userId, id)` → detail = row + `proposals: ProposalDetail[]` (via `proposals.get` for each id; missing ids skipped) + `plan: { id, status } | null` (the `WeeklyPlan` for `addDays(weekStart, 7)`).
  - `skip(userId, id)` → `READY → SKIPPED` (409 otherwise); audit `weekly_review:skip`.
  - `markApproved(userId, weekStart, tx)` — used by E10-03's approve (`READY → APPROVED`, `approvedAt`; no-op when absent or already `APPROVED`).
- `apps/api/src/weekly/weekly-review.task.ts` — `WeeklyReviewTask` with `@Cron(CronExpression.EVERY_HOUR)` `handleCron()`: `profiles = prisma.userProfile.findMany({ where: { onboardingCompletedAt: { not: null } }, select: { userId, timezone, weeklyReviewWeekday, weeklyReviewTime } })`; for each, `parts = localTimeParts(now, timezone)`; candidate when `parts.weekday === weeklyReviewWeekday && parts.hour === Number(weeklyReviewTime.slice(0,2))`; skip when a review for `defaultReviewWeek(now, tz)` already exists with status ≠ `GENERATING`; run `generate(userId, { trigger: 'cron' })` sequentially in batches of 3 (`Promise.allSettled`), each failure logged with `userId` and continued. Log one line `Weekly review sweep candidates=<n> generated=<n> failed=<n>`. Skip the entire sweep when `process.env.WEEKLY_REVIEW_CRON_DISABLED === 'true'` (integration tests and the e2e stack set it to avoid background writes).
- `apps/api/src/weekly/weekly-settings.service.ts` + `weekly-settings.controller.ts` — `get(userId)` → `{ weeklyReviewWeekday, weeklyReviewTime, timezone, nextReviewAt }` (`nextReviewAt` = next local occurrence as ISO), `update(userId, dto)` via `UserProfileService.update`; audit `weekly_settings:update` `meta { from, to }`.
- `apps/api/src/weekly/weekly-review.controller.ts` — `@ApiTags('Weekly Review')`, `@Controller('weekly')`.
- DTOs (`apps/api/src/weekly/dto/`, `createZodDto`): `generate-review.dto.ts` `{ weekStart?: isoDate }`, `review-query.dto.ts` `{ weekStart?, limit?: 1..52 }`, `update-weekly-settings.dto.ts` `{ weeklyReviewWeekday: z.number().int().min(0).max(6), weeklyReviewTime: hhmm }`, `weekly-review-response.dto.ts` (`WeeklyReviewSummary` = row without `aggregates`/`aiSummary` bodies but with `counts: { WORK, FAMILY, HEALTH }: { planned, completed }`; `WeeklyReviewDetail` = full row + `proposals` + `plan`), `weekly-settings-response.dto.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/weekly/reviews/generate` | `@Auth()` own; throttle 5/hour/user (`apps/api/src/ai/gateway/test-throttle.ts` pattern) | `{ weekStart? }` | 200 `WeeklyReviewDetail`; 400 `INVALID_WEEK_START`; 409 `WEEKLY_REVIEW_APPROVED` / `WEEKLY_REVIEW_IN_PROGRESS`; 429 `RATE_LIMITED` |
| GET | `/api/weekly/reviews` | `@Auth()` | `?weekStart=&limit=` | 200 `{ items: WeeklyReviewSummary[] }` newest first |
| GET | `/api/weekly/reviews/current` | `@Auth()` | — | 200 `WeeklyReviewDetail \| null` |
| GET | `/api/weekly/reviews/:id` | `@Auth()` own → 404 | — | 200 `WeeklyReviewDetail` |
| POST | `/api/weekly/reviews/:id/skip` | `@Auth()` own | — | 200 `WeeklyReviewSummary` (`SKIPPED`); 409 `WEEKLY_REVIEW_NOT_SKIPPABLE` |
| GET | `/api/weekly/settings` | `@Auth()` | — | 200 `{ weeklyReviewWeekday, weeklyReviewTime, timezone, nextReviewAt }` |
| PUT | `/api/weekly/settings` | `@Auth()` | `{ weeklyReviewWeekday, weeklyReviewTime }` | 200 same shape |

OpenAPI: add `{ name: 'Weekly Review', description: 'Planned-versus-actual aggregates for one Monday-start week, the coach\'s six-part summary, and the plan-change proposals it raised. Generated on the user\'s chosen day and time or on demand; the numbers never depend on the model.' }` to the `EvolvePath` group in `apps/api/src/openapi/tags.ts`. Config: `apps/api/src/config/configuration.ts` gains `weekly: { loadSoftCap: Number(process.env.WEEKLY_LOAD_SOFT_CAP ?? 8), cronDisabled: process.env.WEEKLY_REVIEW_CRON_DISABLED === 'true' }`. Audit actions: `weekly_review:generate`, `weekly_review:skip`, `weekly_settings:update`.

**UI (frontend-dev)** — n/a (E10-04).

**Tests (testing-dev)**
- `apps/api/src/weekly/week-bounds.spec.ts`: `weekStartFor` returns a Monday in `America/Costa_Rica`, `Asia/Tokyo`, `UTC` for a Sunday 23:30 local and a Monday 00:10 local; `weekBounds` end is exactly 7 local days later across a DST change (`Europe/Madrid`, last Sunday of March); `defaultReviewWeek` on Monday/Tuesday → previous week, Wednesday–Sunday → current; `localTimeParts` weekday/hour match `Intl`.
- `apps/api/src/weekly/aggregation.service.spec.ts` (pure `aggregateWeek`, fixtures in `apps/api/src/weekly/__fixtures__/week-fixture.ts`): the epic-script week (WORK 5 planned/4 completed/1 skipped; HEALTH 3 planned — 1 completed FULL, 1 completed MINIMUM, 1 rescheduled twice; FAMILY 3/2/1) yields exactly the counts in epic step 5, `fallbackUsed: 1`, `rescheduled: 2` HEALTH closed rows and `planned: 3` (originals not double-counted), `rescheduleLeaders[0].rescheduleCount === 2`, `timeWindows` morning `4/5`, evening `3/6`; `completionRate` uses 0.5 for partial; future rows excluded when `now` is mid-week and `coverage.partial === true`; `unresolved` counts past PLANNED rows; `frictionTags` sorted; determinism (deep-equal across two calls, input not mutated); `weekAggregatesSchema.parse` passes on every fixture; empty input → all zeros and seven `weekdays`.
- `apps/api/src/weekly/weekly-review-templates.spec.ts`: each rule above with a table of aggregates; output passes `weeklyReviewOutputSchema`; `proposedChanges` always `[]`; `doNotAddYet` present exactly when `totals.planned ≥ softCap`.
- `apps/api/src/weekly/contracts/weekly-review.contract.spec.ts`: `guardReviewOutput` drops a proposal with a foreign `planId`, drops one with a foreign `target.id`, keeps `add` ops (`target.id === null`), reports `dropped`.
- `apps/api/src/weekly/prompts/weekly-reviewer.prompt.spec.ts`: style blocks; version constant; mentions "observation", "inference", "recommendation".
- `apps/api/src/weekly/weekly-review.service.spec.ts` (prisma mock, gateway/proposals/notifications mocked): `invoke` called with `persona 'weekly_reviewer'`, `promptVersion 'weekly_reviewer.v1'`, `schemaName 'weekly_review'`; `ok:false` → `source 'template'`, no `createFromSource` call, status `READY`; `ok:true` with two proposals, one foreign → one `createFromSource` call, `proposalIds.length === 1`, audit `droppedProposals: 1`; `createFromSource` throwing 422 → review still `READY` with that id absent; `notify` called only when `findEvent` returns a definition (mock both ways); `proposeInsights` rejection does not fail generation; `APPROVED` row → 409; a thrown Prisma error mid-generation restores the previous row status; `skip` from `APPROVED` → 409.
- `apps/api/src/weekly/weekly-review.task.spec.ts`: three profiles in three timezones, fake `now` → only the one whose local weekday/hour matches is generated; existing READY review for that week → skipped; a failing user does not stop the batch; `WEEKLY_REVIEW_CRON_DISABLED=true` → no query.
- Integration `apps/api/test/weekly/weekly-review.integration.spec.ts` (`createTestApp({ overrideProviders: [{ provide: AiGatewayService, useValue: fakeGateway }] })`, real DB): seed via E02/E05 endpoints the epic-script week → `POST /weekly/reviews/generate` → 200 with the expected counts, `plan_change_proposals` has one `WEEKLY_REVIEW` row, **`plan_versions` count unchanged**; `GET /weekly/reviews/current` returns it with `proposals[0].preview.diff`; second generate for the same week replaces the summary (same row id); `POST /proposals/:id/accept` (E06-04) → v2; `PUT /weekly/settings {weeklyReviewWeekday: 5, weeklyReviewTime: '16:00'}` → `GET` echoes and `nextReviewAt` is a Friday 16:00 local; `weeklyReviewTime: '24:00'` → 400; other user's review id → 404; fake gateway `{ok:false, code:'timeout'}` → `source 'template'`; sixth generate within the hour → 429.
- `apps/api/test/openapi/openapi-document.spec.ts` passes with the `Weekly Review` tag.

**Docs (docs-dev)** — `docs/API.md` "Weekly Review" section (7 routes, example bodies); `CLAUDE.md` endpoints block, env var `WEEKLY_LOAD_SOFT_CAP` / `WEEKLY_REVIEW_CRON_DISABLED` in "Environment Variables", `weekly_reviewer` call site listed under the "Calling an AI persona" recipe (E06-09); `infra/compose/.env.example` both vars with comments; `docs/specs/weekly-review.md` skeleton sections "Aggregation rules" and "Reviewer contract" (E10-05 completes the file).

#### Acceptance criteria

- [ ] `POST /api/weekly/reviews/generate` on the epic-script week returns `READY` with `aggregates.domains.WORK = {planned: 5, completed: 4, skipped: 1, …}`, `HEALTH.fallbackUsed = 1`, `rescheduleLeaders[0].rescheduleCount = 2`, and the same numbers on every repeat call (deterministic).
- [ ] With the fake OpenAI server up, `aiSummary.source === 'ai'`, every `patterns[]` entry has `observation` and `confidence`, and each `proposedChanges[]` entry has a matching `plan_change_proposals` row with `sourceKind = 'WEEKLY_REVIEW'`; `plan_versions` count is unchanged by generation.
- [ ] With the provider unreachable (or no user key), generation still returns `READY` with `source: 'template'`, numeric sentences, `proposedChanges: []`, and HTTP 200.
- [ ] A proposal naming a `planId`/`routineId` absent from the context is dropped, counted in audit `droppedProposals`, and never persisted.
- [ ] The hourly sweep generates a review only for users whose local weekday and hour equal their profile's `weeklyReviewWeekday`/`weeklyReviewTime`, at most once per week per user, and continues past a failing user.
- [ ] `GET /api/weekly/reviews/current` returns `null` for a new user and the latest review (with resolved `proposals`) afterwards; another user's review id → 404.
- [ ] `PUT /api/weekly/settings` validates weekday 0–6 and `HH:mm`, persists to `user_profiles`, and returns a correct `nextReviewAt` in the user's timezone.
- [ ] `notify('coach.weekly_review_ready', …)` is called iff the event is registered; generation never fails because of notifications or pattern analysis.
- [ ] Every generation writes exactly one `weekly_review:generate` audit row and (when AI ran) one `ai_invocations` row with `persona = 'weekly_reviewer'`, `promptVersion = 'weekly_reviewer.v1'`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: named 400/404/409/429 codes; generation never leaves a row `GENERATING` after an exception; provider failures degrade to the template, never to a 5xx
- [ ] Observability: span `weekly.review.generate` (`@Trace`, `apps/api/src/common/decorators/trace.decorator.ts`) with attributes `weekly.week_start`, `weekly.trigger`, `weekly.source`, `weekly.proposals` — never text; Pino line per generation and per sweep; audit rows listed above
- [ ] Security: ownership on every read/write; the reviewer input contains no email/display name (E06-02's renderer guarantees it; the aggregates carry titles only); user key only (gateway never falls back)
- [ ] Config & secrets: `WEEKLY_LOAD_SOFT_CAP` (default 8), `WEEKLY_REVIEW_CRON_DISABLED` (default false); no secrets
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5.
2. `curl -s …/api/weekly/reviews/current | jq '.data.aiSummary | {source, patterns, proposedChanges: (.proposedChanges | length)}'` → `source: "ai"`, ≥ 1 pattern with `observation`, 1 proposal. `jq '.data.proposals[0].preview.diff'` shows the move.
3. Epic step 13 (AI down → template) and step 11 (409 after approve, once E10-03 exists — until then skip).
4. `curl -s -X PUT …/api/weekly/settings -d '{"weeklyReviewWeekday":5,"weeklyReviewTime":"16:00"}'` → 200; `-d '{"weeklyReviewWeekday":7,…}'` → 400. Epic step 14 for the cron.
5. `psql`: `SELECT action, meta->>'trigger', meta->>'source' FROM audit_events WHERE action='weekly_review:generate';`.

#### Out of scope

- Weekly planning, materialisation, load check, `markApproved` callers (E10-03).
- Notification event definition/copy (E12-02), push delivery (E12-04).
- Multi-week trend inputs to the reviewer (E11 momentum; PRD §14.6 "notification interactions" input arrives with E12-06 — pass `recentNotificationCount` from the context until then).

#### Notes for the implementing agent

- Reuse, do not re-derive: `localDate`/`localDayBounds` (`apps/api/src/today/local-date.ts`), `ContextAssemblerService.assemble/renderForPrompt` (E06-02), `ProposalsService.createFromSource` (E06-04 — never `PlansService.createVersion` from here), `findEvent` (`notification-events.ts`), the throttle in `apps/api/src/ai/gateway/test-throttle.ts`, the `@Cron` shape in `apps/api/src/auth/tasks/token-cleanup.task.ts`.
- `aggregateWeek` must stay pure and side-effect free; it is unit-tested with fixtures and reused by E10-03's load summary and E11's momentum inputs. Put Prisma reads in `AggregationService.load` only.
- E07/E09 tables: read `prisma.focusSession` / `prisma.workoutSession` with `select` limited to the fields in `AggregationInput`; if a model is named differently by the time you implement, adapt the loader, not the aggregate shape.
- Fastify, not Express; Zod DTOs via `createZodDto` (`apps/api/src/email/dto/update-email-settings.dto.ts`), never class-validator; `npm run prisma:*` scripts, never bare `npx`.
- The cron uses `Intl.DateTimeFormat` for local weekday/hour — no date library. The hour comparison is exact, so a review time of `17:30` fires in the 17:00 sweep; document that minute precision is not promised.
- Register the OpenAPI tag in the same commit as the controller; `openapi-document.spec.ts` fails otherwise.

---

### E10-03 `feat(api): add weekly planning flow with constraints, domain modes, load check and approve`

**Part of epic:** E10 · **Blocked by:** E10-02, E02-02, E02-03, E02-04 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §50 fixes the seven-step weekly planning flow (review previous week → fixed constraints → one primary focus → domain modes → propose commitments → check workload → approve next week); PRD §48 requires the product to "estimate total intentional effort" and warn when the user adds substantial new behaviours ("You already have eight recurring commitments this week. I recommend replacing something rather than adding another habit."); PRD §49 lets each domain run in GROW/MAINTAIN/RECOVER/PAUSE for realistic trade-offs; VISION §26 says the product must prevent goal overload. Today nothing turns routines into next week's commitments (E02 states "nothing materialises commitments from routines automatically"), so Monday's Today screen is empty unless the user adds each one by hand.

#### Proposed solution

A `WeeklyPlan` draft per upcoming week, patched step by step, a deterministic materialisation of next week's commitments from active routines plus user constraints, a pure load check, and an idempotent approve that writes commitments, applies domain modes and closes the review.

**Data (database-dev)** — n/a beyond adding `weeklyPlanProposalSchema` to `apps/api/src/weekly/weekly.schema.ts`:

```ts
export const proposedCommitmentSchema = z.object({
  key: z.string(),                                   // `${routineId}:${date}` or `extra:${n}`
  source: z.enum(['routine','extra']),
  include: z.boolean(),
  domain: domainEnum, title: z.string().min(1).max(200),
  date: isoDate, startTime: hhmm, estimatedMinutes: z.number().int().min(1).max(480), minimumMinutes: z.number().int().min(1).nullable(),
  routineId: z.string().uuid().nullable(), planVersionId: z.string().uuid().nullable(), outcomeId: z.string().uuid().nullable(),
  fullVersion: z.string().nullable(), shortVersion: z.string().nullable(), minimumVersion: z.string().nullable(),
  recurring: z.boolean(),                            // true for routine occurrences and extras the user flags as recurring
  excludedBy: z.enum(['travel_day','fixed_event','paused_domain']).nullable(),
});
export const loadWarningSchema = z.object({ code: z.enum(['RECURRING_OVER_CAP','MINUTES_OVER_CAPACITY','DAY_OVER_CAPACITY']), message: z.string(), suggestion: z.string(), detail: z.record(z.unknown()) });
export const weeklyPlanProposalSchema = z.object({
  items: z.array(proposedCommitmentSchema).max(60),
  extras: z.array(extraCommitmentSchema).max(20),   // the user's additions, echoed so /propose is re-runnable
  summary: z.object({ recurringCount: z.number().int(), estimatedMinutes: z.number().int(), byDomain: z.record(domainEnum, z.object({ count: z.number().int(), minutes: z.number().int() })), softCap: z.number().int(), capacityMinutes: z.number().int().nullable() }),
  warnings: z.array(loadWarningSchema),
  proposedAt: z.string().datetime(),
});
export const extraCommitmentSchema = z.object({ domain: domainEnum, title: z.string().min(1).max(200), date: isoDate, startTime: hhmm, estimatedMinutes: z.number().int().min(1).max(480), minimumVersion: z.string().max(500).nullable().default(null), recurring: z.boolean().default(false) });
```

**API (backend-dev)**

Files (new) in `apps/api/src/weekly/`:
- `materialize-week.ts` — **pure**: `materializeWeek(input: { weekStart; timeZone; routines: RoutineForWeek[]; domainModes: WeeklyDomainModes; constraints: WeeklyPlanConstraints; extras: ExtraCommitment[]; existing: Array<{ routineId: string | null; date: isoDate }> }): ProposedCommitment[]`, where `RoutineForWeek = Pick<Routine,'id'|'title'|'domain'|'frequency'|'daysOfWeek'|'preferredTime'|'estimatedDurationMin'|'minimumDurationMin'|'fallbackBehavior'> & { planVersionId; outcomeId }`. Occurrence days: `DAILY` → all 7; `WEEKDAYS` → Mon–Fri; `WEEKENDS` → Sat, Sun; `WEEKLY` → the first day in `daysOfWeek` else Monday; `CUSTOM` → `daysOfWeek`. `startTime = preferredTime ?? DEFAULT_TIME[domain]` (`WORK '09:00'`, `FAMILY '18:30'`, `HEALTH '07:00'`). Versions: `fullVersion = title`, `shortVersion = null`, `minimumVersion = fallbackBehavior ?? '${minimumDurationMin}-minute version'`. Exclusions set `include: false` with `excludedBy`: date ∈ `travelDays` → `travel_day`; a `fixedEvent` on that date whose `[startTime, endTime]` overlaps `[startTime, startTime + estimatedMinutes)` (events with null times block the whole day) → `fixed_event`; `domainModes[domain] === 'PAUSE'` → `paused_domain`. An `existing` `(routineId, date)` pair yields no item (already materialised — idempotency). Extras become items `source: 'extra'`, `key: 'extra:<index>'`, `include: true`. Output sorted `date asc, startTime asc, domain asc, title asc`; same input ⇒ same output.
- `load-check.ts` — **pure**: `checkLoad(items: ProposedCommitment[], opts: { softCap: number; weekdayMinutes: number | null }): { summary; warnings: LoadWarning[] }`. `recurringCount` = distinct `routineId`s among included routine items + included extras with `recurring: true`; `estimatedMinutes` = Σ included `estimatedMinutes`; `capacityMinutes = weekdayMinutes === null ? null : 5 × weekdayMinutes`. Warnings: `RECURRING_OVER_CAP` when `recurringCount > softCap` — `message: 'You already have ${recurringCount} recurring commitments this week. I recommend replacing something rather than adding another habit.'`, `suggestion: 'Untick one recurring commitment or move it to a later week.'`, `detail: { recurringCount, softCap }`; `MINUTES_OVER_CAPACITY` when `capacityMinutes !== null && estimatedMinutes > capacityMinutes` — `message: 'This week adds up to about ${h}h ${m}m; you told me you have about ${weekdayMinutes} minutes on a weekday.'`, `suggestion: 'Use shorter versions or drop the least important day.'`; `DAY_OVER_CAPACITY` when any single weekday's included minutes `> weekdayMinutes` (`detail: { date, minutes }`, at most one warning listing the worst day). Warnings never block; they are surfaced and must be acknowledged at approve.
- `weekly-plan.service.ts` — `WeeklyPlanService`:
  - `create(userId, { weekStart? })` — default `addDays(weekStartFor(now, tz), 7)`; must be a Monday **≥ this week's Monday** (400 `INVALID_WEEK_START`); existing `DRAFT` → return it (idempotent); existing `APPROVED` → 409 `WEEKLY_PLAN_APPROVED`; else create with `reviewId` = the `READY|APPROVED` review for `addDays(weekStart, −7)` (or null), `domainModes` = the user's current `DomainModesService.list` as `{WORK, FAMILY, HEALTH}`, `constraints: {}` (defaults). Audit `weekly_plan:create`.
  - `update(userId, id, patch)` — `DRAFT` only (409 `WEEKLY_PLAN_NOT_EDITABLE`); Zod-validated merge of `constraints` (replace whole object), `primaryFocus` (≤ 200, nullable), `domainModes` (partial merge); clears `proposal` (a change invalidates the previous proposal); audit `weekly_plan:update` `meta { fields }`.
  - `propose(userId, id, { extras = [] })` — loads active routines: every `Routine` with `active: true` whose `PlanVersion.status === 'ACTIVE'` and whose outcome is `ACTIVE`; loads `existing` commitments in the week's bounds with `routineId`; runs `materializeWeek` then `checkLoad` with `softCap = config.weekly.loadSoftCap`, `weekdayMinutes` from the profile; stores `proposal` (items, extras, summary, warnings, `proposedAt`); returns it. Audit `weekly_plan:propose` `meta { items, included, recurringCount, estimatedMinutes, warnings: codes }`.
  - `approve(userId, id, { acknowledgeWarnings = false })` — 409 unless `DRAFT`; 409 `WEEKLY_PLAN_NOT_PROPOSED` when `proposal` is null; if `proposal.warnings.length > 0 && !acknowledgeWarnings` → 422 `LOAD_WARNINGS_UNACKNOWLEDGED` with the warnings in `details`. One `prisma.$transaction`: re-check `existing` and skip items already materialised (idempotent under retry); for each included item create a `Commitment` `{ domain, title, outcomeId, planVersionId, routineId, scheduledStart: local date+time → UTC, scheduledEnd: + estimatedMinutes, importance: 3, status: 'PLANNED', userConfirmed: true, fullVersion, shortVersion, minimumVersion }` through `CommitmentsService.create` (E02-04; pass `tx` — add the optional-client overload if E02-04 lacks it); for each domain whose `domainModes[domain]` differs from the current row call `DomainModesService.set(userId, domain, { mode, reason: 'Weekly plan ' + weekStart }, tx)`; set plan `status: APPROVED`, `approvedAt`; `WeeklyReviewService.markApproved(userId, addDays(weekStart, −7), tx)`. After commit: audit `weekly_plan:approve` `meta { weekStart, created, skippedExisting, domainModeChanges, warnings: codes, acknowledged, primaryFocusSet: boolean }`; log `Weekly plan approve user=<id> week=<w> created=<n> skipped=<n> warnings=<codes>`. Returns `{ plan, createdCommitmentIds, skippedExisting, warnings }`.
  - `get(userId, id)`, `list(userId, { weekStart? })`.
- `weekly-plan.controller.ts` (`@ApiTags('Weekly Planning')`, `@Controller('weekly/plans')`), DTOs `dto/create-weekly-plan.dto.ts` `{ weekStart? }`, `dto/update-weekly-plan.dto.ts` `{ constraints?, primaryFocus?, domainModes? }` (strict object), `dto/propose-weekly-plan.dto.ts` `{ extras?: ExtraCommitment[] }`, `dto/approve-weekly-plan.dto.ts` `{ acknowledgeWarnings?: boolean }`, `dto/weekly-plan-response.dto.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/weekly/plans` | `@Auth()` | `{ weekStart? }` | 201 `WeeklyPlanDetail` (200 when an existing DRAFT is returned); 400 `INVALID_WEEK_START`; 409 `WEEKLY_PLAN_APPROVED` |
| GET | `/api/weekly/plans` | `@Auth()` | `?weekStart=` | 200 `{ items: WeeklyPlanSummary[] }` |
| GET | `/api/weekly/plans/:id` | `@Auth()` own → 404 | — | 200 `WeeklyPlanDetail` = row + `review: WeeklyReviewSummary \| null` |
| PATCH | `/api/weekly/plans/:id` | `@Auth()` own | `{ constraints?, primaryFocus?, domainModes? }` | 200 `WeeklyPlanDetail`; 409 `WEEKLY_PLAN_NOT_EDITABLE` |
| POST | `/api/weekly/plans/:id/propose` | `@Auth()` own | `{ extras? }` | 200 `WeeklyPlanDetail` with `proposal { items, summary, warnings }` |
| POST | `/api/weekly/plans/:id/approve` | `@Auth()` own | `{ acknowledgeWarnings? }` | 200 `{ plan, createdCommitmentIds, skippedExisting, warnings }`; 409 `WEEKLY_PLAN_NOT_EDITABLE` / `WEEKLY_PLAN_NOT_PROPOSED`; 422 `LOAD_WARNINGS_UNACKNOWLEDGED` |

OpenAPI: add `{ name: 'Weekly Planning', description: 'A draft for the coming week: fixed constraints, one primary focus, domain modes, the commitments EvolvePath proposes from active routines, the cross-domain load check, and the approve step that writes next week\'s commitments. Deterministic — no model call.' }` to the `EvolvePath` group. Audit actions: `weekly_plan:create`, `weekly_plan:update`, `weekly_plan:propose`, `weekly_plan:approve`. `WeeklyModule` adds `PathModule` and `CommitmentsModule` to its imports (export `DomainModesService`, `PlansService`, `CommitmentsService` from those modules if not already exported).

**UI (frontend-dev)** — n/a (E10-04).

**Tests (testing-dev)**
- `apps/api/src/weekly/materialize-week.spec.ts` (table-driven): each `frequency` yields the right dates for a fixed `weekStart`; `preferredTime` and per-domain defaults; travel day → `excludedBy 'travel_day'`; an all-day fixed event blocks the day, a timed one only overlapping items (18:30–19:10 vs 19:00–20:00 dentist → excluded; 10:00–11:00 → kept); `PAUSE` domain → `paused_domain`; `existing` pair removed; extras appended with `extra:` keys; ordering; determinism; a `Europe/Madrid` DST week still has seven dates.
- `apps/api/src/weekly/load-check.spec.ts`: 8 recurring with cap 8 → no warning; 9 → `RECURRING_OVER_CAP` with the PRD §48 sentence and `detail.recurringCount === 9`; the same routine on five days counts once; two non-recurring extras count zero; `weekdayMinutes 60` and 350 minutes → `MINUTES_OVER_CAPACITY` (`capacityMinutes 300`); `weekdayMinutes null` → no capacity warnings; one heavy Thursday → `DAY_OVER_CAPACITY` with that date; excluded items never count.
- `apps/api/src/weekly/weekly-plan.service.spec.ts` (prisma mock): `create` twice → same DRAFT id; `create` for a past Monday → 400; `update` clears `proposal`; `approve` without proposal → 409; with warnings and no ack → 422 and **no `commitment.create`**; with ack → creates included items only, calls `DomainModesService.set` only for changed domains, calls `markApproved`, writes audit with `created` count; retry after a partial failure skips `existing` pairs.
- Integration `apps/api/test/weekly/weekly-plan.integration.spec.ts` (real DB, `WEEKLY_REVIEW_CRON_DISABLED=true`): seed the two routines from the epic script (HEALTH `CUSTOM [1,3,6] 18:30`, WORK `WEEKDAYS 07:30`) → `POST /weekly/plans {}` → 201 with `domainModes` mirroring `GET /me/domain-modes`; `PATCH` travel day next Wednesday + dentist Friday 10:00–11:00 + `domainModes.FAMILY = 'MAINTAIN'` → 200; `POST …/propose {}` → items: WORK Mon/Tue/Thu/Fri included, Wed `travel_day`; HEALTH Mon/Wed(excluded)/Sat; `summary.recurringCount === 2`, `warnings: []`; `propose` with 7 recurring extras → `RECURRING_OVER_CAP`; `approve {}` → 422; `approve {acknowledgeWarnings:true}` → 200, `createdCommitmentIds.length === 13`; `GET /commitments?from=<weekStart>&to=<+7d>` (E02-04) lists them `PLANNED` with `routineId`/`planVersionId` set; `GET /me/domain-modes` → FAMILY `MAINTAIN`; `weekly_reviews` row for the prior week (created by a prior `generate` in the test) is `APPROVED`; second `approve` → 409; `POST /weekly/plans` same week → 409; a second user cannot `GET` the plan (404); `GET /today` (E05-01) on a mocked "next Monday" `now` returns the WORK block as NBA.
- `openapi-document.spec.ts` passes with the `Weekly Planning` tag.

**Docs (docs-dev)** — `docs/API.md` "Weekly Planning" section (6 routes, the proposal and warning shapes); `CLAUDE.md` endpoints block and a "Materialising commitments from routines" note under Common Patterns pointing at `materialize-week.ts` (E08-02's ritual generator should reuse the same occurrence rules — note the cross-reference); `docs/specs/weekly-review.md` sections "Materialisation rules" and "Load check".

#### Acceptance criteria

- [ ] `POST /api/weekly/plans` with no body creates (or returns) the DRAFT for next Monday in the user's timezone; the same call twice returns the same id; a past week → 400; an approved week → 409.
- [ ] `PATCH` accepts constraints, primary focus and partial domain modes on a DRAFT only, and invalidates a previous proposal.
- [ ] `POST …/propose` on the epic-script routines produces exactly the occurrences the frequency rules define, excludes travel days, colliding fixed events and paused domains with a stated `excludedBy`, and returns `summary.recurringCount` and `estimatedMinutes`.
- [ ] A 9th recurring item (with `WEEKLY_LOAD_SOFT_CAP` unset) yields a `RECURRING_OVER_CAP` warning whose message is the PRD §48 sentence with the real count; removing one clears it.
- [ ] `estimatedMinutes > 5 × weekdayMinutes` yields `MINUTES_OVER_CAPACITY`; a null `weekdayMinutes` yields no capacity warning.
- [ ] `approve` with outstanding warnings returns 422 and writes nothing; with `acknowledgeWarnings: true` it creates one `PLANNED` commitment per included item, linked to its routine and plan version, and a retry creates no duplicates.
- [ ] Approve applies changed domain modes to `domain_modes` (visible on `GET /api/me/domain-modes`), marks the prior week's review `APPROVED`, and writes `weekly_plan:approve`.
- [ ] Next Monday's `GET /api/today` (E05-01) lists the materialised commitments with the WORK block as the next best action.
- [ ] No model call happens anywhere in this child (`AiGatewayService` is not injected into `WeeklyPlanService`).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: approve is atomic; named 400/404/409/422 codes; warnings are data, never exceptions
- [ ] Observability: span `weekly.plan.approve`; Pino line per approve; audit actions listed above
- [ ] Security: ownership on plan, routines, outcomes and every created commitment; `userConfirmed: true` only because the user pressed approve
- [ ] Config & secrets: `WEEKLY_LOAD_SOFT_CAP` read once via `configuration.ts`; no new secrets
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–7 (a review exists and v2 is active).
2. `curl -s -X POST …/api/weekly/plans -d '{}'` → 201; note `PID`. `curl -s -X PATCH …/api/weekly/plans/$PID -d '{"constraints":{"travelDays":["<next Wed>"],"fixedEvents":[{"date":"<next Fri>","title":"Dentist","startTime":"10:00","endTime":"11:00"}]},"primaryFocus":"Ship the proposal draft","domainModes":{"FAMILY":"MAINTAIN"}}'` → 200.
3. `curl -s -X POST …/api/weekly/plans/$PID/propose -d '{}' | jq '.data.proposal | {n: (.items|length), inc: [.items[]|select(.include)]|length, warnings, summary}'` → 4 WORK + 2 HEALTH included, Wednesday items `excludedBy`, `warnings: []`.
4. Re-run with `-d '{"extras":[<7 objects with "recurring":true>]}'` → `warnings[0].code == "RECURRING_OVER_CAP"`, message contains "9 recurring commitments".
5. `curl -s -X POST …/api/weekly/plans/$PID/approve -d '{}'` → 422; `-d '{"acknowledgeWarnings":true}'` → 200 with `createdCommitmentIds`. Epic steps 9–11.

#### Out of scope

- The wizard UI (E10-04); AI wording of commitment titles via the `planner` persona (P1: a `?wording=ai` flag on `/propose` would call `planner` with the item list and return titles only — deterministic materialisation stays the source of ids and times).
- Ritual recurrence for FAMILY (E08-02 owns rituals; if E08 routines are modelled as `Routine` rows they are materialised here like any other).
- Rebalancing suggestions ("replace X with Y") — the warning only recommends replacing; the user chooses.

#### Notes for the implementing agent

- `materializeWeek` and `checkLoad` are pure and must not import Prisma or Nest; keep them reusable by E08-02 and by the web (the wizard shows the same summary the API computed — it does not recompute).
- Local date+time → UTC: build the instant with `localDayBounds(date, tz).start` + minutes (E05-01 helper); never `new Date('YYYY-MM-DDTHH:mm')` (that is parsed in the server's zone).
- Commitments go through `CommitmentsService.create` (E02-04) so audit `commitment:create`, ownership checks and the `planVersionId` ACTIVE/DRAFT rule apply; pass the transaction client.
- Use `DomainModesService.set` (E02-02) so `domain_mode:set` audit rows are written with `reason`; do not upsert `domain_modes` directly.
- `WEEKLY_LOAD_SOFT_CAP` is read from `ConfigService` once in the service constructor; tests override via `overrideProviders` on `ConfigService` or by setting the env before `createTestApp`.
- Fastify, Zod DTOs, `npm run prisma:*`; register the OpenAPI tag with the controller.

---

### E10-04 `feat(web): add Weekly Review screen, Weekly Planning wizard and Weekly rhythm settings`

**Part of epic:** E10 · **Blocked by:** E10-02, E10-03, E06-07 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §51 fixes the Weekly Review screen — "Your Week", Work/Family/Health planned-vs-done, What worked, What got in the way, one high-confidence Pattern, one or two Recommendations, Next week as a plan diff, CTA **Approve next week** — and VISION §29 shows the same layout. PRD §50 fixes the planning flow the CTA starts, and §50 says the review day/time is chosen by the user. The API from E10-02/03 exists but nothing renders it; `/progress` is still E02-05's placeholder and `/settings` has no card for the weekly rhythm.

#### Proposed solution

Two routes under the `progress` destination (`/progress/week`, `/progress/week/plan`), a "Weekly rhythm" user-settings card, and components that reuse E06-07's `ProposalCard`/`PlanChangeDiff` for the Recommendation section. **Route decision:** `/progress/week` (not `/review`) — the review is the weekly view of progress, so it lives under the destination whose rail/bottom-bar tab lights up, and no `DESTINATION_ROUTES` change is needed.

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a.

**UI (frontend-dev)**

Routes (`apps/web/src/App.tsx`, inside the `Layout` element, lazy): `/progress/week` → `WeeklyReviewPage`, `/progress/week/plan` → `WeeklyPlanPage`, `/settings/weekly-rhythm` → `UserWeeklyRhythmPage`. `apps/web/src/components/navigation/AppBar.tsx` `resolveDrillDown`: `^/progress/week$` → `{ title: 'Your Week', up: '/progress' }`, `^/progress/week/plan$` → `{ title: 'Plan next week', up: '/progress/week' }` (data rows, not gates). `apps/web/src/pages/ProgressPage.tsx` (E02-05 placeholder, E11 replaces): add a `WeekEntryCard` at the top — "Your Week" with the current review's counts or "No review yet · Generate" — linking to `/progress/week`; E11-04 keeps this card.

Registry: `apps/web/src/config/userSettingsSections.tsx` → `Account` section gains `{ title: 'Weekly rhythm', description: 'Choose the day and time your weekly review is prepared.', Icon: EventRepeatIcon (@mui/icons-material/EventRepeat), path: '/settings/weekly-rhythm' }` — no `permission` (own profile, `@Auth()` on the API).

Types (`apps/web/src/types/index.ts`): `WeekAggregates`, `DomainCounts`, `ReviewPattern`, `WeeklyReviewSummary`, `WeeklyReviewDetail` (with `proposals: ProposalDetail[]` from E06-07's types), `WeeklyPlanDetail`, `ProposedCommitment`, `LoadWarning`, `ExtraCommitment`, `WeeklySettings` — mirror the API DTOs field for field.

`apps/web/src/services/api.ts`: `getCurrentWeeklyReview()`, `getWeeklyReview(id)`, `listWeeklyReviews({weekStart?})`, `generateWeeklyReview({weekStart?})`, `skipWeeklyReview(id)`, `createWeeklyPlan({weekStart?})`, `getWeeklyPlan(id)`, `updateWeeklyPlan(id, patch)`, `proposeWeeklyPlan(id, {extras})`, `approveWeeklyPlan(id, {acknowledgeWarnings})`, `getWeeklySettings()`, `updateWeeklySettings(body)`; reuse `acceptProposal/editProposal/rejectProposal` (E06-07).

Hooks: `apps/web/src/hooks/useWeeklyReview.ts` (`{ review, isLoading, error, generate, skip, reload, decide(proposalId, 'accept'|'reject'|{edit}) }`, `weekStart` from `?weekStart=` search param), `useWeeklyPlan.ts` (`{ plan, create, update, propose, approve, isSaving, warnings }` — `create` on mount for the wizard, persists each step with `update` before advancing), `useWeeklySettings.ts`.

Components (`apps/web/src/components/weekly/`, all new):
- `WeekDomainTiles.tsx` `{ aggregates }` — three tiles "Work 4 / 5", "Family 2 / 3", "Health 3 / 3" (`completed / planned`, secondary line "1 partial · 1 moved · 1 skipped" when non-zero, `aria-label="Work: 4 of 5 commitments done"`); `Grid size={{ xs: 12, sm: 4 }}`; the number is never coloured red/green (VISION §30 — no worth signalling), partial coverage shows a caption "Week in progress".
- `ReviewList.tsx` `{ title, items, emptyText }` — `<h2>` + bullet list; used for What worked / What got in the way / Keep unchanged / Not yet.
- `PatternCard.tsx` `{ pattern }` — labelled rows **Observation** / **Inference** / **Recommendation** (rows absent when null), confidence chip `High ≥ 0.75 · Medium ≥ 0.5 · Low` with `aria-label="confidence 80%"`, domain chip.
- `ReviewProposalCard.tsx` `{ proposal, onDecide }` — wraps E06-07's `ProposalCard` (renders `PlanChangeDiff`; Accept / Edit / Keep current plan); after accept shows "Plan updated (v<N>)" with a link to `/path/outcomes/<outcomeId>`.
- `TemplateSummaryNotice.tsx` — `Alert severity="info"`: "Summary written from your numbers — the coach was unavailable." shown when `aiSummary.source === 'template'`.
- `WeeklyPlanWizard.tsx` `{ plan, onUpdate, onPropose, onApprove }` — MUI `Stepper` (`orientation` `vertical` below `sm`, `horizontal` at/above — local layout choice via `useMediaQuery(theme.breakpoints.down('sm'))`, documented as not one of the five gates) with steps: `ConstraintsStep` (travel days: date chips via a `DatePicker`-free `<input type="date">` list limited to the week; fixed events: title/date/start/end rows; notes), `FocusStep` (one text field, ≤ 200, prefilled from the review's top `keepUnchanged` suggestion is **not** done — the focus is the user's), `DomainModesStep` (three `ToggleButtonGroup`s GROW/MAINTAIN/RECOVER/PAUSE with the PRD §49 one-line meanings), `CommitmentsStep` (calls `propose` on enter; list grouped by day, each row a `Checkbox` bound to `include`, excluded rows greyed with the `excludedBy` reason, **Add commitment** opens `ExtraCommitmentDialog` {domain, title, date, time, minutes, recurring switch} → re-`propose` with the extras; `LoadSummary` line "N recurring commitments · ~Xh Ym"; `LoadWarningAlert` `role="alert"` per warning with `message` + `suggestion`), `ApproveStep` (recap: focus, modes, N commitments, warnings; `Checkbox` "I understand the load warning" when warnings exist, enabling **Approve next week**; on success `Snackbar` "Next week is ready" and navigate to `/progress/week`).
- `WeekEntryCard.tsx` (Progress placeholder card described above).

Pages:
- `apps/web/src/pages/WeeklyReviewPage.tsx` — `<h1>Your Week</h1>` + subtitle "Mon <d> – Sun <d>" (from `weekStart`, user locale); states: no review → empty state "No review for this week yet" + **Generate review** (calls `generate`, shows a skeleton while pending) ; `GENERATING` → skeleton with "Preparing your week…" and polling every 5 s; `READY|APPROVED|SKIPPED` → `WeekDomainTiles`, `TemplateSummaryNotice?`, then sections in PRD §51 order: **What worked**, **What got in the way**, **Pattern** (the highest-confidence `patterns[0]`; the rest under a "More patterns" `Accordion`), **Recommendation** (`ReviewProposalCard` per proposal, then `ReviewList` "Keep unchanged" and "Not yet"), **Next week** (`plan === null` → CTA **Approve next week** → `navigate('/progress/week/plan')`; `DRAFT` → **Continue planning**; `APPROVED` → "Next week approved · N commitments" + link to `/path`). Secondary actions in a `⋯` menu: **Regenerate** (disabled when APPROVED), **Skip this week**, week picker (previous/next arrows updating `?weekStart=`). Layout: ≥`md` two columns (`Grid size={{ xs: 12, md: 7 }}` tiles + lists | `{ xs: 12, md: 5 }` recommendation + next week); below: single column in the order above.
- `apps/web/src/pages/WeeklyPlanPage.tsx` — mounts the wizard for the plan returned by `createWeeklyPlan({})` (or the `?planId=`); `<h1>Plan next week</h1>` with the week range.
- `apps/web/src/pages/UserWeeklyRhythmPage.tsx` — title "Weekly rhythm", description as the card; `Select` weekday (Sunday…Saturday), `TextField type="time"` (`step 3600` — hours, matching the API's hourly sweep; the helper text says "Reviews are prepared on the hour"), read-only timezone line from the response with a link "Change timezone in Profile" **only if** E04 exposes one (else omit), "Next review: Friday 16:00" from `nextReviewAt`; **Save** → `updateWeeklySettings`, `Snackbar` "Weekly rhythm saved". Not built on `UserSettingsSection` (that component is bound to the `user_settings` JSON document); it reuses the same `Container`/`Typography` chrome so the hub, AppBar title and `h1` name it identically.

Responsive: below `sm` (600px) everything stacks, the stepper is vertical, `BottomNav` stays visible (the wizard is inside `Layout`, not full-screen — unlike E09-08's runner; a weekly plan is not a live activity); ≥`sm` tiles in a row and horizontal stepper; ≥`md` two-column review. The five coupled gates are untouched.

A11y: one `h1` per page; section headings are `h2` in PRD §51 order so screen readers can jump; tiles carry the "N of M" `aria-label`; warnings are `role="alert"`; stepper steps expose `aria-current="step"`; every icon button has `aria-label`; confidence is text + chip, never colour alone; `vitest-axe` on both pages.

`data-testid`s for E10-05: `week-tile-WORK|FAMILY|HEALTH`, `review-generate`, `review-pattern`, `review-proposal`, `review-approve-next-week`, `wizard-next`, `wizard-add-commitment`, `wizard-load-warning`, `wizard-approve`, `wizard-ack-warnings`, `rhythm-weekday`, `rhythm-time`, `rhythm-save`.

**Tests (testing-dev)** (Vitest + RTL + MSW; handlers in `apps/web/src/__tests__/mocks/handlers.ts` with mutable weekly state and fixtures in `apps/web/src/__tests__/mocks/weekly.data.ts`):
- `__tests__/components/weekly/WeekDomainTiles.test.tsx`: renders "4 / 5" and the aria-label; partial coverage caption; no colour classes on numbers.
- `__tests__/components/weekly/PatternCard.test.tsx`: rows present/absent per null fields; confidence chip text for 0.8/0.6/0.3.
- `__tests__/components/weekly/WeeklyPlanWizard.test.tsx`: steps persist via `PATCH` before advancing (assert request bodies); entering the commitments step calls `propose`; adding an extra re-calls `propose` with `extras`; a `RECURRING_OVER_CAP` warning renders `role="alert"` and disables **Approve** until the acknowledgement box is ticked; approve sends `acknowledgeWarnings: true`; vertical stepper below `sm` (`matchMedia` mock), horizontal above.
- `__tests__/pages/WeeklyReviewPage.test.tsx`: empty → Generate → review rendered with tiles, sections in PRD §51 order (assert heading order), one `review-proposal`; Accept → `POST /proposals/:id/accept` called and "Plan updated (v2)" shown; template source shows the notice; `APPROVED` disables Regenerate; `?weekStart=` drives the request; axe passes.
- `__tests__/pages/UserWeeklyRhythmPage.test.tsx`: loads settings, save sends `{weeklyReviewWeekday, weeklyReviewTime}`, shows the snackbar, renders `nextReviewAt`; axe passes.
- `__tests__/config/userSettingsSections.test.ts`: the `Weekly rhythm` card exists under `Account` with path `/settings/weekly-rhythm` and no `permission`; `settingsPageTitle('/settings/weekly-rhythm')` = "Weekly rhythm".
- `__tests__/config/destinations.test.ts`: `/progress/week`, `/progress/week/plan` resolve to `progress`; `/settings/weekly-rhythm` to `profile`; the route-ownership assertion still passes.
- `__tests__/components/navigation/AppBar.test.tsx` (extend): drill-down titles and `up` for the two new paths.
- Visual (ops-dev runs in the pinned Playwright container, testing-dev authors): `tests/visual/specs/weekly-review.spec.ts` — `harnessUrl({ route: '/progress/week' })` at 390×844 and 1280×800 with the MSW fixture; baselines `weekly-review-390px-chromium-linux.png`, `weekly-review-1280px-chromium-linux.png`; regenerate `user-hub` baselines (one new card).

**Docs (docs-dev)** — `CLAUDE.md` "Access Control"/"Settings UI" examples unchanged; add `/settings/weekly-rhythm` to the user-settings card list wherever `docs/specs/settings-ui.md` (E01-11) enumerates cards; `docs/specs/weekly-review.md` section "Screens" (routes, states, responsive rules).

#### Acceptance criteria

- [ ] `/progress/week` renders the PRD §51 structure in order — Your Week, three domain tiles, What worked, What got in the way, Pattern, Recommendation, Next week — from `GET /api/weekly/reviews/current`, and **Generate review** creates one when none exists.
- [ ] The Pattern card labels Observation / Inference / Recommendation separately and shows a confidence chip; the Recommendation section renders each proposal through `PlanChangeDiff` with Accept / Edit / Keep current plan wired to `POST /api/proposals/:id/*`.
- [ ] Accepting a proposal shows "Plan updated (v2)" and `/path` shows v2 ACTIVE / v1 SUPERSEDED without a reload of the review page being required.
- [ ] **Approve next week** opens the wizard at `/progress/week/plan`; each step persists on **Next** (`PATCH`), the commitments step shows the API's proposed list grouped by day with excluded rows explaining why, and adding a 9th recurring commitment shows the `RECURRING_OVER_CAP` alert.
- [ ] Approve is disabled while warnings are unacknowledged; after approve the review page shows "Next week approved · N commitments".
- [ ] A template summary shows the "coach was unavailable" notice and the page is fully usable.
- [ ] `/settings` shows the **Weekly rhythm** card; saving day/time persists and the page shows the next review time; the hub, AppBar and `h1` all say "Weekly rhythm".
- [ ] Below 600px the tiles stack, the stepper is vertical and BottomNav stays visible; the AppBar shows back arrows titled "Your Week" and "Plan next week".
- [ ] Axe reports no violations on the review page, the wizard and the settings page; `npm run test:run` and `npm run typecheck` pass in `apps/web`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: API errors render an `Alert` with the server message; 409 on Regenerate explains "This week is already approved"; 422 on approve re-opens the acknowledgement; generation shows a skeleton, never a blank page
- [ ] Observability: n/a beyond existing client error logging
- [ ] Security: pages call only own-resource endpoints; no admin permission involved; no `permission` on the card (mirrors the API)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5 (API-seeded week and a generated review).
2. Epic steps 6–8 and 12, 15 exactly as written.
3. Delete the review (`psql … -c "DELETE FROM weekly_reviews"`), reload `/progress/week` → empty state → **Generate review** → skeleton → the screen from step 6.
4. `npm run dev` in `apps/web` with the MSW dev handlers is not required; the visual harness `apps/web/visual/main.tsx` gets `/progress/week` and `/progress/week/plan` routes with the fixture so `tests/visual` can screenshot both.

#### Out of scope

- The Progress screen proper (momentum cards, timeline — E11-04); only the `WeekEntryCard` is added to the placeholder.
- Editing routines/plan versions inline (Path, E02-06); editing proposals beyond E06-07's `EditProposalDialog`.
- A timezone editor (belongs to Profile; E04 owns `timezone`).
- Push/browser notification for "your week is ready" (E12).

#### Notes for the implementing agent

- Import `ProposalCard` and `PlanChangeDiff` from `apps/web/src/components/coach/` (E06-07); do not fork the diff rendering. If `ProposalCard` is coupled to the chat message shape, extract a `ProposalCardBody` in E06's folder and use it from both places (a small, related refactor — commit it separately as `refactor(web): …`).
- Settings page rule (CLAUDE.md "Settings UI Pattern"): card in `USER_SETTINGS_SECTIONS` first, page reached through `SettingsHub`, never a tab on an existing settings page. The card has no `permission` because the API route is plain `@Auth()`.
- Do not add a `weekly` key to `DESTINATIONS`; `/progress/*` is already owned by `progress`. `destinations.test.ts` reads the live route list — it will tell you if ownership breaks.
- The wizard's `useMediaQuery(down('sm'))` for stepper orientation is a local layout choice; write the comment E01-07's `PersonaModelTable` uses ("not one of the five coupled gates").
- Dates: the API speaks `'YYYY-MM-DD'` local dates; render with `Intl.DateTimeFormat(undefined, { weekday, day, month })` and never through `new Date('YYYY-MM-DD')` (UTC parse shifts the day).
- Keep the review page read-mostly: every mutation goes through the hooks' API calls and a reload of `current`, so the screen never shows state the server has not persisted (VISION §20).

---

### E10-05 `test(tests): E10 end-to-end verification`

**Part of epic:** E10 · **Blocked by:** E10-01, E10-02, E10-03, E10-04, E01-10, E06-09 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → ops-dev → docs-dev

#### Problem statement

PRD §135's weekly loop and PRD §101 Day 7 ("Weekly review … Approve next week") are only real if a browser can drive them against the API and database with the model faked: a seeded week of mixed evidence, a generated review with the six outputs and a proposal, an accepted plan change producing v2 on Path, next week planned with the §48 load warning, approved, and Monday's commitments present. This child adds that Playwright spec, the fake-server scenario it needs, and the spec document E11/E12 read for the contracts fixed here.

#### Proposed solution

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a (gaps found while seeding are filed against the owning child, not patched here).

**Fake server (testing-dev)** — extend `tools/fake-openai/scenarios/index.mjs` (E06-09's schema-driven matcher): schema name `weekly_review` → `tools/fake-openai/scenarios/weekly-review.json`:
```json
{ "whatWorked": ["Morning focus blocks: 4 of 5 done", "Health: fallback used once instead of skipping"],
  "whatDidNot": ["Evening workouts were moved twice", "One family dinner skipped for an unexpected conflict"],
  "patterns": [{ "observation": "4 of 5 morning commitments were completed; 1 of 3 evening ones", "inference": "Plans after 18:00 are less reliable than mornings", "recommendation": "Move the Wednesday workout to Saturday morning", "confidence": 0.8, "domain": "HEALTH" }],
  "proposedChanges": [{ "planId": "<PLACEHOLDER:planId:HEALTH>", "summary": "Move Wednesday workout to Saturday morning",
    "changes": [{ "op": "move", "target": { "type": "routine", "id": "<PLACEHOLDER:routineId:Strength workout>" }, "before": { "preferredTime": "18:30", "triggerValue": "WED" }, "after": { "preferredTime": "09:00", "triggerValue": "SAT" }, "reason": "Evening sessions were moved twice; mornings held." }] }],
  "keepUnchanged": ["Morning focus block routine"],
  "doNotAddYet": ["Do not add a second workout day yet"] }
```
Placeholders resolve by scanning the serialized input: `planId:HEALTH` = the `planId:` line inside the HEALTH plan block the context renderer emits (E06-02 format), `routineId:<title>` = the `routineId:` line whose title matches; fall back to the first id of that kind. `x-fake-behaviour: timeout` semantics unchanged (used for the template case).

**E2E (testing-dev)** — `tests/e2e/specs/weekly-review.spec.ts` (new); stack `base + dev + fake-openai` with `WEEKLY_REVIEW_CRON_DISABLED=true` in `.env` for the run (documented in `docs/TESTING.md`); `loginAsTestUser(page, { email: 'weekly-<ts>@test.local', role: 'contributor', withAiKey: true, withOnboarding: true })`; seeding via `page.request` using `tests/e2e/helpers/seed.helper.ts` (E06-09) and `tests/e2e/helpers/commitments.helper.ts` (E05-07) extended with `seedMixedWeek(ctx, { weekStart })` (the epic-script week: WORK 5 planned / 4 completed / 1 skipped; HEALTH 3 — 1 completed FULL, 1 fallback MINIMUM + completed, 1 rescheduled twice; FAMILY 3 / 2 / 1 skipped; one day reflection) and `nextMonday(tz)`. Tests:
1. **Review shows counts and pattern**: `seedMixedWeek`; `POST /api/weekly/reviews/generate {}` via request → 200 `source 'ai'`; `goto('/progress/week')`; expect `week-tile-WORK` text `4 / 5`, `week-tile-HEALTH` `2 / 3`, `week-tile-FAMILY` `2 / 3`; `review-pattern` contains "Observation" and "morning"; one `review-proposal` containing "Wednesday" and "Saturday" with a diff table (≥`sm`).
2. **Accept proposal → Plan v2 on Path**: `GET /api/plans/:healthPlanId/versions` → 1; click **Accept** in `review-proposal`; expect "Plan updated (v2)"; `goto('/path')` → HEALTH outcome → history shows `v2` Active with rationale containing "Saturday", `v1` Superseded; API → 2 versions, `plan_change_proposals` status `ACCEPTED` via `GET /api/proposals?status=ACCEPTED`.
3. **Plan next week with load warning → approve**: click `review-approve-next-week` → URL `/progress/week/plan`; Constraints: add travel day next Wednesday; `wizard-next`; Focus "Ship the proposal draft"; `wizard-next`; Domain modes FAMILY → MAINTAIN; `wizard-next`; commitments step lists WORK Mon/Tue/Thu/Fri and HEALTH Mon/Sat (Saturday from v2), Wednesday rows marked "Travel day"; no `wizard-load-warning`; click `wizard-add-commitment` and add 7 recurring extras (loop) → after the 9th recurring item `wizard-load-warning` is visible with text "9 recurring commitments"; remove one extra → alert gone; add it back; `wizard-next`; `wizard-approve` disabled until `wizard-ack-warnings` ticked; click approve → snackbar "Next week is ready" → URL `/progress/week` with "Next week approved". API: `GET /api/commitments?from=<nextMonday>&to=<+7d>` → 13 `PLANNED` rows, four with `title 'Morning focus block'`, two `'Strength workout'` (one on Saturday), `GET /api/me/domain-modes` FAMILY `MAINTAIN`, `GET /api/weekly/reviews/current` status `APPROVED`.
4. **Today next Monday shows the commitments**: if the test-clock helper exists by then (E11-06 plans `POST /api/testing/clock` for the comeback flow), set it to next Monday 08:00 in the user's timezone, `goto('/')` → NBA title "Morning focus block"; otherwise (helper absent) assert the same through `GET /api/today?date=<nextMonday>` if E05-01 accepts a date override, else through `/path` → WORK outcome → **Upcoming commitments** listing four "Morning focus block" rows next week — and leave a `test.info().annotations` note naming which path ran.
5. **AI down → template review still renders**: new user, `seedMixedWeek`; admin fixture sets `PUT /api/ai-settings {baseUrl: 'http://fake-openai:1/v1'}` (E05-07's pattern; restored in `afterEach`); `goto('/progress/week')` → **Generate review** → tiles render, notice "coach was unavailable", no `review-proposal`, "Not yet" list may be empty.
6. **Weekly rhythm settings**: `/settings` → card **Weekly rhythm** → `/settings/weekly-rhythm`; select Friday, time 16:00; save; reload → values persisted; `GET /api/weekly/settings` → `{5, '16:00'}`.
7. **Phone layout**: `test.use({ viewport: { width: 375, height: 812 } })`: `/progress/week` shows stacked tiles, BottomNav visible, AppBar back arrow "Your Week"; wizard stepper vertical.
Run with `cd tests/e2e && npx playwright test specs/weekly-review.spec.ts`; add `"test:weekly": "playwright test specs/weekly-review.spec.ts"` to `tests/e2e/package.json`.

**Docs (docs-dev)**
- `docs/specs/weekly-review.md` (new, completing E10-02/03/04's skeleton sections): purpose and the PRD §135 loop; week addressing (Monday-start local `weekStart` strings, `defaultReviewWeek` rule, coverage/partial); data model (`weekly_reviews`, `weekly_plans`, profile columns, status machines `GENERATING → READY → APPROVED | SKIPPED`, `DRAFT → APPROVED`); aggregation rules (every count definition, time windows, tie rules, what is excluded and why — rescheduled originals, cancelled, future); reviewer contract (six outputs, pattern labelling per PRD §14.4, limits, guard, prompt version); template fallback rules; scheduling (hourly sweep, local-time match, idempotency, `WEEKLY_REVIEW_CRON_DISABLED`); mutation protocol hand-off (`WEEKLY_REVIEW` proposals, accept → v2, what approve of the *plan* does and does not touch); materialisation rules and load check (`WEEKLY_LOAD_SOFT_CAP`, `5 × weekdayMinutes`, acknowledgement semantics); screens and responsive rules; observability (audit actions, spans, log lines); **rejected alternatives** (`@db.Date` for `weekStart`; letting the reviewer mutate plans; a separate `/review` destination; blocking approve on warnings; per-minute cron; AI-worded commitments in V1; Sunday-start weeks); extension points for E11 (momentum reads `aggregateWeek`) and E12 (`coach.weekly_review_ready`, N8).
- `docs/API.md`: verify "Weekly Review" (7 routes) and "Weekly Planning" (6 routes) sections are complete with request/response examples and error codes; cross-link to Plan Proposals.
- `CLAUDE.md`: endpoints blocks, tables, env vars (E10-02/03 added them — verify), a "Weekly loop" pointer paragraph to the spec under Common Patterns (do not restate rules).
- `docs/TESTING.md`: `weekly-review.spec.ts` in the E2E section, the `weekly_review` scenario row in the fake-server table, `WEEKLY_REVIEW_CRON_DISABLED` for e2e runs.
- `docs/epics/README.md`: E10 row links to this file and to `docs/specs/weekly-review.md`; `ROADMAP.md` E10 checklist.

**UI (frontend-dev)** — only `data-testid`s missing from E10-04's list, if any.

#### Acceptance criteria

- [ ] `cd tests/e2e && npx playwright test specs/weekly-review.spec.ts` passes against `base + dev + fake-openai` compose from a clean database in under 4 minutes.
- [ ] Test 1 proves the UI counts equal the API aggregates for the seeded week and the pattern is rendered with its Observation label.
- [ ] Test 2 proves `plan_versions` is 1 before Accept and 2 after, with v2 visible on Path.
- [ ] Test 3 proves the `RECURRING_OVER_CAP` alert appears exactly when the 9th recurring item is added, that approve requires acknowledgement, and that approve materialises 13 `PLANNED` commitments including the Saturday workout from v2.
- [ ] Test 4 proves next week's commitments are visible to the user (Today via the clock helper, or Upcoming on Path) and records which path ran.
- [ ] Test 5 proves the review screen works with the provider unreachable.
- [ ] The fake scenario is selected by schema name `weekly_review` with placeholder ids resolved from the rendered context (the guard passes; `droppedProposals: 0` in the audit meta).
- [ ] `docs/specs/weekly-review.md` exists with every section listed above; `docs/API.md`, `docs/TESTING.md`, `CLAUDE.md`, `docs/epics/README.md` and `ROADMAP.md` updated.
- [ ] `npm test` (api), `npm run test:run` (web) and the visual baselines are green on the epic branch.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: explicit waits on text/roles and `toPass` polling for the GENERATING state, no fixed sleeps; unique user per test; `afterEach` restores AI settings; seed helper fails fast with the API error body
- [ ] Observability: the spec asserts `GET /api/weekly/reviews/current` exposes no `invocationId` to the client (log ids stay internal — drop it from the response DTO in E10-02 if it leaks)
- [ ] Security: the e2e user is a `contributor`; only the AI-down test uses the admin fixture; no real OpenAI key anywhere
- [ ] Config & secrets: `WEEKLY_REVIEW_CRON_DISABLED=true` for e2e documented; `OPENAI_BASE_URL` from `.env.example` (E01-12)
- [ ] Tests listed above pass locally (e2e in `tests/e2e`)
- [ ] Docs updated (spec, API.md, TESTING.md, CLAUDE.md, epics README, ROADMAP)

#### Manual test script

1. Stack from the epic script step 2 (plus `WEEKLY_REVIEW_CRON_DISABLED=true`); `cd tests/e2e && npm run test:weekly` → 7 passed.
2. Open `docs/specs/weekly-review.md` and cross-check: every count definition against `apps/api/src/weekly/aggregation.service.ts`, `WEEKLY_LOAD_SOFT_CAP` default against `configuration.ts`, the six output field names against `weekly.schema.ts`.
3. Run the epic-level manual verification steps 1–15 once end to end.

#### Out of scope

- The test-clock helper itself (E11-06); CI workflow files (declined project-wide; local runs only).
- Visual baselines for the review page (E10-04 owns them).
- Cron timing e2e (covered by the E10-02 unit test with a fake clock; the epic script's step 14 is the manual check).

#### Notes for the implementing agent

- Reuse `tests/e2e/helpers/auth.helper.ts` (`withAiKey`, `withOnboarding`), `seed.helper.ts` (E06-09) and `commitments.helper.ts` (E05-07); do not create a second login or seed helper — extend them.
- Seed through the public API only (outcomes → plans → routines → commitments → actions), never `psql`, so the spec also exercises E02/E05 contracts.
- The reviewer input is the API's, not the browser's: scenario selection must key on `text.format.name === 'weekly_review'` exactly as E06-09 does for `coach_reply`.
- Keep the "9th recurring" assertion tied to the default cap: read `WEEKLY_LOAD_SOFT_CAP` from the environment in the spec and add `cap + 1 − recurringFromRoutines` extras rather than hard-coding 7.
- If a case fails because an earlier child deviated, fix the child under its own issue and reference it in the commit; the spec is the last child.

---
