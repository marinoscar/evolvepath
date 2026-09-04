# E07 — Work Domain: Focus Sessions & Anti-Procrastination

<!-- epic-meta: slug=work-focus-anti-procrastination phase=3 -->

## Epic

### Goal
Turn a work outcome into startable sessions and get the user to actually begin them. The `planner` persona converts an outcome into milestones, planned focus sessions, an implementation intention and minimum starts (PRD §24); each session becomes a `WORK` commitment; a lightweight server-timed focus session records *starting* as evidence distinct from completing (PRD §27–§28, VISION §10); deterministic avoidance detection (PRD §25) places every work commitment on the seven-level intervention ladder (PRD §26) and, at "moved twice", asks the VISION §9 question — "What's making it hard to start?" — routing each of the eight answers to a different intervention. The weekly summary data (PRD §29) feeds E10. Everything except the coaching copy works with the AI down (PRD §120), and PRD §104 is the acceptance list this epic must satisfy.

### Background
- VISION Part I: §8 "Work: From Intention to Execution" (execution, not task storage), §9 "The Anti-Procrastination Mission" (diagnose friction; the eight answers; the "build strategy presentation" example), §10 "Start Is a Product Feature" (Start for 5/10/20, Continue, Break this down, I'm stuck; ten minutes after three days of avoidance is progress).
- PRD §22–§29 (Work requirements, outcomes, planning, detection signals, intervention ladder levels 0–6, Start flow, focus sessions, weekly review data), §104 (acceptance), §16 (structured coaching contract with `intervention_type`), §10.7 (`Commitment` statuses and `reschedule_count`), §10.9 (`Evidence` source `TIMER`), §10.10 (`Reflection.friction_tags`), §10.11 (`Obstacle`), §120 (AI failure degradation).
- Builds on E01: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` (`apps/api/src/ai/gateway/ai-gateway.service.ts`) → `{ok:true, output}` / `{ok:false, error:{code,message}}`; `AiKeyRequiredException` (`apps/api/src/ai/gateway/ai-errors.ts`); the fake OpenAI server `tools/fake-openai/server.mjs` + `infra/compose/fake-openai.compose.yml` (E01-10).
- Builds on E02-01's schema (`apps/api/prisma/schema.prisma`): `Outcome` (domain `WORK|FAMILY|HEALTH`, `importance`, `targetDate`), `Plan` + `PlanVersion` (`version`, `status`, `rationale`, `createdBy USER|AI`, `userApproved`, `previousVersionId`), `Routine` (trigger type/value, `estimatedMinutes`/`minimumMinutes`, `fallbackBehavior`), `Commitment` (status `PLANNED|READY|STARTED|COMPLETED|PARTIALLY_COMPLETED|RESCHEDULED|SKIPPED|MISSED|CANCELLED`, `rescheduleCount`, `skipReason`, full/short/minimum versions), `Evidence` (source `USER_LOG|TIMER|WORKOUT_LOG|APP_FLOW`), `Reflection`; services under `apps/api/src/outcomes/`, `apps/api/src/plans/`, `apps/api/src/commitments/` (E02-02..04); the Path screen and `/path/outcomes/:id` (E02-06).
- Builds on E05: `GET /api/today` and the next-best-action engine (E05-01, `apps/api/src/today/`), commitment actions `POST /api/commitments/:id/actions/{start,pause,continue,complete,partial,use-fallback,reschedule,skip,make-smaller}` (E05-02), the Today screen (E05-04, `apps/web/src/pages/TodayPage.tsx`) and the Start flow screen `/start/:commitmentId` (E05-05, `apps/web/src/pages/StartFlowPage.tsx`).
- Builds on E06: `Obstacle` and `PlanChangeProposal` (E06-01, migration `add_coach_and_memory`), the coaching contract `coachingResponseSchema` with `intervention_type` including the PRD §26 ladder names `NORMAL_REMINDER, ACTIVATION_REDUCTION, DECOMPOSITION, FRICTION_DIAGNOSIS, ENVIRONMENT_CHANGE, PLAN_CHALLENGE, GOAL_CHALLENGE` and `friction_question` (E06-03, `apps/api/src/coach/coaching-response.schema.ts`), the mutation protocol `POST /api/proposals/:id/{accept,edit,reject}` (E06-04), the safety pre-check (E06-06), the Coach screen (E06-07).
- Codebase facts: per-user endpoints are plain `@Auth()` with ownership in the query (`apps/api/src/pat/pat.controller.ts`); audit rows are direct `prisma.auditEvent.create` calls (`apps/api/src/email/email-settings.service.ts`); DTOs use `nestjs-zod` `createZodDto` (`apps/api/src/email/dto/update-email-settings.dto.ts`), never class-validator; every `@ApiTags` name must be declared in `apps/api/src/openapi/tags.ts` or `test/openapi/openapi-document.spec.ts` fails; integration specs use `createTestApp({ useMockDatabase: true, overrideProviders })` from `apps/api/test/helpers/test-app.helper.ts`; web tests use MSW (`apps/web/src/__tests__/mocks/handlers.ts`); Playwright login is `loginAsTestUser` in `tests/e2e/helpers/auth.helper.ts`.
- Spec file produced by this epic: `docs/specs/work-domain.md` (E07-06).

### Scope
- [ ] E07-01 feat(api): add work outcome session planning with planner proposals, apply and template fallback
- [ ] E07-02 feat(api): add focus sessions with start, extend, notes, stop and TIMER evidence
- [ ] E07-03 feat(api): add avoidance detection, intervention ladder and friction diagnosis
- [ ] E07-04 feat(web): add work outcome detail, focus timer controls and friction dialog
- [ ] E07-05 feat(api): add work weekly summary aggregation
- [ ] E07-06 test(tests): E07 end-to-end verification

### Out of scope
- A full Pomodoro app: no break scheduling, no sound, no long/short cycles (PRD §28 "not a full Pomodoro application").
- Calendar integration for protecting time (PRD §69) — sessions are commitments with a `scheduledStart` only.
- The Weekly Review screen and the AI sentence "protect mornings for high-friction work" (E10) — this epic ships the data (E07-05) only.
- Notifications N2 "Start cue" / N3 "Procrastination rescue" (E12) — the ladder level is exposed; sending is E12's decision engine.
- Memory insights derived from obstacles (E06-05 / E10) — E07 writes `Obstacle` rows, it does not summarise them.
- Family and Health commitments — the detector and focus timer run for `domain === 'WORK'` only in this epic.
- Enterprise task import (Jira, Asana, …) — VISION §8 explicitly rejects it.

### Sequencing
- E07-01 (session planning) and E07-02 (focus sessions) are independent and can run in parallel; both need E02-04's commitments and E05-02's actions.
- E07-03 depends on E07-02 (the `daysUnchanged`/evidence signals read `FocusSession` + `Evidence`) and on E06-01/E06-03 (`Obstacle`, `coachingResponseSchema`).
- E07-04 can start against MSW once E07-01/02/03 response shapes are agreed; it merges last because it touches E05's `StartFlowPage` and `TodayPage`.
- E07-05 depends on E07-02 (focus session rows) and E07-03 (ladder level on postponed commitments).
- Critical path: E07-02 → E07-03 → E07-04 → E07-06. E07-01 and E07-05 run alongside.

### Manual end-to-end verification
1. Fresh clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, and the `OPENAI_BASE_URL` override from `infra/compose/fake-openai.compose.yml`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed` (confirm `add_work_milestones` and `add_focus_sessions` in the migrate output).
3. Open http://localhost:3535/testing/login. Email `worker@test.local`, role `viewer`, "Seed OpenAI key" (E01-10) checked, "Mark onboarding complete" (E04-06) checked. Submit → Today.
4. Path → `Add outcome` (E02-06): domain Work, title "Finish strategy presentation", why "The board decides budget on it", target date = next Friday, confidence 3. Open http://localhost:3535/path/outcomes/<id>: the work variant shows empty "Milestones" and "Planned sessions" and the CTA `Plan sessions with the coach`.
5. Click it; leave target date, set "Minutes per day" 45 → a proposal appears: 3 milestones, 5 sessions (Mon–Fri, e.g. "25 min — storyline"), an implementation intention ("After I sit down with coffee → I open the deck and start the next session"), review cadence Weekly, rationale. Edit the first session's duration to 20. `Apply` → the page lists the sessions under their milestones; Today shows the first session as a Work commitment.
6. DB: `select title, scheduled_start, duration_minutes, minimum_version, milestone_id from commitments where domain = 'WORK' order by scheduled_start;` → 5 rows with milestone ids; `select version, status, created_by, user_approved from plan_versions where user_id = '<id>' order by version;` → the previous version `SUPERSEDED`, the new one `ACTIVE | AI | true`; `select trigger_type, trigger_value from routines where title like 'Focus session%';` → the implementation intention.
7. Today: on the first session card press `Reschedule` → tomorrow (E05-02). Press `Reschedule` again → later today. The card now shows "You've moved this twice. What's making it hard to start?" with `Answer`. `select reschedule_count from commitments where id = '<id>';` → 2. `curl -H "Authorization: Bearer $T" http://localhost:3535/api/today | jq '.data.domains.work.commitments[0].avoidance'` → `{ "level": 3, "interventionType": "FRICTION_DIAGNOSIS", "signals": ["RESCHEDULED_TWICE"] }` and `interventionMode: "FRICTION_PROMPT"`.
8. Click `Answer`, choose "It feels too big", submit → an intervention card: "Let's stop treating this like one task. For the next 10 minutes, write only the storyline: decision, recommendation, three arguments." with `Start 10 minutes`, `Use minimum version`, `Not now`. DB: `select obstacle_type, observed_count from obstacles where user_id = '<id>';` → `TASK_TOO_LARGE | 1`; `select friction_tags from reflections where commitment_id = '<id>';` → `{TOO_BIG}`.
9. `Start 10 minutes` → http://localhost:3535/start/<commitmentId> shows the instruction, `Begin 10:00`. Begin; type "Checked Slack" into "Distraction note" → `Add`. Reload the browser: the timer resumes at the right remaining time (server `startedAt`). Wait for 00:00 (or set `plannedMinutes: 1` via curl for the test) → "Continue another 15 minutes?" → `Continue` → planned becomes 25:00, `continuedCount` 1. Press `Done for now` → outcome "partial".
10. DB: `select planned_minutes, continued_count, distraction_notes, ended_at is not null as ended from focus_sessions;` → `25 | 1 | {"Checked Slack"} | true`; `select evidence_type, source, quantitative_value, qualitative_value from evidence where commitment_id = '<id>' order by created_at;` → an `APP_FLOW` "started" row (E05-02) then `FOCUS_SESSION | TIMER | <minutes> | partial`; `select status from commitments where id = '<id>';` → `PARTIALLY_COMPLETED`.
11. `curl -H "Authorization: Bearer $T" "http://localhost:3535/api/work/summary"` → `focusSessions.planned = 5`, `focusSessions.partial = 1`, `starts.started = 1`, `repeatedlyPostponed[0].rescheduleCount = 2`, `timeWindows.morning.planned ≥ 1`.
12. Stop the fake server (`docker compose stop fake-openai`). Create a second work outcome, `Plan sessions with the coach` → "The coach is unavailable" + `Use a standard plan` → evenly spaced template sessions → `Apply` works. Reschedule one of its sessions twice, answer "I'm tired" → the template intervention "Do only the minimum version today: <minimum>" appears (no AI). `select persona, status from ai_invocations where persona in ('planner','coach') order by created_at;` → `succeeded` rows from steps 5 and 8, `failed` rows from this step.
13. `select action, meta from audit_events where action like 'work:%' order by created_at;` → `work:sessions_applied` (×2, `{source:'ai'}` then `{source:'template'}`) and `work:friction_answered` (×2, `{answer, interventionType, level, source}`).

## Child issues

### E07-01 `feat(api): add work outcome session planning with planner proposals, apply and template fallback`

**Part of epic:** E07 · **Blocked by:** E01-06, E02-03, E02-04, E04-01, E06-01 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §24 requires the AI to convert a work outcome into milestones, planned sessions, implementation triggers, minimum starts and a review cadence, and says "each session becomes a Commitment"; PRD §104 requires "AI can break outcome into planned sessions". PRD §15 forbids the AI from mutating plans — the plan is a proposal until the user applies it — and PRD §120 requires the product to work when the model is down. There is no milestone concept in E02-01's schema, no `planner` call site for work, and no way to materialise a set of dated sessions under an outcome.

#### Proposed solution
New module `apps/api/src/work/` (new) with `work.module.ts` (imports `PrismaModule`, `AiModule`, `UserProfileModule` (E04-01), and E02's `OutcomesModule`/`PlansModule`/`CommitmentsModule` as they exist; registered in `app.module.ts`; exports nothing yet) and the sub-folder `apps/api/src/work/planning/` (new): `work-session-planning.controller.ts`, `work-session-planning.service.ts` (gateway call + guardrails + apply transaction), `work-session-plan.schema.ts` (Zod contract), `work-session-templates.ts` (deterministic fallback), `dto/{plan-sessions,apply-session-plan}.dto.ts` via `createZodDto`.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`:

```prisma
model Milestone {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  outcomeId   String    @map("outcome_id") @db.Uuid
  title       String
  order       Int
  targetDate  DateTime? @map("target_date") @db.Date
  completedAt DateTime? @map("completed_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user        User         @relation("UserMilestones", fields: [userId], references: [id], onDelete: Cascade)
  outcome     Outcome      @relation(fields: [outcomeId], references: [id], onDelete: Cascade)
  commitments Commitment[]

  @@unique([outcomeId, order])
  @@index([userId, outcomeId])
  @@map("milestones")
}
```

Add `milestoneId String? @map("milestone_id") @db.Uuid` + `milestone Milestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)` to `model Commitment`, `milestones Milestone[] @relation("UserMilestones")` to `model User`, `milestones Milestone[]` to `model Outcome`. Migration: `npm run prisma:migrate:dev -- --name add_work_milestones`. Seed: none.

**API (backend-dev)** — all routes plain `@Auth()`; the outcome must belong to the caller (`findFirst({ where: { id, userId } })` → 404 otherwise, never 403 — do not leak existence) and have `domain === 'WORK'` (400 `OUTCOME_NOT_WORK`). OpenAPI tag `Work` added to `apps/api/src/openapi/tags.ts` in the product group E02-02 introduced (after `Commitments`).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/outcomes/:id/plan-sessions` | `@Auth()` + ownership | `{ targetDate?: 'YYYY-MM-DD', availableMinutesPerDay?: 10..240 }` | 200 `{ proposalId, proposal: WorkSessionPlan, source: 'ai' }`; 412 `AI_KEY_REQUIRED`; 503 `AI_UNAVAILABLE { code, message, retryable }`; 400 `OUTCOME_NOT_WORK`, `TARGET_DATE_PAST` |
| POST | `/api/outcomes/:id/plan-sessions/template` | `@Auth()` + ownership | same body | 200 `{ proposalId, proposal, source: 'template' }` — never calls the gateway |
| POST | `/api/outcomes/:id/plan-sessions/apply` | `@Auth()` + ownership | `{ proposalId: uuid, proposal?: WorkSessionPlan }` (edited copy optional) | 201 `{ planVersionId, routineId, milestoneIds[], commitmentIds[] }`; 404 `PROPOSAL_NOT_FOUND`; 409 `PROPOSAL_NOT_PENDING`; 400 `PROPOSAL_INVALID { details[] }` |
| GET | `/api/outcomes/:id/work-plan` | `@Auth()` + ownership | — | 200 `{ milestones: Milestone[], sessions: CommitmentSummary[] (status, scheduledStart, durationMinutes, milestoneId, rescheduleCount), implementationIntention: { when, then } | null, reviewCadence, latestProposal: { id, status } | null }` |

Zod contract (`work-session-plan.schema.ts`; also the gateway `schema` with `schemaName: 'work_session_plan'`):

```ts
export const workSessionPlanSchema = z.object({
  milestones: z.array(z.object({ title: z.string().min(3).max(120), order: z.number().int().min(0) })).min(1).max(8),
  sessions: z.array(z.object({
    title: z.string().min(3).max(120),
    scheduledStart: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(10).max(120),
    milestoneIndex: z.number().int().min(0),
    minimumStart: z.object({ title: z.string().min(3).max(160), minutes: z.number().int().min(2).max(15) }),
  })).min(1).max(20),
  implementationIntention: z.object({ when: z.string().min(3).max(160), then: z.string().min(3).max(160) }),
  reviewCadence: z.enum(['DAILY', 'TWICE_WEEKLY', 'WEEKLY']),
  rationale: z.string().max(800),
});
export type WorkSessionPlan = z.infer<typeof workSessionPlanSchema>;
```

Deterministic guardrails (`WorkSessionPlanningService.validate(plan, ctx)`, applied to AI output, templates, and the edited copy at apply; failures → `details[]` naming the rule): `milestones[].order` are `0..n-1` without gaps; every `milestoneIndex < milestones.length`; every `scheduledStart` in `[now, targetDate 23:59 local]` (or `now + 14 days` when the outcome has no target date); at most 2 sessions per calendar day; per-day sum of `durationMinutes ≤ availableMinutesPerDay` (request value, else `user_profiles.weekday_minutes` (E04-01), else 60); `minimumStart.minutes < durationMinutes`; sessions sorted ascending. Guardrail violations on AI output are treated as a gateway `schema` failure (503, `retryable: false`, nothing stored).

Gateway call: `this.ai.invoke({ persona: 'planner', userId, promptVersion: 'work-session-plan.v1', instructions: WORK_PLANNING_INSTRUCTIONS, input: { today, timezone, outcome: { title, whyItMatters, successDefinition, targetDate, importance }, availableMinutesPerDay, existingSessions: [{ scheduledStart, durationMinutes }] }, schema: workSessionPlanSchema, schemaName: 'work_session_plan' })`. `WORK_PLANNING_INSTRUCTIONS` (constant in the service) states: milestones are deliverables, not phases; sessions are concrete ("25 min — storyline: decision, recommendation, three arguments"), never "work on X"; one session per weekday by default, none on weekends unless the target date forces it; every session carries a `minimumStart` a tired person can do in ≤ 10 minutes; the implementation intention is an "After/When … → I …" pair in the user's own day; do not exceed the daily minutes. Error mapping as E04-02: `no_user_key` → 412 via `AiKeyRequiredException`; `rate_limit|timeout|network|provider` → 503 `retryable: true`; `ai_disabled|no_model|schema|refusal` → 503 `retryable: false`.

Proposal storage: reuse E06-01's `PlanChangeProposal` (status `PROPOSED`) with `diff = { kind: 'work_session_plan', outcomeId, source: 'ai' | 'template', plan }` and `reason = plan.rationale`; `proposalId` is its id. `apply` loads it by `(id, userId)`, requires `status === 'PROPOSED'`, re-validates the edited `proposal` if given (else the stored one), then in one `prisma.$transaction`: create `Milestone` rows (`order` from the plan); resolve the outcome's `Plan` and its `ACTIVE` `PlanVersion` (create the plan with a v1 if the outcome has none — E02-06 outcomes created outside onboarding may lack one); create `PlanVersion` `{ version: n+1, status: 'ACTIVE', createdBy: source === 'ai' ? 'AI' : 'USER', userApproved: true, rationale, previousVersionId, fallbackStrategy: 'Minimum starts: ' + joined minimumStart titles }` and set the previous version `SUPERSEDED` (E02-03's activate semantics — call `PlansService.createVersion`/`activate` if they accept a `tx`, otherwise write directly, never nest a `$transaction`); create one `Routine` under that plan version `{ title: 'Focus session: <outcome title>', triggerType: 'AFTER', triggerValue: implementationIntention.when, frequency: 'PLANNED', estimatedMinutes: median session duration, minimumMinutes: min minimumStart.minutes, fallbackBehavior: implementationIntention.then }` (E02-01 field names — check `schema.prisma`); create one `Commitment` per session `{ domain: 'WORK', status: 'PLANNED', title, scheduledStart, scheduledEnd: start + duration, durationMinutes, importance: outcome.importance, commitmentType: 'FOCUS_SESSION', fullVersion: '<title> — <duration> min', shortVersion: '<title> — <ceil(duration/2)> min', minimumVersion: '<minimumStart.title> — <minimumStart.minutes> min', routineId, milestoneId, sourcePlanId }`; mark the proposal `ACCEPTED` (or `EDITED` when an edited copy was sent) with `appliedPlanVersionId`. After the transaction: audit `prisma.auditEvent.create({ actorUserId: userId, action: 'work:sessions_applied', targetType: 'outcome', targetId: outcome.id, meta: { source, edited, milestones, sessions, planVersionId } })`. Re-applying the same outcome later (a second proposal) appends new milestones with `order` continuing from the current max and does not touch existing commitments.

Templates (`work-session-templates.ts`, pure, exported `buildTemplateSessionPlan({ outcome, now, timezone, targetDate, availableMinutesPerDay })`): `N = min(10, weekdays between tomorrow and targetDate inclusive)` (no target date → the next 5 weekdays); sessions evenly spaced over those weekdays at 09:00 local, `durationMinutes = min(availableMinutesPerDay, 45)`; milestones `["Clarify what done looks like", "Produce a rough first version", "Refine and finish"]` with sessions assigned by thirds; every `minimumStart = { title: 'Open the work and write the next three bullets', minutes: 10 }`; `implementationIntention = { when: 'After I sit down at my desk in the morning', then: 'I open "<outcome title>" and start the next planned session' }`; `reviewCadence: 'WEEKLY'`; `rationale` says it is a standard schedule to adjust. Output must pass `workSessionPlanSchema` and the guardrails (unit-tested).

Log one line per propose/apply (`Work plan-sessions user=<id> outcome=<id> source=<ai|template> sessions=<n> milestones=<n>`), never the titles.

**UI (frontend-dev)** — n/a here; `services/api.ts` functions (`planOutcomeSessions`, `planOutcomeSessionsTemplate`, `applyOutcomeSessionPlan`, `getOutcomeWorkPlan`) and types (`WorkSessionPlan`, `Milestone`, `OutcomeWorkPlan`) are added by E07-04.

**Tests (testing-dev)**
- `work-session-plan.schema.spec.ts`: accepts the fake server's fixture; rejects 21 sessions, `durationMinutes: 5`, `minimumStart.minutes: 20`, a non-ISO `scheduledStart`, `reviewCadence: 'MONTHLY'`.
- `work-session-templates.spec.ts`: no target date → 5 weekday sessions at 09:00 in `America/Costa_Rica` and `Asia/Tokyo`; target date in 3 days → 3 sessions; target date 6 weeks out → capped at 10; `availableMinutesPerDay: 20` → 20-minute sessions; output passes schema + guardrails.
- `work-session-planning.service.spec.ts` (gateway + prisma mocked): `invoke` called with `persona: 'planner'`, `promptVersion: 'work-session-plan.v1'`, `schemaName: 'work_session_plan'`; `{ok:false, code:'no_user_key'}` → 412; `{ok:false, code:'timeout'}` → 503 `retryable: true`; AI output with 3 sessions on one day → 503 `code: 'schema'` and no `planChangeProposal.create`; `apply` runs inside one `$transaction`, creates milestones/version/routine/commitments with the field values above, supersedes the previous version, marks the proposal `ACCEPTED`/`EDITED`, audits once; `apply` twice → 409 `PROPOSAL_NOT_PENDING`; non-WORK outcome → 400; another user's outcome → 404.
- `apps/api/test/work-planning.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true, overrideProviders: [{ provide: AiGatewayService, useValue: stub }] })`): 401 on every route; propose → apply round-trip returns ids; `template` never calls the stub; `GET /work-plan` reflects applied sessions.
- `test/openapi/openapi-document.spec.ts` passes with the new `Work` tag.

**Docs (docs-dev)** — `docs/API.md` new "Work" section (the four routes, error codes, the Zod contract); `CLAUDE.md` "API Endpoints" list and "Database Tables" (`milestones`); `docs/specs/work-domain.md` is written by E07-06 — leave a pointer in the PR, not a partial file.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates `milestones` with the unique `(outcome_id, order)` and adds `commitments.milestone_id` with `ON DELETE SET NULL`
- [ ] `POST /api/outcomes/:id/plan-sessions` returns a proposal satisfying the schema and guardrails and creates exactly one `plan_change_proposals` row (`PROPOSED`) — `commitments`, `milestones`, `routines`, `plan_versions` gain no rows
- [ ] `POST …/plan-sessions/apply` creates milestones, one new `ACTIVE` plan version (previous `SUPERSEDED`), one routine carrying the implementation intention, and one `PLANNED` `WORK` commitment per session with full/short/minimum versions and `milestone_id`, atomically
- [ ] An edited proposal sent to `apply` is re-validated; a per-day total above `availableMinutesPerDay` is rejected with 400 `PROPOSAL_INVALID` and a `details[]` entry
- [ ] Applying the same proposal twice returns 409 and creates nothing
- [ ] `POST …/plan-sessions/template` produces evenly spaced weekday sessions until the target date without calling the gateway, and `apply` accepts it with `created_by = USER`
- [ ] With no user key, `plan-sessions` returns 412 `AI_KEY_REQUIRED`; with the fake server forcing `timeout`, 503 with `retryable: true`
- [ ] A `FAMILY` outcome returns 400 `OUTCOME_NOT_WORK`; another user's outcome returns 404
- [ ] `GET /api/outcomes/:id/work-plan` lists milestones in order with their sessions and the implementation intention
- [ ] No outcome or session titles appear in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures never surface as 500; every 4xx carries a stable `code`; `$transaction` failure leaves no milestone/commitment/version behind and the proposal stays `PROPOSED`
- [ ] Observability: one log line per propose/apply; the gateway writes the `ai_invocations` row; audit `work:sessions_applied`
- [ ] Security: all routes `@Auth()`; ownership on outcome and proposal by `userId`; `source` read from the stored proposal, never from the body; proposal text is user content — stored, never interpreted
- [ ] Config & secrets: none new; `availableMinutesPerDay` default chain documented (request → profile → 60)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–4, then obtain a token (`/testing/login` sets one; copy from devtools or use `appctl login`).
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"availableMinutesPerDay":45}' http://localhost:3535/api/outcomes/<id>/plan-sessions` → `proposalId` + 5 sessions; `select count(*) from commitments where domain='WORK';` unchanged.
3. `curl -X POST … -d '{"proposalId":"<pid>"}' …/plan-sessions/apply` → 201 with ids; repeat → 409. Epic step 6 DB checks.
4. `curl … -d '{"proposalId":"<pid2>","proposal":<copy with two 45-min sessions on the same day and availableMinutesPerDay 45>}'` → 400 `PROPOSAL_INVALID` with `details[0]` naming the daily cap.
5. `docker compose stop fake-openai`; `plan-sessions` → 503; `plan-sessions/template` → 5 sessions; `apply` → 201; `select created_by from plan_versions order by version desc limit 1;` → `USER`.

#### Out of scope
- Any UI (E07-04), the friction/ladder logic (E07-03), focus timing (E07-02)
- Milestone editing endpoints beyond what `apply` creates (E02-06's outcome editor may add them later)
- Rescheduling the whole session plan when the target date moves (E10 weekly planning)

#### Notes for the implementing agent
- Copy E04-02's shape exactly for the propose → validate → apply flow, the gateway error mapping and the template fallback (`apps/api/src/onboarding/onboarding-proposal.service.ts`, `onboarding-templates.ts`).
- Gateway contract: `apps/api/src/ai/gateway/ai-gateway.types.ts`; never call the provider directly.
- `PlanChangeProposal` is E06-01's model — if it carries a `kind`/`type` column, set it to `WORK_SESSION_PLAN` instead of nesting `kind` in `diff`; if E06-04's accept endpoint would otherwise try to apply this proposal as a generic diff, make `POST /proposals/:id/accept` return 409 `PROPOSAL_KIND_UNSUPPORTED` for this kind and say so in `docs/API.md`.
- Field names on `PlanVersion`/`Routine`/`Commitment` are E02-01's; read `schema.prisma` before writing the create payloads. `commitmentType` may not exist — if it does not, encode `FOCUS_SESSION` in `routineId` + `milestoneId` presence and do not add a column here.
- Dates: compute weekdays and 09:00 local with `Intl.DateTimeFormat` parts as E04-02 did; add no date library.
- Zod via `nestjs-zod` `createZodDto`; Fastify, not Express. Register the `Work` tag in `apps/api/src/openapi/tags.ts`.

---

### E07-02 `feat(api): add focus sessions with start, extend, notes, stop and TIMER evidence`

**Part of epic:** E07 · **Blocked by:** E02-04, E05-02 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §27–§28: Start shows a timer, one-sentence instruction, stop/continue controls, asks "Continue another 15 minutes?" at completion, allows a distraction note, and "starting counts as evidence distinct from completing"; PRD §104: "Start is recorded separately from completion". VISION §10: ten minutes on something avoided for three days is meaningful progress and the system should reinforce it. E05-05's Start flow keeps its timer client-side with a persisted start time but nothing on the server knows how long the user actually focused, how often they continued, or what distracted them — so no `TIMER` evidence (PRD §10.9) and no data for PRD §29's "planned vs completed focus sessions".

#### Proposed solution
A `FocusSession` row with server timestamps, owned by the user and bound to one commitment, and five endpoints under `apps/api/src/work/focus/` (new): `focus-session.controller.ts`, `focus-session.service.ts`, `dto/{start-focus-session,extend-focus-session,focus-session-note,stop-focus-session}.dto.ts`, `dto/focus-session-response.dto.ts`.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`:

```prisma
enum FocusSessionOutcome {
  DONE
  PARTIAL
  ABANDONED
}

model FocusSession {
  id               String               @id @default(uuid()) @db.Uuid
  userId           String               @map("user_id") @db.Uuid
  commitmentId     String               @map("commitment_id") @db.Uuid
  plannedMinutes   Int                  @map("planned_minutes")
  instruction      String?
  startedAt        DateTime             @default(now()) @map("started_at") @db.Timestamptz
  endedAt          DateTime?            @map("ended_at") @db.Timestamptz
  outcome          FocusSessionOutcome? 
  continuedCount   Int                  @default(0) @map("continued_count")
  distractionNotes String[]             @default([]) @map("distraction_notes")
  evidenceId       String?              @unique @map("evidence_id") @db.Uuid
  createdAt        DateTime             @default(now()) @map("created_at") @db.Timestamptz

  user       User       @relation("UserFocusSessions", fields: [userId], references: [id], onDelete: Cascade)
  commitment Commitment @relation(fields: [commitmentId], references: [id], onDelete: Cascade)
  evidence   Evidence?  @relation(fields: [evidenceId], references: [id], onDelete: SetNull)

  @@index([userId, startedAt])
  @@index([commitmentId])
  @@map("focus_sessions")
}
```

Add `focusSessions FocusSession[] @relation("UserFocusSessions")` to `model User`, `focusSessions FocusSession[]` to `model Commitment`, `focusSession FocusSession?` to `model Evidence`. Migration: `npm run prisma:migrate:dev -- --name add_focus_sessions`. Seed: none. "One active session per user" is enforced in the service (`findFirst({ where: { userId, endedAt: null } })` inside the create transaction) — a partial unique index is deliberately not used so a crashed client can always be recovered through `GET /focus-sessions/active`.

**API (backend-dev)** — all routes `@Auth()`; every query scoped by `userId`; the commitment must belong to the caller (404 otherwise) and have `domain === 'WORK'` (400 `COMMITMENT_NOT_WORK`). OpenAPI tag `Work` (E07-01; declare it here if E07-01 has not merged).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/focus-sessions` | `@Auth()` | `{ commitmentId: uuid, plannedMinutes: 1..180, instruction?: ≤ 240 }` | 201 `FocusSession` + `serverNow`; 409 `FOCUS_SESSION_ACTIVE { activeSessionId }`; 400 `COMMITMENT_NOT_STARTABLE` when status ∈ `COMPLETED|CANCELLED` |
| GET | `/api/focus-sessions/active` | `@Auth()` | — | 200 `{ session: FocusSession \| null, serverNow }` |
| POST | `/api/focus-sessions/:id/extend` | `@Auth()` | `{ minutes: 1..60 }` | 200 `FocusSession`; 409 `FOCUS_SESSION_ENDED` |
| POST | `/api/focus-sessions/:id/note` | `@Auth()` | `{ text: 1..280 }` | 200 `FocusSession`; 409 when ended; 400 `TOO_MANY_NOTES` above 20 |
| POST | `/api/focus-sessions/:id/stop` | `@Auth()` | `{ outcome: 'done' \| 'partial' \| 'abandoned' }` | 200 `{ session, evidenceId, commitmentStatus, actualMinutes }`; 409 when already ended |
| GET | `/api/focus-sessions?commitmentId=&from=&to=` | `@Auth()` | query | 200 `{ sessions: FocusSession[] }` (own rows, newest first, max 100) |

`FocusSession` response DTO: `{ id, commitmentId, plannedMinutes, instruction, startedAt, endedAt, outcome, continuedCount, distractionNotes, actualMinutes (null until ended), remainingSeconds (computed from `serverNow` while active; ≤ 0 means "ask to continue") }`.

`FocusSessionService`:
- `start(userId, dto)`: transaction — reject an active session (409 with its id so the client can resume rather than lose it); create the row; then call E05-02's start action (`CommitmentActionsService.start(userId, commitmentId)` in `apps/api/src/commitments/`) so the commitment becomes `STARTED` and the `APP_FLOW` "started" evidence is written exactly as any other start — if the commitment is already `STARTED` (a second session on the same commitment) skip the action, never write a second start evidence. Log `Focus start user=<id> commitment=<id> planned=<n>`.
- `extend(userId, id, minutes)`: `plannedMinutes += minutes`, `continuedCount += 1`.
- `addNote(userId, id, text)`: `distractionNotes: { push: text.trim() }` (cap 20).
- `stop(userId, id, outcome)`: `endedAt = now()`, `actualMinutes = max(1, round((endedAt − startedAt) / 60000))`; create `Evidence { userId, commitmentId, evidenceType: 'FOCUS_SESSION', source: 'TIMER', quantitativeValue: actualMinutes, qualitativeValue: outcome, confidence: 1, occurredAt: endedAt }` (E02-04's `EvidenceService.create` if it accepts a `tx`, else direct) and link `evidenceId`; transition the commitment through E05-02's actions: `done` → `complete` (→ `COMPLETED`), `partial` → `partial` (→ `PARTIALLY_COMPLETED`), `abandoned` → `pause` (→ back to `PLANNED`, so the next-best-action engine can offer it again today; the `TIMER` evidence is still recorded — starting counts, VISION §10). Log `Focus stop user=<id> commitment=<id> outcome=<o> actual=<n> continued=<c>`.
- `getActive(userId)`: the row with `endedAt: null`, or null.

Audit: none per session (product data, high volume); the `Evidence` row is the record.

**UI (frontend-dev)** — n/a here; `services/api.ts` functions (`startFocusSession`, `getActiveFocusSession`, `extendFocusSession`, `addFocusSessionNote`, `stopFocusSession`, `listFocusSessions`) and the `FocusSession` type are added by E07-04.

**Tests (testing-dev)**
- `focus-session.service.spec.ts` (prisma + `CommitmentActionsService` mocked): `start` creates the row and calls `start` action once; second `start` for the same user → 409 with `activeSessionId`; `start` on an already-`STARTED` commitment does not call the action; non-WORK commitment → 400; `extend` increments both fields and rejects after `endedAt`; `addNote` trims, appends, rejects the 21st; `stop('done')` writes `TIMER` evidence with `quantitativeValue` = elapsed minutes (fake timers: 10 min → 10) and calls `complete`; `stop('partial')` → `partial`; `stop('abandoned')` → `pause` and evidence still written; `stop` twice → 409; `remainingSeconds` is negative after the planned time.
- `apps/api/test/focus-sessions.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true })`): 401 on every route; start → active → extend → note → stop round trip; a second user cannot read or stop the first user's session (404).

**Docs (docs-dev)** — `docs/API.md` "Work" section (six routes, DTO, error codes); `CLAUDE.md` "Database Tables" (`focus_sessions`) and "API Endpoints"; `docs/ARCHITECTURE.md` data-model list.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates `focus_sessions` and the `FocusSessionOutcome` enum with cascading `user_id`/`commitment_id` FKs
- [ ] `POST /api/focus-sessions` creates a session with server `startedAt`, moves the commitment to `STARTED`, and writes exactly one `APP_FLOW` start evidence (none if the commitment was already `STARTED`)
- [ ] A second `POST /api/focus-sessions` while one is active returns 409 with `activeSessionId`; `GET /api/focus-sessions/active` returns that session with a `remainingSeconds` computed from the server clock
- [ ] `extend {minutes: 15}` raises `plannedMinutes` by 15 and `continuedCount` by 1; `note` appends to `distractionNotes`
- [ ] `stop {outcome:'partial'}` after ~10 minutes writes an `evidence` row `source = 'TIMER'`, `quantitative_value = 10`, `qualitative_value = 'partial'` and the commitment is `PARTIALLY_COMPLETED`; `'done'` → `COMPLETED`; `'abandoned'` → `PLANNED` with the evidence still present
- [ ] Any mutation on an ended session returns 409 `FOCUS_SESSION_ENDED`
- [ ] Another user's session id returns 404 on every route
- [ ] No instruction or note text appears in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: every 4xx carries a stable `code`; the start transaction rolls back the row if the commitment action throws; evidence creation and the status transition happen in one transaction
- [ ] Observability: the two log lines above (ids and numbers only); OTel span attributes `work.focus.planned_minutes`, `work.focus.outcome` on stop
- [ ] Security: all routes `@Auth()`; `userId` in every query; notes are user content — stored, never interpreted or logged
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–6 (a `WORK` commitment exists), token in `$T`.
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"commitmentId":"<cid>","plannedMinutes":1,"instruction":"Write the decision statement"}' http://localhost:3535/api/focus-sessions` → 201; repeat → 409 with `activeSessionId`.
3. `curl … /api/focus-sessions/active` → `remainingSeconds` counting down; after a minute it is ≤ 0.
4. `curl -X POST … -d '{"minutes":15}' …/focus-sessions/<sid>/extend` → `plannedMinutes: 16`, `continuedCount: 1`; `-d '{"text":"Checked Slack"}' …/note` → note appended.
5. `curl -X POST … -d '{"outcome":"partial"}' …/stop` → `actualMinutes ≥ 1`, `commitmentStatus: "PARTIALLY_COMPLETED"`; epic step 10 DB checks; `…/stop` again → 409.

#### Out of scope
- The timer UI, distraction-note input and "Continue 15 more" button (E07-04)
- Push/sound at timer end (E12 / not in V1)
- Focus sessions for `FAMILY`/`HEALTH` commitments — E09's workout runner has its own session model

#### Notes for the implementing agent
- The start/complete/partial/pause transitions belong to E05-02 (`apps/api/src/commitments/commitment-actions.service.ts` or wherever E05-02 put them) — call them, do not re-implement the state machine or write a second `APP_FLOW` evidence.
- Evidence fields (`evidenceType`, `quantitativeValue`, `qualitativeValue`, `occurredAt`) are E02-01's names — verify in `schema.prisma`.
- `remainingSeconds` is computed on the server from `startedAt + plannedMinutes` against `Date.now()` and returned with `serverNow` so a phone with a skewed clock still resumes correctly — never trust a client-supplied elapsed time.
- `distractionNotes: { push }` is a Prisma scalar-list write; the 20-cap check reads the row first inside the same transaction.
- Pattern for own-resource controllers: `apps/api/src/pat/pat.controller.ts`; DTOs via `createZodDto`; Fastify, not Express.

---

### E07-03 `feat(api): add avoidance detection, intervention ladder and friction diagnosis`

**Part of epic:** E07 · **Blocked by:** E07-02, E05-01, E05-02, E06-01, E06-03, E06-06 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §25 lists the avoidance signals (repeated rescheduling, unchanged task across days, repeated short skips, explicit "later", high-priority work displaced by lower-priority completions) and requires that avoidance "must not be inferred solely from one miss"; PRD §26 fixes a seven-level ladder from normal reminder to goal challenge; VISION §9 requires the coach to ask "You've moved this twice. What is making it hard to start?" and route each of eight answers to a different intervention; PRD §104: "repeated reschedules trigger friction intervention". E05's next-best-action engine sees `rescheduleCount` but has no notion of a level, E06's Coaching Reasoner has the `intervention_type` vocabulary but no deterministic input telling it which rung the user is on, and nothing stores the friction answer as an `Obstacle` (PRD §10.11).

#### Proposed solution
A pure detector, a signal collector, a friction endpoint, and the ladder level on `GET /today`, all under `apps/api/src/work/avoidance/` (new): `avoidance-detector.ts` (pure), `avoidance-signals.service.ts` (DB → signals), `avoidance.service.ts` (assess a commitment; cached per request), `friction.controller.ts`, `friction.service.ts` (Obstacle + Reflection + coach call), `friction-templates.ts` (deterministic copy), `friction-answers.ts` (the answer → intervention table), `time-window.ts` (shared with E07-05), `dto/answer-friction.dto.ts`.

**Data (database-dev)** — n/a. Writes into E06-01's `Obstacle` (`obstacleType`, `description`, `domain`, `observedCount`, `confidence`, `lastObservedAt`, `interventionHistory Json`) and E02-01's `Reflection` (`commitmentId`, `userText`, `frictionTags`). New `obstacleType` values used: `AMBIGUOUS_WORK_TASK`, `TASK_TOO_LARGE`, `LOW_ENERGY_WINDOW`, `LOW_MOTIVATION`, `URGENCY_DISPLACEMENT`, `PERFECTIONISM`, `INFORMATION_GAP`, `OTHER` — if E06-01 made `obstacleType` an enum, extend it with these values in a migration `add_work_obstacle_types`; if it is a string column, no migration.

**API (backend-dev)**

*Detector* — `apps/api/src/work/avoidance/avoidance-detector.ts` (new), pure, no imports from Nest/Prisma:

```ts
export enum AvoidanceLevel { NORMAL_REMINDER = 0, ACTIVATION_REDUCTION = 1, DECOMPOSITION = 2, FRICTION_DIAGNOSIS = 3, ENVIRONMENT_CHANGE = 4, PLAN_CHALLENGE = 5, GOAL_CHALLENGE = 6 }
export type AvoidanceSignalKey = 'RESCHEDULED_TWICE' | 'UNCHANGED_3_DAYS' | 'SHORT_SKIPS' | 'EXPLICIT_LATER' | 'DISPLACED_BY_LOWER_IMPORTANCE' | 'SAME_WINDOW_FAILURES';
export interface AvoidanceSignals {
  rescheduleCount: number;               // Commitment.rescheduleCount
  daysUnchanged: number;                 // whole days the commitment has sat in PLANNED/READY/RESCHEDULED with no evidence
  shortSkipCount: number;                // SKIPPED|MISSED commitments of the same outcome in the last 14 days
  explicitLaterCount: number;            // skip/reschedule reasons matching /\b(later|tomorrow|not now)\b/i, same outcome, 14 days
  displacedByLowerImportanceCount: number; // past days this commitment was due and untouched while a lower-importance WORK commitment was COMPLETED
  sameWindowFailureCount: number;        // SKIPPED|MISSED|RESCHEDULED occurrences of the same outcome in the same time window, 21 days
  weeksOfEvidence: number;               // floor(days since the outcome was created / 7)
}
export interface AvoidanceAssessment { level: AvoidanceLevel; interventionType: InterventionType; signals: AvoidanceSignalKey[]; rationale: string }
export function detectAvoidance(s: AvoidanceSignals): AvoidanceAssessment
```

Deterministic rule (document it verbatim in the file header and in `docs/specs/work-domain.md`):
1. A signal is *active* when it crosses its threshold: `RESCHEDULED_TWICE` ← `rescheduleCount ≥ 2`; `UNCHANGED_3_DAYS` ← `daysUnchanged ≥ 3`; `SHORT_SKIPS` ← `shortSkipCount ≥ 2`; `EXPLICIT_LATER` ← `explicitLaterCount ≥ 2`, or `≥ 1` when any other signal is active; `DISPLACED_BY_LOWER_IMPORTANCE` ← `count ≥ 2`; `SAME_WINDOW_FAILURES` ← `count ≥ 3`. A single reschedule, skip, or "later" never activates anything (PRD §25) → level 0.
2. `base` = the highest of the active signals' own rungs: `UNCHANGED_3_DAYS` → 1, `SHORT_SKIPS` → 2, `RESCHEDULED_TWICE` → 3, `EXPLICIT_LATER` → 3, `DISPLACED_BY_LOWER_IMPORTANCE` → 4, `SAME_WINDOW_FAILURES` → 5. No active signal → level 0 and stop.
3. `extra` = occurrences beyond each active signal's threshold, summed: `(rescheduleCount − 2) + (daysUnchanged − 3) + (shortSkipCount − 2) + (explicitLaterCount − 2, min 0) + (displaced − 2) + (sameWindow − 3)`, each term clamped at ≥ 0 and only for active signals. The level rises **one step per additional occurrence**: `level = base + extra`.
4. Caps: `level ≤ 4` unless `weeksOfEvidence ≥ 3` (levels 5–6 require three weeks of evidence, PRD §26 L6 "for three weeks"); level 5 additionally requires `SAME_WINDOW_FAILURES` active (PRD §26 L5 "keeps failing at 4 PM"), otherwise clamp to 4; level 6 requires `weeksOfEvidence ≥ 3` and `base + extra ≥ 6`. Final `level = min(level, 6)`.
5. `interventionType` = the PRD §26 name for the level (`AvoidanceLevel[level]`); `rationale` is a fixed sentence per level with the numbers substituted (e.g. "Moved 2 times, untouched for 4 days"), never AI-written.

*Signals* — `AvoidanceSignalsService.collect(userId, commitment, now, timezone): Promise<AvoidanceSignals>` reads the commitment, its outcome (via `sourcePlanId` → plan → outcome), the same outcome's commitments in the last 21 days, this commitment's `Evidence`, and the user's `WORK` commitments completed on the days this one was due; `daysUnchanged = 0` once any `Evidence` row exists for the commitment; time windows via `time-window.ts` `timeWindowOf(date, timezone): 'morning' | 'afternoon' | 'evening'` (`< 12:00`, `12:00–16:59`, `≥ 17:00` local). One query per table, batched for all of today's work commitments (`collectMany`) so `GET /today` does not go N+1.

*Ladder on Today* — E05-01's `TodayService` calls `AvoidanceService.assessMany(userId, workCommitments)` and adds to every `WORK` commitment card: `avoidance: { level, interventionType, signals }` and `interventionMode: 'NONE' | 'SUGGEST_MINIMUM' | 'SUGGEST_DECOMPOSITION' | 'FRICTION_PROMPT' | 'ENVIRONMENT_HINT' | 'PLAN_REVIEW'` mapped from the level (0 → `NONE`, 1 → `SUGGEST_MINIMUM`, 2 → `SUGGEST_DECOMPOSITION`, 3 → `FRICTION_PROMPT`, 4 → `ENVIRONMENT_HINT`, 5–6 → `PLAN_REVIEW`), except that `FRICTION_PROMPT` becomes `SUGGEST_DECOMPOSITION` when a `Reflection` with `frictionTags` exists for the commitment in the last 7 days (asked once, then act on the answer). The next-best-action rationale (E05-01) appends the assessment's `rationale` when `level ≥ 1`. Non-WORK cards get `avoidance: null`, `interventionMode: 'NONE'`.

*Friction endpoint* — OpenAPI tag `Work`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/commitments/:id/friction` | `@Auth()` + ownership (404) | `{ answer: FrictionAnswer, text?: ≤ 500 }` (`text` required for `OTHER`) | 200 `{ level, obstacleId, reflectionId, intervention: { interventionType, userMessage, recommendedAction?: { title, durationMinutes }, fallbackAction?: { title, durationMinutes }, proposalId?: string, source: 'ai' \| 'template' } }`; 400 `COMMITMENT_NOT_WORK`, `TEXT_REQUIRED` |
| GET | `/api/commitments/:id/avoidance` | `@Auth()` + ownership | — | 200 `AvoidanceAssessment` (for the outcome detail page and debugging) |

`friction-answers.ts` — the VISION §9 table, exported as `FRICTION_ANSWERS` (order is the dialog order):

| `FrictionAnswer` | Label | `interventionType` | `obstacleType` | Template intervention |
|---|---|---|---|---|
| `DONT_KNOW_WHERE_TO_BEGIN` | I don't know where to begin | `ACTIVATION_REDUCTION` | `AMBIGUOUS_WORK_TASK` | recommended: "Start for 10 minutes: open the work and write one sentence stating what done looks like" (10); fallback: minimum version (5) |
| `TOO_BIG` | It feels too big | `DECOMPOSITION` | `TASK_TOO_LARGE` | recommended: "Let's stop treating this like one task. For the next 10 minutes, write only the first three bullets of '<title>'." (10); fallback: minimum version |
| `TIRED` | I'm tired | `MINIMUM_VERSION` | `LOW_ENERGY_WINDOW` | recommended: the commitment's `minimumVersion` (its minutes); fallback: "Reschedule to your next morning slot" |
| `DONT_WANT_TO` | I don't want to do it | `RECONNECT_REASON` | `LOW_MOTIVATION` | userMessage quotes the outcome's `whyItMatters`; recommended: "Give it 5 minutes, then decide" (5) |
| `SOMETHING_URGENT` | Something more urgent came up | `PROTECTED_RESCHEDULE` | `URGENCY_DISPLACEMENT` | `proposalId` for a `PlanChangeProposal` moving the session to the next free slot of the same window tomorrow with `protected: true` (E06-04 accept applies it); recommended: none |
| `WORRIED_ABOUT_QUALITY` | I'm worried I won't do it well | `PERFECTIONISM_REFRAME` | `PERFECTIONISM` | userMessage: "A rough draft is the goal, not the final version."; recommended: "Write a deliberately bad first draft for 10 minutes" (10) |
| `NEED_MORE_INFO` | I need more information | `CLARIFY_INFO_GAP` | `INFORMATION_GAP` | recommended: "Spend 10 minutes listing exactly what you need to know and who has it" (10) |
| `OTHER` | Other | `FREE_TEXT` | `OTHER` | userMessage acknowledges the text; recommended: minimum version |

E07-03 extends E06-03's `interventionTypeEnum` in `apps/api/src/coach/coaching-response.schema.ts` with the six additive values `MINIMUM_VERSION`, `RECONNECT_REASON`, `PROTECTED_RESCHEDULE`, `PERFECTIONISM_REFRAME`, `CLARIFY_INFO_GAP`, `FREE_TEXT` (E06's tests keep passing; the enum only grows).

`FrictionService.answer(userId, commitmentId, dto)`:
1. Load the commitment (+ outcome), assess the level, run E06-06's safety pre-check on `text` (a `redirect` decision short-circuits to the safety copy with `interventionType: 'FRICTION_DIAGNOSIS'` and no obstacle write).
2. Transaction: create `Reflection { commitmentId, userText: text ?? null, frictionTags: [answer] }`; upsert `Obstacle` by `(userId, domain: 'WORK', obstacleType)` — `observedCount += 1`, `lastObservedAt = now`, `confidence = min(1, observedCount / 3)`, `description = label`, `interventionHistory: [...existing, { at, commitmentId, answer, level, interventionType }]` (cap 50 entries).
3. Coach call: `this.ai.invoke({ persona: 'coach', userId, promptVersion: 'work-friction.v1', instructions: FRICTION_INSTRUCTIONS, input: { commitment: { title, minimumVersion, scheduledStart, rescheduleCount }, outcome: { title, whyItMatters }, answer, text, requiredInterventionType, level, coachingStyle }, schema: coachingResponseSchema, schemaName: 'coaching_response' })`. `FRICTION_INSTRUCTIONS`: reply in ≤ 3 sentences in the user's coaching style (E04-01 `coachingStyle`), set `intervention_type` to `requiredInterventionType`, give one `recommended_action` of ≤ 10 minutes that names the *first concrete thing to write or open*, no motivational theater (VISION §9). Server guard: if `ok` but `output.intervention_type !== requiredInterventionType` or `recommended_action.duration_minutes > 15`, discard and use the template (log `Friction ai_override reason=<…>`); any `{ok:false}` → template. `source` reflects what was returned.
4. For `SOMETHING_URGENT`: create the `PlanChangeProposal` (`diff: { kind: 'move_commitment', commitmentId, to: <next same-window slot tomorrow>, protected: true }`, `reason`) and return its id; E06-04 `accept` applies it (moves `scheduledStart`, does **not** increment `rescheduleCount` — a protected move is not avoidance).
5. After the transaction: audit `prisma.auditEvent.create({ actorUserId: userId, action: 'work:friction_answered', targetType: 'commitment', targetId, meta: { answer, level, interventionType, source } })`. Log `Friction user=<id> commitment=<id> answer=<a> level=<n> source=<s>` — never `text`.

**UI (frontend-dev)** — n/a here; E07-04 adds `answerFriction`, `getCommitmentAvoidance` in `services/api.ts` and the `FrictionAnswer`, `FrictionIntervention`, `AvoidanceAssessment` types; E05-04's Today types gain `avoidance` and `interventionMode` (E07-04).

**Tests (testing-dev)**
- `avoidance-detector.spec.ts` — one case per level and per rule: all zeros → 0; `rescheduleCount: 1` → 0; `shortSkipCount: 1` → 0; `explicitLaterCount: 1` alone → 0; `daysUnchanged: 3` → 1 (`UNCHANGED_3_DAYS`); `daysUnchanged: 4` → 2; `shortSkipCount: 2` → 2; `rescheduleCount: 2` → 3 (`RESCHEDULED_TWICE`, the e2e case); `rescheduleCount: 3` → 4; `explicitLaterCount: 2` → 3; `explicitLaterCount: 1` + `daysUnchanged: 3` → 2 (base 1 + extra 1 from the now-active later signal); `displaced: 2` → 4; `rescheduleCount: 4, weeksOfEvidence: 1` → capped 4; `rescheduleCount: 4, weeksOfEvidence: 3, sameWindow: 0` → 4 (level 5 needs the window signal); `sameWindow: 3, weeksOfEvidence: 3` → 5; `sameWindow: 4, rescheduleCount: 3, weeksOfEvidence: 3` → 6; `sameWindow: 3, weeksOfEvidence: 2` → 4; `interventionType` matches `AvoidanceLevel[level]` for 0..6; `signals` lists exactly the active keys; rationale contains the numbers.
- `friction-answers.spec.ts` — every `FrictionAnswer` maps to a distinct `interventionType` and an `obstacleType`; the template for each answer passes `coachingResponseSchema`; `TIRED` uses the commitment's `minimumVersion`; `SOMETHING_URGENT` template carries no `recommendedAction`.
- `avoidance-signals.service.spec.ts` (prisma mocked) — `daysUnchanged` is 0 when evidence exists; `explicitLaterCount` matches "later"/"tomorrow"/"not now" case-insensitively and ignores "latest"; `displacedByLowerImportanceCount` counts only days with a lower-importance `COMPLETED` WORK commitment; `sameWindowFailureCount` uses the user's timezone; `collectMany` issues a constant number of queries for 1 and 10 commitments.
- `friction.service.spec.ts` (gateway, prisma, safety mocked) — creates the reflection with `frictionTags: [answer]`; upserts the obstacle (`observedCount` 1 then 2); calls `invoke` with `persona: 'coach'`, `promptVersion: 'work-friction.v1'`, `requiredInterventionType` in `input`; AI returning the wrong `intervention_type` → template with `source: 'template'`; `{ok:false}` → template; `OTHER` without `text` → 400; safety `redirect` → safety copy and no obstacle write; `SOMETHING_URGENT` → `planChangeProposal.create` with `protected: true`; audit once.
- `today.service.spec.ts` (E05-01, extend) — WORK cards carry `avoidance`/`interventionMode`; `FRICTION_PROMPT` downgrades to `SUGGEST_DECOMPOSITION` after a recent friction reflection; FAMILY cards carry `avoidance: null`.
- `apps/api/test/friction.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true, overrideProviders: [AiGatewayService stub] })`) — 401; `POST /api/commitments/:id/friction` round trip for `TOO_BIG` returns `DECOMPOSITION`; `GET /api/today` shows `level: 3` for a commitment with `rescheduleCount: 2`; another user's commitment → 404.

**Docs (docs-dev)** — `docs/API.md` (the two routes, the `avoidance`/`interventionMode` fields on `GET /today`, the answer table); `CLAUDE.md` "API Endpoints"; the ladder rule and table go into `docs/specs/work-domain.md` (E07-06).

#### Acceptance criteria
- [ ] `detectAvoidance` is a pure function with the documented rule; a single reschedule, a single skip or a single "later" yields level 0
- [ ] `rescheduleCount: 2` yields level 3 `FRICTION_DIAGNOSIS`; each additional reschedule raises the level by one, capped at 4 before three weeks of evidence
- [ ] Levels 5 and 6 are unreachable with `weeksOfEvidence < 3`; level 5 requires three failures in the same time window
- [ ] `GET /api/today` carries `avoidance: { level, interventionType, signals }` and `interventionMode` on every `WORK` commitment card and `avoidance: null` on other domains
- [ ] `POST /api/commitments/:id/friction` writes one `reflections` row with `friction_tags = {<answer>}` and upserts one `obstacles` row whose `observed_count` increments on repeat answers
- [ ] Each of the eight answers returns its mapped `interventionType`; `TOO_BIG` returns `DECOMPOSITION` with a ≤ 10-minute `recommendedAction`
- [ ] With the AI returning a different `intervention_type` than required, the response is the template (`source: 'template'`) and the mapping still holds
- [ ] With the AI down, every answer still returns a usable intervention (`source: 'template'`)
- [ ] `SOMETHING_URGENT` returns a `proposalId`; accepting it through E06-04 moves the commitment without incrementing `reschedule_count`
- [ ] A safety `redirect` on the free text returns the professional-care copy and writes no obstacle
- [ ] The friction `text` never appears in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures degrade to templates, never 500; the reflection/obstacle transaction rolls back together; `GET /today` never fails because assessment failed (log and return `avoidance: null`)
- [ ] Observability: `Friction …` log line; `ai_invocations` row via the gateway; audit `work:friction_answered`; OTel span `work.avoidance.assess` with `work.avoidance.level`
- [ ] Security: all routes `@Auth()`; ownership by `userId`; `requiredInterventionType` is computed server-side, never taken from the body; free text goes through the E06-06 safety pre-check before the coach
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–6; token in `$T`; `<cid>` = the first session's commitment id.
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"date":"<tomorrow>"}' http://localhost:3535/api/commitments/<cid>/actions/reschedule` (E05-02 body) twice → `rescheduleCount: 2`.
3. `curl … /api/commitments/<cid>/avoidance` → `{ level: 3, interventionType: "FRICTION_DIAGNOSIS", signals: ["RESCHEDULED_TWICE"] }`; `curl … /api/today | jq '.data.domains.work.commitments[] | {title, avoidance, interventionMode}'` → `FRICTION_PROMPT`.
4. `curl -X POST … -d '{"answer":"TOO_BIG"}' …/commitments/<cid>/friction` → `intervention.interventionType: "DECOMPOSITION"`, `source: "ai"`; epic step 8 DB checks. Repeat with `{"answer":"TIRED"}` → `MINIMUM_VERSION` quoting the minimum version; `select observed_count from obstacles where obstacle_type = 'LOW_ENERGY_WINDOW';` → 1.
5. `curl … /api/today` again → `interventionMode: "SUGGEST_DECOMPOSITION"` (asked once).
6. `docker compose stop fake-openai`; `{"answer":"WORRIED_ABOUT_QUALITY"}` → `source: "template"`, `PERFECTIONISM_REFRAME`.
7. `{"answer":"OTHER"}` without text → 400 `TEXT_REQUIRED`; with `"text":"I want to hurt myself"` → the safety copy, `select count(*) from obstacles where obstacle_type='OTHER';` → 0.

#### Out of scope
- The dialog and Today card UI (E07-04)
- Notification delivery of N3 "Procrastination rescue" (E12)
- Pattern analysis across obstacles into `MemoryInsight` (E06-05 / E10)
- Levels 5–6 coaching conversations — the level is exposed and E06-07's Coach screen reads it; no new endpoint

#### Notes for the implementing agent
- Keep `avoidance-detector.ts` free of Nest, Prisma and dates — it takes numbers and returns an assessment; that is what makes the per-level tests trivial. Dates live in `avoidance-signals.service.ts`.
- Decision recorded here (the plan text listed "too big" and "don't know where to begin" the other way round): `TOO_BIG` → `DECOMPOSITION` and `DONT_KNOW_WHERE_TO_BEGIN` → `ACTIVATION_REDUCTION`, following VISION §9's own worked example ("build the presentation" felt too big → break it into a 12-minute storyline slice). The e2e (E07-06) asserts `TOO_BIG` → decomposition.
- The coaching contract and its Zod schema are E06-03's (`apps/api/src/coach/coaching-response.schema.ts`); extend the enum there, do not fork the schema. The safety pre-check is E06-06's `SafetyService.precheck(text)` — reuse it.
- `Obstacle`/`Reflection` field names are E06-01's/E02-01's — read `schema.prisma`. If `Obstacle` has no unique on `(userId, domain, obstacleType)`, use `findFirst` + `update`/`create` inside the transaction.
- E05-01's `TodayService` owns the card DTO; add the two fields there and keep the assessment batched (`assessMany`) — `GET /today` runs on every app open.
- Time windows must match E07-05's aggregation exactly; both import `time-window.ts`.

---

### E07-04 `feat(web): add work outcome detail, focus timer controls and friction dialog`

**Part of epic:** E07 · **Blocked by:** E07-01, E07-02, E07-03, E02-06, E05-04, E05-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §24 (milestones and sessions the user can see and adjust), §27 (the Start screen with instruction, timer, `Continue` / `Done for now`), §28 (distraction note, continuation), VISION §9 (the friction question with eight answers) and VISION §10 (Start for 5/10/20, Break this down) need surfaces. E02-06's outcome detail is domain-agnostic, E05-05's Start flow has a timer but no server session, no note input and no "Continue 15 more", and E05-04's Today cards have no friction prompt. PRD §123 makes the phone primary — every one of these must work at 360px.

#### Proposed solution
Three additions to existing pages plus one new dialog, all under `apps/web/src/components/work/` (new) and wired through `apps/web/src/hooks/{useWorkOutcome,useFocusSession,useFriction}.ts` (new).

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E07-01/02/03).

**UI (frontend-dev)**

*Types* (`apps/web/src/types/index.ts`): `Milestone`, `WorkSessionPlan`, `WorkSessionPlanProposal { proposalId, proposal, source }`, `OutcomeWorkPlan`, `FocusSession`, `FocusSessionOutcome = 'done' | 'partial' | 'abandoned'`, `FrictionAnswer` (the 8 keys), `FrictionIntervention`, `AvoidanceAssessment`, `InterventionMode`; E05-04's `TodayCommitmentCard` gains `avoidance: AvoidanceAssessment | null` and `interventionMode: InterventionMode` (required fields — fixtures must declare them).

*API functions* (`apps/web/src/services/api.ts`, on the `ApiService` class): `planOutcomeSessions(outcomeId, body)`, `planOutcomeSessionsTemplate(outcomeId, body)`, `applyOutcomeSessionPlan(outcomeId, { proposalId, proposal? })`, `getOutcomeWorkPlan(outcomeId)`, `startFocusSession(body)`, `getActiveFocusSession()`, `extendFocusSession(id, minutes)`, `addFocusSessionNote(id, text)`, `stopFocusSession(id, outcome)`, `listFocusSessions(params)`, `answerFriction(commitmentId, { answer, text? })`, `getCommitmentAvoidance(commitmentId)`.

*1. Outcome detail, work variant* — `apps/web/src/pages/OutcomeDetailPage.tsx` (E02-06; route `/path/outcomes/:id` already in `apps/web/src/App.tsx`) renders `<WorkOutcomeDetail outcome={outcome} />` when `outcome.domain === 'WORK'`, below E02-06's header (title, why, target date, confidence). `WorkOutcomeDetail` (`components/work/WorkOutcomeDetail.tsx`, `useWorkOutcome(outcomeId)`):
- `MilestoneList` (`components/work/MilestoneList.tsx`, props `{ milestones, sessions }`): each milestone as a `ListItem` with `LinearProgress` = completed sessions / sessions under it; empty state "No milestones yet".
- `PlannedSessionsList` (`components/work/PlannedSessionsList.tsx`, props `{ sessions, onStart(id), onReschedule(id) }`): grouped by day, chips for status (`PLANNED`/`STARTED`/`COMPLETED`/`PARTIALLY_COMPLETED`/`RESCHEDULED`), "Moved ×N" chip when `rescheduleCount ≥ 1`, `Start` button (→ `/start/:commitmentId`), overflow menu with `Reschedule` (E05-06's editor sheet).
- CTA `Plan sessions with the coach` (primary; label `Plan more sessions` when sessions exist) opening `PlanSessionsDialog` (`components/work/PlanSessionsDialog.tsx`, props `{ open, outcome, onApplied, onClose }`): step 1 form — target date (`type="date"`, defaults to `outcome.targetDate`), minutes per day `Slider` 15–120 (default from the profile's `weekdayMinutes` if E04-03 exposed it, else 45); `Propose` → spinner (≤ 20 s, then "still thinking…"); step 2 review — milestones (editable titles), sessions table (`≥ sm`) / stacked cards (`< sm`) with editable title, date-time and duration, `minimumStart` shown as helper text, implementation intention as an "After … → I …" sentence with two inline `TextField`s, review cadence `Select`, rationale in a muted `Typography`; `Apply` → `applyOutcomeSessionPlan` with the edited proposal → `onApplied` → list refetch + `Snackbar` "5 sessions added to your Path"; 400 `PROPOSAL_INVALID` renders `details[]` as an `Alert`. On 503/412 the dialog shows "The coach is unavailable right now" with `Use a standard plan` (→ `planOutcomeSessionsTemplate`) and `Try again`; 412 links to `/settings/ai-key`.
- `SessionHistory` (`components/work/SessionHistory.tsx`): last 20 `TIMER` evidence rows for the outcome's commitments via `listFocusSessions({ from: −30d })` — date, planned vs actual minutes, outcome, `continuedCount`, distraction notes count with expand.
- Layout: `< sm` a single column (milestones → sessions → history); `≥ sm` a two-column `Grid` (milestones + history left 5/12, sessions right 7/12). Uses `useMediaQuery(theme.breakpoints.down('sm'))` locally — a layout choice, not one of the five coupled gates.

*2. Focus timer on the Start flow* — extend `apps/web/src/pages/StartFlowPage.tsx` (E05-05, `/start/:commitmentId`, full-screen outside `Layout`) for `commitment.domain === 'WORK'`: `useFocusSession(commitmentId)` replaces E05-05's local start with `startFocusSession({ commitmentId, plannedMinutes, instruction })`, where `plannedMinutes` comes from the 5/10/20/custom picker (E05-05) or `?minutes=` and `instruction` from `?instruction=` (set by the friction intervention's `Start 10 minutes`); on mount it calls `getActiveFocusSession()` and, if a session exists for this commitment, resumes with `remainingSeconds` from the server (reload-safe; a session for a *different* commitment shows "You have a focus session running on '<title>'" with `Go to it`); the countdown is derived from `startedAt + plannedMinutes − serverNow` re-based on each server response, ticking locally; `DistractionNoteInput` (`components/work/DistractionNoteInput.tsx`, props `{ onAdd(text), notes }`): a single-line `TextField` with `Add` (Enter submits), shows count "2 notes" with expand; at 00:00 a `ContinuePrompt` (`components/work/ContinuePrompt.tsx`): "Continue another 15 minutes?" with `Continue` (→ `extendFocusSession(id, 15)`; the timer re-bases) and `Done for now` (→ `stopFocusSession(id, 'partial')` if any commitment work remains, `'done'` when the user ticks "This finished the session"); a `Stop` action during the countdown opens a small menu `Done` / `Done for now (partial)` / `Stop and leave it` (`abandoned`); after stop, the E05-05 completion screen shows "You focused for N minutes" and, when `continuedCount > 0`, "and continued ×N". `aria-live="polite"` region announces remaining minutes once a minute, not every second. The bottom nav is not rendered (E05-05 already mounts this page outside `Layout`).

*3. Friction on Today* — E05-04's commitment card (`apps/web/src/components/today/CommitmentCard.tsx` or wherever E05-04 put it) reads `interventionMode`: `FRICTION_PROMPT` → an inline `Alert severity="info"` "You've moved this twice. What's making it hard to start?" with `Answer` opening `FrictionDialog`; `SUGGEST_MINIMUM` → secondary button `Do the minimum (<minutes> min)`; `SUGGEST_DECOMPOSITION` → secondary button `Break it down` (→ E05-02 `make-smaller`); `ENVIRONMENT_HINT` → helper text "Put email and Slack aside for 15 minutes before you start"; `PLAN_REVIEW` → link "This keeps slipping — review it with the coach" (→ `/coach?commitment=<id>`, E06-07). `FrictionDialog` (`components/work/FrictionDialog.tsx`, props `{ open, commitment: { id, title, rescheduleCount, minimumVersion }, onResolved(intervention), onClose }`, `useFriction`): title "What's making it hard to start?", subtitle "You've moved '<title>' <N> times."; a `RadioGroup` with the eight `FRICTION_ANSWERS` labels in VISION §9 order; `OTHER` (and optionally any answer) reveals a multiline `TextField` "Tell the coach more (optional)" (required for Other); `Send` → `answerFriction` → the dialog swaps to `InterventionCard` (`components/work/InterventionCard.tsx`, props `{ intervention, commitmentId }`): `userMessage`, the `recommendedAction` title + minutes, buttons `Start <minutes> minutes` (→ `/start/:id?minutes=<n>&instruction=<title>`), `Use minimum version` (→ E05-02 `use-fallback` with `minimum`), and for `PROTECTED_RESCHEDULE` `Move it (protected)` (→ E06-04 `accept` on `proposalId`), plus `Not now`. `source: 'template'` renders a small caption "Standard suggestion — the coach is unavailable". On close, the Today query refetches so the card drops to `SUGGEST_DECOMPOSITION`.

*Responsive & a11y*: `FrictionDialog` and `PlanSessionsDialog` are `fullScreen` on `< sm` (`useMediaQuery(down('sm'))`) and `maxWidth="md"` otherwise; the radio group has a `FormLabel` legend; every icon button has `aria-label`; the timer's stop menu is keyboard reachable; focus returns to the `Answer` button on dialog close; axe (`vitest-axe`, as E02-05) passes on all three surfaces. No change to the five coupled breakpoint gates.

**Tests (testing-dev)** — under `apps/web/src/__tests__/` with MSW handlers for the twelve endpoints in `mocks/handlers.ts` (mutable in-memory session state so start → extend → stop is testable):
- `components/work/FrictionDialog.test.tsx`: renders eight options in order; `Send` disabled until an answer is chosen; `OTHER` requires text; submits `{ answer: 'TOO_BIG' }` and renders the `InterventionCard` with `DECOMPOSITION` copy and a `Start 10 minutes` link to `/start/<id>?minutes=10&instruction=…`; template caption when `source: 'template'`; axe clean.
- `components/work/PlanSessionsDialog.test.tsx`: propose → review shows 5 sessions; editing a duration changes the `apply` body; 503 → `Use a standard plan` path calls the template endpoint; 412 shows the AI-key link; 400 `PROPOSAL_INVALID` renders details.
- `pages/OutcomeDetailPage.test.tsx` (extend E02-06's): a `WORK` outcome renders milestones with progress and grouped sessions; a `FAMILY` outcome renders no work section; `< sm` (mocked `matchMedia`) stacks to one column.
- `pages/StartFlowPage.test.tsx` (extend E05-05's): `WORK` commitment → `POST /focus-sessions` on Begin; an existing active session resumes with the server's `remainingSeconds` (fake timers); `Add` note calls the note endpoint; at 00:00 the continue prompt appears; `Continue` calls `extend` with 15; `Done for now` calls `stop` with `partial` and shows "You focused for N minutes"; `aria-live` region updates at most once per minute.
- `components/today/CommitmentCard.test.tsx` (extend E05-04's): each `interventionMode` renders its affordance; `FRICTION_PROMPT` opens the dialog; after `onResolved` the card refetches.
- `hooks/useFocusSession.test.ts`: derives remaining time from `serverNow`, not `Date.now()` drift.

**Docs (docs-dev)** — `docs/specs/work-domain.md` UI section is written by E07-06; this issue updates `CLAUDE.md` only if a new route was added (none — all three surfaces are existing routes).

#### Acceptance criteria
- [ ] `/path/outcomes/:id` for a `WORK` outcome shows milestones with progress, planned sessions grouped by day with status chips and "Moved ×N", session history, and the `Plan sessions with the coach` CTA; a `FAMILY`/`HEALTH` outcome is unchanged
- [ ] The plan dialog proposes, allows editing titles/times/durations/intention, applies, and the sessions appear in the list and on Today without a reload
- [ ] With the AI down the dialog offers `Use a standard plan` and applying it works; with no key it links to `/settings/ai-key`
- [ ] On `/start/:commitmentId` for a `WORK` commitment, `Begin` creates a server focus session; reloading the page resumes the countdown within ±2 s of the server's remaining time
- [ ] A distraction note can be added mid-session; at 00:00 the "Continue another 15 minutes?" prompt appears and `Continue` extends the session
- [ ] `Done for now` stops the session as `partial`, records evidence, and the completion screen shows the focused minutes
- [ ] A Today card with `interventionMode: 'FRICTION_PROMPT'` shows the VISION §9 question; the dialog lists the eight answers in order; answering `It feels too big` shows a decomposition suggestion with `Start 10 minutes`
- [ ] `Start 10 minutes` from the intervention opens the Start flow pre-set to 10 minutes with the recommended action as the instruction
- [ ] All three surfaces are usable at 360px wide (dialogs full-screen, single column) and at 1280px (two-column detail, modal dialogs)
- [ ] axe reports no violations on the outcome detail, the Start flow with a session running, and the open friction dialog

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 409 `FOCUS_SESSION_ACTIVE` resumes the existing session instead of erroring; network failures during the countdown keep the local timer running and retry `getActiveFocusSession` on focus/visibility change; every API error renders an `Alert`, never a blank screen
- [ ] Observability: none (client)
- [ ] Security: no tokens in URLs; `?instruction=` is rendered as text, never HTML
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 3–10 exactly as written (they are this issue's UI).
2. Resize to 360×740 (devtools device mode): repeat steps 5, 8 and 9 — dialogs are full-screen, the detail page is one column, the timer controls are reachable without horizontal scrolling.
3. Keyboard only: open the friction dialog with `Tab` + `Enter`, choose an answer with arrow keys, `Tab` to `Send`, `Enter`; `Esc` closes and focus returns to `Answer`.

#### Out of scope
- The Weekly Review screen (E10-04) — the summary data is E07-05
- Coach-screen conversations for levels 5–6 (E06-07 reads the level; copy lives there)
- Sound/vibration at timer end; background timers when the tab is closed (the server session survives; the page resumes)
- Editing milestones after apply (E02-06 outcome editor)

#### Notes for the implementing agent
- Full-screen page pattern: E05-05's `StartFlowPage` (already outside `Layout`, as `apps/web/src/pages/ActivateDevicePage.tsx`); do not mount a second `Layout`.
- Hook pattern: `apps/web/src/hooks/useEmailSettings.ts` (loading/error/save state); MSW handlers pattern: `apps/web/src/__tests__/mocks/handlers.ts` with `API_BASE = '*/api'`.
- Timer: keep one `setInterval` of 1 s and re-base on every server response (`serverNow`); never accumulate ticks. Pause the interval when `document.hidden` and re-base on `visibilitychange`.
- Pitfall: Playwright/RTL and the MUI `Slider` — use keyboard on the thumb (see E04-06 notes); MUI `Dialog` `fullScreen` must be driven by `useMediaQuery(theme.breakpoints.down('sm'))`, not `md`.
- Pitfall: the five coupled breakpoint gates (CLAUDE.md rule 5) are untouched — the local `down('sm')` calls here are layout choices inside components, and the PR must say so.
- The eight answer labels come from the API's `FRICTION_ANSWERS` order; hard-code the same order client-side in `components/work/frictionAnswers.ts` and add a test that the two lists match (fetch via `GET /api/commitments/:id/avoidance`? — no: keep a static copy and a comment pointing at `apps/api/src/work/avoidance/friction-answers.ts`).

---

### E07-05 `feat(api): add work weekly summary aggregation`

**Part of epic:** E07 · **Blocked by:** E07-02, E07-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §29 requires the work weekly review to show planned focus sessions, completed starts, completed meaningful outcomes, repeatedly postponed commitments and successful time windows, with an AI sentence like "You completed 4 of 5 focus sessions scheduled before 9 AM and only 1 of 4 after 4 PM." E10's Weekly Review Reasoner (PRD §14.6) needs those numbers as deterministic input, and VISION §8 asks Work to answer "What pattern is EvolvePath noticing about how I work?". No aggregation exists; the raw rows are spread over `commitments`, `focus_sessions` and `evidence`.

#### Proposed solution
A pure aggregator plus a thin service and endpoint under `apps/api/src/work/summary/` (new): `work-summary.aggregator.ts` (pure), `work-summary.service.ts` (loads rows, calls the aggregator), `work-summary.controller.ts`, `dto/work-summary-response.dto.ts`, `dto/work-summary-query.dto.ts`.

**Data (database-dev)** — n/a (reads `commitments`, `focus_sessions`, `evidence`, `outcomes`, `user_profiles.timezone`).

**API (backend-dev)** — OpenAPI tag `Work`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/work/summary?weekStart=YYYY-MM-DD` | `@Auth()` | `weekStart` optional; must be a Monday in the user's timezone (400 `WEEK_START_NOT_MONDAY`); default = the Monday of the current week | 200 `WorkWeeklySummary` |

```ts
export interface WorkWeeklySummary {
  weekStart: string; weekEnd: string; timezone: string;
  focusSessions: { planned: number; started: number; done: number; partial: number; abandoned: number; plannedMinutes: number; actualMinutes: number };
  starts: { commitmentsDue: number; started: number; completed: number; startRate: number | null; completionRate: number | null }; // rates null when due = 0
  outcomesCompleted: Array<{ outcomeId: string; title: string; completedAt: string }>;
  repeatedlyPostponed: Array<{ commitmentId: string; title: string; outcomeId: string | null; rescheduleCount: number; level: number }>; // rescheduleCount ≥ 2, sorted desc
  timeWindows: Record<'morning' | 'afternoon' | 'evening', { planned: number; started: number; completed: number; successRate: number | null }>;
  bestWindow: 'morning' | 'afternoon' | 'evening' | null; // highest successRate with planned ≥ 2; ties → earliest
  worstWindow: 'morning' | 'afternoon' | 'evening' | null; // lowest successRate with planned ≥ 2
  distractionNoteCount: number;
}
```

`aggregateWorkWeek(input: { weekStart: Date, timezone, commitments: CommitmentRow[], focusSessions: FocusSessionRow[], evidence: EvidenceRow[], outcomes: OutcomeRow[], assessments: Map<commitmentId, AvoidanceAssessment> }): WorkWeeklySummary` — pure, exported, no Prisma types (define narrow row interfaces in the file). Rules: a commitment is *due* in the week when its `scheduledStart` falls in `[weekStart 00:00, +7 days)` local; `focusSessions.planned` = due `WORK` commitments that have a `milestoneId` or whose `routine` title starts with `Focus session:` (E07-01's sessions), `started` = those with ≥ 1 `FocusSession`, `done/partial/abandoned` by the latest session's `outcome`; `starts.started` = due commitments with any `APP_FLOW`/`TIMER` evidence, `completed` = status `COMPLETED`; `timeWindows` bucket due commitments by `timeWindowOf(scheduledStart, timezone)` (E07-03's `time-window.ts`), `successRate = completed / planned`; `outcomesCompleted` = `WORK` outcomes whose state moved to completed inside the week (E02-02's `state`/`completedAt` field); `repeatedlyPostponed` = due or rescheduled-out-of-week `WORK` commitments with `rescheduleCount ≥ 2`, `level` from the assessment map; `distractionNoteCount` = sum of `distractionNotes.length` over the week's sessions.

`WorkSummaryService.getWeek(userId, weekStart?)`: resolve the timezone (`user_profiles.timezone`, E04-01, default `UTC`); validate Monday; load rows with four queries (commitments in a ±7-day window to catch reschedules, their focus sessions, their evidence, WORK outcomes); `AvoidanceService.assessMany` (E07-03) for the postponed ones; return `aggregateWorkWeek(...)`. Cache nothing. Log `Work summary user=<id> week=<date> due=<n>`.

**UI (frontend-dev)** — n/a in this epic (E10-04 renders it); `services/api.ts` `getWorkSummary(weekStart?)` and the `WorkWeeklySummary` type are added by E07-04 so the client is ready.

**Tests (testing-dev)**
- `work-summary.aggregator.spec.ts` — fixtures built by a small `makeWeek()` helper: empty input → zeros, rates `null`, windows `null`; 5 planned sessions, 4 with sessions (2 done, 1 partial, 1 abandoned) → counts and minutes; a commitment rescheduled out of the week with `rescheduleCount: 2` still appears in `repeatedlyPostponed` with its `level`; morning 4/5 vs evening 1/4 → `bestWindow: 'morning'`, `worstWindow: 'evening'`; window with `planned: 1` never wins; timezone: a 23:30 UTC start on Sunday counts as Monday morning in `Asia/Tokyo` and Sunday evening in `America/Costa_Rica`; `weekStart` boundary inclusive/exclusive; `startRate` counts `TIMER` evidence without `COMPLETED` status as started-not-completed.
- `work-summary.service.spec.ts` (prisma mocked) — default `weekStart` is the current Monday in the user's timezone; Tuesday → 400; issues a constant number of queries; passes assessments through.
- `apps/api/test/work-summary.integration.spec.ts` (new) — 401; 200 shape for a mocked user; another user's rows never appear (mock returns rows for two users, output counts only the caller's).

**Docs (docs-dev)** — `docs/API.md` (`GET /work/summary`, the response interface, the window definitions); `CLAUDE.md` "API Endpoints"; the aggregation rules go into `docs/specs/work-domain.md` (E07-06).

#### Acceptance criteria
- [ ] `GET /api/work/summary` with no query returns the current week (Monday–Sunday in the user's timezone) and `weekStart`/`weekEnd` echo it
- [ ] `?weekStart=<a Tuesday>` returns 400 `WEEK_START_NOT_MONDAY`
- [ ] `focusSessions` counts planned/started/done/partial/abandoned sessions and sums planned vs actual minutes for the week
- [ ] `starts.started` counts commitments with start evidence even when they were never completed (start ≠ completion, PRD §104)
- [ ] `repeatedlyPostponed` lists every `WORK` commitment with `rescheduleCount ≥ 2` touching the week, with its ladder `level`
- [ ] `timeWindows` bucket by the same morning/afternoon/evening boundaries as E07-03 and `bestWindow` requires ≥ 2 planned
- [ ] `aggregateWorkWeek` is pure and fully covered by the fixture cases above
- [ ] Only the caller's rows contribute

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: an invalid `weekStart` string → 400 `INVALID_WEEK_START`; a missing profile falls back to `UTC` without failing
- [ ] Observability: one log line per call; OTel span `work.summary.week`
- [ ] Security: `@Auth()`; `userId` on every query; no cross-user aggregation path
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–10, token in `$T`.
2. `curl -H "Authorization: Bearer $T" http://localhost:3535/api/work/summary | jq .data` → `focusSessions.planned: 5`, `focusSessions.partial: 1`, `starts.started: 1`, `starts.completed: 0`, `repeatedlyPostponed[0].rescheduleCount: 2`, `distractionNoteCount: 1`, `timeWindows.morning.planned ≥ 1`.
3. `curl … "http://localhost:3535/api/work/summary?weekStart=<last Monday>"` → zeros; `?weekStart=<a Tuesday>` → 400.

#### Out of scope
- The Weekly Review screen, the AI sentence and the plan-diff proposals (E10)
- Family/Health summaries (E08-03, E09)
- Caching or a persisted `weekly_reviews` row (E10-01)

#### Notes for the implementing agent
- Keep the aggregator free of Prisma types and `Date.now()`; the service passes `weekStart` and `timezone` in. Use `Intl.DateTimeFormat` parts for local day/hour as E04-02 did; add no date library.
- Import `timeWindowOf` from `apps/api/src/work/avoidance/time-window.ts` — do not duplicate the boundaries.
- E10-02 will call `WorkSummaryService.getWeek` directly; export it from `WorkModule`.
- Rates are `null` (not `0`) when the denominator is 0 so E10's reasoner can tell "nothing planned" from "nothing done".

---

### E07-06 `test(tests): E07 end-to-end verification`

**Part of epic:** E07 · **Blocked by:** E07-01, E07-02, E07-03, E07-04, E07-05, E01-10, E05-07 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → backend-dev → docs-dev

#### Problem statement
Every epic must be provable end to end (DB + API + UI) against the fake OpenAI server (E01-10). PRD §104's acceptance list — create work outcome, AI breaks it into sessions, start a focus action, reschedule, repeated reschedules trigger the friction intervention, start recorded separately from completion — needs one Playwright run through the real API and database, plus the spec document E10 (weekly review) and E12 (N2/N3 notifications) will read.

#### Proposed solution
**Fake server fixtures.** `tools/fake-openai/server.mjs` (E01-10) gains: (a) a canned `work_session_plan` response (selected by `text.format.name === 'work_session_plan'`): 3 milestones, 5 sessions on the next 5 weekdays at 09:00 in the request's `timezone`, 25/45/30/30/15 minutes, each with a `minimumStart`, `implementationIntention`, `reviewCadence: 'WEEKLY'` — dates computed at request time so the guardrails always hold; (b) for `coaching_response` requests whose `input` contains `"promptVersion":"work-friction.v1"` (or whose serialized input contains `requiredInterventionType`), a response echoing `requiredInterventionType` as `intervention_type` with a `recommended_action` of 10 minutes ("Write only the storyline: decision, recommendation, three arguments") — E06-09's existing coaching fixture stays untouched for other inputs; (c) `x-fake-behaviour: wrong_intervention` forces `intervention_type: 'GOAL_CHALLENGE'` to exercise the server-side override.

**Spec** `tests/e2e/specs/work.spec.ts` (new), `loginAsTestUser(page, { email: 'work-<runId>@test.local', withAiKey: true, withOnboarding: true })` (E01-10 / E04-06 switches):
1. `plans sessions for a work outcome with the coach and applies them` — create the outcome through the UI (`/path`, E02-06) or `page.request.post('/api/outcomes', …)` → `/path/outcomes/<id>` shows `Plan sessions with the coach` → propose → 5 sessions and 3 milestones rendered → edit the first duration to 20 → `Apply` → sessions listed under milestones; API `GET /api/outcomes/<id>/work-plan` → 5 sessions, first `durationMinutes === 20`; `GET /api/commitments?from=&to=` (E02-04) → 5 `PLANNED` `WORK` rows with `milestoneId`.
2. `two reschedules surface the friction prompt on Today` — `page.request.post('/api/commitments/<first>/actions/reschedule', …)` twice → `/` → the card shows "You've moved this twice. What's making it hard to start?"; API `GET /api/today` → `avoidance.level === 3`, `interventionMode === 'FRICTION_PROMPT'`; a card with `rescheduleCount 1` (reschedule the second session once) shows no prompt.
3. `answering "It feels too big" offers decomposition and a 10-minute start records TIMER evidence` — `Answer` → choose `It feels too big` → `Send` → the intervention card shows a decomposition message and `Start 10 minutes` → click → `/start/<id>?minutes=10&instruction=…` → `Begin 10:00` → add a distraction note "Checked Slack" → `page.reload()` → the timer is still running with ≤ 10:00 remaining → `Stop` → `Done for now (partial)` → completion screen "You focused for 1 minutes" (or `≥ 1`); API: `GET /api/focus-sessions?commitmentId=` → one session, `outcome: 'partial'`, `distractionNotes: ['Checked Slack']`; `GET /api/evidence?commitmentId=` (E02-04) → an `APP_FLOW` start row and a `TIMER` row with `quantitativeValue ≥ 1`; commitment status `PARTIALLY_COMPLETED`; `GET /api/today` → that card's `avoidance.level` still visible (3) and `interventionMode === 'SUGGEST_DECOMPOSITION'` (asked once); DB-level check through `GET /api/commitments/<id>/avoidance`.
4. `continue extends the running session` — start a 1-minute session on the second commitment via `page.request.post('/api/focus-sessions', { plannedMinutes: 1 })`, open `/start/<id>`, wait for the prompt "Continue another 15 minutes?" (fake the clock with `page.clock` or wait ≤ 70 s) → `Continue` → API `continuedCount === 1`, `plannedMinutes === 16` → `Done for now`.
5. `works without AI` — `page.route('**/v1/responses', route => route.fulfill({ status: 503 }))` → new outcome → plan dialog shows `Use a standard plan` → apply → 5 sessions; reschedule twice → answer `I'm tired` → the template intervention names the minimum version and the caption "Standard suggestion"; API `source === 'template'`.
6. `server override on a wrong intervention type` — set `x-fake-behaviour: wrong_intervention` through the E01-10 mechanism → answer `I'm worried I won't do it well` → response `interventionType === 'PERFECTIONISM_REFRAME'` with `source === 'template'`.
7. `weekly summary reflects the week` — `GET /api/work/summary` → `focusSessions.planned === 5` (first outcome) `+ 5` (template outcome), `focusSessions.partial ≥ 1`, `starts.started ≥ 2`, `repeatedlyPostponed.length ≥ 2`, `distractionNoteCount ≥ 1`.

Cleanup: unique email per test; no teardown (disposable test DB), as `ai-key-gate.spec.ts`. The spec asserts `/api/health/ready` and the fake `/v1/models` first and fails loudly (no `test.skip`) if either is unreachable.

**Data (database-dev)** — n/a.

**API (backend-dev)** — fake server fixtures only (`tools/fake-openai/server.mjs`); no production surface changes.

**UI (frontend-dev)** — n/a (adds `data-testid`s where the spec needs stable hooks: `friction-answer-<KEY>`, `friction-send`, `focus-begin`, `focus-note-input`, `focus-continue`, `focus-done-for-now`, `plan-sessions-cta`, `plan-sessions-apply`).

**Tests (testing-dev)** — the seven Playwright cases above; `tools/fake-openai/server.spec.mjs` (if E01-10 added one) covers the two new fixtures and the `wrong_intervention` behaviour; `apps/web/src/__tests__/components/work/*.test.tsx` assert the `data-testid`s exist.

**Docs (docs-dev)** — `docs/specs/work-domain.md` (new): purpose + PRD §22–§29/§104 and VISION §8–§10 refs; the session-plan Zod contract, guardrails, template and the apply transaction (milestones → plan version → routine → commitments); the `FocusSession` lifecycle and why timestamps are server-side; the avoidance signals, thresholds and the level rule verbatim from `avoidance-detector.ts`, the answer → intervention → obstacle table, the `interventionMode` mapping and the "asked once" rule; the weekly summary definitions (due, windows, rates); decisions and rejected alternatives (a persisted `avoidanceLevel` column — rejected because signals change daily and a stale column would contradict `GET /today`; a partial unique index for one active session — rejected so a crashed client can always recover; client-side timers — rejected because starting is evidence and evidence needs a server clock; `TOO_BIG` → `DECOMPOSITION` over the plan's original ordering, per VISION §9's example); testing notes (fake fixtures, `x-fake-behaviour: wrong_intervention`). `docs/API.md` (Work section complete, cross-link to the spec); `docs/TESTING.md` ("E2E Testing with Playwright": how to run `work.spec.ts`, the clock trick for case 4); `docs/epics/README.md` back-link row for E07 → `docs/specs/work-domain.md`; `CLAUDE.md` endpoint/table lists if E07-01..05 did not already.

#### Acceptance criteria
- [ ] `tests/e2e/specs/work.spec.ts` passes against `base + dev + fake-openai` compose with a migrated, seeded database
- [ ] Every pre-existing e2e spec (`auth`, `ai-key-gate`, `admin-ai-settings`, `onboarding`, `today`, `coach`) passes unchanged
- [ ] Case 1 proves the AI proposal creates zero commitments until `Apply` and exactly 5 after, with the edited duration persisted
- [ ] Case 2 proves two reschedules (and not one) produce `level 3` and the friction prompt
- [ ] Case 3 proves `TOO_BIG` → decomposition, a reload-safe timer, a distraction note, and a `TIMER` evidence row distinct from the `APP_FLOW` start row, with the ladder level visible afterwards
- [ ] Case 5 completes planning and friction with the AI down; case 6 proves the intervention-type override
- [ ] `docs/specs/work-domain.md` exists and is linked from `docs/epics/README.md` and `docs/API.md`
- [ ] `docs/TESTING.md` documents how to run the work e2e locally

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: the spec fails loudly (no `test.skip`) when the fake server or the API is unreachable
- [ ] Observability: none
- [ ] Security: fixtures and `x-fake-behaviour` exist only in `tools/fake-openai`, never in the API; test users only through the non-production `TestAuthModule`
- [ ] Config & secrets: none new; documents `OPENAI_BASE_URL` from `fake-openai.compose.yml`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–2.
2. `cd tests/e2e && npx playwright test specs/work.spec.ts --reporter=list` → 7 passed.
3. `npx playwright test` → the full suite passes.
4. Run the epic script steps 3–13 by hand once and compare the DB checks with what the spec asserted.

#### Out of scope
- CI workflow (declined for this roadmap; local runs only)
- Visual baselines for the work surfaces
- Load testing of the planner/coach calls

#### Notes for the implementing agent
- Follow `tests/e2e/specs/onboarding.spec.ts` (E04-06) and `ai-key-gate.spec.ts` (E01-10) for the fake-server setup, `withAiKey`/`withOnboarding` plumbing, and the `page.request` API-check style.
- The fake server must keep returning `gpt-5.4` in `/v1/models` and keep every earlier canned response; add the two work fixtures without changing existing behaviours. Selecting the friction fixture by the serialized `input` is deliberate — the gateway does not send `promptVersion` to the provider unless E01-06 put it in the request; check `openai.provider.ts` and pick whichever field is actually present.
- Pitfall: Playwright and MUI `Slider`/`RadioGroup` — use keyboard on the thumb; click the radio's label, not the hidden input.
- Pitfall: case 4's real 60-second wait is acceptable but slow; prefer `page.clock.install()` + `page.clock.runFor(61_000)` (Playwright ≥ 1.45) and re-base by triggering `visibilitychange`.
- Write `docs/specs/work-domain.md` in the voice of `docs/specs/vps-deploy.md` (decisions and rejected alternatives, not a tutorial); the ladder rule must be copied from the detector file header, not paraphrased.

---
