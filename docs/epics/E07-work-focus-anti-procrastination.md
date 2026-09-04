# E07 — Work Domain: Focus Sessions & Anti-Procrastination

<!-- epic-meta: slug=work-focus-anti-procrastination phase=3 -->

## Epic

### Goal
Turn a work outcome into startable sessions and get the user to actually begin them. The `planner` persona converts an outcome into milestones, planned focus sessions, an implementation intention and minimum starts (PRD §24); each session becomes a `WORK` commitment; a server-recorded focus session layered on E05's timer records *starting* as `TIMER` evidence distinct from completing (PRD §27–§28, VISION §10); deterministic avoidance detection (PRD §25) places every work commitment on the seven-level intervention ladder (PRD §26) and, at "moved twice", asks the VISION §9 question — "What's making it hard to start?" — routing each of the eight answers to a different intervention. The weekly summary data (PRD §29) feeds E10. Everything except the coaching copy works with the AI down (PRD §120), and PRD §104 is the acceptance list this epic must satisfy.

### Background
- VISION Part I: §8 "Work: From Intention to Execution" (execution, not task storage), §9 "The Anti-Procrastination Mission" (diagnose friction; the eight answers; the "build strategy presentation" example), §10 "Start Is a Product Feature" (Start for 5/10/20, Continue, Break this down, I'm stuck; ten minutes after three days of avoidance is progress).
- PRD §22–§29 (Work requirements, outcomes, planning, detection signals, intervention ladder levels 0–6, Start flow, focus sessions, weekly review data), §104 (acceptance), §16 (structured coaching contract with `intervention_type`), §10.7 (`Commitment` statuses and `reschedule_count`), §10.9 (`Evidence` source `TIMER`), §10.10 (`Reflection.friction_tags`), §10.11 (`Obstacle`), §120 (AI failure degradation).
- Builds on E01: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` (`apps/api/src/ai/gateway/ai-gateway.service.ts`) → `{ok:true, output}` / `{ok:false, error:{code,message}}`; `AiKeyRequiredException` (`apps/api/src/ai/gateway/ai-errors.ts`); the provider request carries `metadata: { invocationId, persona, promptVersion }` (E01-06), which is how the fake OpenAI server `tools/fake-openai/server.mjs` + `infra/compose/fake-openai.compose.yml` (E01-10) selects canned replies.
- Builds on E02-01's schema (`apps/api/prisma/schema.prisma`): `Outcome` (`domain WORK|FAMILY|HEALTH`, `importance`, `targetDate`, `motivation`, `successDefinition`), `Plan` + `PlanVersion` (one `ACTIVE` per plan via a partial unique index), `Routine` (`planVersionId`, `triggerType TIME|EVENT`, `triggerValue`, `frequency`, `daysOfWeek`, `preferredTime`, `estimatedDurationMin`, `minimumDurationMin`, `fallbackBehavior`), `Commitment` (`outcomeId`, `planVersionId`, `routineId`, `commitmentType`, `importance`, full/short/minimum versions, `status`, `rescheduleCount`, `skipReason`, `startedAt`, `completedAt`), `Evidence` (table `evidence_items`; `evidenceType` free label, `source USER_LOG|TIMER|WORKOUT_LOG|APP_FLOW`, `quantitativeValue`, `quantitativeUnit`, `qualitativeValue`, `occurredAt`), `Reflection` (`relatedType`, `relatedId`, `commitmentId`, `userText`, `frictionTags String[]`). Services: `apps/api/src/path/{outcomes,plans,routines}/` (E02-02/03), `apps/api/src/commitments/` with `commitment-transitions.ts` (E02-04); `GET /api/evidence?from&to&commitmentId&source`; the Path screen with `apps/web/src/pages/OutcomeDetailPage.tsx` at `/path/outcomes/:id` (E02-06). OpenAPI group `EvolvePath` in `apps/api/src/openapi/tags.ts`.
- Builds on E05: `GET /api/today` (E05-01, `apps/api/src/today/`, `todayResponseSchema` with `domains[].commitments[]` as `commitmentCardSchema`, `nextBestAction.interventionMode` from `apps/api/src/today/nba/intervention-mode.ts` — today `DIAGNOSE` ← `rescheduleCount >= 2`, `CHALLENGE_PLAN` ← ≥ 4 misses; `apps/api/src/today/local-date.ts` `localDate`/`localDayBounds`/`greetingFor`); commitment actions `POST /api/commitments/:id/actions/{start,pause,continue,complete,partial,fallback,reschedule,skip,decompose,decompose/apply}` in `apps/api/src/commitments/actions/commitment-actions.service.ts` (E05-02: `start {minutes?}` sets `startedAt`/`activeSince`/`timerMinutes` and writes `APP_FLOW started`; `continue {extraMinutes?}`; `complete`/`partial {notes?, minutesSpent?}`; `reschedule {scheduledStart, scheduledEnd?}` on the same row with `rescheduleCount += 1`; `skip {reason: SkipReason, text?}` writes `skipReason` + `skipNote` + a `Reflection`); the Today screen (E05-04, `apps/web/src/pages/TodayPage.tsx`, `components/today/CommitmentRow.tsx`, `hooks/useToday.ts`); the Start flow (E05-05, `apps/web/src/pages/StartFlowPage.tsx` at `/start/:commitmentId` outside `Layout`, `hooks/useStartSession.ts`, pure `utils/commitmentTimer.ts`, already showing "Continue another 15?" at 00:00 and a distraction-note textarea held in component state); the e2e helper `tests/e2e/helpers/commitments.helper.ts` (E05-07).
- Builds on E06: `Obstacle` (`type ObstacleType`, `description`, `domain`, `observedCount`, `confidence`, `lastObservedAt`, `interventionHistory Json`) and `PlanChangeProposal` (E06-01, migration `add_coach_and_memory`); the coaching contract `apps/api/src/coach/contracts/coach-reply.contract.ts` — `INTERVENTION_TYPES` (`NORMAL_REMINDER, ACTIVATION_REDUCTION, DECOMPOSITION, FRICTION_DIAGNOSIS, ENVIRONMENT_CHANGE, PLAN_CHALLENGE, GOAL_CHALLENGE, REINFORCE, CLARIFY, REDUCE_SCOPE, RECONNECT_REASON, RECOVER`), `coachReplySchema` (`intervention_type`, `reasoning_summary`, `user_message`, `recommended_action {title, duration_minutes, commitmentId}`, `fallback_action`, `proposal`, `friction_question`), schemaName `coach_reply` (E06-03); `SafetyPolicyService.evaluate({ userId, text, surface })` in `apps/api/src/coach/safety/` exported by `SafetyModule` (E06-06); the Coach screen at `/coach` (E06-07).
- Codebase facts: per-user endpoints are plain `@Auth()` with ownership in the query and 404 (never 403) for another user's row (`apps/api/src/pat/pat.controller.ts`, E02-02's `owned-resource.ts`); audit rows are direct `prisma.auditEvent.create` calls (`apps/api/src/email/email-settings.service.ts`); DTOs use `nestjs-zod` `createZodDto` (`apps/api/src/email/dto/update-email-settings.dto.ts`), never class-validator; every `@ApiTags` name must be declared in `apps/api/src/openapi/tags.ts` or `test/openapi/openapi-document.spec.ts` fails; integration specs use `createTestApp({ useMockDatabase: true, overrideProviders })` from `apps/api/test/helpers/test-app.helper.ts`; web tests use MSW (`apps/web/src/__tests__/mocks/handlers.ts`); Playwright login is `loginAsTestUser` in `tests/e2e/helpers/auth.helper.ts`.
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
- Family and Health commitments — the detector and focus sessions run for `domain === 'WORK'` only in this epic.
- A new plan version per session plan — sessions are commitments under the outcome's active plan version, not a strategy change; E06-04 owns version creation.
- Enterprise task import (Jira, Asana, …) — VISION §8 explicitly rejects it.

### Sequencing
- E07-01 (session planning) and E07-02 (focus sessions) are independent and can run in parallel; both need E02-04's commitments and E05-02's actions.
- E07-03 depends on E07-02 (the evidence-based signals read `FocusSession` + `Evidence`) and on E06-01/E06-03/E06-06 (`Obstacle`, `coachReplySchema`, safety).
- E07-04 can start against MSW once E07-01/02/03 response shapes are agreed; it merges last because it touches E05's `StartFlowPage` and `CommitmentRow`.
- E07-05 depends on E07-02 (focus session rows) and E07-03 (ladder level on postponed commitments).
- Critical path: E07-02 → E07-03 → E07-04 → E07-06. E07-01 and E07-05 run alongside.

### Manual end-to-end verification
1. Fresh clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, and the `OPENAI_BASE_URL` override from `infra/compose/fake-openai.compose.yml`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed` (confirm `add_work_planning`, `add_focus_sessions` and `add_work_obstacle_types` in the migrate output).
3. Open http://localhost:3535/testing/login. Email `worker@test.local`, role `viewer`, "Seed an OpenAI key" (E01-10) checked, "Mark onboarding complete" (E04-06) checked. Submit → Today.
4. Path → `Add outcome` (E02-06): domain Work, title "Finish strategy presentation", motivation "The board decides budget on it", target date = next Friday, confidence 3. Open http://localhost:3535/path/outcomes/<id>: the work section shows empty "Milestones" and "Planned sessions" and the CTA `Plan sessions with the coach`.
5. Click it; leave the target date, set "Minutes per day" 45 → a proposal appears: 3 milestones, 5 sessions (Mon–Fri, e.g. "25 min — storyline"), an implementation intention ("After I sit down with coffee → I open the deck and start the next session"), review cadence Weekly, rationale. Edit the first session's duration to 20. `Apply` → the page lists the sessions under their milestones; Today shows the first session as a Work commitment.
6. DB (`psql "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"`): `select title, scheduled_start, commitment_type, milestone_id, routine_id from commitments where domain = 'WORK' order by scheduled_start;` → 5 rows, `commitment_type = 'FOCUS_SESSION'`, milestone and routine ids set; `select title, trigger_type, trigger_value, plan_version_id from routines where title like 'Focus session%';` → `EVENT`, the "After I sit down…" trigger, the outcome's `ACTIVE` version; `select status, source from work_session_plan_proposals;` → `APPLIED | ai`; `select count(*) from plan_versions where user_id = '<id>';` unchanged from before step 5.
7. Today: on the first session card press `Reschedule` → tomorrow (E05-04 dialog). Press `Reschedule` again → later today. The card now shows "You've moved this twice. What's making it hard to start?" with `Answer`. `select reschedule_count from commitments where id = '<id>';` → 2. `curl -H "Authorization: Bearer $T" http://localhost:3535/api/today | jq '.data.domains[] | select(.domain=="WORK") | .commitments[0].avoidance'` → `{ "level": 3, "interventionType": "FRICTION_DIAGNOSIS", "signals": ["RESCHEDULED_TWICE"], "suggestedAction": "FRICTION_QUESTION" }`; `.data.nextBestAction.interventionMode` → `DIAGNOSE`.
8. Click `Answer`, choose "It feels too big", submit → an intervention card: "Let's stop treating this like one task. For the next 10 minutes, write only the storyline: decision, recommendation, three arguments." with `Start 10 minutes`, `Use minimum version`, `Not now`. DB: `select type, observed_count from obstacles where user_id = '<id>';` → `TASK_TOO_LARGE | 1`; `select friction_tags from reflections where commitment_id = '<id>' order by created_at desc limit 1;` → `{TOO_BIG}`.
9. `Start 10 minutes` → http://localhost:3535/start/<commitmentId> shows the instruction, `Begin 10:00`. Begin; type "Checked Slack" into "Distraction note" → `Add`. Reload the browser: the timer resumes at the right remaining time and the note is still listed (server state). Wait for 00:00 (or start with `plannedMinutes: 1` via curl for the test) → "Continue another 15?" → `Continue` → the countdown shows 15:00, `continuedCount` 1. Press `Done for now` → `Partially done`.
10. DB: `select planned_minutes, continued_count, distraction_notes, outcome, ended_at is not null as ended from focus_sessions;` → `25 | 1 | {"Checked Slack"} | PARTIAL | true`; `select evidence_type, source, quantitative_value, qualitative_value from evidence_items where commitment_id = '<id>' order by occurred_at;` → `started | APP_FLOW` (E05-02), `continued | APP_FLOW`, `partially_completed | USER_LOG`, then `focus_session | TIMER | <minutes> | partial`; `select status from commitments where id = '<id>';` → `PARTIALLY_COMPLETED`.
11. `curl -H "Authorization: Bearer $T" "http://localhost:3535/api/work/summary" | jq .data` → `focusSessions.planned = 5`, `focusSessions.partial = 1`, `starts.started = 1`, `repeatedlyPostponed[0].rescheduleCount = 2`, `timeWindows.morning.planned ≥ 1`, `distractionNoteCount = 1`.
12. Stop the fake server (`docker compose stop fake-openai`). Create a second work outcome, `Plan sessions with the coach` → "The coach is unavailable" + `Use a standard plan` → evenly spaced template sessions → `Apply` works. Reschedule one of its sessions twice, answer "I'm tired" → the template intervention "Do only the minimum version today: <minimum>" with the caption "Standard suggestion — the coach is unavailable". `select persona, status from ai_invocations where persona in ('planner','coach') order by created_at;` → `succeeded` rows from steps 5 and 8, `failed` rows from this step.
13. `select action, meta from audit_events where action like 'work:%' order by created_at;` → `work:sessions_applied` (×2, `{source:'ai'}` then `{source:'template'}`) and `work:friction_answered` (×2, `{answer, interventionType, level, source}`).

## Child issues

### E07-01 `feat(api): add work outcome session planning with planner proposals, apply and template fallback`

**Part of epic:** E07 · **Blocked by:** E01-06, E02-03, E02-04, E04-01 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §24 requires the AI to convert a work outcome into milestones, planned sessions, implementation triggers, minimum starts and a review cadence, and says "each session becomes a Commitment"; PRD §104 requires "AI can break outcome into planned sessions". PRD §15 forbids the AI from mutating plans — the plan is a proposal until the user applies it — and PRD §120 requires the product to work when the model is down. There is no milestone concept in E02-01's schema, no `planner` call site for work, and no way to materialise a set of dated sessions under an outcome.

#### Proposed solution
New module `apps/api/src/work/` (new) with `work.module.ts` (imports `PrismaModule`, `AiModule`, `UserProfileModule` (E04-01), `PathModule` (E02-02/03) and `CommitmentsModule` (E02-04/E05-02); registered in `app.module.ts`) and the sub-folder `apps/api/src/work/planning/` (new): `work-session-planning.controller.ts`, `work-session-planning.service.ts` (gateway call + guardrails + apply transaction), `work-session-plan.schema.ts` (Zod contract), `work-session-templates.ts` (deterministic fallback), `dto/{plan-sessions,apply-session-plan}.dto.ts` via `createZodDto`.

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

enum WorkSessionPlanSource { AI TEMPLATE }
enum WorkSessionPlanStatus { PROPOSED APPLIED DISCARDED EXPIRED }

model WorkSessionPlanProposal {
  id           String                @id @default(uuid()) @db.Uuid
  userId       String                @map("user_id") @db.Uuid
  outcomeId    String                @map("outcome_id") @db.Uuid
  source       WorkSessionPlanSource
  status       WorkSessionPlanStatus @default(PROPOSED)
  plan         Json                  // validated by workSessionPlanSchema
  appliedPlan  Json?                 @map("applied_plan") // the (possibly edited) copy that was applied
  invocationId String?               @map("invocation_id") @db.Uuid
  expiresAt    DateTime              @map("expires_at") @db.Timestamptz
  appliedAt    DateTime?             @map("applied_at") @db.Timestamptz
  createdAt    DateTime              @default(now()) @map("created_at") @db.Timestamptz

  user    User    @relation("UserWorkSessionPlanProposals", fields: [userId], references: [id], onDelete: Cascade)
  outcome Outcome @relation(fields: [outcomeId], references: [id], onDelete: Cascade)

  @@index([userId, outcomeId, status])
  @@map("work_session_plan_proposals")
}
```

Add `milestoneId String? @map("milestone_id") @db.Uuid` + `milestone Milestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)` to `model Commitment`; `milestones Milestone[] @relation("UserMilestones")` and `workSessionPlanProposals WorkSessionPlanProposal[] @relation("UserWorkSessionPlanProposals")` to `model User`; `milestones Milestone[]` and `workSessionPlanProposals WorkSessionPlanProposal[]` to `model Outcome`. Migration: `npm run prisma:migrate:dev -- --name add_work_planning`. Seed: none.

**API (backend-dev)** — all routes plain `@Auth()`; the outcome is loaded with `findFirst({ where: { id, userId } })` → 404 otherwise (never 403 — do not leak existence; reuse E02-02's `owned-resource.ts`) and must have `domain === 'WORK'` (400 `OUTCOME_NOT_WORK`). OpenAPI tag `Work` added to the `EvolvePath` group in `apps/api/src/openapi/tags.ts` after `Reflections`: `{ name: 'Work', description: 'Work-domain execution: session planning for an outcome, focus sessions with TIMER evidence, avoidance assessment and friction diagnosis, and the weekly summary.' }`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/outcomes/:id/plan-sessions` | `@Auth()` + ownership | `{ targetDate?: 'YYYY-MM-DD', availableMinutesPerDay?: 10..240 }` | 200 `{ proposalId, proposal: WorkSessionPlan, source: 'ai', expiresAt }`; 412 `AI_KEY_REQUIRED`; 503 `AI_UNAVAILABLE { code, message, retryable }`; 400 `OUTCOME_NOT_WORK`, `TARGET_DATE_PAST` |
| POST | `/api/outcomes/:id/plan-sessions/template` | `@Auth()` + ownership | same body | 200 `{ proposalId, proposal, source: 'template', expiresAt }` — never calls the gateway |
| POST | `/api/outcomes/:id/plan-sessions/apply` | `@Auth()` + ownership | `{ proposalId: uuid, proposal?: WorkSessionPlan }` (edited copy optional) | 201 `{ routineId, milestoneIds[], commitmentIds[] }`; 404 `PROPOSAL_NOT_FOUND`; 409 `PROPOSAL_NOT_PENDING` (already applied/discarded/expired); 400 `PROPOSAL_INVALID { details[] }` |
| GET | `/api/outcomes/:id/work-plan` | `@Auth()` + ownership | — | 200 `{ milestones: Milestone[], sessions: CommitmentSummary[] (id, title, status, scheduledStart, durationMinutes, milestoneId, rescheduleCount), implementationIntention: { when, then } \| null, reviewCadence \| null, latestProposal: { id, status, source } \| null }` |

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

Deterministic guardrails (`WorkSessionPlanningService.validate(plan, ctx)`, applied to AI output, templates, and the edited copy at apply; failures → `details[]` naming the rule): `milestones[].order` are `0..n-1` without gaps; every `milestoneIndex < milestones.length`; every `scheduledStart` in `[now, targetDate 23:59 local]` (or `now + 14 days` when the outcome has no target date); at most 2 sessions per local calendar day; per-day sum of `durationMinutes ≤ availableMinutesPerDay` (request value, else `user_profiles.weekday_minutes` (E04-01), else 60); `minimumStart.minutes < durationMinutes`; sessions sorted ascending. Guardrail violations on AI output are treated as a gateway `schema` failure (503, `retryable: false`, nothing stored).

Gateway call: `this.ai.invoke({ persona: 'planner', userId, promptVersion: 'work-session-plan.v1', instructions: WORK_PLANNING_INSTRUCTIONS, input: { today, timezone, outcome: { title, motivation, successDefinition, targetDate, importance }, availableMinutesPerDay, existingSessions: [{ scheduledStart, durationMinutes }] }, schema: workSessionPlanSchema, schemaName: 'work_session_plan' })`. `WORK_PLANNING_INSTRUCTIONS` (constant in the service) states: milestones are deliverables, not phases; sessions are concrete ("25 min — storyline: decision, recommendation, three arguments"), never "work on X"; one session per weekday by default, none on weekends unless the target date forces it; every session carries a `minimumStart` a tired person can do in ≤ 10 minutes; the implementation intention is an "After/When … → I …" pair in the user's own day; do not exceed the daily minutes. Error mapping as E04-02: `no_user_key` → 412 via `AiKeyRequiredException`; `rate_limit|timeout|network|provider` → 503 `retryable: true`; `ai_disabled|no_model|schema|refusal` → 503 `retryable: false`.

Proposal storage: a `WorkSessionPlanProposal` row (`status PROPOSED`, `expiresAt = now + 7 days`, `invocationId` from the gateway result). Creating a new proposal for an outcome marks that outcome's other `PROPOSED` rows `DISCARDED`. `apply` loads the proposal by `(id, userId, outcomeId)`, requires `status === 'PROPOSED'` and `expiresAt > now` (otherwise flips to `EXPIRED` and returns 409), re-validates the edited `proposal` if given (else the stored one), then in one `prisma.$transaction`:
1. Resolve the outcome's `Plan` and its `ACTIVE` `PlanVersion`; when the outcome has none (E02-06 outcomes created outside onboarding may lack one) create `Plan` + `PlanVersion { version: 1, status: 'ACTIVE', createdBy: 'USER', userApproved: true, rationale: 'Created when planning focus sessions', activeFrom: now }` through E02-03's `PlansService` if it accepts a `tx`, otherwise directly.
2. Create `Milestone` rows (`order` continues from the outcome's current max + 1 when milestones already exist, so a second plan appends).
3. Create one `Routine` under the active version: `{ userId, planVersionId, domain: 'WORK', title: 'Focus session: <outcome title>', triggerType: 'EVENT', triggerValue: implementationIntention.when, frequency: 'CUSTOM', daysOfWeek: <distinct local weekdays of the sessions>, preferredTime: <HH:mm of the first session>, estimatedDurationMin: <median session duration>, minimumDurationMin: <min minimumStart.minutes>, fallbackBehavior: <the most common minimumStart title>, active: true }`. Reuse the outcome's existing focus routine (same title, `active`) when one exists instead of creating a second.
4. Create one `Commitment` per session: `{ userId, domain: 'WORK', outcomeId, planVersionId, routineId, milestoneId, title, scheduledStart, scheduledEnd: start + duration, importance: outcome.importance, commitmentType: 'FOCUS_SESSION', status: 'PLANNED', fullVersion: <title, durationMinutes>, shortVersion: <title, ceil(duration/2)>, minimumVersion: <minimumStart.title, minimumStart.minutes> }` — the three version columns take whatever shape E02-01/E05-02 left them (`String` or `Json {title, minutes}`); write the shape E05's `apps/api/src/commitments/commitment-card.mapper.ts` reads.
5. Mark the proposal `APPLIED`, `appliedAt = now`, `appliedPlan = <the applied copy>`.

After the transaction: audit `prisma.auditEvent.create({ actorUserId: userId, action: 'work:sessions_applied', targetType: 'outcome', targetId: outcome.id, meta: { source: 'ai' | 'template', edited: boolean, milestones, sessions, routineId } })`. No new `PlanVersion` is created (decision — see Notes). `GET /work-plan` reads `implementationIntention`/`reviewCadence` from the latest `APPLIED` proposal's `appliedPlan` and the sessions from `commitments` where `outcomeId` and `commitmentType = 'FOCUS_SESSION'`.

Templates (`work-session-templates.ts`, pure, exported `buildTemplateSessionPlan({ outcome, now, timezone, targetDate, availableMinutesPerDay })`): `N = min(10, weekdays between tomorrow and targetDate inclusive)` (no target date → the next 5 weekdays); sessions evenly spaced over those weekdays at 09:00 local, `durationMinutes = min(availableMinutesPerDay, 45)`; milestones `["Clarify what done looks like", "Produce a rough first version", "Refine and finish"]` with sessions assigned by thirds; every `minimumStart = { title: 'Open the work and write the next three bullets', minutes: 10 }`; `implementationIntention = { when: 'After I sit down at my desk in the morning', then: 'I open "<outcome title>" and start the next planned session' }`; `reviewCadence: 'WEEKLY'`; `rationale` says it is a standard schedule to adjust. Output must pass `workSessionPlanSchema` and the guardrails (unit-tested).

Log one line per propose/apply (`Work plan-sessions user=<id> outcome=<id> source=<ai|template> sessions=<n> milestones=<n>`), never the titles.

**UI (frontend-dev)** — n/a here; `services/api.ts` functions (`planOutcomeSessions`, `planOutcomeSessionsTemplate`, `applyOutcomeSessionPlan`, `getOutcomeWorkPlan`) and types (`WorkSessionPlan`, `Milestone`, `OutcomeWorkPlan`) are added by E07-04.

**Tests (testing-dev)**
- `work-session-plan.schema.spec.ts`: accepts the fake server's fixture; rejects 21 sessions, `durationMinutes: 5`, `minimumStart.minutes: 20`, a non-ISO `scheduledStart`, `reviewCadence: 'MONTHLY'`.
- `work-session-templates.spec.ts`: no target date → 5 weekday sessions at 09:00 in `America/Costa_Rica` and `Asia/Tokyo`; target date in 3 days → 3 sessions; target date 6 weeks out → capped at 10; `availableMinutesPerDay: 20` → 20-minute sessions; output passes schema + guardrails.
- `work-session-planning.service.spec.ts` (gateway + prisma mocked): `invoke` called with `persona: 'planner'`, `promptVersion: 'work-session-plan.v1'`, `schemaName: 'work_session_plan'`; `{ok:false, code:'no_user_key'}` → 412; `{ok:false, code:'timeout'}` → 503 `retryable: true`; AI output with 3 sessions on one day → 503 `code: 'schema'` and no `workSessionPlanProposal.create`; a new proposal discards the previous `PROPOSED` one; `apply` runs inside one `$transaction`, creates plan+v1 when missing, milestones, one routine, and commitments with the field values above, marks the proposal `APPLIED`, audits once, creates **no** `planVersion` when one is active; `apply` twice → 409 `PROPOSAL_NOT_PENDING`; expired → 409 and status `EXPIRED`; non-WORK outcome → 400; another user's outcome → 404.
- `apps/api/test/work-planning.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true, overrideProviders: [{ provide: AiGatewayService, useValue: stub }] })`): 401 on every route; propose → apply round-trip returns ids; `template` never calls the stub; `GET /work-plan` reflects applied sessions and the intention.
- `test/openapi/openapi-document.spec.ts` passes with the new `Work` tag.

**Docs (docs-dev)** — `docs/API.md` new "Work" section (the four routes, error codes, the Zod contract); `CLAUDE.md` "API Endpoints" list and "Database Tables" (`milestones`, `work_session_plan_proposals`); `docs/specs/work-domain.md` is written by E07-06 — leave a pointer in the PR, not a partial file.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates `milestones` (unique `(outcome_id, order)`), `work_session_plan_proposals`, and `commitments.milestone_id` with `ON DELETE SET NULL`
- [ ] `POST /api/outcomes/:id/plan-sessions` returns a proposal satisfying the schema and guardrails and creates exactly one `work_session_plan_proposals` row (`PROPOSED`) — `commitments`, `milestones`, `routines`, `plan_versions` gain no rows
- [ ] `POST …/plan-sessions/apply` creates milestones, one focus routine on the outcome's `ACTIVE` plan version (creating plan + v1 only when the outcome had none), and one `PLANNED` `WORK` commitment per session with `commitment_type = 'FOCUS_SESSION'`, full/short/minimum versions, `milestone_id` and `routine_id`, atomically
- [ ] An edited proposal sent to `apply` is re-validated; a per-day total above `availableMinutesPerDay` is rejected with 400 `PROPOSAL_INVALID` and a `details[]` entry
- [ ] Applying the same proposal twice returns 409 and creates nothing; an expired proposal returns 409 and reads `EXPIRED`
- [ ] `POST …/plan-sessions/template` produces evenly spaced weekday sessions until the target date without calling the gateway, and `apply` accepts it with `source = TEMPLATE`
- [ ] With no user key, `plan-sessions` returns 412 `AI_KEY_REQUIRED`; with the fake server forcing `timeout`, 503 with `retryable: true`
- [ ] A `FAMILY` outcome returns 400 `OUTCOME_NOT_WORK`; another user's outcome returns 404
- [ ] `GET /api/outcomes/:id/work-plan` lists milestones in order with their sessions and the implementation intention
- [ ] No outcome or session titles appear in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures never surface as 500; every 4xx carries a stable `code`; `$transaction` failure leaves no milestone/routine/commitment behind and the proposal stays `PROPOSED`
- [ ] Observability: one log line per propose/apply; the gateway writes the `ai_invocations` row; audit `work:sessions_applied`
- [ ] Security: all routes `@Auth()`; ownership on outcome and proposal by `userId`; `source` read from the stored proposal, never from the body; proposal text is user content — stored, never interpreted
- [ ] Config & secrets: none new; `availableMinutesPerDay` default chain documented (request → profile → 60)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–4, then obtain a token (`/testing/login` sets one; copy from devtools or use `appctl login`).
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"availableMinutesPerDay":45}' http://localhost:3535/api/outcomes/<id>/plan-sessions` → `proposalId` + 5 sessions; `select count(*) from commitments where domain='WORK';` unchanged.
3. `curl -X POST … -d '{"proposalId":"<pid>"}' …/plan-sessions/apply` → 201 with ids; repeat → 409. Epic step 6 DB checks.
4. New proposal `<pid2>`; `curl … -d '{"proposalId":"<pid2>","proposal":<copy with two 45-min sessions on the same day>}' …/apply` → 400 `PROPOSAL_INVALID` with `details[0]` naming the daily cap.
5. `docker compose stop fake-openai`; `plan-sessions` → 503; `plan-sessions/template` → 5 sessions; `apply` → 201; `select source from work_session_plan_proposals order by created_at desc limit 1;` → `TEMPLATE`.

#### Out of scope
- Any UI (E07-04), the friction/ladder logic (E07-03), focus timing (E07-02)
- Milestone editing endpoints beyond what `apply` creates (E02-06's outcome editor may add them later)
- Rescheduling the whole session plan when the target date moves (E10 weekly planning)
- A new plan version per applied plan (see Notes)

#### Notes for the implementing agent
- Copy E04-02's shape exactly for the propose → validate → apply flow, the gateway error mapping and the template fallback (`apps/api/src/onboarding/onboarding-proposal.service.ts`, `onboarding-templates.ts`).
- Decision recorded here: sessions are applied under the outcome's **current** `ACTIVE` plan version and do not create a new `PlanVersion`. Rejected alternatives: (a) a new version per apply — E06-04's `ProposalsService` owns version creation and its `changes` column is typed `PlanChange[]`, so a session plan cannot ride on `plan_change_proposals` without breaking E06-07's diff view; (b) storing the pending plan on `user_profiles` as E04 did — an outcome can have several plans over time. The user's explicit `Apply` is the PRD §15 approval step; the rationale is kept on the proposal row and rendered by E07-04.
- Field names on `PlanVersion`/`Routine`/`Commitment` are E02-01's (`estimatedDurationMin`, `minimumDurationMin`, `daysOfWeek`, `commitmentType`); read `schema.prisma` before writing the create payloads. E05-02 may have turned the version columns into JSON — match `commitment-card.mapper.ts`.
- Dates: compute weekdays and 09:00 local with E05-01's `apps/api/src/today/local-date.ts` helpers (`localDate`, `localDayBounds`) and `Intl.DateTimeFormat` parts; add no date library.
- Zod via `nestjs-zod` `createZodDto`; Fastify, not Express. Register the `Work` tag in `apps/api/src/openapi/tags.ts` in the same commit as the controller.

---

### E07-02 `feat(api): add focus sessions with start, extend, notes, stop and TIMER evidence`

**Part of epic:** E07 · **Blocked by:** E02-04, E05-02 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §27–§28: Start shows a timer, one-sentence instruction, stop/continue controls, asks "Continue another 15 minutes?" at completion, allows a distraction note, and "starting counts as evidence distinct from completing"; PRD §104: "Start is recorded separately from completion". VISION §10: ten minutes on something avoided for three days is meaningful progress and the system should reinforce it. E05-02 already persists the timer on the commitment (`activeSince`, `activeSeconds`, `timerMinutes`) and E05-05 shows the continue prompt — but nothing records a *focus session* as a unit: how long the user actually focused, how often they continued, what distracted them (E05-05 keeps notes in React state and loses them on reload), or the `TIMER` evidence (PRD §10.9) E07-05's "planned vs completed focus sessions" needs.

#### Proposed solution
A `FocusSession` row layered on E05-02's timer — it never re-implements the timer or the state machine — with six endpoints under `apps/api/src/work/focus/` (new): `focus-session.controller.ts`, `focus-session.service.ts`, `dto/{start-focus-session,extend-focus-session,focus-session-note,stop-focus-session,focus-session-query}.dto.ts`, `dto/focus-session-response.dto.ts`.

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
  actualMinutes    Int?                 @map("actual_minutes")
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

Add `focusSessions FocusSession[] @relation("UserFocusSessions")` to `model User`, `focusSessions FocusSession[]` to `model Commitment`, `focusSession FocusSession?` to `model Evidence`. Migration: `npm run prisma:migrate:dev -- --name add_focus_sessions`. Seed: none. "One active session per user" is enforced in the service — a partial unique index is deliberately not used so a crashed client can always recover through `GET /focus-sessions/active`.

**API (backend-dev)** — all routes `@Auth()`; every query scoped by `userId`; the commitment must belong to the caller (404 otherwise) and have `domain === 'WORK'` (400 `COMMITMENT_NOT_WORK`). OpenAPI tag `Work` (E07-01; declare it here if E07-01 has not merged).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/focus-sessions` | `@Auth()` | `{ commitmentId: uuid, plannedMinutes: 1..180, instruction?: ≤ 240, takeOver?: boolean }` | 201 `FocusSessionResponse`; 409 `FOCUS_SESSION_ACTIVE { activeSessionId, commitmentId }` unless `takeOver` (then the active one is stopped as `ABANDONED` first); 400 `COMMITMENT_NOT_STARTABLE` when status ∈ `COMPLETED\|CANCELLED` |
| GET | `/api/focus-sessions/active` | `@Auth()` | — | 200 `{ session: FocusSessionResponse \| null, serverNow }` |
| POST | `/api/focus-sessions/:id/extend` | `@Auth()` | `{ minutes: 1..60 }` | 200 `FocusSessionResponse`; 409 `FOCUS_SESSION_ENDED` |
| POST | `/api/focus-sessions/:id/note` | `@Auth()` | `{ text: 1..280 }` | 200 `FocusSessionResponse`; 409 when ended; 400 `TOO_MANY_NOTES` above 20 |
| POST | `/api/focus-sessions/:id/stop` | `@Auth()` | `{ outcome: 'done' \| 'partial' \| 'abandoned', notes?: ≤ 1000 }` | 200 `{ session, evidenceId, commitmentStatus, actualMinutes }`; 409 when already ended |
| GET | `/api/focus-sessions?commitmentId=&outcomeId=&from=&to=` | `@Auth()` | query (`from`/`to` ≤ 93 days as E02-04's evidence query) | 200 `{ sessions: FocusSessionResponse[] }` (own rows, newest first, max 100) |

`FocusSessionResponse`: `{ id, commitmentId, plannedMinutes, instruction, startedAt, endedAt, outcome, actualMinutes, continuedCount, distractionNotes, commitment: { title, status, timer: { activeSince, activeSeconds, timerMinutes } } }` — the `timer` block is E05-01's `commitmentCardSchema.timer`, so the client derives the countdown with E05-05's `utils/commitmentTimer.ts` and nothing here duplicates that maths. `serverNow` on `active` lets a skewed phone re-anchor.

`FocusSessionService` (every mutation loads the row with `{ id, userId }` → 404):
- `start(userId, dto)`: transaction — if an active session exists (`endedAt: null`) and `!takeOver` → 409; with `takeOver` call `stop(active, 'abandoned')` first; create the row; then call E05-02's `CommitmentActionsService.start(userId, commitmentId, { minutes: plannedMinutes })` — that moves the commitment to `STARTED`, sets the timer fields and writes the `APP_FLOW started` evidence exactly as any other start (if the commitment is already `STARTED`, E05-02's `start` behaves as `continue`; never write a second start evidence here). Log `Focus start user=<id> commitment=<id> planned=<n>`.
- `extend(userId, id, minutes)`: `plannedMinutes += minutes`, `continuedCount += 1`, then E05-02's `continue(userId, commitmentId, { extraMinutes: minutes })` so `timerMinutes` grows and the `APP_FLOW continued` evidence is written (E05-05 makes the same call at 00:00; if E05-02's precondition requires a paused timer, pause-then-continue inside the transaction).
- `addNote(userId, id, text)`: `distractionNotes: { push: text.trim() }` (cap 20, checked by reading the row inside the same transaction).
- `stop(userId, id, outcome, notes?)`: transaction — route through E05-02: `done` → `complete(userId, commitmentId, { notes })` (→ `COMPLETED`, `USER_LOG completed` evidence), `partial` → `partial(…)` (→ `PARTIALLY_COMPLETED`), `abandoned` → `pause(…)` (status stays `STARTED` with `activeSince: null`; the next-best-action engine's "STARTED is the NBA" rule keeps offering it — starting still counts, VISION §10); then `actualMinutes = max(1, round(commitment.activeSeconds / 60))` read back after the action (pause-aware; fall back to `endedAt − startedAt` if the field is null), `endedAt = now`, `outcome`; create `Evidence { userId, commitmentId, evidenceType: 'focus_session', source: 'TIMER', occurredAt: endedAt, quantitativeValue: actualMinutes, quantitativeUnit: 'minutes', qualitativeValue: outcome, confidence: 1 }` (E02-04's `EvidenceService.create` if it accepts a `tx` and a non-`USER_LOG` source, else direct) and link `evidenceId`. Log `Focus stop user=<id> commitment=<id> outcome=<o> actual=<n> continued=<c>`.
- `getActive(userId)`: the row with `endedAt: null` joined to its commitment timer, or null.
- `list(userId, query)`.

Audit: none per session (product data, high volume); the `Evidence` row is the record.

**UI (frontend-dev)** — n/a here; `services/api.ts` functions (`startFocusSession`, `getActiveFocusSession`, `extendFocusSession`, `addFocusSessionNote`, `stopFocusSession`, `listFocusSessions`) and the `FocusSession` type are added by E07-04.

**Tests (testing-dev)**
- `focus-session.service.spec.ts` (prisma + `CommitmentActionsService` mocked): `start` creates the row and calls `start` with `{ minutes }` once; second `start` → 409 with `activeSessionId`; `takeOver: true` stops the previous as `ABANDONED` then starts; non-WORK commitment → 400; `COMPLETED` commitment → 400; `extend` increments both fields and calls `continue` with `extraMinutes`, rejects after `endedAt`; `addNote` trims, appends, rejects the 21st; `stop('done')` calls `complete`, writes `TIMER` evidence with `quantitativeValue` from `activeSeconds` (600 s → 10) and links it; `stop('partial')` → `partial`; `stop('abandoned')` → `pause` and evidence still written; `stop` twice → 409; `actualMinutes` floors at 1.
- `apps/api/test/focus-sessions.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true })`): 401 on every route; start → active → extend → note → stop round trip; a second user cannot read, extend or stop the first user's session (404); the list filters by `commitmentId`.

**Docs (docs-dev)** — `docs/API.md` "Work" section (six routes, DTO, error codes, the relationship to E05-02's actions); `CLAUDE.md` "Database Tables" (`focus_sessions`) and "API Endpoints"; `docs/ARCHITECTURE.md` data-model list.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates `focus_sessions` and the `FocusSessionOutcome` enum with cascading `user_id`/`commitment_id` FKs
- [ ] `POST /api/focus-sessions` creates a session with server `startedAt`, moves the commitment to `STARTED` through E05-02's `start`, and results in exactly one `APP_FLOW started` evidence row
- [ ] A second `POST /api/focus-sessions` while one is active returns 409 with `activeSessionId`; with `takeOver: true` the previous session ends as `ABANDONED` with its own `TIMER` evidence
- [ ] `GET /api/focus-sessions/active` returns the session with the commitment's `timer` block and `serverNow`
- [ ] `extend {minutes: 15}` raises `plannedMinutes` by 15, `continuedCount` by 1 and the commitment's `timerMinutes` by 15; `note` appends to `distractionNotes`
- [ ] `stop {outcome:'partial'}` after ~10 minutes writes an `evidence_items` row `source = 'TIMER'`, `evidence_type = 'focus_session'`, `quantitative_value = 10`, `qualitative_value = 'partial'` and the commitment is `PARTIALLY_COMPLETED`; `'done'` → `COMPLETED`; `'abandoned'` → still `STARTED` (paused) with the evidence present
- [ ] Any mutation on an ended session returns 409 `FOCUS_SESSION_ENDED`
- [ ] Another user's session id returns 404 on every route
- [ ] No instruction or note text appears in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: every 4xx carries a stable `code`; the start transaction rolls back the row if the commitment action throws (409 `INVALID_TRANSITION` from the matrix propagates unchanged); evidence creation and the status transition happen in one transaction
- [ ] Observability: the two log lines above (ids and numbers only); OTel span attributes `work.focus.planned_minutes`, `work.focus.outcome` on stop
- [ ] Security: all routes `@Auth()`; `userId` in every query; notes are user content — stored, never interpreted or logged
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–6 (a `WORK` commitment exists), token in `$T`.
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"commitmentId":"<cid>","plannedMinutes":1,"instruction":"Write the decision statement"}' http://localhost:3535/api/focus-sessions` → 201; repeat → 409 with `activeSessionId`.
3. `curl … /api/focus-sessions/active` → `session.commitment.timer.activeSince` set, `timerMinutes: 1`, `serverNow`.
4. `curl -X POST … -d '{"minutes":15}' …/focus-sessions/<sid>/extend` → `plannedMinutes: 16`, `continuedCount: 1`, `timer.timerMinutes: 16`; `-d '{"text":"Checked Slack"}' …/note` → note appended.
5. `curl -X POST … -d '{"outcome":"partial"}' …/stop` → `actualMinutes ≥ 1`, `commitmentStatus: "PARTIALLY_COMPLETED"`; epic step 10 DB checks; `…/stop` again → 409.

#### Out of scope
- The timer UI, distraction-note input wiring and query params (E07-04)
- Push/sound at timer end (E12 / not in V1)
- Focus sessions for `FAMILY`/`HEALTH` commitments — E09's workout runner has its own session model
- Changing E05-02's timer semantics — this issue only calls them

#### Notes for the implementing agent
- The start/continue/complete/partial/pause transitions belong to E05-02 (`apps/api/src/commitments/actions/commitment-actions.service.ts`) — call them, do not re-implement the state machine or write a second `APP_FLOW` evidence. If those methods open their own `$transaction`, call them **after** the row write and compensate (delete the row) on failure rather than nesting transactions.
- Evidence fields (`evidenceType`, `quantitativeValue`, `quantitativeUnit`, `qualitativeValue`, `occurredAt`) and the `evidence_items` table name are E02-01's — verify in `schema.prisma`. E02-04's `POST /evidence` only accepts `USER_LOG`; `TIMER` rows are server-written here.
- `distractionNotes: { push }` is a Prisma scalar-list write; the 20-cap check reads the row first inside the same transaction.
- Pattern for own-resource controllers: `apps/api/src/pat/pat.controller.ts`; DTOs via `createZodDto`; Fastify, not Express.

---

### E07-03 `feat(api): add avoidance detection, intervention ladder and friction diagnosis`

**Part of epic:** E07 · **Blocked by:** E07-02, E05-01, E05-02, E06-01, E06-03, E06-06 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §25 lists the avoidance signals (repeated rescheduling, unchanged task across days, repeated short skips, explicit "later", high-priority work displaced by lower-priority completions) and requires that avoidance "must not be inferred solely from one miss"; PRD §26 fixes a seven-level ladder from normal reminder to goal challenge; VISION §9 requires the coach to ask "You've moved this twice. What is making it hard to start?" and route each of eight answers to a different intervention; PRD §104: "repeated reschedules trigger friction intervention". E05-01's `resolveInterventionMode` uses two ad-hoc heuristics (`rescheduleCount >= 2` → `DIAGNOSE`, ≥ 4 misses → `CHALLENGE_PLAN`) with no notion of a level, E06's coaching contract has the `intervention_type` vocabulary but no deterministic input telling it which rung the user is on, and nothing stores the friction answer as an `Obstacle` (PRD §10.11).

#### Proposed solution
A pure detector, a signal collector, a friction endpoint, and the ladder level on `GET /today`, all under `apps/api/src/work/avoidance/` (new): `avoidance-detector.ts` (pure), `avoidance-signals.service.ts` (DB → signals), `avoidance.service.ts` (assess commitments, batched), `friction.controller.ts`, `friction.service.ts` (Obstacle + Reflection + coach call), `friction-templates.ts` (deterministic copy), `friction-answers.ts` (the answer → intervention table), `time-window.ts` (shared with E07-05), `dto/answer-friction.dto.ts`.

**Data (database-dev)** — extend E06-01's `ObstacleType` enum with `TASK_TOO_LARGE`, `LOW_MOTIVATION`, `URGENCY_DISPLACEMENT` (migration `npm run prisma:migrate:dev -- --name add_work_obstacle_types`; Postgres `ALTER TYPE … ADD VALUE` — Prisma emits it, nothing hand-written). Writes into `Obstacle` (`type`, `description`, `domain`, `observedCount`, `confidence`, `lastObservedAt`, `interventionHistory`) and E02-01's `Reflection` (`relatedType: 'commitment'`, `relatedId`, `commitmentId`, `userText`, `frictionTags`). Seed: none.

**API (backend-dev)**

*Detector* — `apps/api/src/work/avoidance/avoidance-detector.ts` (new), pure, no imports from Nest/Prisma/`Date`:

```ts
export enum AvoidanceLevel { NORMAL_REMINDER = 0, ACTIVATION_REDUCTION = 1, DECOMPOSITION = 2, FRICTION_DIAGNOSIS = 3, ENVIRONMENT_CHANGE = 4, PLAN_CHALLENGE = 5, GOAL_CHALLENGE = 6 }
export type AvoidanceSignalKey = 'RESCHEDULED_TWICE' | 'UNCHANGED_3_DAYS' | 'SHORT_SKIPS' | 'EXPLICIT_LATER' | 'DISPLACED_BY_LOWER_IMPORTANCE' | 'SAME_WINDOW_FAILURES';
export interface AvoidanceSignals {
  rescheduleCount: number;                 // Commitment.rescheduleCount
  daysUnchanged: number;                   // whole days the commitment has sat in PLANNED/READY/RESCHEDULED with no Evidence row
  shortSkipCount: number;                  // SKIPPED|MISSED commitments of the same outcome in the last 14 days
  explicitLaterCount: number;              // same-outcome commitments (14 days) with skipReason 'AVOIDED' or skipNote matching /\b(later|tomorrow|not now)\b/i
  displacedByLowerImportanceCount: number; // past days this commitment was due and untouched while a lower-importance WORK commitment was COMPLETED
  sameWindowFailureCount: number;          // SKIPPED|MISSED|RESCHEDULED occurrences of the same outcome in the same time window, 21 days
  weeksOfEvidence: number;                 // floor(days since the outcome was created / 7)
}
export type SuggestedAction = 'NONE' | 'MINIMUM' | 'DECOMPOSE' | 'FRICTION_QUESTION' | 'ENVIRONMENT' | 'PLAN_REVIEW';
export interface AvoidanceAssessment { level: AvoidanceLevel; interventionType: (typeof INTERVENTION_TYPES)[number]; signals: AvoidanceSignalKey[]; rationale: string; suggestedAction: SuggestedAction }
export function detectAvoidance(s: AvoidanceSignals, opts?: { askedRecently?: boolean }): AvoidanceAssessment
```

Deterministic rule (document it verbatim in the file header and in `docs/specs/work-domain.md`):
1. A signal is *active* when it crosses its threshold: `RESCHEDULED_TWICE` ← `rescheduleCount ≥ 2`; `UNCHANGED_3_DAYS` ← `daysUnchanged ≥ 3`; `SHORT_SKIPS` ← `shortSkipCount ≥ 2`; `EXPLICIT_LATER` ← `explicitLaterCount ≥ 2`, or `≥ 1` when any other signal is active; `DISPLACED_BY_LOWER_IMPORTANCE` ← `count ≥ 2`; `SAME_WINDOW_FAILURES` ← `count ≥ 3`. A single reschedule, skip, or "later" never activates anything (PRD §25) → level 0.
2. `base` = the highest of the active signals' own rungs: `UNCHANGED_3_DAYS` → 1, `SHORT_SKIPS` → 2, `RESCHEDULED_TWICE` → 3, `EXPLICIT_LATER` → 3, `DISPLACED_BY_LOWER_IMPORTANCE` → 4, `SAME_WINDOW_FAILURES` → 5. No active signal → level 0 and stop.
3. `extra` = occurrences beyond each active signal's threshold, summed: `(rescheduleCount − 2) + (daysUnchanged − 3) + (shortSkipCount − 2) + (explicitLaterCount − 2) + (displaced − 2) + (sameWindow − 3)`, each term clamped at ≥ 0 and counted only for active signals (an `EXPLICIT_LATER` activated by the "≥ 1 with another signal" clause contributes `explicitLaterCount` itself). The level rises **one step per additional occurrence**: `level = base + extra`.
4. Caps: `level ≤ 4` unless `weeksOfEvidence ≥ 3` (levels 5–6 need three weeks of evidence — PRD §26 L6 "for three weeks"); level 5 additionally requires `SAME_WINDOW_FAILURES` active (PRD §26 L5 "keeps failing at 4 PM"), otherwise clamp to 4; level 6 requires `weeksOfEvidence ≥ 3` and `base + extra ≥ 6`. Final `level = min(level, 6)`.
5. `interventionType` = the PRD §26 name for the level (`AvoidanceLevel[level]` — all seven are members of E06-03's `INTERVENTION_TYPES`); `rationale` is a fixed sentence per level with the numbers substituted ("Moved 2 times, untouched for 4 days"), never AI-written; `suggestedAction` = 0 → `NONE`, 1 → `MINIMUM`, 2 → `DECOMPOSE`, 3 → `FRICTION_QUESTION` (or `DECOMPOSE` when `opts.askedRecently`), 4 → `ENVIRONMENT`, 5–6 → `PLAN_REVIEW`.

*Signals* — `AvoidanceSignalsService.collectMany(userId, commitments, now, timezone): Promise<Map<commitmentId, AvoidanceSignals>>` reads, with one query per table for the whole batch: the commitments' outcomes (`Commitment.outcomeId`), the same outcomes' commitments in the last 21 days (`status`, `scheduledStart`, `skipReason`, `skipNote`, `rescheduleCount`), the commitments' `Evidence` rows, and the user's `WORK` commitments `COMPLETED` on the days the assessed ones were due. `daysUnchanged` = whole local days since `createdAt` while status ∈ `PLANNED|READY|RESCHEDULED`, and `0` once any `Evidence` row exists for the commitment. `time-window.ts` exports `timeWindowOf(date, timezone): 'morning' | 'afternoon' | 'evening'` using E05-01's `greetingFor` boundaries (05:00–11:59 morning, 12:00–17:59 afternoon, else evening) — import `greetingFor` from `apps/api/src/today/local-date.ts`, do not restate the hours. `askedRecently` = a `Reflection` for the commitment in the last 7 days whose `frictionTags` contains a `FrictionAnswer` key (E05-02's skip reflections carry `SkipReason` keys and do not count).

*Ladder on Today* — E05-01's `TodayService` calls `AvoidanceService.assessMany(userId, workCommitments, now, timezone)` and adds `avoidance: AvoidanceAssessment | null` to `commitmentCardSchema` (`null` for non-WORK cards). `resolveInterventionMode` (`apps/api/src/today/nba/intervention-mode.ts`) replaces its two heuristic inputs with the assessment: `CHALLENGE_PLAN` ← top candidate `avoidance.level ≥ 5`; `DIAGNOSE` ← `avoidance.level ∈ {3, 4}`; `REDUCE` additionally ← `avoidance.level ∈ {1, 2}`; precedence order unchanged; non-WORK candidates keep E05-01's original rules. The NBA rationale appends `avoidance.rationale` when `level ≥ 1`.

*Friction endpoint* — OpenAPI tag `Work`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/commitments/:id/friction` | `@Auth()` + ownership (404) | `{ answer: FrictionAnswer, text?: ≤ 500 }` (`text` required for `OTHER`) | 200 `{ level, obstacleId, reflectionId, intervention: { interventionType, userMessage, recommendedAction?: { title, durationMinutes }, fallbackAction?: { title, durationMinutes }, suggestedReschedule?: { scheduledStart, scheduledEnd }, source: 'ai' \| 'template' } }`; 400 `COMMITMENT_NOT_WORK`, `TEXT_REQUIRED` |
| GET | `/api/commitments/:id/avoidance` | `@Auth()` + ownership | — | 200 `AvoidanceAssessment` (for the outcome detail page and debugging) |
| POST | `/api/commitments/:id/actions/reschedule` | existing (E05-02) | body gains `protected?: boolean` | when `protected` and a `SOMETHING_URGENT` reflection exists for the commitment within 24 h: dates move, status → `RESCHEDULED`, **`rescheduleCount` unchanged**, evidence `qualitativeValue.protected = true`; otherwise `protected` is ignored (400 `PROTECTED_RESCHEDULE_NOT_ALLOWED` if sent without the reflection) |

`friction-answers.ts` — the VISION §9 table, exported as `FRICTION_ANSWERS` (order is the dialog order). `interventionType` values are E06-03's `INTERVENTION_TYPES` plus two additive members this issue appends there: `PERFECTIONISM_REFRAME`, `PROTECTED_RESCHEDULE` (E06's tests keep passing; the enum only grows).

| `FrictionAnswer` | Label | `interventionType` | `Obstacle.type` | Template intervention |
|---|---|---|---|---|
| `DONT_KNOW_WHERE_TO_BEGIN` | I don't know where to begin | `ACTIVATION_REDUCTION` | `AMBIGUOUS_WORK_TASK` | recommended: "Start for 10 minutes: open the work and write one sentence stating what done looks like" (10); fallback: minimum version |
| `TOO_BIG` | It feels too big | `DECOMPOSITION` | `TASK_TOO_LARGE` | recommended: "Let's stop treating this like one task. For the next 10 minutes, write only the first three bullets of '<title>'." (10); fallback: minimum version |
| `TIRED` | I'm tired | `REDUCE_SCOPE` | `LOW_ENERGY_WINDOW` | recommended: the commitment's `minimumVersion` (its minutes); fallback: "Reschedule to your next morning slot" |
| `DONT_WANT_TO` | I don't want to do it | `RECONNECT_REASON` | `LOW_MOTIVATION` | userMessage quotes the outcome's `motivation`; recommended: "Give it 5 minutes, then decide" (5) |
| `SOMETHING_URGENT` | Something more urgent came up | `PROTECTED_RESCHEDULE` | `URGENCY_DISPLACEMENT` | `suggestedReschedule` = next free slot in the same time window tomorrow; no `recommendedAction` |
| `WORRIED_ABOUT_QUALITY` | I'm worried I won't do it well | `PERFECTIONISM_REFRAME` | `PERFECTIONISM` | userMessage: "A rough draft is the goal, not the final version."; recommended: "Write a deliberately bad first draft for 10 minutes" (10) |
| `NEED_MORE_INFO` | I need more information | `CLARIFY` | `AMBIGUOUS_WORK_TASK` | recommended: "Spend 10 minutes listing exactly what you need to know and who has it" (10) |
| `OTHER` | Other | `FRICTION_DIAGNOSIS` | `OTHER` | userMessage acknowledges the text; recommended: minimum version |

`FrictionService.answer(userId, commitmentId, dto)`:
1. Load the commitment (+ outcome, `WORK` only), assess the level (`AvoidanceService.assessOne`), and when `text` is present run `SafetyPolicyService.evaluate({ userId, text, surface: 'coach' })` (E06-06) — a `redirect` decision short-circuits to `{ interventionType: 'FRICTION_DIAGNOSIS', userMessage: decision.userFacingNote, source: 'template' }` with no obstacle or reflection write.
2. Transaction: create `Reflection { userId, relatedType: 'commitment', relatedId: id, commitmentId: id, userText: text ?? null, frictionTags: [answer] }`; find the user's `Obstacle` with `{ domain: 'WORK', type }` (`findFirst`; E06-01 has no unique on that pair) → update `observedCount += 1`, `lastObservedAt = now`, `confidence = min(1, observedCount / 3)`, `interventionHistory = [...existing, { at, commitmentId, answer, level, interventionType }]` (cap 50) — or create it with `observedCount: 1`, `confidence: 0.34`, `description: <label>`.
3. Coach call: `this.ai.invoke({ persona: 'coach', userId, promptVersion: 'work-friction.v1', instructions: FRICTION_INSTRUCTIONS, input: { commitment: { id, title, minimumVersion, scheduledStart, rescheduleCount }, outcome: { title, motivation }, answer, text, requiredInterventionType, level, coachingStyle }, schema: coachReplySchema, schemaName: 'coach_reply' })`. `FRICTION_INSTRUCTIONS`: reply in ≤ 3 sentences in the user's coaching style (E04-01), set `intervention_type` to `requiredInterventionType`, give one `recommended_action` of ≤ 10 minutes that names the *first concrete thing to write or open* (`commitmentId` = this commitment or null), no motivational theater (VISION §9), `proposal` and `friction_question` null. Server guard (deterministic): if `ok` but `output.intervention_type !== requiredInterventionType`, `recommended_action.duration_minutes > 15`, `recommended_action.commitmentId` is another id, or `proposal`/`friction_question` non-null → discard and use the template (log `Friction ai_override reason=<…>`); any `{ok:false}` → template. `source` reflects what was returned.
4. For `SOMETHING_URGENT`: compute `suggestedReschedule` deterministically (tomorrow, same `timeWindowOf` window, first 15-minute slot not overlapping the user's commitments); the client applies it through E05-02's `reschedule` with `protected: true`, which this issue teaches to leave `rescheduleCount` alone when the reflection exists — a protected move is not avoidance.
5. After the transaction: audit `prisma.auditEvent.create({ actorUserId: userId, action: 'work:friction_answered', targetType: 'commitment', targetId, meta: { answer, level, interventionType, source } })`. Log `Friction user=<id> commitment=<id> answer=<a> level=<n> source=<s>` — never `text`.

**UI (frontend-dev)** — n/a here; E07-04 adds `answerFriction`, `getCommitmentAvoidance` in `services/api.ts`, the `FrictionAnswer`, `FrictionIntervention`, `AvoidanceAssessment` types, and `CommitmentCard.avoidance`.

**Tests (testing-dev)**
- `avoidance-detector.spec.ts` — one case per level and per rule: all zeros → 0; `rescheduleCount: 1` → 0; `shortSkipCount: 1` → 0; `explicitLaterCount: 1` alone → 0; `daysUnchanged: 3` → 1 (`UNCHANGED_3_DAYS`, `MINIMUM`); `daysUnchanged: 4` → 2; `shortSkipCount: 2` → 2 (`DECOMPOSE`); `rescheduleCount: 2` → 3 (`RESCHEDULED_TWICE`, `FRICTION_QUESTION`; with `askedRecently` → `DECOMPOSE`); `rescheduleCount: 3` → 4; `explicitLaterCount: 2` → 3; `explicitLaterCount: 1` + `daysUnchanged: 3` → 2; `displaced: 2` → 4 (`ENVIRONMENT`); `rescheduleCount: 4, weeksOfEvidence: 1` → capped 4; `rescheduleCount: 4, weeksOfEvidence: 3, sameWindow: 0` → 4 (level 5 needs the window signal); `sameWindow: 3, weeksOfEvidence: 3` → 5 (`PLAN_REVIEW`); `sameWindow: 4, rescheduleCount: 3, weeksOfEvidence: 3` → 6; `sameWindow: 3, weeksOfEvidence: 2` → 4; `interventionType` matches `AvoidanceLevel[level]` and is a member of `INTERVENTION_TYPES` for 0..6; `signals` lists exactly the active keys; rationale contains the numbers; pure (same input → deep-equal output).
- `friction-answers.spec.ts` — every `FrictionAnswer` maps to an `INTERVENTION_TYPES` member and an `ObstacleType` member; the eight templates each pass `coachReplySchema` after mapping; `TIRED` uses the commitment's `minimumVersion`; `SOMETHING_URGENT` carries no `recommendedAction`.
- `avoidance-signals.service.spec.ts` (prisma mocked) — `daysUnchanged` is 0 when evidence exists; `explicitLaterCount` counts `skipReason: 'AVOIDED'` and notes matching "later"/"tomorrow"/"not now" case-insensitively, ignores "latest"; `displacedByLowerImportanceCount` counts only days with a lower-importance `COMPLETED` WORK commitment; `sameWindowFailureCount` uses the user's timezone; `collectMany` issues a constant number of queries for 1 and 10 commitments; `askedRecently` ignores skip reflections.
- `friction.service.spec.ts` (gateway, prisma, safety mocked) — creates the reflection with `frictionTags: [answer]`; obstacle `observedCount` 1 then 2 on repeat; calls `invoke` with `persona: 'coach'`, `promptVersion: 'work-friction.v1'`, `schemaName: 'coach_reply'`, `requiredInterventionType` in `input`; AI returning the wrong `intervention_type` → template with `source: 'template'`; AI `recommended_action.commitmentId` of another commitment → template; `{ok:false}` → template; `OTHER` without `text` → 400; safety `redirect` → safety copy, no reflection, no obstacle, no gateway call; `SOMETHING_URGENT` → `suggestedReschedule` tomorrow in the same window; audit once.
- `commitment-actions.service.spec.ts` (E05-02, extend) — `reschedule` with `protected: true` and a recent `SOMETHING_URGENT` reflection leaves `rescheduleCount` unchanged; without the reflection → 400.
- `intervention-mode.spec.ts` (E05-01, extend) — `avoidance.level 3` → `DIAGNOSE`, `5` → `CHALLENGE_PLAN`, `1` → `REDUCE`; a FAMILY candidate with `avoidance: null` keeps the old rules.
- `today.service.spec.ts` (E05-01, extend) — WORK cards carry `avoidance`; FAMILY cards carry `avoidance: null`; assessment failure logs and yields `null` without failing the request.
- `apps/api/test/friction.integration.spec.ts` (new, `createTestApp({ useMockDatabase: true, overrideProviders: [AiGatewayService stub, SafetyPolicyService allow-all] })`) — 401; `POST /api/commitments/:id/friction` round trip for `TOO_BIG` returns `DECOMPOSITION`; `GET /api/today` shows `avoidance.level: 3` and `nextBestAction.interventionMode: 'DIAGNOSE'` for a commitment with `rescheduleCount: 2`; another user's commitment → 404.

**Docs (docs-dev)** — `docs/API.md` (the two routes, the `protected` flag on reschedule, the `avoidance` field on `GET /today` cards, the answer table); `CLAUDE.md` "API Endpoints"; the ladder rule and table go into `docs/specs/work-domain.md` (E07-06); `docs/specs/today-and-nba.md` (E05-07) gets a one-paragraph note that `DIAGNOSE`/`CHALLENGE_PLAN` now come from the avoidance level.

#### Acceptance criteria
- [ ] `detectAvoidance` is a pure function with the documented rule; a single reschedule, a single skip or a single "later" yields level 0
- [ ] `rescheduleCount: 2` yields level 3 `FRICTION_DIAGNOSIS` with `suggestedAction: 'FRICTION_QUESTION'`; each additional reschedule raises the level by one, capped at 4 before three weeks of evidence
- [ ] Levels 5 and 6 are unreachable with `weeksOfEvidence < 3`; level 5 requires three failures in the same time window
- [ ] `GET /api/today` carries `avoidance` on every `WORK` commitment card and `avoidance: null` on other domains; the NBA `interventionMode` is `DIAGNOSE` for level 3–4 and `CHALLENGE_PLAN` for 5–6
- [ ] `POST /api/commitments/:id/friction` writes one `reflections` row with `friction_tags = {<answer>}` and one `obstacles` row (`type` per the table) whose `observed_count` increments on repeat answers
- [ ] Each of the eight answers returns its mapped `interventionType`; `TOO_BIG` returns `DECOMPOSITION` with a ≤ 10-minute `recommendedAction`
- [ ] After an answer, the card's `suggestedAction` is `DECOMPOSE` (asked once) for 7 days
- [ ] With the AI returning a different `intervention_type` than required, the response is the template (`source: 'template'`) and the mapping still holds
- [ ] With the AI down, every answer still returns a usable intervention (`source: 'template'`)
- [ ] `SOMETHING_URGENT` returns `suggestedReschedule`; applying it with `protected: true` moves the commitment without incrementing `reschedule_count`
- [ ] A safety `redirect` on the free text returns the professional-care copy and writes nothing
- [ ] The friction `text` never appears in API logs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures degrade to templates, never 500; the reflection/obstacle transaction rolls back together; `GET /today` never fails because assessment failed (log and return `avoidance: null`)
- [ ] Observability: `Friction …` log line; `ai_invocations` row via the gateway; audit `work:friction_answered`; OTel span `work.avoidance.assess` with `work.avoidance.level`
- [ ] Security: all routes `@Auth()`; ownership by `userId`; `requiredInterventionType` is computed server-side, never taken from the body; free text goes through E06-06 before the coach; `protected` is server-verified against the reflection
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–6; token in `$T`; `<cid>` = the first session's commitment id.
2. `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"scheduledStart":"<tomorrow 09:00 ISO>"}' http://localhost:3535/api/commitments/<cid>/actions/reschedule` twice (second with a later time) → `rescheduleCount: 2`.
3. `curl … /api/commitments/<cid>/avoidance` → `{ level: 3, interventionType: "FRICTION_DIAGNOSIS", signals: ["RESCHEDULED_TWICE"], suggestedAction: "FRICTION_QUESTION" }`; `curl … /api/today | jq '.data.nextBestAction.interventionMode'` → `"DIAGNOSE"`.
4. `curl -X POST … -d '{"answer":"TOO_BIG"}' …/commitments/<cid>/friction` → `intervention.interventionType: "DECOMPOSITION"`, `source: "ai"`; epic step 8 DB checks. Repeat with `{"answer":"TIRED"}` → `REDUCE_SCOPE` quoting the minimum version; `select observed_count from obstacles where type = 'LOW_ENERGY_WINDOW';` → 1.
5. `curl … /api/commitments/<cid>/avoidance` again → `suggestedAction: "DECOMPOSE"` (asked once).
6. `{"answer":"SOMETHING_URGENT"}` → `suggestedReschedule`; `curl -X POST … -d '{"scheduledStart":"<that>","protected":true}' …/actions/reschedule` → `rescheduleCount` still 2.
7. `docker compose stop fake-openai`; `{"answer":"WORRIED_ABOUT_QUALITY"}` → `source: "template"`, `PERFECTIONISM_REFRAME`.
8. `{"answer":"OTHER"}` without text → 400 `TEXT_REQUIRED`; with `"text":"I don't want to be alive"` → the safety copy; `select count(*) from obstacles where type='OTHER';` → 0.

#### Out of scope
- The dialog and Today card UI (E07-04)
- Notification delivery of N3 "Procrastination rescue" (E12)
- Pattern analysis across obstacles into `MemoryInsight` (E06-05 / E10)
- Levels 5–6 coaching conversations — the level is exposed and E06-07's Coach screen reads it; no new endpoint

#### Notes for the implementing agent
- Keep `avoidance-detector.ts` free of Nest, Prisma and dates — it takes numbers and returns an assessment; that is what makes the per-level tests trivial. Dates live in `avoidance-signals.service.ts`.
- Decision recorded here (the plan text listed "too big" and "don't know where to begin" the other way round): `TOO_BIG` → `DECOMPOSITION` and `DONT_KNOW_WHERE_TO_BEGIN` → `ACTIVATION_REDUCTION`, following VISION §9's own worked example ("build the presentation" felt too big → break it into a 12-minute storyline slice). The e2e (E07-06) asserts `TOO_BIG` → decomposition.
- Decision: no `PlanChangeProposal` for the protected reschedule — E06-04's `PlanChange` ops target routines' `preferredTime`/`triggerValue`, not a single commitment's date; a guarded flag on E05-02's `reschedule` is smaller and keeps `rescheduleCount` honest.
- The coaching contract is E06-03's (`apps/api/src/coach/contracts/coach-reply.contract.ts`); append the two enum members there, do not fork the schema. E06-03's `guardCoachOutput` needs a `CoachContext`; the narrower checks in step 3 are enough here.
- `Obstacle.type` is an enum — the migration must land before the service; the Prisma client regenerates with `npm run prisma:generate`.
- E05-01's `TodayService` owns the card DTO; add `avoidance` there and keep the assessment batched (`assessMany`) — `GET /today` runs on every app open. Time windows must match E07-05's aggregation exactly; both import `time-window.ts`.

---

### E07-04 `feat(web): add work outcome detail, focus timer controls and friction dialog`

**Part of epic:** E07 · **Blocked by:** E07-01, E07-02, E07-03, E02-06, E05-04, E05-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §24 (milestones and sessions the user can see and adjust), §27–§28 (the Start screen with instruction, timer, distraction note, `Continue` / `Done for now`), VISION §9 (the friction question with eight answers) and VISION §10 (Start for 5/10/20, Break this down) need surfaces. E02-06's `OutcomeDetailPage` is domain-agnostic, E05-05's `StartFlowPage` has the timer and the continue prompt but keeps distraction notes in React state and knows nothing about focus sessions or a pre-set instruction, and E05-04's `CommitmentRow` has no friction prompt. PRD §123 makes the phone primary — every one of these must work at 360px.

#### Proposed solution
Three additions to existing pages plus one new dialog, all under `apps/web/src/components/work/` (new) and wired through `apps/web/src/hooks/{useWorkOutcome,useFocusSession,useFriction}.ts` (new).

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E07-01/02/03).

**UI (frontend-dev)**

*Types* (`apps/web/src/types/index.ts`): `Milestone`, `WorkSessionPlan`, `WorkSessionPlanProposal { proposalId, proposal, source, expiresAt }`, `OutcomeWorkPlan`, `FocusSession` (the E07-02 response incl. `commitment.timer`), `FocusSessionOutcome = 'done' | 'partial' | 'abandoned'`, `FrictionAnswer` (the 8 keys), `FrictionIntervention`, `AvoidanceAssessment`, `SuggestedAction`; E05-04's `CommitmentCard` gains `avoidance: AvoidanceAssessment | null` (required — fixtures in `__tests__/mocks/today.data.ts` must declare it).

*API functions* (`apps/web/src/services/api.ts`, on the `ApiService` class): `planOutcomeSessions(outcomeId, body)`, `planOutcomeSessionsTemplate(outcomeId, body)`, `applyOutcomeSessionPlan(outcomeId, { proposalId, proposal? })`, `getOutcomeWorkPlan(outcomeId)`, `startFocusSession(body)`, `getActiveFocusSession()`, `extendFocusSession(id, minutes)`, `addFocusSessionNote(id, text)`, `stopFocusSession(id, outcome, notes?)`, `listFocusSessions(params)`, `answerFriction(commitmentId, { answer, text? })`, `getCommitmentAvoidance(commitmentId)`, `getWorkSummary(weekStart?)` (E07-05's client, ready for E10).

*1. Outcome detail, work variant* — `apps/web/src/pages/OutcomeDetailPage.tsx` (E02-06; route `/path/outcomes/:id` already in `apps/web/src/App.tsx`) renders `<WorkOutcomeDetail outcome={outcome} />` when `outcome.domain === 'WORK'`, in E02-06's left column directly below `PlanSummaryCard` (keeping E02-06's `md` two-column grid — this issue adds no new breakpoint). `WorkOutcomeDetail` (`components/work/WorkOutcomeDetail.tsx`, `useWorkOutcome(outcomeId)`):
- `MilestoneList` (`components/work/MilestoneList.tsx`, props `{ milestones, sessions }`): each milestone as a `ListItem` with `LinearProgress` = completed sessions / sessions under it; empty state "No milestones yet".
- `PlannedSessionsList` (`components/work/PlannedSessionsList.tsx`, props `{ sessions, onStart(id), onReschedule(id) }`): grouped by day, status `Chip`s, "Moved ×N" chip when `rescheduleCount ≥ 1`, `Start` button (→ `/start/:commitmentId`), overflow menu with `Reschedule` (E05-04's `dialogs/RescheduleDialog.tsx`).
- CTA `Plan sessions with the coach` (`data-testid="plan-sessions-cta"`; label `Plan more sessions` when sessions exist) opening `PlanSessionsDialog` (`components/work/PlanSessionsDialog.tsx`, props `{ open, outcome, onApplied, onClose }`): step 1 form — target date (`type="date"`, defaults to `outcome.targetDate`), minutes per day `Slider` 15–120 (default 45); `Propose` → spinner (≤ 20 s, then "still thinking…"); step 2 review — milestones (editable titles), sessions as a `Table` (`≥ sm`) or stacked `Card`s (`< sm`) with editable title, date-time and duration, `minimumStart` as helper text, implementation intention as an "After … → I …" sentence with two inline `TextField`s, review cadence `Select`, rationale in muted `Typography`; `Apply` (`data-testid="plan-sessions-apply"`) → `applyOutcomeSessionPlan` with the edited proposal → `onApplied` → refetch + `Snackbar` "5 sessions added to your Path"; 400 `PROPOSAL_INVALID` renders `details[]` in an `Alert`; 409 `PROPOSAL_NOT_PENDING` re-proposes. On 503/412 the dialog shows "The coach is unavailable right now" with `Use a standard plan` (→ `planOutcomeSessionsTemplate`) and `Try again`; 412 links to `/settings/ai-key`.
- `SessionHistory` (`components/work/SessionHistory.tsx`): last 20 focus sessions for the outcome via `listFocusSessions({ outcomeId, from: −30d })` — date, planned vs actual minutes, outcome, `continuedCount`, notes count with expand.
- Stacking below `sm` comes from E02-06's grid; the dialog is `fullScreen` below `sm` via `useMediaQuery(theme.breakpoints.down('sm'))` — a local layout choice, not one of the five coupled gates.

*2. Focus session on the Start flow* — extend `apps/web/src/pages/StartFlowPage.tsx` and `hooks/useStartSession.ts` (E05-05) for `commitment.domain === 'WORK'`; the timer maths stays E05-05's `utils/commitmentTimer.ts` over `commitment.timer`:
- Query params `?minutes=<n>` (pre-selects the `TimerPicker`, custom when not a preset) and `?instruction=<text>` (rendered as the one-sentence instruction above E05-05's `StepsList`, as text).
- `Begin` calls `startFocusSession({ commitmentId, plannedMinutes, instruction })` instead of `startCommitment` (the server performs E05-02's start); 409 `FOCUS_SESSION_ACTIVE` for *this* commitment → resume it; for another commitment → an inline `Alert` "You have a focus session running on '<title>'" with `Go to it` and `Stop it and start this` (→ `takeOver: true`).
- On mount and on `visibilitychange`/`focus`, `getActiveFocusSession()`; when it matches the route's commitment the page opens the running view with the session's notes and `continuedCount` and re-anchors the timer from `session.commitment.timer` + `serverNow` (reload-safe, as E05-05 already is for the commitment alone).
- `DistractionNoteInput` (`components/work/DistractionNoteInput.tsx`, props `{ notes, onAdd(text), disabled }`, `data-testid="focus-note-input"`) replaces E05-05's in-state textarea for WORK: `Add` (Enter submits) calls `addFocusSessionNote` immediately; the list shows saved notes.
- At 00:00 E05-05's "Continue another 15?" prompt calls `extendFocusSession(id, 15)` (`data-testid="focus-continue"`) instead of `continueCommitment`; the countdown re-anchors from the response.
- `Done for now` (`data-testid="focus-done-for-now"`) opens E05-04's `CompleteDialog`; its `Complete` → `stopFocusSession(id, 'done', notes)`, `Partially done` → `stopFocusSession(id, 'partial', notes)`; a new `Stop and leave it` entry in the running view's overflow menu → `stopFocusSession(id, 'abandoned')` after a confirm.
- Completion navigates to `/` with E05-05's snackbar extended: "Recorded: N minutes on <title>" + " · continued ×N" when `continuedCount > 0`.
- The `aria-live` region and the absence of `Layout` are E05-05's; unchanged.

*3. Friction on Today* — `apps/web/src/components/today/CommitmentRow.tsx` (E05-04) reads `commitment.avoidance?.suggestedAction`: `FRICTION_QUESTION` → an inline `Alert severity="info"` "You've moved this twice. What's making it hard to start?" with `Answer` opening `FrictionDialog`; `MINIMUM` → secondary button `Do the minimum (<minutes> min)` (→ E05-02 `fallback {version:'minimum'}` then `/start/:id`); `DECOMPOSE` → secondary button `Break it down` (→ E05-04's `MakeItSmallerDialog`); `ENVIRONMENT` → helper text "Put email and Slack aside for 15 minutes before you start"; `PLAN_REVIEW` → link "This keeps slipping — review it with the coach" (→ `/coach`, E06-07). `NextBestActionCard` is unchanged — its `DIAGNOSE` mode is now fed by the level (E07-03). `FrictionDialog` (`components/work/FrictionDialog.tsx`, props `{ open, commitment: { id, title, rescheduleCount, minimumVersion }, onResolved(intervention), onClose }`, `useFriction`): title "What's making it hard to start?", subtitle "You've moved '<title>' <N> times."; a `RadioGroup` with the eight `FRICTION_ANSWERS` labels in VISION §9 order (`data-testid="friction-answer-<KEY>"`); `OTHER` reveals a required multiline `TextField` "Tell the coach more"; `Send` (`data-testid="friction-send"`) → `answerFriction` → the dialog swaps to `InterventionCard` (`components/work/InterventionCard.tsx`, props `{ intervention, commitment }`): `userMessage`, the `recommendedAction` title + minutes, buttons `Start <minutes> minutes` (→ `/start/:id?minutes=<n>&instruction=<title>`), `Use minimum version` (→ `fallback {version:'minimum'}` then `/start/:id`), for `PROTECTED_RESCHEDULE` `Move it (protected)` (→ E05-02 `reschedule` with `{ scheduledStart: suggestedReschedule.scheduledStart, scheduledEnd, protected: true }`), plus `Not now`. `source: 'template'` renders a caption "Standard suggestion — the coach is unavailable". On close, `useToday` refetches so the row drops to `DECOMPOSE`.

*Responsive & a11y*: `FrictionDialog` and `PlanSessionsDialog` are `fullScreen` on `< sm` and `maxWidth="md"` otherwise; the radio group has a `FormLabel` legend; every icon button has `aria-label`; the running view's overflow menu is keyboard reachable; focus returns to the `Answer` button on dialog close; axe (`vitest-axe`, as E02-05) passes on all three surfaces. No change to the five coupled breakpoint gates.

**Tests (testing-dev)** — under `apps/web/src/__tests__/` with MSW handlers for the twelve endpoints in `mocks/handlers.ts` (mutable in-memory session state so start → extend → stop is testable):
- `components/work/FrictionDialog.test.tsx`: renders eight options in order; `Send` disabled until an answer is chosen; `OTHER` requires text; submits `{ answer: 'TOO_BIG' }` and renders the `InterventionCard` with the `DECOMPOSITION` copy and a `Start 10 minutes` link to `/start/<id>?minutes=10&instruction=…`; `PROTECTED_RESCHEDULE` renders `Move it (protected)` and posts `protected: true`; template caption when `source: 'template'`; axe clean.
- `components/work/PlanSessionsDialog.test.tsx`: propose → review shows 5 sessions; editing a duration changes the `apply` body; 503 → `Use a standard plan` calls the template endpoint; 412 shows the AI-key link; 400 `PROPOSAL_INVALID` renders details.
- `pages/OutcomeDetailPage.test.tsx` (extend E02-06's): a `WORK` outcome renders milestones with progress and grouped sessions; a `FAMILY` outcome renders no work section.
- `pages/StartFlowPage.test.tsx` (extend E05-05's): `WORK` commitment → `POST /focus-sessions` on Begin with `?minutes=10&instruction=` honoured; an existing active session resumes with its notes (fake timers); `Add` note posts immediately; at 00:00 `Continue` posts `extend` with 15; `Partially done` posts `stop` with `partial` and the snackbar shows "continued ×1"; 409 for another commitment shows the take-over alert; a FAMILY commitment still uses E05-05's `startCommitment`.
- `components/today/CommitmentRow.test.tsx` (extend E05-04's): each `suggestedAction` renders its affordance; `FRICTION_QUESTION` opens the dialog; after `onResolved` the row refetches; `avoidance: null` renders nothing extra.
- `hooks/useFocusSession.test.ts`: re-anchors from `serverNow`, not `Date.now()` drift; `visibilitychange` triggers a refetch.

**Docs (docs-dev)** — `docs/specs/work-domain.md` UI section is written by E07-06; this issue updates `docs/specs/today-and-nba.md` (E05-07) with the WORK branch of the Start flow, and `CLAUDE.md` only if a new route was added (none — all three surfaces are existing routes).

#### Acceptance criteria
- [ ] `/path/outcomes/:id` for a `WORK` outcome shows milestones with progress, planned sessions grouped by day with status chips and "Moved ×N", session history, and the `Plan sessions with the coach` CTA; a `FAMILY`/`HEALTH` outcome is unchanged
- [ ] The plan dialog proposes, allows editing titles/times/durations/intention, applies, and the sessions appear in the list and on Today without a reload
- [ ] With the AI down the dialog offers `Use a standard plan` and applying it works; with no key it links to `/settings/ai-key`
- [ ] On `/start/:commitmentId` for a `WORK` commitment, `Begin` creates a server focus session; reloading the page resumes the countdown and the saved distraction notes
- [ ] A distraction note is persisted the moment it is added; at 00:00 the "Continue another 15?" prompt extends the focus session
- [ ] `Partially done` stops the session as `partial`, records evidence, and the snackbar shows the focused minutes
- [ ] A Today row with `suggestedAction: 'FRICTION_QUESTION'` shows the VISION §9 question; the dialog lists the eight answers in order; answering `It feels too big` shows a decomposition suggestion with `Start 10 minutes`
- [ ] `Start 10 minutes` from the intervention opens the Start flow pre-set to 10 minutes with the recommended action as the instruction
- [ ] All three surfaces are usable at 360px wide (dialogs full-screen, single column) and at 1280px (E02-06's two-column detail, modal dialogs)
- [ ] axe reports no violations on the outcome detail, the Start flow with a session running, and the open friction dialog

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 409 `FOCUS_SESSION_ACTIVE` resumes or offers take-over instead of erroring; network failures during the countdown keep the local timer running and retry `getActiveFocusSession` on focus/visibility change; every API error renders an `Alert`, never a blank screen
- [ ] Observability: none (client)
- [ ] Security: no tokens in URLs; `?instruction=` is rendered as text, never HTML, and capped at 240 chars client-side
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
- Do not fork `StartFlowPage`: branch on `commitment.domain` inside `useStartSession` so FAMILY/HEALTH keep E05-05's calls untouched; the timer derivation (`commitmentTimer.ts`) is shared.
- Hook pattern: `apps/web/src/hooks/useEmailSettings.ts` (loading/error/save state); MSW handlers pattern: `apps/web/src/__tests__/mocks/handlers.ts` with `API_BASE = '*/api'`; Today fixtures in `__tests__/mocks/today.data.ts` (E05-04).
- Pitfall: RTL/Playwright and the MUI `Slider` — use keyboard on the thumb (see E04-06 notes); MUI `Dialog` `fullScreen` must be driven by `useMediaQuery(theme.breakpoints.down('sm'))`, not `md`.
- Pitfall: the five coupled breakpoint gates (CLAUDE.md rule 5) are untouched — the local `down('sm')` calls here are layout choices inside components, and the PR must say so.
- The eight answer labels are copied from the API's `FRICTION_ANSWERS` order into `components/work/frictionAnswers.ts` with a comment pointing at `apps/api/src/work/avoidance/friction-answers.ts`; a Vitest asserts the eight keys match the `FrictionAnswer` union.

---

### E07-05 `feat(api): add work weekly summary aggregation`

**Part of epic:** E07 · **Blocked by:** E07-02, E07-03 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §29 requires the work weekly review to show planned focus sessions, completed starts, completed meaningful outcomes, repeatedly postponed commitments and successful time windows, with an AI sentence like "You completed 4 of 5 focus sessions scheduled before 9 AM and only 1 of 4 after 4 PM." E10's Weekly Review Reasoner (PRD §14.6) needs those numbers as deterministic input, and VISION §8 asks Work to answer "What pattern is EvolvePath noticing about how I work?". No aggregation exists; the raw rows are spread over `commitments`, `focus_sessions` and `evidence_items`.

#### Proposed solution
A pure aggregator plus a thin service and endpoint under `apps/api/src/work/summary/` (new): `work-summary.aggregator.ts` (pure), `work-summary.service.ts` (loads rows, calls the aggregator), `work-summary.controller.ts`, `dto/work-summary-response.dto.ts`, `dto/work-summary-query.dto.ts`.

**Data (database-dev)** — n/a (reads `commitments`, `focus_sessions`, `evidence_items`, `outcomes`, `user_profiles.timezone`).

**API (backend-dev)** — OpenAPI tag `Work`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/work/summary?weekStart=YYYY-MM-DD` | `@Auth()` | `weekStart` optional; must be a Monday in the user's timezone (400 `WEEK_START_NOT_MONDAY`); default = the Monday of the current local week | 200 `WorkWeeklySummary` |

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

`aggregateWorkWeek(input: { weekStart: Date, timezone, commitments: CommitmentRow[], focusSessions: FocusSessionRow[], evidence: EvidenceRow[], outcomes: OutcomeRow[], assessments: Map<commitmentId, AvoidanceAssessment> }): WorkWeeklySummary` — pure, exported, no Prisma types (define narrow row interfaces in the file). Rules: a commitment is *due* in the week when its `scheduledStart` falls in `[weekStart 00:00, +7 days)` local (`localDayBounds` from E05-01); `focusSessions.planned` = due `WORK` commitments with `commitmentType === 'FOCUS_SESSION'`, `started` = those with ≥ 1 `FocusSession`, `done/partial/abandoned` by the latest session's `outcome`, `plannedMinutes` = sum of their planned durations, `actualMinutes` = sum of `FocusSession.actualMinutes`; `starts.started` = due `WORK` commitments with `startedAt` set or any `APP_FLOW started`/`TIMER` evidence, `completed` = status `COMPLETED`; `timeWindows` bucket due `WORK` commitments by `timeWindowOf(scheduledStart, timezone)` (E07-03's `time-window.ts`), `successRate = completed / planned`; `outcomesCompleted` = `WORK` outcomes whose `state` became `COMPLETED` inside the week (E02-01's `state`/`updatedAt` — use `completedAt` if E02-02 added one); `repeatedlyPostponed` = `WORK` commitments due in the week or rescheduled out of it with `rescheduleCount ≥ 2`, `level` from the assessment map; `distractionNoteCount` = sum of `distractionNotes.length` over sessions started in the week.

`WorkSummaryService.getWeek(userId, weekStart?)`: resolve the timezone (`user_profiles.timezone`, E04-01, default `UTC`); validate Monday; load rows with four queries (commitments in a ±7-day window around the week to catch reschedules, their focus sessions, their evidence, `WORK` outcomes); `AvoidanceService.assessMany` (E07-03) for the postponed ones; return `aggregateWorkWeek(...)`. Cache nothing. Log `Work summary user=<id> week=<date> due=<n>`. Export the service from `WorkModule` for E10-02.

**UI (frontend-dev)** — n/a in this epic (E10-04 renders it); `services/api.ts` `getWorkSummary(weekStart?)` and the `WorkWeeklySummary` type are added by E07-04 so the client is ready.

**Tests (testing-dev)**
- `work-summary.aggregator.spec.ts` — fixtures built by a small `makeWeek()` helper: empty input → zeros, rates `null`, windows `null`; 5 planned sessions, 4 with sessions (2 done, 1 partial, 1 abandoned) → counts and minutes; a commitment rescheduled out of the week with `rescheduleCount: 2` still appears in `repeatedlyPostponed` with its `level`; morning 4/5 vs evening 1/4 → `bestWindow: 'morning'`, `worstWindow: 'evening'`; a window with `planned: 1` never wins; timezone: a 23:30 UTC start on Sunday counts as Monday morning in `Asia/Tokyo` and Sunday evening in `America/Costa_Rica`; `weekStart` boundary inclusive/exclusive; `startRate` counts a started-but-not-completed commitment as started; determinism (deep-equal across two calls).
- `work-summary.service.spec.ts` (prisma mocked) — default `weekStart` is the current Monday in the user's timezone; Tuesday → 400; issues a constant number of queries; passes assessments through; missing profile → `UTC`.
- `apps/api/test/work-summary.integration.spec.ts` (new) — 401; 200 shape for a mocked user; another user's rows never appear (the mock returns rows for two users, output counts only the caller's).

**Docs (docs-dev)** — `docs/API.md` (`GET /work/summary`, the response interface, the window definitions); `CLAUDE.md` "API Endpoints"; the aggregation rules go into `docs/specs/work-domain.md` (E07-06).

#### Acceptance criteria
- [ ] `GET /api/work/summary` with no query returns the current week (Monday–Sunday in the user's timezone) and `weekStart`/`weekEnd` echo it
- [ ] `?weekStart=<a Tuesday>` returns 400 `WEEK_START_NOT_MONDAY`; an unparsable value returns 400 `INVALID_WEEK_START`
- [ ] `focusSessions` counts planned/started/done/partial/abandoned sessions and sums planned vs actual minutes for the week
- [ ] `starts.started` counts commitments with start evidence even when they were never completed (start ≠ completion, PRD §104)
- [ ] `repeatedlyPostponed` lists every `WORK` commitment with `rescheduleCount ≥ 2` touching the week, with its ladder `level`
- [ ] `timeWindows` bucket by the same morning/afternoon/evening boundaries as E07-03 and `bestWindow` requires ≥ 2 planned
- [ ] `aggregateWorkWeek` is pure and fully covered by the fixture cases above
- [ ] Only the caller's rows contribute

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: invalid `weekStart` → 400 with a stable `code`; a missing profile falls back to `UTC` without failing
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
- Keep the aggregator free of Prisma types and `Date.now()`; the service passes `weekStart` and `timezone` in. Use E05-01's `local-date.ts` helpers and `Intl.DateTimeFormat` parts; add no date library.
- Import `timeWindowOf` from `apps/api/src/work/avoidance/time-window.ts` — do not duplicate the boundaries.
- Rates are `null` (not `0`) when the denominator is 0 so E10's reasoner can tell "nothing planned" from "nothing done".

---

### E07-06 `test(tests): E07 end-to-end verification`

**Part of epic:** E07 · **Blocked by:** E07-01, E07-02, E07-03, E07-04, E07-05, E01-10, E05-07 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → backend-dev → docs-dev

#### Problem statement
Every epic must be provable end to end (DB + API + UI) against the fake OpenAI server (E01-10). PRD §104's acceptance list — create work outcome, AI breaks it into sessions, start a focus action, reschedule, repeated reschedules trigger the friction intervention, start recorded separately from completion — needs one Playwright run through the real API and database, plus the spec document E10 (weekly review) and E12 (N2/N3 notifications) will read.

#### Proposed solution
**Fake server fixtures.** `tools/fake-openai/server.mjs` (E01-10) gains: (a) a canned `work_session_plan` response (selected by `body.text.format.name === 'work_session_plan'`): 3 milestones, 5 sessions on the next 5 weekdays at 09:00 in the request input's `timezone`, 25/45/30/30/15 minutes, each with a `minimumStart`, an `implementationIntention`, `reviewCadence: 'WEEKLY'` — dates computed at request time so the guardrails always hold; (b) for `coach_reply` requests with `body.metadata.promptVersion === 'work-friction.v1'` (E01-06 sends `metadata { invocationId, persona, promptVersion }`), a reply echoing the input's `requiredInterventionType` as `intervention_type`, a `recommended_action` of 10 minutes ("Write only the storyline: decision, recommendation, three arguments", `commitmentId` = the input's commitment id), `proposal`/`friction_question` null — E06-09's existing `coach_reply` fixtures stay untouched for other prompt versions; (c) `x-fake-behaviour: wrong_intervention` forces `intervention_type: 'GOAL_CHALLENGE'` to exercise the server-side override.

**Spec** `tests/e2e/specs/work.spec.ts` (new), `loginAsTestUser(page, { email: 'work-<runId>@test.local', withAiKey: true, withOnboarding: true })` (E01-10 / E04-06 switches), API calls through E05-07's `tests/e2e/helpers/commitments.helper.ts` (`apiContext`, `createOutcome`, `getCommitment`, `todayAt`):
1. `plans sessions for a work outcome with the coach and applies them` — `createOutcome(ctx, { domain: 'WORK', title: 'Finish strategy presentation', … })` → `/path/outcomes/<id>` shows `plan-sessions-cta` → propose → 5 sessions and 3 milestones rendered → edit the first duration to 20 → `plan-sessions-apply` → sessions listed under milestones; API `GET /api/outcomes/<id>/work-plan` → 5 sessions, first `durationMinutes === 20`, `implementationIntention` present; `GET /api/commitments?from&to` (E02-04) → 5 `PLANNED` `WORK` rows with `milestoneId`; `GET /api/plans/<planId>/versions` count unchanged.
2. `two reschedules surface the friction prompt on Today` — `POST /api/commitments/<first>/actions/reschedule { scheduledStart: todayAt(…) }` twice → `/` → the row shows "You've moved this twice. What's making it hard to start?"; API `GET /api/today` → that card's `avoidance.level === 3`, `suggestedAction === 'FRICTION_QUESTION'`, `nextBestAction.interventionMode === 'DIAGNOSE'`; a second session rescheduled once shows no prompt and `avoidance.level === 0`.
3. `answering "It feels too big" offers decomposition and a 10-minute start records TIMER evidence` — `Answer` → `friction-answer-TOO_BIG` → `friction-send` → the intervention card shows a decomposition message and `Start 10 minutes` → click → `/start/<id>?minutes=10&instruction=…` → `Begin 10:00` → add a distraction note "Checked Slack" → `page.reload()` → the timer is still running with ≤ 10:00 remaining and the note is listed → `Done for now` → `Partially done` → snackbar "Recorded: 1 minutes" (or `≥ 1`); API: `GET /api/focus-sessions?commitmentId=` → one session, `outcome: 'PARTIAL'`, `distractionNotes: ['Checked Slack']`; `GET /api/evidence?from&to&commitmentId=` → an `APP_FLOW` `started` row and a `TIMER` `focus_session` row with `quantitativeValue ≥ 1`; `getCommitment` → `PARTIALLY_COMPLETED`; `GET /api/commitments/<id>/avoidance` → `level 3`, `suggestedAction 'DECOMPOSE'` (asked once).
4. `continue extends the running session` — `POST /api/focus-sessions { commitmentId: <second>, plannedMinutes: 1 }`, open `/start/<id>`, wait for "Continue another 15?" (`page.clock` or ≤ 70 s) → `focus-continue` → API `continuedCount === 1`, `plannedMinutes === 16`, `commitment.timer.timerMinutes === 16` → `Done for now` → `Complete` → `getCommitment` → `COMPLETED`.
5. `works without AI` — `page.route('**/v1/responses', route => route.fulfill({ status: 503 }))` → new outcome → plan dialog shows `Use a standard plan` → apply → 5 sessions; reschedule twice → answer `I'm tired` → the template intervention names the minimum version and the caption "Standard suggestion"; API `source === 'template'`.
6. `server override on a wrong intervention type` — set `x-fake-behaviour: wrong_intervention` through the E01-10 mechanism → answer `I'm worried I won't do it well` → response `interventionType === 'PERFECTIONISM_REFRAME'` with `source === 'template'`.
7. `protected reschedule keeps the count` — answer `Something more urgent came up` → `Move it (protected)` → `getCommitment` → `rescheduleCount` unchanged, `status 'RESCHEDULED'`.
8. `weekly summary reflects the week` — `GET /api/work/summary` → `focusSessions.planned === 10` (both outcomes), `focusSessions.partial ≥ 1`, `focusSessions.done ≥ 1`, `starts.started ≥ 2`, `repeatedlyPostponed.length ≥ 2`, `distractionNoteCount ≥ 1`.

Cleanup: unique email per test; no teardown (disposable test DB), as `ai-key-gate.spec.ts`. The spec asserts `/api/health/ready` and the fake `/v1/models` first and fails loudly (no `test.skip`) if either is unreachable.

**Data (database-dev)** — n/a.

**API (backend-dev)** — fake server fixtures only (`tools/fake-openai/server.mjs`); no production surface changes.

**UI (frontend-dev)** — n/a (the `data-testid`s are E07-04's).

**Tests (testing-dev)** — the eight Playwright cases above; `tools/fake-openai/server.spec.mjs` (if E01-10 added one) covers the two new fixtures and the `wrong_intervention` behaviour; `apps/web/src/__tests__/components/work/*.test.tsx` assert the `data-testid`s exist.

**Docs (docs-dev)** — `docs/specs/work-domain.md` (new): purpose + PRD §22–§29/§104 and VISION §8–§10 refs; the session-plan Zod contract, guardrails, template and the apply transaction (plan+v1 when missing → milestones → routine on the active version → commitments); the `FocusSession` lifecycle as a layer over E05-02's timer and why the record is server-side; the avoidance signals, thresholds and the level rule verbatim from `avoidance-detector.ts`, the answer → intervention → obstacle table, the `suggestedAction` mapping, the "asked once" rule and how the level feeds E05-01's `interventionMode`; the protected reschedule; the weekly summary definitions (due, windows, rates); decisions and rejected alternatives (a persisted `avoidanceLevel` column — rejected because signals change daily and a stale column would contradict `GET /today`; a partial unique index for one active session — rejected so a crashed client can always recover; a new `PlanVersion` per session plan — rejected, sessions are commitments not strategy and E06-04 owns versions; riding on `plan_change_proposals` — rejected, its `changes` column is typed `PlanChange[]`; `TOO_BIG` → `DECOMPOSITION` over the plan's original ordering, per VISION §9's example); testing notes (fake fixtures, `x-fake-behaviour: wrong_intervention`). `docs/API.md` (Work section complete, cross-link to the spec); `docs/TESTING.md` ("E2E Testing with Playwright": how to run `work.spec.ts`, the clock trick for case 4); `docs/epics/README.md` back-link row for E07 → `docs/specs/work-domain.md`; `CLAUDE.md` endpoint/table lists if E07-01..05 did not already.

#### Acceptance criteria
- [ ] `tests/e2e/specs/work.spec.ts` passes against `base + dev + fake-openai` compose with a migrated, seeded database
- [ ] Every pre-existing e2e spec (`auth`, `ai-key-gate`, `admin-ai-settings`, `onboarding`, `today`, `coach`, and E02/E03's) passes unchanged
- [ ] Case 1 proves the AI proposal creates zero commitments until `Apply` and exactly 5 after, with the edited duration persisted and no new plan version
- [ ] Case 2 proves two reschedules (and not one) produce `level 3`, the friction prompt and `DIAGNOSE`
- [ ] Case 3 proves `TOO_BIG` → decomposition, a reload-safe session with persisted notes, and a `TIMER` evidence row distinct from the `APP_FLOW` start row, with the ladder level visible afterwards
- [ ] Case 5 completes planning and friction with the AI down; case 6 proves the intervention-type override; case 7 proves the protected reschedule
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
2. `cd tests/e2e && npx playwright test specs/work.spec.ts --reporter=list` → 8 passed.
3. `npx playwright test` → the full suite passes.
4. Run the epic script steps 3–13 by hand once and compare the DB checks with what the spec asserted.

#### Out of scope
- CI workflow (declined for this roadmap; local runs only)
- Visual baselines for the work surfaces
- Load testing of the planner/coach calls

#### Notes for the implementing agent
- Follow `tests/e2e/specs/today.spec.ts` (E05-07) for the commitments helper and API-seeded data, `onboarding.spec.ts` (E04-06) and `ai-key-gate.spec.ts` (E01-10) for the fake-server setup and the `withAiKey`/`withOnboarding` plumbing.
- The fake server must keep returning `gpt-5.4` in `/v1/models` and keep every earlier canned response; add the two work fixtures without changing existing behaviours. Select the friction fixture by `body.metadata.promptVersion` — verify in `apps/api/src/ai/providers/openai/openai.provider.ts` that `metadata` is actually sent; if E01-06 dropped it, fall back to scanning the serialized `input` for `requiredInterventionType`.
- Pitfall: Playwright and MUI `Slider`/`RadioGroup` — use keyboard on the thumb; click the radio's label, not the hidden input.
- Pitfall: case 4's real 60-second wait is acceptable but slow; prefer `page.clock.install()` + `page.clock.runFor(61_000)` (Playwright ≥ 1.45) and trigger `visibilitychange` so the hook re-anchors.
- Write `docs/specs/work-domain.md` in the voice of `docs/specs/vps-deploy.md` (decisions and rejected alternatives, not a tutorial); the ladder rule must be copied from the detector file header, not paraphrased.

---
