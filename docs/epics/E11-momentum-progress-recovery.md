# E11 — Momentum, Progress & Recovery

<!-- epic-meta: slug=momentum-progress-recovery phase=4 -->
<!-- epic-issue: #94 -->

> GitHub epic: [#94](https://github.com/marinoscar/evolvepath/issues/94)

## Epic

### Goal

Turn the evidence the earlier epics record into something the user can read without being graded: per-domain **momentum states** computed by a deterministic, unit-tested engine (PRD §52–§54, VISION §30), a **consistency run** counted in weeks with grace (PRD §55), a **recovery** measure and an **evidence timeline** (PRD §75–§76), and a **comeback loop** that treats returning after inactivity as a first-class product state (PRD §56–§57, §109, VISION §32–§33). After E11 a user who disappears for four days is not met by a red overdue list; stale commitments are closed as historical evidence, one small restart action is offered, and completing it records "Back on Path". Nowhere in this epic is there a number that scores the person (PRD P13, §54 "Avoid: Health Score: 77/100").

### Background

- **Domain state** comes from E02-01 (#36): `Commitment` (status `PLANNED, READY, STARTED, COMPLETED, PARTIALLY_COMPLETED, RESCHEDULED, SKIPPED, MISSED, CANCELLED`, `rescheduleCount`, `scheduledStart`/`scheduledEnd`, `importance`, `routineId`, `planVersionId`, `outcomeId`), `Evidence` (table `evidence_items`, `evidenceType` free label, `source USER_LOG | TIMER | WORKOUT_LOG | APP_FLOW`, `occurredAt`, `commitmentId` `SetNull` so evidence outlives its commitment), `Routine` (`estimatedDurationMin`, `minimumDurationMin`, `fallbackBehavior`, `preferredTime`, `active`), `PlanVersion` (`status ACTIVE`, `rationale`), `Outcome` (`importance`, `state`), `DomainMode` (`GROW | MAINTAIN | RECOVER | PAUSE`). The transition matrix is `apps/api/src/commitments/commitment-transitions.ts` (`canTransition`, `TERMINAL_STATUSES`); `PLANNED → MISSED` and `READY → MISSED` are allowed, `STARTED → MISSED` is not, and `RESCHEDULED` is terminal (a reschedule opens a new row that carries `rescheduleCount`, E02-04 (#47) — the semantics E05 is reconciled to).
- **Execution fields and evidence labels** come from E05-02 (#40): `Commitment.startedAt`, `completedAt`, `versionUsed FULL | SHORT | MINIMUM`, `minutesSpent`; evidence rows `started` / `paused` / `continued` / `completed` / `partially_completed` / `fallback_selected` / `rescheduled` with the completion row tagging `fallbackUsed` in its `qualitativeValue`. `CommitmentActionsService` (`apps/api/src/commitments/actions/commitment-actions.service.ts`) is the only writer of those rows; `CommitmentCard` is the shared card shape (`apps/api/src/commitments/commitment-card.mapper.ts`).
- **Today** (E05-01 (#38)) returns `momentum: z.null()` in `todayResponseSchema` (`apps/api/src/today/today.schema.ts`) with the comment "E11 replaces with its schema"; its candidate loader already excludes past days ("no catch-up debt, VISION §33; E11 closes them"); `apps/api/src/today/local-date.ts` provides `localDate`, `localDayBounds` and the timezone rule (`user_profiles.timezone ?? 'UTC'`). E05-04 (#46)'s `TodayPage` renders nothing for a null momentum and E05-05 (#48)'s `/start/:commitmentId` is the full-screen execution route the comeback flow reuses.
- **Profile** (E04-01 (#100)): `user_profiles` (`timezone`, `coachingStyle`, `weekdayMinutes`, `quietHoursStart/End`), owned by `UserProfileService` (`apps/api/src/user-profile/user-profile.service.ts`, `getOrCreate`, `update`). This epic adds its comeback columns there rather than in a new table.
- **Memory & proposals** (E06): confirmed `MemoryInsight` rows (`userConfirmed && !doNotUse`) are the "Insights" section of Progress; `plan:change_accepted` audit rows (E06-04 (#76), meta `{proposalId, planId, fromVersion, toVersion}`) are the "plan changes accepted" timeline events. E06-05 (#78)'s `aggregateStats` note says "E11 replaces `aggregateStats` with the momentum engine's analytics" — E11-01 (#98) exports the engine's signals so E06-05 (#78) can switch to them; it does not rewrite E06-05 (#78).
- **AI**: only the `coach` persona is used, only for optional wording of the restart action, through `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` (E01-06 (#26)), which returns `{ok:true, output}` or `{ok:false, error}` and never throws. Every state in this epic is computed without AI (PRD §53 "deterministic and testable", §120).
- **Scheduling**: `ScheduleModule.forRoot()` is registered in `apps/api/src/app.module.ts`; the pattern to copy is `apps/api/src/auth/tasks/token-cleanup.task.ts` (`@Cron(CronExpression.EVERY_DAY_AT_3AM)`, a `Logger`, one service call per step).
- **Test auth**: `apps/api/src/test-auth/test-auth.controller.ts` is `@Controller('auth/test')` behind `TestEnvironmentGuard` (module registered only when `NODE_ENV !== 'production'`); E01-10 (#30) added `withAiKey`, E04-05 (#106) added `withOnboarding`. E11-02 (#112) adds the two non-production helpers e2e needs (`simulate-idle`, `jobs/run`).
- **Charts**: `apps/web/package.json` has no chart library (`@mui/material` ^9.1, `@mui/x-data-grid` ^9.10). E11-04 (#117) adds `@mui/x-charts` (the MUI X package on the same major as the data grid; peer `@mui/material` 9) — chosen over a second charting stack because it shares the theme, palette and a11y conventions already in the bundle.
- **Shell**: `/progress` is already a destination (`apps/web/src/config/destinations.ts` `DESTINATIONS.progress`, E02-05 (#51)) with a placeholder `apps/web/src/pages/ProgressPage.tsx`; full-screen routes outside `Layout` follow `/activate` and `/start/:commitmentId` and are listed in `UNOWNED_ROUTES`; the five coupled breakpoint gates (CLAUDE.md, Settings UI rule 5) are not touched.
- Specs this epic reads: `docs/specs/domain-model.md` (E02-08 (#62)), `docs/specs/today-and-nba.md` (E05-07 (#55)), `docs/specs/coach-and-memory.md` (E06-09 (#93)). Spec it writes: `docs/specs/momentum-and-recovery.md` (E11-06 (#121)).

### Scope

- [ ] #98 feat(api): add deterministic momentum engine and GET /progress (E11-01)
- [ ] #112 feat(api): add comeback loop with inactivity sweep and no catch-up debt (E11-02)
- [ ] #115 feat(api): add evidence timeline and milestone detection (E11-03)
- [ ] #117 feat(web): add Progress screen with momentum, timeline and consistency charts (E11-04)
- [ ] #119 feat(web): add comeback flow screens and Today welcome-back banner (E11-05)
- [ ] #121 test(tests): E11 end-to-end verification (E11-06)

### Out of scope

- Coaching notifications of any kind — N6 Recovery, N7 Evidence celebration, the independence metric's data source (`NotificationInteraction`) and "reduced reminders" detection live in E12; E11 exposes `independence.ratio: null` and a `REDUCED_REMINDERS` milestone kind that no detector awards until E12-06 (#69) lands.
- Weekly Review content and the weekly planning wizard (E10). E11's consistency run is a per-week aggregate over commitments; it does not read `weekly_reviews`.
- Workout-specific counting rules (E09). `TEN_WORKOUTS` counts HEALTH completions with `commitmentType = 'workout'` **or** `WORKOUT_LOG` evidence; E09 decides which it writes.
- Any AI-authored plan mutation. "Plan review suggested" is a flag and a link to the coach (E06) / Path; the comeback loop never creates a `PlanVersion`.
- Daily streaks (PRD §55 allows them "only when daily repetition truly serves the behaviour" — not in V1), social/accountability (PRD §78), search over history (PRD §79), home-screen widgets (PRD §124).
- Deleting or rewriting historical evidence. The sweep changes commitment **status** only; `evidence_items` rows are never touched.

### Sequencing

- **E11-01 (#98)** first: `ProgressModule`, the engine, `GET /progress`, and the `momentum` slot on `GET /today`. Nothing else in the epic compiles without `ProgressModule`.
- **E11-02 (#112)** (comeback) depends on E11-01 (#98) for the module and for `local-date` reuse only; it can start once E11-01 (#98)'s module skeleton is merged. It owns the `user_profiles` columns and the test-auth helpers.
- **E11-03 (#115)** (timeline + milestones) depends on E11-02 (#112) (the `FIRST_COMEBACK` milestone hooks into `ComebackService.complete`, and the sweep runs the daily milestone pass).
- **E11-04 (#117)** (Progress screen) depends on E11-01 (#98) and E11-03 (#115) (timeline + milestones endpoints). **E11-05 (#119)** (comeback screens) depends on E11-02 (#112) and E05-05 (#48) (`/start/:commitmentId`). The two web children can run in parallel.
- **E11-06 (#121)** last. Critical path: E11-01 (#98) → E11-02 (#112) → E11-03 (#115) → E11-04 (#117) → E11-06 (#121).

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`, and `POSTGRES_HOST`/`POSTGRES_PORT` to a reachable PostgreSQL.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed`. The applied list ends with `add_comeback_state`, `add_progress_milestones`.
3. Open http://localhost:3535/testing/login, sign in as `momentum@test.local` (role `contributor`, tick "Seed an OpenAI key" and leave "Mark onboarding complete" ticked). Mint a PAT at `/settings/tokens`, `export TOKEN=…`.
4. Seed two domains through the API (all calls `curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'`):
   - `POST /api/outcomes {"domain":"HEALTH","title":"Three workouts a week","importance":5}` → `HID`; `POST /api/outcomes/$HID/plans {"rationale":"Mornings","routines":[{"title":"Strength workout","triggerType":"TIME","triggerValue":"07:00","frequency":"CUSTOM","daysOfWeek":[1,3,5],"preferredTime":"07:00","estimatedDurationMin":40,"minimumDurationMin":12,"fallbackBehavior":"12-minute bodyweight circuit"}]}` → note the ACTIVE version id `HVID` and routine id `HRID`.
   - `POST /api/outcomes {"domain":"WORK","title":"Ship the proposal","importance":4}` → `WID`; a plan with routine "Morning focus block" (`estimatedDurationMin` 50, `minimumDurationMin` 10).
   - Six HEALTH commitments on the past six Mon/Wed/Fri 07:00 (`routineId: HRID`, `planVersionId: HVID`, `minimumVersion: "12-minute circuit"`) and six WORK commitments on the past six weekdays 09:00.
5. Drive outcomes: complete 5 of the 6 HEALTH rows (`POST /api/commitments/<id>/actions/complete {"notes":"done"}`), one of them after `POST …/actions/fallback {"version":"minimum"}`; leave the oldest HEALTH row untouched. For WORK: complete the 3 oldest, skip the 3 newest (`…/actions/skip {"reason":"AVOIDED"}`).
6. `curl … /api/progress | jq '.data.momentum'` → `HEALTH.state` is `STEADY` or `IMPROVING` with evidence bullets such as `"5 of 6 planned workouts completed"` and `"1 completed with the minimum version"`; `WORK.state` is `SLIPPING` with `"3 in a row not started"`; `FAMILY.state` is `INSUFFICIENT_DATA`. `jq '.data.consistencyRun'` → `{weeks: 1 or 2, graceUsed: 0, weekly: [...]}`; `jq '.data.independence.ratio'` → `null`.
7. `curl … /api/today | jq '.data.momentum'` → `{WORK:{state:"SLIPPING",…}, FAMILY:{state:"INSUFFICIENT_DATA",…}, HEALTH:{…}}` (no longer `null`).
8. http://localhost:3535/progress — observe the sections in PRD §75 order: **Your evolution**, three **Momentum** cards (state word + arrow icon + bullets + a 4-week trend line), **Evidence** (timeline with "Completed Strength workout", the fallback completion marked "minimum version", "Started … after two postponements" if you rescheduled one twice), **Consistency** (weekly bars, planned vs completed), **Recovery** ("No misses yet" or "Returned in N days"), **Coach dependency** ("Available once notifications learn your rhythm"), **Insights** (empty state linking to `/settings/ai-memory`). Search the page text for `/100` and the word "score": neither appears. Resize below 600px: single column, BottomNav visible, charts fill the width.
9. Simulate a lapse: `curl -X POST … /api/auth/test/simulate-idle -d '{"email":"momentum@test.local","idleDays":4}'` (non-production only: shifts `lastActiveAt` and the user's commitment/evidence timestamps back four days; also create one PLANNED HEALTH commitment dated two days ago). `curl -X POST … /api/auth/test/jobs/run -d '{"job":"comeback","email":"momentum@test.local"}'` → `{"closedCount":1,"trigger":"INACTIVITY","comebackState":"OFFERED"}`.
10. http://localhost:3535/ — the **Welcome back. No catching up.** banner is shown above the next-best-action; the domain cards list only today's items; `curl … "/api/commitments?from=<30 days ago>&to=<start of today>&status=PLANNED,READY" | jq '.data|length'` → `0`. `psql … -c "SELECT status FROM commitments WHERE scheduled_start < now()::date ORDER BY scheduled_start DESC LIMIT 1;"` → `MISSED`; `SELECT count(*) FROM evidence_items;` is unchanged from step 8.
11. Tap **Restart with one thing** → `/comeback`. Screen 1 "You're still on the Path." → Continue → Screen 2 shows Health recommended ("You kept 5 of 6 workouts before the pause") with Work and Family as alternatives → **Take the recommendation** → Screen 3 shows "12-minute bodyweight circuit · 12 min" → **Start** → `/start/<id>` with the timer at 12:00 → **Done for now** → **Complete** → `/comeback/done` shows **Back on Path.** and "The important part was not that you missed. It was that you returned." plus the next planned commitment (or "Nothing planned yet — review your plan").
12. DB checks: `SELECT comeback_state, last_active_at, plan_review_suggested_at FROM user_profiles;` → `NONE`, just now, `NULL` (fewer than 4 misses); `SELECT evidence_type, source FROM evidence_items ORDER BY occurred_at DESC LIMIT 1;` → `recovery`, `APP_FLOW`; `SELECT kind FROM milestones;` → `FIRST_COMEBACK`; `SELECT action FROM audit_events WHERE action LIKE 'comeback:%' ORDER BY created_at;` → `comeback:sweep`, `comeback:offer`, `comeback:complete`.
13. http://localhost:3535/progress — a toast "First comeback — you returned." appears once (reload: gone); the timeline shows "Back on Path" and a milestone entry at the top.
14. Stop the fake provider (`docker compose stop fake-openai`), repeat steps 9–11 with a fresh user: the restart action's title is the routine's fallback text (template wording), everything else identical.
15. `cd tests/e2e && npx playwright test progress.spec.ts comeback.spec.ts` passes against the same stack.

## Child issues

### E11-01 `feat(api): add deterministic momentum engine and GET /progress` — #98

**Part of epic:** E11 · **Blocked by:** E05-02 (#40), E06-05 (#78) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §52 replaces a single "quality of life" score with per-domain momentum states (`BUILDING, IMPROVING, STEADY, SLIPPING, RECOVERING, INSUFFICIENT_DATA`); §53 lists the inputs and requires "the exact formula should remain deterministic and testable"; §54 fixes the presentation — a state word plus evidence sentences ("5 of 6 planned workouts completed. Returned one day after a miss."), never "77/100"; §55 asks for a consistency run counted in **weeks** with grace, a recovery measure ("Returned in 1 day") and milestones; §75 lists the Progress sections including "Coach dependency: percent completed without reminder". VISION §30–§31: momentum evaluates behaviour, tolerates normal life, and "one missed day should not erase weeks of effort". Today `GET /today` ships `momentum: null` (E05-01 (#38)) and nothing aggregates evidence.

#### Proposed solution

A new `apps/api/src/progress/` module whose core is a pure function over a 28-day per-domain window, plus pure helpers for the consistency run and recovery latency, a loader that builds the windows from Prisma, `GET /progress`, and the `momentum` slot of `GET /today` filled from the same service.

**Data (database-dev)** — n/a (reads `commitments`, `evidence_items`, `routines`, `outcomes`, `domain_modes`, `user_profiles`, `memory_insights`). No migration.

**API (backend-dev)**

Files (all new unless marked):

- `apps/api/src/progress/progress.module.ts` — `imports: [PrismaModule, UserProfileModule]`; providers below; `exports: [MomentumService, ProgressService]`. Register in `app.module.ts` after `TodayModule`. `TodayModule` (E05-01 (#38), existing) adds `ProgressModule` to its imports.
- `apps/api/src/progress/progress.controller.ts` — `@ApiTags('Progress')`, `@Controller('progress')`, `@Auth()`.
- `apps/api/src/progress/progress.service.ts` — `getProgress(userId, now = new Date()): Promise<ProgressResponse>`.
- `apps/api/src/progress/progress.schema.ts` — Zod schemas below; `dto/progress-response.dto.ts` — `createZodDto(progressResponseSchema)`.
- `apps/api/src/progress/momentum/momentum-engine.ts` — `computeMomentum` (pure).
- `apps/api/src/progress/momentum/momentum-evidence.ts` — bullet templates (pure).
- `apps/api/src/progress/momentum/consistency-run.ts` — `computeConsistencyRun` (pure).
- `apps/api/src/progress/momentum/recovery-latency.ts` — `computeRecoveryLatency` (pure).
- `apps/api/src/progress/momentum/domain-window.loader.ts` — `DomainWindowLoader` (Prisma → `DomainWindow[]`).
- `apps/api/src/progress/momentum/momentum.service.ts` — `MomentumService.forUser(userId, now)` → `Record<Domain, MomentumResult>`; `.summary(userId, now)` → the Today slot.
- `apps/api/src/progress/independence/independence-reader.ts` — `export interface IndependenceReader { read(userId, from, to): Promise<{ ratio: number | null; completedWithoutReminder: number; sampleSize: number }> }`, token `INDEPENDENCE_READER`, and `NullIndependenceReader` returning `{ ratio: null, completedWithoutReminder: 0, sampleSize: 0 }`. E12-06 (#69) replaces the provider; nothing else changes.

Engine contract (`momentum-engine.ts`, no Nest or Prisma imports, no `Date.now()`):

```ts
export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';
export type MomentumState = 'BUILDING' | 'IMPROVING' | 'STEADY' | 'SLIPPING' | 'RECOVERING' | 'INSUFFICIENT_DATA';
export const WINDOW_DAYS = 28;
export const HALF_WINDOW_DAYS = 14;
export const MIN_PLANNED = 3;            // below this: INSUFFICIENT_DATA
export const BUILDING_MAX_HISTORY_DAYS = 14;
export const BUILDING_MIN_RATIO = 0.5;
export const TREND_DELTA = 0.15;         // IMPROVING / SLIPPING threshold between halves
export const SLIP_CONSECUTIVE_MISSES = 3;
export const RECOVERY_IDLE_DAYS = 3;
export const RECOVERY_LOOKBACK_DAYS = 7;

export interface WindowCommitment {
  id: string; scheduledStart: Date; status: CommitmentStatus;   // Prisma enum
  rescheduleCount: number; fallbackUsed: boolean;               // versionUsed ∈ {SHORT, MINIMUM}
  completedAt: Date | null; commitmentType: string | null;
}
export interface DomainWindow {
  domain: Domain; now: Date; timeZone: string;
  firstActivityAt: Date | null;          // earliest commitment or evidence in this domain, ever
  commitments: WindowCommitment[];       // scheduledStart in [now − 28d, now); any status
}
export interface MomentumSignals {
  planned: number; completed: number; partial: number; fallback: number;
  missed: number; skipped: number; openPastDue: number; rescheduledTwice: number;
  ratio: number | null; recentRatio: number | null; priorRatio: number | null;
  consecutiveMisses: number; historyDays: number | null;
  lastCompletionAt: Date | null; lastMissAt: Date | null; returnedAfterIdleDays: number | null;
}
export interface MomentumResult { domain: Domain; state: MomentumState; evidence: string[]; signals: MomentumSignals }
export function computeMomentum(input: DomainWindow): MomentumResult;
```

Definitions (each is what the unit spec pins):

- **decided** = commitments with `status ∈ {COMPLETED, PARTIALLY_COMPLETED, MISSED, SKIPPED}` **plus** `openPastDue` = `status ∈ {PLANNED, READY}` with `scheduledStart < now` (a past-due row the E11-02 (#112) sweep has not closed yet counts as not done, so the number is the same before and after the sweep). `CANCELLED` (plan changes, E06-04 (#76)) and `RESCHEDULED` (closed by a reschedule; its successor row carries the intention) are excluded. `planned = decided.length`.
- `completed` = COMPLETED; `partial` = PARTIALLY_COMPLETED; `fallback` = completed or partial rows with `fallbackUsed`; `successes = completed + partial` (a fallback completion is a completion — PRD §44, P7); `ratio = planned ? successes / planned : null`.
- `recentRatio` / `priorRatio` = the same ratio over `[now − 14d, now)` / `[now − 28d, now − 14d)`, `null` when that half has fewer than `MIN_PLANNED` decided rows.
- `consecutiveMisses` = length of the trailing run of `MISSED | SKIPPED | openPastDue` when decided rows are ordered by `scheduledStart` ascending.
- `historyDays` = whole days between `firstActivityAt` and `now` (`null` when no activity ever).
- `returnedAfterIdleDays`: for the latest success `s` with `completedAt ≥ now − 7d`, the number of whole days between the previous success in this domain (or `firstActivityAt`) and `s.completedAt`; counted only when that gap is `≥ RECOVERY_IDLE_DAYS` **and** contains at least one `MISSED | SKIPPED | openPastDue` row (a planned rest is not a recovery). Otherwise `null`.
- `rescheduledTwice` = decided rows with `rescheduleCount ≥ 2`.

State — the **first** matching rule wins, in this order (precedence is part of the contract):

| # | State | Rule |
|---|---|---|
| 1 | `INSUFFICIENT_DATA` | `planned < MIN_PLANNED` |
| 2 | `RECOVERING` | `returnedAfterIdleDays !== null` |
| 3 | `SLIPPING` | `consecutiveMisses ≥ SLIP_CONSECUTIVE_MISSES`, **or** both half ratios non-null and `priorRatio − recentRatio ≥ TREND_DELTA` |
| 4 | `BUILDING` | `historyDays < BUILDING_MAX_HISTORY_DAYS` and `ratio ≥ BUILDING_MIN_RATIO` |
| 5 | `IMPROVING` | both half ratios non-null and `recentRatio − priorRatio ≥ TREND_DELTA` |
| 6 | `STEADY` | otherwise |

Evidence bullets (`momentum-evidence.ts`, `buildEvidence(signals, domain): string[]`, at most 3, in this priority, plain counts only — never a percentage, never `/100`):

1. `"{successes} of {planned} planned {noun} completed"` — noun: HEALTH → `workouts` when every decided row has `commitmentType === 'workout'`, else `health commitments`; WORK → `focus sessions` when all are `focus_session`, else `work actions`; FAMILY → `family commitments`. Singular when 1.
2. `"Returned {n} day(s) after a miss"` when `returnedAfterIdleDays !== null`.
3. `"{consecutiveMisses} in a row not started"` when `consecutiveMisses ≥ 2`.
4. `"{fallback} completed with the short or minimum version"` when `fallback > 0`.
5. `"{rescheduledTwice} moved more than once"` when `rescheduledTwice > 0`.
6. `"Last two weeks: {recentSuccesses} of {recentPlanned}, before that {priorSuccesses} of {priorPlanned}"` when both halves are non-null and the state is IMPROVING or SLIPPING.
7. For `INSUFFICIENT_DATA`: exactly one bullet, `"Not enough planned {noun} yet — momentum appears after {MIN_PLANNED}"`.

Consistency run (`consistency-run.ts`):

```ts
export const WEEK_SUCCESS_RATIO = 0.6;
export const GRACE_EVERY_N_WEEKS = 4;
export const RUN_LOOKBACK_WEEKS = 26;
export interface WeekStat { weekStart: string /* YYYY-MM-DD, Monday, user tz */; planned: number; completed: number; success: boolean; graced: boolean; current: boolean }
export function computeConsistencyRun(commitments: WindowCommitment[] /* all domains, 26 weeks */, now: Date, timeZone: string): { weeks: number; graceUsed: number; weekly: WeekStat[] }
```

- Weeks are Monday–Sunday in the user's timezone (`localDate` from `apps/api/src/today/local-date.ts` for the day label). `planned`/`completed` use the same decided/success definitions as the engine, across all three domains.
- A week is **successful** when `planned ≥ 1` and `completed / planned ≥ WEEK_SUCCESS_RATIO`. A week with `planned = 0` is **neutral**: it neither extends nor breaks the run and is not counted.
- Walk completed weeks from the most recent backwards. Each successful week adds 1. A non-successful week is **graced** (run continues, `graceUsed += 1`) if fewer than one grace has been used in the last `GRACE_EVERY_N_WEEKS` counted weeks; otherwise it ends the run. The current, incomplete week is reported (`current: true`) but never counted.
- `weekly` is the last 12 weeks ascending (for the Progress bars).

Recovery latency (`recovery-latency.ts`): `computeRecoveryLatency(commitments: WindowCommitment[] /* 90 days, all domains */): { medianDays: number | null; samples: number }` — for each `MISSED` row, days from its `scheduledStart` to the next success (any domain) whose `completedAt` is later; median over samples; `null` with `samples = 0` when there are no misses or no return yet. `RECOVERY_LOOKBACK_DAYS = 90`.

`DomainWindowLoader.load(userId, now)`: one `commitment.findMany` (`userId`, `scheduledStart ≥ now − 90d`, select `id, domain, scheduledStart, status, rescheduleCount, versionUsed, completedAt, commitmentType`), one `evidence.groupBy`/`findFirst` per domain for `firstActivityAt` (min of earliest commitment `scheduledStart` and earliest evidence `occurredAt` joined through `commitment.domain`), timezone from `UserProfileService`. Maps `versionUsed ∈ {SHORT, MINIMUM}` → `fallbackUsed`. Returns the 28-day windows per domain plus the 90-day list for the run/latency helpers. `@Trace('progress.window.load')`.

Endpoints:

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/progress` | `@Auth()` (own data) | — | 200 `ProgressResponse` |
| GET | `/api/today` | existing `@Auth()` (E05-01 (#38)) | — | existing body with `momentum` filled (schema below) |

```ts
// progress.schema.ts
export const momentumStateEnum = z.enum(['BUILDING','IMPROVING','STEADY','SLIPPING','RECOVERING','INSUFFICIENT_DATA']);
export const momentumSchema = z.object({
  domain: domainEnum, state: momentumStateEnum,
  evidence: z.array(z.string()).max(3),
  signals: z.object({ planned: z.number().int(), completed: z.number().int(), partial: z.number().int(), fallback: z.number().int(),
    missed: z.number().int(), skipped: z.number().int(), consecutiveMisses: z.number().int(), rescheduledTwice: z.number().int(),
    lastCompletionAt: z.string().datetime().nullable(), lastMissAt: z.string().datetime().nullable(), returnedAfterIdleDays: z.number().int().nullable() }),
  trend: z.array(z.object({ weekStart: z.string(), planned: z.number().int(), completed: z.number().int() })).length(4),  // last 4 weeks, this domain
});
export const progressResponseSchema = z.object({
  generatedAt: z.string().datetime(), windowDays: z.literal(28),
  momentum: z.object({ WORK: momentumSchema, FAMILY: momentumSchema, HEALTH: momentumSchema }),
  consistencyRun: z.object({ weeks: z.number().int(), graceUsed: z.number().int(), weekly: z.array(weekStatSchema).max(12) }),
  recovery: z.object({ medianDays: z.number().nullable(), samples: z.number().int() }),
  independence: z.object({ ratio: z.number().min(0).max(1).nullable(), completedWithoutReminder: z.number().int(), sampleSize: z.number().int() }),
  milestones: z.array(milestoneSchema),          // [] until E11-03 (#115)
  insights: z.array(z.object({ id: z.string().uuid(), category: z.string(), statement: z.string() })),  // confirmed, not doNotUse (E06-05 (#78))
});
// today.schema.ts (E05-01 (#38), existing) — replace `momentum: z.null()` with:
export const momentumSummarySchema = z.object({ state: momentumStateEnum, headline: z.string().nullable() });   // headline = first evidence bullet
momentum: z.object({ WORK: momentumSummarySchema, FAMILY: momentumSummarySchema, HEALTH: momentumSummarySchema }),
```

`ratio`, `recentRatio` and `priorRatio` are **deliberately not serialised** — the API exposes counts, the UI renders counts; a ratio in the payload is one PR away from a percentage badge. `TodayService.getToday` (E05-01 (#38)) calls `MomentumService.summary(userId, now)` in its existing `Promise.all`; a thrown error there is caught, logged at `warn`, and degrades to `state: 'INSUFFICIENT_DATA', headline: null` per domain so Today never fails because of Progress.

Audit: none (reads). Log: `progress.compute user=<id> latencyMs=<n>` at debug. OpenAPI: add `{ name: 'Progress', description: 'Momentum per domain, consistency run, recovery, coach dependency, milestones and the evidence timeline. Counts and states only — there is no score.' }` to the `Product` group in `apps/api/src/openapi/tags.ts` (created by E05-01 (#38) for `Today`).

Error codes: 401 only.

**UI (frontend-dev)** — n/a (E11-04 (#117)). Types are added to `apps/web/src/types/index.ts` there; E05-04 (#46)'s `TodayResponse.momentum` type changes from `null` to `Record<Domain, MomentumSummary>` in this child's PR only if `apps/web` typecheck requires it (it does not: E05-04 (#46) renders nothing for momentum and the type is `null` — leave the web change to E11-04 (#117)).

**Tests (testing-dev)**

- `apps/api/src/progress/momentum/momentum-engine.spec.ts` — fixture builder `window({ now, days: [{ offset, status, fallback?, reschedules? }] })`; one `it` per state proving the rule and the precedence: 2 decided → `INSUFFICIENT_DATA` with the single bullet; 10-day-old user, 4 of 6 → `BUILDING`; prior 3/7 vs recent 6/7 → `IMPROVING` with bullet 6; recent 2/7 vs prior 6/7 → `SLIPPING`; C C M M M → `SLIPPING` via consecutive misses with "3 in a row not started"; M M M then C yesterday → `RECOVERING` beats `SLIPPING`, bullet "Returned 4 days after a miss"; gap with no misses (planned rest) → not `RECOVERING`; 10-day-old user who returned after idle → `RECOVERING` beats `BUILDING`; even split 5/7 both halves → `STEADY`; fallback completions count as successes and produce bullet 4; `CANCELLED`/`RESCHEDULED` rows ignored; open past-due row counts as not done and equals the same result after it is set to `MISSED`; same input twice → deep-equal output; bullets never match `/\d+\s*%|\/\s*100/`.
- `apps/api/src/progress/momentum/consistency-run.spec.ts` — Monday boundaries in `America/Costa_Rica` vs `UTC`; empty week neutral; one grace per 4 counted weeks (S S G S S → 5 with `graceUsed 1`; S G G → 1 with `graceUsed 1`); current week excluded; `weekly` length ≤ 12 ascending.
- `apps/api/src/progress/momentum/recovery-latency.spec.ts` — median of 1, 3 → 2; no misses → `null/0`; miss without return → excluded.
- `apps/api/src/progress/momentum/momentum.service.spec.ts` (Prisma mock) — loader maps `versionUsed` to `fallbackUsed`; `summary` headline is bullet 1; timezone from profile, `UTC` fallback.
- `apps/api/src/today/today.service.spec.ts` (extend) — `momentum` present with three domains; a rejecting `MomentumService` degrades to `INSUFFICIENT_DATA` and Today still returns 200 data.
- `apps/api/test/progress/progress.integration.spec.ts` (`createTestApp`) — 401 without token; 200 body passes `progressResponseSchema.safeParse`; `independence.ratio === null`; `milestones` is `[]`; user B's commitments never influence user A; serialised body contains no `ratio` key under `momentum`.

**Docs (docs-dev)** — `docs/API.md` new section "Progress" (`GET /progress` with an example body); "Today" section notes the `momentum` shape; `CLAUDE.md` "API Endpoints (MVP)" adds a "Progress" block. `docs/specs/momentum-and-recovery.md` is written by E11-06 (#121); this issue lists the constants and the precedence table in its PR description so the spec author copies them.

#### Acceptance criteria

- [ ] `computeMomentum` is a pure function: same `DomainWindow` in, deep-equal `MomentumResult` out; it imports nothing from Nest or Prisma.
- [ ] Every state is reachable and pinned by a fixture, and the precedence `INSUFFICIENT_DATA → RECOVERING → SLIPPING → BUILDING → IMPROVING → STEADY` is proven by at least two overlap cases.
- [ ] Evidence bullets are counts and sentences only; no bullet, headline or serialised field contains a percentage or `/100`, and the response carries no `ratio` under `momentum`.
- [ ] `GET /api/progress` returns three momentum entries, a consistency run in weeks with `graceUsed`, `recovery.medianDays`, `independence.ratio: null`, and the user's confirmed memory insights.
- [ ] `GET /api/today` returns `momentum.{WORK,FAMILY,HEALTH}` with `state` and `headline` instead of `null`, and still returns 200 when the momentum service throws.
- [ ] A fallback (`MINIMUM`/`SHORT`) completion counts as a success and is named in a bullet.
- [ ] A past-due `PLANNED` row yields the same state as the same row marked `MISSED`.
- [ ] Week boundaries follow `user_profiles.timezone` (a Sunday 23:30 completion in `America/Costa_Rica` belongs to that week, not the next).
- [ ] `openapi-document.spec.ts` passes with `Progress` declared under `Product`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (constant names, state enum, schema field names, file paths)
- [ ] Error handling: loader failures surface as 500 on `/progress` but degrade on `/today`; invalid timezone → `UTC` with a warn log
- [ ] Observability: `progress.window.load` span; `progress.compute` debug line; no bullet text in logs
- [ ] Security: `@Auth()`; every query filtered by `userId`; insights returned are the caller's confirmed rows only
- [ ] Config & secrets: none — thresholds are exported constants, not env vars
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–7.
2. `curl … /api/progress | jq '.data.momentum.HEALTH.evidence'` → the "5 of 6 planned workouts completed" bullet and the fallback bullet; `jq '.data.momentum.HEALTH.signals'` → `planned 6, completed 5, fallback 1`.
3. Complete the remaining HEALTH row today → `jq '.data.momentum.HEALTH.state'` stays non-`SLIPPING`; skip three HEALTH rows scheduled today/yesterday/two days ago → `SLIPPING` with "3 in a row not started".
4. `curl … /api/progress | grep -c '"ratio"'` → `1` (only `independence.ratio`); `grep -c '/100'` → `0`.

#### Out of scope

- Milestones, timeline (E11-03 (#115)); the comeback sweep (E11-02 (#112)); the Progress screen (E11-04 (#117)).
- Persisting momentum snapshots (recomputed per request; a cache is a later optimisation).
- Independence data (E12-06 (#69) provides the reader implementation).

#### Notes for the implementing agent

- Copy module/controller/DTO layout from `apps/api/src/today/` (E05-01 (#38)) and keep the engine free of I/O exactly as `nba-scorer.ts` is; the loader is the only Prisma touchpoint.
- Reuse `localDate`/`localDayBounds` from `apps/api/src/today/local-date.ts` for week labels — do not add a date library.
- `RESCHEDULED` rows are terminal closed rows (E02-04 (#47)); the live intention is the successor row with `rescheduledFromId`. Do not count both.
- `TodayModule` imports `ProgressModule`, never the reverse — `ProgressModule` must not depend on `TodayModule` or `CommitmentsModule` (E11-03 (#115) adds a `MilestonesModule` that `CommitmentsModule` imports; a cycle here would break that).
- Register the `Progress` tag in `tags.ts` in the same commit as the controller.
- Zod v4 + `nestjs-zod`; Fastify; no class-validator.

---

### E11-02 `feat(api): add comeback loop with inactivity sweep and no catch-up debt` — #112

**Part of epic:** E11 · **Blocked by:** E11-01 (#98), E04-01 (#100), E05-02 (#40) · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §56: when a user returns after inactivity the product must not show "a giant overdue list, a failed streak, 16 red tasks"; it should close old commitments as missed/historical, preserve evidence, evaluate active plans, create **one** restart action and schedule a plan review if needed. PRD §57 sets the triggers (3+ days of inactivity, multiple misses, substantial plan drift) and the completion ("Back on Path"); §109 is the acceptance list (overdue items do not flood Today, restart experience, prior misses remain evidence, one next action, plan review available); §136 is the loop (Miss → Slip → No shame → Reduce scope → Restart → Record recovery). VISION §32 makes recovery "a first-class product state" and §33 "No catch-up debt". E02-04 (#47) and E05 deliberately never auto-transition a commitment ("E11-02 (#112) comeback loop"); nothing in the API knows when a user was last active.

#### Proposed solution

Comeback state on `user_profiles`, an activity tracker fed by the existing action services, a daily `@Cron` sweep that closes stale open commitments as `MISSED` (evidence untouched) and offers one restart commitment sized from the user's own routine, four `/comeback` endpoints, a `comeback` slot on `GET /today`, and two non-production test-auth helpers so the loop can be driven in seconds.

**Data (database-dev)** — migration `add_comeback_state` on `user_profiles` (E04-01 (#100)):

```prisma
enum ComebackState { NONE OFFERED IN_PROGRESS }
enum ComebackTrigger { INACTIVITY REPEATED_MISSES }

model UserProfile {
  // … existing fields (E04-01 (#100))
  comebackState          ComebackState    @default(NONE) @map("comeback_state")
  comebackTrigger        ComebackTrigger? @map("comeback_trigger")
  comebackOfferedAt      DateTime?        @map("comeback_offered_at") @db.Timestamptz
  comebackCommitmentId   String?          @map("comeback_commitment_id") @db.Uuid
  lastActiveAt           DateTime?        @map("last_active_at") @db.Timestamptz
  lastSweepAt            DateTime?        @map("last_sweep_at") @db.Timestamptz
  planReviewSuggestedAt  DateTime?        @map("plan_review_suggested_at") @db.Timestamptz
  comebackCommitment     Commitment?      @relation("ComebackRestart", fields: [comebackCommitmentId], references: [id], onDelete: SetNull)
  @@index([comebackState])
  @@index([lastActiveAt])
}
```

`Commitment` gains the back-relation `comebackFor UserProfile[] @relation("ComebackRestart")`. `commitmentType` value `'restart'` marks the restart commitment (free string column, E02-01 (#36)). Seed: n/a. `npm run prisma:migrate:dev -- --name add_comeback_state` then `npm run prisma:generate`.

**API (backend-dev)**

Files (new unless marked) under `apps/api/src/progress/comeback/`: `comeback.controller.ts`, `comeback.service.ts`, `comeback-detector.ts` (pure), `restart-picker.ts` (pure), `restart-wording.service.ts` (optional AI), `comeback-sweep.task.ts` (`@Cron`), `activity-tracker.service.ts`, `comeback.schema.ts`, `dto/*.ts`. `ProgressModule` adds `imports: [AiModule, CommitmentsModule]` (E05-02 (#40)'s `CommitmentActionsService` completes the restart row; `CommitmentsModule` must **not** import `ProgressModule` — see E11-01 (#98) notes) and exports `ActivityTrackerService`.

Activity tracking — `ActivityTrackerService.touch(userId, at = new Date())`: `UPDATE user_profiles SET last_active_at = at WHERE user_id = ? AND (last_active_at IS NULL OR last_active_at < at − 5 min)` (one cheap write per 5 minutes at most, via `prisma.userProfile.updateMany`; creates the profile through `UserProfileService.getOrCreate` when absent). Called, detached (`void …catch(log)`), after commit from: every `CommitmentActionsService` action (E05-02 (#40)), `EvidenceService.create`/`createFromFlow` (E02-04 (#47)), `CheckInService.upsert` and `DayReflectionService.create` (E05-03 (#43)), `CoachService.sendMessage` (E06-03 (#70)). Opening the app is **not** activity (PRD §57 counts behaviour, not sessions). `CommitmentsModule`, `TodayModule` and `CoachModule` import `ProgressModule` for it.

Detector (`comeback-detector.ts`, pure):

```ts
export const INACTIVITY_DAYS = 3;
export const MISSES_WINDOW_DAYS = 7;
export const MISSES_THRESHOLD = 4;
export const PLAN_DRIFT_MISSES_14D = 4;   // → planReviewSuggested
export const PLAN_DRIFT_CLOSED = 5;       // closed in one sweep → planReviewSuggested
export interface DetectorInput { now: Date; lastActiveAt: Date | null; hasHistory: boolean; missedLast7: number; comebackState: ComebackState }
export function detectComeback(i: DetectorInput): ComebackTrigger | null
// INACTIVITY when hasHistory && (lastActiveAt === null || now − lastActiveAt ≥ 3 days); else REPEATED_MISSES when missedLast7 ≥ 4; else null.
// Returns null when comebackState !== 'NONE' (an offer is already open — never stack offers).
```

Restart picker (`restart-picker.ts`, pure): input = the user's ACTIVE outcomes (with `importance`, domain, domain mode) → their ACTIVE plan version → active routines (`title, minimumDurationMin, fallbackBehavior, preferredTime`), plus per-domain `momentum.signals` (E11-01 (#98)) and today's local date. Rule, in order: exclude domains in `PAUSE` mode; choose the routine with the highest **outcome importance**; tie → the domain with the most recent `lastCompletionAt` (rebuild what worked, VISION §32 "Recommended restart"); tie → fixed order `HEALTH, WORK, FAMILY` (VISION §56: "a ten-minute health action or small Work start"). Output `RestartPlan { domain, routineId, outcomeId, planVersionId, title: routine.fallbackBehavior ?? routine.title, minutes: clamp(routine.minimumDurationMin, 10, 15), reason: '<template per rule>' , alternatives: [{domain, title, minutes}] for the best routine of each other eligible domain }`. When no eligible routine exists: `{ domain: 'HEALTH', title: 'A 10-minute walk', minutes: 10, reason: 'A small physical restart is the safest first step.', alternatives: [] }` with `routineId: null`.

Sweep (`ComebackService.sweepUser(userId, now)`, `@Trace('comeback.sweep')`):

1. Profile via `UserProfileService.getOrCreate`; `timeZone`; `startOfToday = localDayBounds(localDate(now, tz), tz).start`.
2. **Close** in one `$transaction`: every commitment `{ userId, status IN (PLANNED, READY), scheduledStart < startOfToday }` → `status: 'MISSED'` (both transitions are in the E02-04 (#47) matrix; assert with `canTransition` before writing, skip and warn otherwise). `STARTED` rows are left alone (matrix has no `STARTED → MISSED`; the user can still complete or partial them from Today). **No evidence row is created and none is modified.** `closedCount` = rows updated.
3. `missedLast7` = `MISSED` rows with `scheduledStart ≥ now − 7d` (after step 2); `missedLast14` likewise; `hasHistory` = any commitment or evidence ever.
4. `trigger = detectComeback(...)`. When `null`: set `lastSweepAt`, audit `comeback:sweep` meta `{closedCount, trigger: null}` only if `closedCount > 0`, return.
5. **Offer**: `restart = pickRestart(...)`; optional wording via `RestartWordingService.compose(userId, restart, coachingStyle)` → `AiGatewayService.invoke({ persona: 'coach', userId, promptVersion: 'comeback-restart.v1', instructions: '<coachingStyle-aware; one title ≤ 80 chars naming the same behaviour, one note ≤ 160 chars; no guilt, no streaks, no "overdue"; never invent a new goal>', input: { domain, title, minutes, idleDays, reason }, schema: z.object({ title: z.string().max(80), note: z.string().max(160) }), schemaName: 'ComebackRestartWording' })`; on `{ok:false}` or a title that fails the banned-word check (`/\b(overdue|behind|failed|streak|lazy|guilt)\b/i`) use the template `title = restart.title`, `note = 'No catching up. We start from today.'`. Create the restart commitment `{ userId, domain, outcomeId, planVersionId, routineId, title, commitmentType: 'restart', importance: outcome.importance ?? 3, scheduledStart: max(now + 1h, today at routine.preferredTime) clamped to today 21:00 local, fullVersion: { title, minutes }, minimumVersion: { title, minutes: min(5, minutes) }, status: 'PLANNED', userConfirmed: false }` through E02-04 (#47)'s create path (`CommitmentsService.create` semantics; no evidence). Update profile `{ comebackState: 'OFFERED', comebackTrigger: trigger, comebackOfferedAt: now, comebackCommitmentId, planReviewSuggestedAt: (missedLast14 ≥ 4 || closedCount ≥ 5) ? now : unchanged, lastSweepAt: now }`. Audit `comeback:sweep` meta `{closedCount, trigger}` and `comeback:offer` meta `{trigger, domain, routineId, minutes, wording: 'ai' | 'template', planReviewSuggested}` (never the title text).

`ComebackSweepTask` (`comeback-sweep.task.ts`): `@Cron(CronExpression.EVERY_DAY_AT_4AM)` (after `TokenCleanupTask` at 3 AM); iterates users with `isActive` and any commitment (`findMany` in pages of 200 by `id`), calls `sweepUser` per user with per-user try/catch (one failure never stops the run), logs `comeback.sweep users=<n> closed=<n> offered=<n> failed=<n> ms=<n>`. Exposes `runForUser(userId)` for the test helper and `runAll()` for ops.

Endpoints (`ComebackController`, `@ApiTags('Comeback')`, `@Controller('comeback')`, `@Auth()`):

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/comeback` | `@Auth()` | — | 200 `ComebackStatus` `{ state, trigger, offeredAt, idleDays, closedCount, planReviewSuggested, restart: CommitmentCard \| null, recommendation: { domain, reason } \| null, alternatives: [{ domain, title, minutes }] , wording: { note } }` — `restart` is E05-01 (#38)'s `CommitmentCard`; when `state === 'NONE'` everything but `state` is null/empty |
| POST | `/api/comeback/choose` | `@Auth()` | `{ domain: 'WORK' \| 'FAMILY' \| 'HEALTH' }` | 200 `ComebackStatus` — when the domain differs from the offered one: transition the current restart row to `CANCELLED` (matrix, audit `commitment:transition`), create the alternative's restart row, update `comebackCommitmentId`; state → `IN_PROGRESS`; 409 `NO_COMEBACK_OFFER` when `state === 'NONE'`; 400 when the domain has no alternative |
| POST | `/api/comeback/start` | `@Auth()` | — | 200 `ComebackStatus` with `state: 'IN_PROGRESS'` (the UI then navigates to `/start/<restart.id>`); 409 when `NONE` |
| POST | `/api/comeback/complete` | `@Auth()` | `{ notes?: string ≤ 500 }` | 200 `ComebackCompletion` `{ celebration: { title: 'Back on Path.', body }, evidenceId, milestone: null, nextCommitment: CommitmentCard \| null, planReviewSuggested }` — if the restart row is not yet `COMPLETED`/`PARTIALLY_COMPLETED`, complete it via `CommitmentActionsService.complete(userId, id, { notes })` (E05-02 (#40) writes its own `completed` evidence and audit); then create evidence `{ source: 'APP_FLOW', evidenceType: 'recovery', commitmentId, occurredAt: now, qualitativeValue: JSON { trigger, idleDays, closedCount }, confidence: 1 }`; profile → `{ comebackState: 'NONE', comebackTrigger: null, comebackCommitmentId: null, lastActiveAt: now }`; `nextCommitment` = the earliest `PLANNED \| READY` commitment with `scheduledStart > now` in the next 7 days (PRD §57 "then schedule next realistic commitment"); audit `comeback:complete` meta `{trigger, idleDays, restartCommitmentId}`; idempotent — a second call with `state === 'NONE'` returns 409 `NO_COMEBACK_OFFER` |
| POST | `/api/comeback/dismiss` | `@Auth()` | — | 204 — profile → `NONE`, restart row → `CANCELLED` (PRD §127 user control); audit `comeback:dismiss` |

`milestone` in the completion body is `null` in this child; E11-03 (#115) fills it (schema `milestoneSchema.nullable()` declared here as `z.unknown().nullable()` and tightened by E11-03 (#115)).

`GET /today` (E05-01 (#38), `today.schema.ts`): add `comeback: z.object({ state: z.enum(['OFFERED','IN_PROGRESS']), restartCommitmentId: z.string().uuid().nullable(), offeredAt: z.string().datetime() }).nullable()` — `null` when `NONE`. `TodayService` reads it from `UserProfileService` (no extra query when the profile is already loaded for the timezone). The restart row is a normal today commitment, so E05-01 (#38)'s loader lists it on its domain card and the NBA engine may pick it (E05-01 (#38)'s `RECOVER` intervention mode already fires at `daysSinceLastEvidence ≥ 3`).

Test-auth helpers (non-production only; `apps/api/src/test-auth/`, existing module; both behind `TestEnvironmentGuard`, both `@Public()` like `POST /auth/test/login` — they take an `email` and act on that user, so a spec can call them with `page.request` without a token):

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/test/simulate-idle` | `TestEnvironmentGuard` | `{ email, idleDays: int 1..60 }` | 200 `{ userId, shiftedCommitments, shiftedEvidence, lastActiveAt }` — sets `user_profiles.last_active_at = now − idleDays`, and subtracts `idleDays` days from the user's `commitments.scheduled_start/scheduled_end/started_at/completed_at` and `evidence_items.occurred_at` (`updateMany` with a raw interval), so a freshly seeded history reads as "idle for N days" without a clock injection. **Decision (E11-06 (#121) uses this, not time travel):** shifting data is deterministic, needs no global clock seam in every service, and the sweep/momentum code paths are exercised with the real `new Date()`. |
| POST | `/api/auth/test/jobs/run` | `TestEnvironmentGuard` | `{ job: 'comeback' \| 'milestones', email }` | 200 `{ job, closedCount, trigger, comebackState }` (`milestones` variant added by E11-03 (#115)) — runs `ComebackSweepTask.runForUser(userId)` synchronously |

`TestAuthModule` imports `ProgressModule`. Both routes are documented under the existing `Test Authentication` tag.

Copy rule (enforced by a unit test over every string constant in `comeback/`): no `overdue`, `behind`, `failed`, `streak`, `lazy`, `guilt`, `catch up` (PRD §56–§57, §129). Template strings: offer note "No catching up. We start from today."; completion body "The important part was not that you missed. It was that you returned." (VISION §32).

Error codes: 401; 409 `NO_COMEBACK_OFFER`; 400 Zod / no alternative; 404 never needed (profile is the caller's). OpenAPI: tag `Comeback` ("Return after inactivity: stale commitments are closed as history, one small restart action is offered, completing it records recovery. No overdue list is ever produced.") in the `Product` group.

**UI (frontend-dev)** — n/a (E11-05 (#119)).

**Tests (testing-dev)**

- `apps/api/src/progress/comeback/comeback-detector.spec.ts` — `lastActiveAt` 3 days ago → `INACTIVITY`; 2 days → `null`; null with history → `INACTIVITY`; null without history → `null`; 4 misses in 7 → `REPEATED_MISSES`; state `OFFERED` → `null` always.
- `apps/api/src/progress/comeback/restart-picker.spec.ts` — importance wins; tie → most recent completion; tie → HEALTH > WORK > FAMILY; `PAUSE` excluded; minutes clamped 10–15 (routine minimum 5 → 10, 40 → 15); no routine → the walk template; alternatives cover the other eligible domains only.
- `apps/api/src/progress/comeback/comeback.service.spec.ts` (Prisma mock + gateway stub) — sweep closes only `PLANNED|READY` before start of local today (a `STARTED` row and today's rows untouched); `prisma.evidence.update/delete` never called; `closedCount` counted; no offer when detector returns null; offer creates exactly one commitment with `commitmentType 'restart'` and sets profile fields; `{ok:false}` → template wording; AI title containing "overdue" → template; `planReviewSuggestedAt` set at 4 misses / 5 closed; `complete` writes `recovery` evidence, resets state, returns `nextCommitment`; `complete` twice → 409; `choose` cancels the old restart and creates the new one; `dismiss` cancels and resets. Timezone case: a commitment at 23:00 yesterday in `America/Costa_Rica` is closed while today's 00:30 is not.
- `apps/api/src/progress/comeback/comeback-copy.spec.ts` — every exported string in `comeback/` passes the banned-word regex.
- `apps/api/src/progress/comeback/activity-tracker.service.spec.ts` — second `touch` within 5 min issues no write; profile created when absent.
- `apps/api/src/test-auth/test-auth.service.spec.ts` (extend) — `simulate-idle` shifts only the named user's rows; `jobs/run` returns the sweep summary; both 403 when `NODE_ENV=production` (guard test as for `login`).
- `apps/api/test/progress/comeback.integration.spec.ts` (`createTestApp` + `AiGatewayService` stub): seed user A with an outcome/plan/routine and three past `PLANNED` rows + one `COMPLETED` (through E02/E05 services); `simulate-idle 4` → `jobs/run comeback` → `GET /comeback` `state OFFERED`, `restart.commitmentType 'restart'`, `closedCount 3`; `GET /commitments?from&to<today&status=PLANNED,READY` → `[]`; `GET /evidence?from&to` count unchanged; `GET /today` → `comeback.state 'OFFERED'`, domain cards contain only today's rows; `POST /comeback/complete` → `celebration.title 'Back on Path.'`, one new `recovery` evidence, `GET /comeback` → `NONE`; second complete → 409; user B is untouched throughout.

**Docs (docs-dev)** — `docs/API.md`: "Comeback" section (5 routes) and the two test-auth helpers under "Test Authentication" with a non-production warning; `CLAUDE.md`: endpoints block, `user_profiles` line gains "(+ comeback state, E11-02 (#112))", "Security Guidelines" bullet "Test-auth helpers (`simulate-idle`, `jobs/run`) exist only when `NODE_ENV !== 'production'`"; `docs/TESTING.md`: how to drive the sweep locally.

#### Acceptance criteria

- [ ] After `simulate-idle 4` and the sweep, every `PLANNED`/`READY` commitment scheduled before the start of the user's local today is `MISSED`; `STARTED` rows and today's rows are unchanged; `evidence_items` row count and contents are identical before and after.
- [ ] `GET /api/commitments?from=<30d ago>&to=<start of today>&status=PLANNED,READY` returns an empty list after the sweep (no overdue flood, PRD §109).
- [ ] Exactly one restart commitment exists per offer (`commitmentType = 'restart'`), sized 10–15 minutes from the user's most important active routine, and `GET /api/comeback` returns it with a recommendation reason and alternatives for the other domains.
- [ ] The sweep never creates a second offer while one is open, and never offers to a user with no history.
- [ ] `POST /api/comeback/complete` records `APP_FLOW` evidence of type `recovery`, resets `comebackState` to `NONE`, updates `lastActiveAt`, returns the "Back on Path." celebration and the next planned commitment, and 409s on repeat.
- [ ] `planReviewSuggestedAt` is set when ≥ 4 misses in 14 days or ≥ 5 rows were closed, and exposed as `planReviewSuggested` on `/comeback` and `/comeback/complete`.
- [ ] With the AI gateway failing, the offer uses template wording and the whole loop still works; with the fake provider up the wording comes from the `coach` persona and is rejected when it contains a banned word.
- [ ] `GET /api/today` carries `comeback: { state, restartCommitmentId, offeredAt }` while an offer is open and `null` otherwise.
- [ ] Every user-facing string in the module passes the banned-word test; audit rows `comeback:sweep`, `comeback:offer`, `comeback:complete`, `comeback:dismiss` are written without commitment titles.
- [ ] The cron runs daily at 04:00 UTC, isolates per-user failures, and `POST /api/auth/test/jobs/run` is absent from a production build.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: matrix violations skipped with a warn, never thrown from the sweep; gateway `{ok:false}` → template; 409 `NO_COMEBACK_OFFER`; per-user try/catch in the cron
- [ ] Observability: `comeback.sweep` span and summary log line; audit actions above; `ai_invocations` row for each wording call (`promptVersion comeback-restart.v1`)
- [ ] Security: `@Auth()` on `/comeback/*`; all writes scoped by `userId`; test helpers behind `TestEnvironmentGuard` and absent in production; no titles/notes in audit or logs
- [ ] Config & secrets: none new; thresholds are exported constants
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5 and 9–10 (seed, idle, sweep, check Today and the DB).
2. `curl … /api/comeback | jq '.data | {state, trigger, closedCount, recommendation, alternatives: (.alternatives|length)}'` → `OFFERED`, `INACTIVITY`, `1`, `{domain:"HEALTH", reason:…}`, `1` (WORK).
3. `curl -X POST … /api/comeback/choose -d '{"domain":"WORK"}'` → restart is now the Work routine's minimum; `psql -c "SELECT status, commitment_type FROM commitments WHERE commitment_type='restart' ORDER BY created_at;"` → `CANCELLED`, `PLANNED`.
4. `curl -X POST … /api/comeback/complete -d '{}'` → `celebration.title "Back on Path."`; `SELECT evidence_type FROM evidence_items ORDER BY occurred_at DESC LIMIT 2;` → `recovery`, `completed`. Repeat the call → 409 `NO_COMEBACK_OFFER`.
5. `docker compose stop fake-openai`; new user; repeat steps 9–10 → `jq '.data.wording'` shows the template note; `SELECT status, error_code FROM ai_invocations ORDER BY created_at DESC LIMIT 1;` → `failed`.

#### Out of scope

- Milestone `FIRST_COMEBACK` and the timeline entry (E11-03 (#115) hooks into `complete`).
- Screens (E11-05 (#119)); notifications N6 "Recovery" (E12).
- Re-planning: the flag links to the coach/Path; no `PlanVersion` is created here.
- Closing `STARTED` rows (no matrix path; a user can still finish or skip them from Today).

#### Notes for the implementing agent

- Copy `apps/api/src/auth/tasks/token-cleanup.task.ts` for the cron shape; `ScheduleModule.forRoot()` is already registered.
- Use `canTransition(status, 'MISSED')` from `apps/api/src/commitments/commitment-transitions.ts` — do not hand-roll the check. `RESCHEDULED` rows are already terminal and are not in the close set.
- Local day boundary: `localDayBounds(localDate(now, tz), tz).start` from `apps/api/src/today/local-date.ts`; never `setHours(0,0,0,0)` on a UTC `Date`.
- The restart row must go through E02-04 (#47)'s create semantics (ownership of `outcomeId`/`planVersionId`/`routineId`); a raw `prisma.commitment.create` is acceptable only inside the same transaction with the same validation — prefer `CommitmentsService.create` if E02-04 (#47) exposes it for internal callers.
- Call `AiGatewayService.invoke` outside `$transaction`; treat `ok:false` as the normal path in tests.
- Test-auth routes: copy the `@Public() + @UseGuards(TestEnvironmentGuard)` pair from `test-auth.controller.ts`; the raw interval update is `prisma.$executeRaw` with a bound integer, never string interpolation.
- Audit with `prisma.auditEvent.create` after commit, `targetType: 'user_profile'` for `comeback:*`, meta without titles.

---

### E11-03 `feat(api): add evidence timeline and milestone detection` — #115

**Part of epic:** E11 · **Blocked by:** E11-02 (#112) · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §76 wants a chronological timeline of **meaningful** events ("Started avoided proposal after two postponements", "Completed Upper A", "Protected family dinner", "Returned to Health plan after one missed workout") that "creates confidence from evidence"; §55 lists the milestones to celebrate (first full week, four weeks, ten workouts, first successful comeback, first month with reduced reminders); §77 says celebrations must match significance and "avoid constant confetti"; VISION §57 is the thirty-day payoff ("Thirty days ago those were intentions. Now there is evidence."). Evidence rows exist (E02-04 (#47), E05-02 (#40)) but nothing selects the meaningful ones, and nothing remembers that a milestone was reached.

#### Proposed solution

A `Milestone` table, a pure detector run by the daily sweep and after the two actions that can complete a milestone instantly, a pure timeline builder over evidence + commitments + audit + milestones, and three endpoints.

**Data (database-dev)** — migration `add_progress_milestones`:

```prisma
enum MilestoneKind { FIRST_FULL_WEEK FOUR_WEEKS TEN_WORKOUTS FIRST_COMEBACK REDUCED_REMINDERS FIRST_START_AFTER_POSTPONE }

model Milestone {
  id             String        @id @default(uuid()) @db.Uuid
  userId         String        @map("user_id") @db.Uuid
  kind           MilestoneKind
  sequence       Int           @default(1)            // 1 for one-off kinds; n for the n-th FOUR_WEEKS / TEN_WORKOUTS
  domain         Domain?                              // E02-01 (#36) enum; null for cross-domain kinds
  achievedAt     DateTime      @map("achieved_at") @db.Timestamptz
  meta           Json?                                // {weeks} | {count} | {commitmentId} — never free text
  acknowledgedAt DateTime?     @map("acknowledged_at") @db.Timestamptz
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, kind, sequence])
  @@index([userId, achievedAt(sort: Desc)])
  @@index([userId, acknowledgedAt])
  @@map("milestones")
}
```

`User` gains `milestones Milestone[]`. Repeatable kinds: `FOUR_WEEKS` (sequence `n` when the consistency run reaches `4n` weeks) and `TEN_WORKOUTS` (sequence `n` at `10n` workouts); all others are one-off (`sequence` fixed at 1, the unique index makes a second award a no-op). Seed: n/a. `npm run prisma:migrate:dev -- --name add_progress_milestones`.

**API (backend-dev)**

Files (new): `apps/api/src/progress/milestones/milestones.module.ts` (own module, `imports: [PrismaModule]`, exports `MilestonesService`; imported by `ProgressModule` **and** `CommitmentsModule` — a separate module so `CommitmentsModule → MilestonesModule` creates no cycle with `ProgressModule → CommitmentsModule`), `milestones.service.ts`, `milestone-detector.ts` (pure), `milestone-copy.ts` (titles/bodies per kind), `dto/milestone-response.dto.ts`; `apps/api/src/progress/timeline/timeline-builder.ts` (pure), `timeline.service.ts`, `dto/timeline-query.dto.ts`, `dto/timeline-response.dto.ts`. `ProgressController` gains the routes.

Detector (`milestone-detector.ts`):

```ts
export interface MilestoneInput {
  now: Date; existing: Array<{ kind: MilestoneKind; sequence: number }>;
  consistencyRunWeeks: number;                  // E11-01 (#98) computeConsistencyRun
  successfulWeeksEver: number;                  // weeks with success=true over the user's whole history (loader counts up to 104)
  workoutCompletions: number;                   // HEALTH COMPLETED with commitmentType 'workout' OR any WORKOUT_LOG evidence, distinct commitments
  comebackCompletions: number;                  // evidence rows of type 'recovery'
  startedAfterPostpone: { commitmentId: string; at: Date } | null;   // earliest `started` evidence on a commitment with rescheduleCount ≥ 2
  independence: { ratio: number | null; sampleSize: number };        // E11-01 (#98) reader; null until E12
}
export interface MilestoneCandidate { kind: MilestoneKind; sequence: number; domain: Domain | null; achievedAt: Date; meta: Record<string, unknown> }
export function detectMilestones(i: MilestoneInput): MilestoneCandidate[]
```

Rules: `FIRST_FULL_WEEK` when `successfulWeeksEver ≥ 1`; `FOUR_WEEKS` sequence `n = floor(consistencyRunWeeks / 4)` for every `n ≥ 1` not yet in `existing` (`meta {weeks: 4n}`); `TEN_WORKOUTS` sequence `n = floor(workoutCompletions / 10)` likewise (`domain HEALTH`, `meta {count: 10n}`); `FIRST_COMEBACK` when `comebackCompletions ≥ 1`; `FIRST_START_AFTER_POSTPONE` when `startedAfterPostpone` is set (`meta {commitmentId}`, `achievedAt = at`); `REDUCED_REMINDERS` when `independence.ratio !== null && ratio ≥ 0.7 && sampleSize ≥ 10` (dormant until E12-06 (#69) provides a non-null reader — documented, tested with a fixture that supplies a ratio). Candidates already in `existing` are filtered out; the DB unique index is the second guard.

`MilestonesService`: `evaluate(userId, now)` (loads inputs, runs the detector, `createMany({ skipDuplicates: true })`, audit `milestone:achieved` per new row meta `{kind, sequence}`, returns new rows); `afterAction(userId, event: { kind: 'started' | 'completed' | 'comeback_completed'; commitmentId?: string })` — detached wrapper (`void evaluate().catch(log)`) called from `CommitmentActionsService.start` and `.complete/.partial` (E05-02 (#40), after commit — HEALTH only for `completed`, any domain for `started`) and from `ComebackService.complete` (E11-02 (#112), which now awaits `evaluate` and puts the `FIRST_COMEBACK` row into its `milestone` response field); `list(userId, { unacknowledged })`; `acknowledge(userId, id)` (404 for foreign ids). `ComebackSweepTask` calls `evaluate` after `sweepUser` for every swept user (daily pass catches `FIRST_FULL_WEEK`/`FOUR_WEEKS` at week boundaries). `POST /api/auth/test/jobs/run { job: 'milestones' }` (E11-02 (#112) helper) runs `evaluate` for the named user.

Timeline builder (`timeline-builder.ts`, pure):

```ts
export type TimelineKind = 'completed' | 'completed_fallback' | 'partially_completed' | 'started_after_postpone' | 'family_kept' | 'returned_after_miss' | 'plan_change_accepted' | 'comeback_completed' | 'milestone';
export interface TimelineEvent { id: string; at: string; kind: TimelineKind; significance: 'ordinary' | 'notable' | 'milestone'; domain: Domain | null; title: string; detail: string | null; commitmentId: string | null; milestoneId: string | null }
export function buildTimeline(rows: TimelineRows, timeZone: string): TimelineEvent[]   // sorted at desc, id asc
```

Inputs (`TimelineRows`, loaded by `TimelineService` for `[from, to]`): evidence rows with `evidenceType ∈ {completed, partially_completed, started, recovery}` joined to their commitment (`title, domain, rescheduleCount, versionUsed, commitmentType`), `MISSED` commitments in range (for the "returned" rule), `audit_events` with `action = 'plan:change_accepted'` joined to the applied `plan_versions.rationale` via `meta.planId/toVersion`, and `milestones`. Mapping:

- `completed` → `completed` ("Completed {title}"); `completed_fallback` when `versionUsed ∈ {SHORT, MINIMUM}` ("Completed {title} — minimum version"); `partially_completed` ("Made progress on {title}").
- FAMILY `completed` → `family_kept` ("Protected {title}", `notable`) — PRD §76 "Protected family dinner"; no other family wording.
- `started` on a commitment with `rescheduleCount ≥ 2` → `started_after_postpone` ("Started {title} after {n} postponements", `notable`); other `started`/`paused`/`continued`/`rescheduled`/`fallback_selected` rows are **not** events.
- A success whose nearest earlier same-domain row is `MISSED` → additionally `returned_after_miss` ("Returned to {Domain} plan after {k} missed", `notable`, `k` = misses since the previous success).
- `plan:change_accepted` → `plan_change_accepted` ("Plan updated to v{toVersion}", detail = rationale first line ≤ 120 chars, `notable`).
- `recovery` evidence → `comeback_completed` ("Back on Path", `notable`).
- `milestones` → `milestone` (title from `milestone-copy.ts`, `significance 'milestone'`).

Copy (`milestone-copy.ts`, PRD §77 examples): `FIRST_FULL_WEEK` "First full week — your plan held for seven days."; `FOUR_WEEKS` "{weeks} weeks of momentum."; `TEN_WORKOUTS` "{count} workouts completed."; `FIRST_COMEBACK` "First comeback — you returned."; `FIRST_START_AFTER_POSTPONE` "You started something you had moved twice."; `REDUCED_REMINDERS` "A month with fewer reminders — more of this was you."

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/progress/timeline` | `@Auth()` | `TimelineQueryDto` `{ from: ISO (default now − 28d), to: ISO (default now), domain?, limit: 1..200 = 100, cursor? }` (`to − from ≤ 186 days`, 400 otherwise) | 200 `{ items: TimelineEvent[], nextCursor: string \| null }` newest first; cursor = base64 `at|id` |
| GET | `/api/progress/milestones` | `@Auth()` | `{ unacknowledged?: boolean }` | 200 `{ items: Milestone[] }` (`{ id, kind, sequence, domain, achievedAt, acknowledgedAt, title, body, meta }`) newest first, max 50 |
| POST | `/api/progress/milestones/:id/ack` | `@Auth()` | — | 200 `Milestone` with `acknowledgedAt` set; 404 for unknown/foreign ids; idempotent |

`GET /progress` (E11-01 (#98)) `milestones` now returns the 10 most recent plus every unacknowledged one; `POST /comeback/complete` (E11-02 (#112)) `milestone` returns the `FIRST_COMEBACK` row on the first completion, else `null`. Celebration intensity (PRD §77) is a property of the payload, not of the API: `significance: 'milestone'` → the client shows a toast once and a timeline entry; `'notable'` → highlighted timeline entry; `'ordinary'` → plain entry. Notification delivery of milestones (N7) is E12's.

OpenAPI: reuse tag `Progress`. Audit `milestone:achieved`, `milestone:acknowledge` (meta `{kind, sequence}`). Error codes: 400 range, 401, 404.

**UI (frontend-dev)** — n/a (E11-04 (#117)/E11-05 (#119)).

**Tests (testing-dev)**

- `milestone-detector.spec.ts` — each kind from a fixture; `FOUR_WEEKS` at 8 weeks with `existing [{FOUR_WEEKS,1}]` yields sequence 2 only; `TEN_WORKOUTS` at 9 → none, 10 → one, 20 with 1 existing → sequence 2; `REDUCED_REMINDERS` dormant on `ratio null`, awarded at 0.7/10; nothing awarded twice.
- `milestones.service.spec.ts` (Prisma mock) — `createMany` with `skipDuplicates`; audit per new row; `afterAction` never throws (rejecting Prisma → logged); `acknowledge` foreign id → 404.
- `timeline-builder.spec.ts` — the PRD §76 four examples reproduced from fixtures (started after two postponements; completed Upper A; protected family dinner; returned to Health plan after one missed workout); `paused`/`rescheduled` rows produce no event; fallback completion → `completed_fallback`; `plan:change_accepted` → title with version and rationale detail; stable ordering and cursor pagination (page 2 starts after page 1's last `at|id`); output byte-identical across two runs.
- `apps/api/test/progress/timeline.integration.spec.ts` — seed through E02/E05 services, `GET /progress/timeline` returns the expected kinds in order; `to − from` of 200 days → 400; foreign user's events absent.
- `apps/api/test/progress/milestones.integration.spec.ts` — after 10 HEALTH completions and `jobs/run milestones` → one `TEN_WORKOUTS`; a second run → none; `GET /progress/milestones?unacknowledged=true` → 1; `ack` → 0; comeback flow from E11-02 (#112)'s integration spec now returns `milestone.kind 'FIRST_COMEBACK'` on the first completion and `null` on a later comeback.
- `apps/api/src/commitments/actions/commitment-actions.service.spec.ts` (extend) — `start` and `complete` call `MilestonesService.afterAction` after the transaction; a rejecting hook does not fail the action.

**Docs (docs-dev)** — `docs/API.md` "Progress" section: timeline and milestones routes with an example timeline; `CLAUDE.md` "Database Tables": `milestones`; endpoints block; `docs/specs/momentum-and-recovery.md` (E11-06 (#121)) gets the timeline mapping table and milestone rules — this issue drafts them in the PR description.

#### Acceptance criteria

- [ ] `npm run prisma:migrate` applies `add_progress_milestones`; `milestones` has the unique `(user_id, kind, sequence)` index and cascades on user delete.
- [ ] `GET /api/progress/timeline` renders the four PRD §76 examples from equivalent data with the kinds `started_after_postpone`, `completed`, `family_kept`, `returned_after_miss`, and never lists pause/continue/reschedule evidence.
- [ ] Fallback completions are labelled (`completed_fallback`) and count as completions.
- [ ] Ten HEALTH workout completions award exactly one `TEN_WORKOUTS` milestone; the twentieth awards sequence 2; re-running the job awards nothing.
- [ ] The first `POST /api/comeback/complete` returns `milestone.kind === 'FIRST_COMEBACK'`; a later comeback returns `milestone: null`.
- [ ] Starting a commitment with `rescheduleCount ≥ 2` awards `FIRST_START_AFTER_POSTPONE` immediately (before any cron run).
- [ ] `REDUCED_REMINDERS` is never awarded while `independence.ratio` is `null`.
- [ ] Unacknowledged milestones appear in `GET /progress.milestones` and `GET /progress/milestones?unacknowledged=true` until `ack`; `ack` is idempotent and 404s for another user's id.
- [ ] Timeline pagination is stable (no duplicates or gaps across pages) and the range cap returns 400.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: detector/hook failures are logged, never propagated into commitment actions or the comeback completion; range validation 400
- [ ] Observability: audit `milestone:achieved`/`milestone:acknowledge`; span `progress.timeline.build`; log `milestones.evaluate user=<id> new=<n>`
- [ ] Security: `@Auth()`; `userId` on every query; `meta` carries ids and counts only
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5, then reschedule one WORK commitment twice via `POST /api/commitments/<id>/transition {"to":"RESCHEDULED","rescheduleTo":…}` (E02-04 (#47)) and start the successor → `curl … /api/progress/milestones | jq '.data.items[].kind'` includes `FIRST_START_AFTER_POSTPONE`.
2. `curl … "/api/progress/timeline?from=<35d ago>&to=<now>" | jq '.data.items[] | {kind, title}'` → completions, the fallback one labelled, `started_after_postpone` for step 1.
3. Complete 10 HEALTH commitments with `commitmentType: 'workout'`; `curl -X POST … /api/auth/test/jobs/run -d '{"job":"milestones","email":…}'` → `TEN_WORKOUTS` in `GET /progress/milestones?unacknowledged=true`; `POST …/milestones/<id>/ack` → gone from the unacknowledged list.
4. Epic steps 9–12 → `SELECT kind FROM milestones;` includes `FIRST_COMEBACK`; timeline top entries are the milestone and "Back on Path".

#### Out of scope

- Rendering (E11-04 (#117)/E11-05 (#119)); toasts and notifications (N7, E12).
- Backfilling milestones for data older than the user's first sweep beyond what the detector's inputs cover (104 weeks of weekly stats, all-time workout count).
- Search or filtering by free text (PRD §79).

#### Notes for the implementing agent

- Put `MilestonesModule` in its own module file so `CommitmentsModule` can import it without importing `ProgressModule` (which imports `CommitmentsModule`) — Nest circular imports fail at boot, not at compile time.
- Rationale for plan changes lives on `plan_versions` (E02-03 (#42)); the audit meta only carries `planId`/`toVersion` — join, do not copy rationale into audit.
- `qualitativeValue` on E05-02 (#40) completion evidence is JSON text; prefer `Commitment.versionUsed` for fallback detection and fall back to parsing only when the column is null.
- Keep `buildTimeline` and `detectMilestones` free of Prisma so the fixtures in the spec are plain objects.
- `createMany({ skipDuplicates: true })` relies on the unique index — do not remove `sequence` from it.
- Reuse the `Progress` OpenAPI tag; no new group.

---

### E11-04 `feat(web): add Progress screen with momentum, timeline and consistency charts` — #117

**Part of epic:** E11 · **Blocked by:** E11-01 (#98), E11-03 (#115), E02-05 (#51) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §75 defines the Progress screen sections (Your evolution, Momentum, Evidence, Consistency, Recovery, Coach dependency, Insights); §54 fixes momentum presentation as a state word plus evidence bullets and explicitly rejects "Health Score: 77/100"; §77 asks for celebrations whose intensity matches significance; VISION §30 shows the layout ("Work Momentum ↑ Improving … Why Health Momentum is improving …") and §57 the thirty-day payoff. PRD §122 (accessibility) forbids colour as the only carrier of meaning. `/progress` is the E02-05 (#51) placeholder.

#### Proposed solution

Replace `apps/web/src/pages/ProgressPage.tsx` with a sectioned page over `GET /progress`, `GET /progress/timeline` and `GET /progress/milestones`, using `@mui/x-charts` for the trend line and weekly bars, a full timeline page at `/progress/timeline`, and a one-time milestone toast.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E11-01 (#98)/E11-03 (#115)).

**UI (frontend-dev)**

Dependency: `apps/web/package.json` adds `"@mui/x-charts": "^9"` (same major as `@mui/x-data-grid`; peer `@mui/material` 9 — verify the installed range in the registry before pinning; if the 9.x line is not yet published, pin the newest release whose `peerDependencies` includes `@mui/material@^9` and say so in the PR). No other chart library.

Types (`apps/web/src/types/index.ts`): `MomentumState`, `MomentumSignals`, `Momentum`, `MomentumSummary`, `WeekStat`, `ProgressResponse`, `TimelineKind`, `TimelineEvent`, `TimelinePage`, `MilestoneKind`, `Milestone` — mirroring E11-01 (#98)/E11-03 (#115) Zod schemas field for field; `TodayResponse.momentum` (E05-04 (#46)) becomes `Record<Domain, MomentumSummary>`.

`apps/web/src/services/api.ts`: `getProgress()`, `getProgressTimeline(params: { from?, to?, domain?, limit?, cursor? })`, `getMilestones(params?: { unacknowledged?: boolean })`, `acknowledgeMilestone(id)`.

Hooks (`apps/web/src/hooks/`): `useProgress.ts` (`{ progress, loading, error, refresh }`, refetch on window focus), `useProgressTimeline.ts` (`{ items, loadMore, hasMore, loading }` cursor pagination), `useMilestoneToasts.ts` (polls `getMilestones({ unacknowledged: true })` on mount and after `refresh`; shows one `Snackbar` at a time; `acknowledgeMilestone` on close/autohide; also exported for E11-05 (#119) and E05-04 (#46) to call after a completion).

Components (`apps/web/src/components/progress/`, new):

- `EvolutionCard.tsx` `{ progress, bestSelf: BestSelfProfile | null }` — "Your evolution": the identity statement (E02-02 (#39) `GET /me/best-self`) as the headline, then one sentence per domain built from counts (`"Health: 5 workouts in the last four weeks"`), and three small `SparkLineChart`s (one per domain, `progress.momentum[d].trend`) with `aria-label="Health completions per week, last four weeks: 1, 2, 1, 1"`. No totals across domains.
- `MomentumCard.tsx` `{ momentum: Momentum }` — header `"{Domain} Momentum"`, state word as a `Chip` **with an icon** (`TrendingUp` IMPROVING/BUILDING, `TrendingFlat` STEADY, `TrendingDown` SLIPPING, `Replay` RECOVERING, `HourglassEmpty` INSUFFICIENT_DATA) and `aria-label="Health momentum: Improving"`; a `LineChart` (height 120, four `trend` points, `showMark` muted, series `planned` dashed and `completed` solid so the two are distinguishable without colour, legend text below); then the `evidence` bullets as a `<ul>` under a caption "Why". Never renders `signals` numerically beyond what a bullet says.
- `EvidenceTimeline.tsx` `{ items: TimelineEvent[]; compact?: boolean; onLoadMore?; hasMore? }` — grouped by local day (`Intl.DateTimeFormat`), each row: icon per `kind` + text; `significance === 'milestone'` → `EmojiEvents` icon, bold title, `Chip label="Milestone"`; `'notable'` → `Star` icon and a left border; `'ordinary'` → plain. Compact mode shows the latest 8 and a **See all** link to `/progress/timeline`.
- `ConsistencyChart.tsx` `{ run: ProgressResponse['consistencyRun'] }` — caption `"{weeks} weeks building momentum"` (or "Your first successful week is ahead" when 0) with `graceUsed` noted as "1 grace week used"; `BarChart` of `weekly` (x = week label, series `planned` outlined / `completed` filled, graced weeks carry a "grace" label in the tooltip and a pattern fill), `height 180`, plus a visually hidden `<table>` with the same numbers for screen readers.
- `RecoveryCard.tsx` `{ recovery }` — `medianDays === null` → "No misses to recover from yet"; else `"Returned in {medianDays} day(s) on average"` and `"{samples} recoveries"`. Copy never says "failed".
- `CoachDependencyCard.tsx` `{ independence }` — `ratio === null` → "Available once notifications learn your rhythm."; else `"{completedWithoutReminder} of {sampleSize} completed without a reminder"` (count wording, PRD §75's "percent" is rendered as a fraction).
- `InsightsList.tsx` `{ insights }` — confirmed statements with category chips; empty state "Confirmed patterns appear here" linking to `/settings/ai-memory` (E06-08 (#90)).
- `MilestoneToast.tsx` — `Snackbar` + `Alert severity="success"` with the milestone `title`, `autoHideDuration 8000`, close → ack. One at a time; no confetti, no sound.

Pages:

- `apps/web/src/pages/ProgressPage.tsx` (replaces the placeholder) — `Container maxWidth="lg"`; `h1` "Progress"; sections in PRD §75 order, each a `section` with `aria-labelledby` and an `h2`: Your evolution → Momentum (`Grid` `size={{ xs: 12, md: 4 }}` ×3) → Evidence (compact timeline) → Consistency → Recovery + Coach dependency (`Grid` `size={{ xs: 12, sm: 6 }}`) → Insights. `LoadingSpinner` while loading; `Alert` on error; the page never shows a number followed by `/100`, the word "score", or a percentage.
- `apps/web/src/pages/ProgressTimelinePage.tsx` (new) — `/progress/timeline`: domain filter `ToggleButtonGroup` (All/Work/Family/Health), full `EvidenceTimeline` with **Load more**.

Routes (`apps/web/src/App.tsx`): `/progress` → `ProgressPage`, `/progress/timeline` → `ProgressTimelinePage` (inside `Layout`; owned by `progress` via `DESTINATION_ROUTES.progress = ['/progress']` prefix — no registry change). `AppBar.tsx` `PRODUCT_DRILLDOWNS` (E02-06 (#56)'s data table) gains `{ pattern: /^\/progress\/timeline$/, title: 'Evidence', up: '/progress' }` — data only; `isCompactWindow` (gate 5) untouched.

Responsive: charts take the container width (x-charts is responsive when `width` is omitted); below `md` all sections stack; nothing in this child uses `sm` gates. Dark/light: series colours from `theme.palette` (`primary.main` completed, `text.disabled` planned) — validated against both modes with the `dataviz` guidance: trend lines not areas, muted point markers, never colour-only (dashed vs solid, icon + word for state, pattern fill for grace).

a11y: every chart has an `aria-label` sentence and a hidden data table; state chips carry the state word; icons are `aria-hidden` next to text; the toast is `role="status"`; headings `h1 → h2` in order; axe clean.

Visual harness: add a `progress` scene to `apps/web/visual/main.tsx` with a fixed `ProgressResponse` fixture; regenerate baselines only in `mcr.microsoft.com/playwright:v1.62.1-noble` per `docs/TESTING.md`.

**Tests (testing-dev)**

- MSW: `apps/web/src/__tests__/mocks/handlers.ts` + `mocks/progress.data.ts` — `/progress`, `/progress/timeline` (two pages via cursor), `/progress/milestones` (mutable: `ack` removes from unacknowledged).
- `apps/web/src/__tests__/pages/ProgressPage.test.tsx` — renders the seven `h2`s in PRD §75 order; each momentum card shows the state word and its bullets; **no-score assertions**: `expect(container.textContent).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/)`, `.not.toMatch(/\bscore\b/i)`, `.not.toMatch(/\d+\s*%/)`; consistency caption from `weeks`; recovery null copy; independence null copy; insights empty state links to `/settings/ai-memory`; milestone toast appears once for an unacknowledged milestone and `POST …/ack` is sent on close; `axe` (`vitest-axe`) has no violations.
- `apps/web/src/__tests__/components/progress/MomentumCard.test.tsx` — icon + `aria-label` per state; dashed/solid legend text present.
- `apps/web/src/__tests__/components/progress/EvidenceTimeline.test.tsx` — grouping by day; milestone/notable/ordinary styling by role/text; compact mode shows 8 + "See all".
- `apps/web/src/__tests__/components/progress/ConsistencyChart.test.tsx` — hidden table rows equal `weekly`; grace label present for a graced week.
- `apps/web/src/__tests__/pages/ProgressTimelinePage.test.tsx` — filter sends `domain`; Load more appends page 2.
- `apps/web/src/__tests__/config/destinations.test.ts` — `/progress/timeline` owned by `progress`; AppBar test: drill-down title "Evidence" → `/progress`.
- `apps/web/src/__tests__/hooks/useMilestoneToasts.test.ts` — one toast at a time; ack on close.

**Docs (docs-dev)** — `CLAUDE.md` "Repository Structure": `components/progress/`, the two pages; "Technology Stack": add `@mui/x-charts` to the frontend line; `docs/ARCHITECTURE.md` frontend section: Progress screen and the "no score" rule; `docs/specs/momentum-and-recovery.md` UI section (E11-06 (#121) owns the file; component map in this PR).

#### Acceptance criteria

- [ ] `/progress` shows, in order, Your evolution, three Momentum cards (state word with icon + evidence bullets + trend line), Evidence, Consistency (weekly bars), Recovery, Coach dependency, Insights, all from `GET /progress` plus the timeline/milestone calls.
- [ ] The rendered page contains no `N/100`, no `%`, and no "score" text in any state (asserted in the page test with the regexes above).
- [ ] Momentum state is conveyed by word **and** icon; planned vs completed series differ by line style, not only colour; every chart has an `aria-label` and an equivalent hidden table.
- [ ] Unacknowledged milestones show one toast at a time, once; closing it acknowledges the milestone and it does not reappear after reload.
- [ ] Evidence rows differ visibly by significance (milestone > notable > ordinary) without relying on colour alone.
- [ ] `/progress/timeline` filters by domain and paginates with Load more; the compact bar shows the back arrow titled "Evidence".
- [ ] Below 600px the page is a single column with BottomNav visible; charts fill the width; at ≥ 900px the three momentum cards sit side by side.
- [ ] `git diff` of `Layout.tsx`, `BottomNav.tsx`, `SettingsHub.tsx` is empty; `AppBar.tsx` changes only `PRODUCT_DRILLDOWNS`.
- [ ] axe reports zero violations on `ProgressPage` and `ProgressTimelinePage`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: API errors in an `Alert`; a failing milestones poll never blocks the page; empty states for every section
- [ ] Observability: n/a (client)
- [ ] Security: `api` service only; no ids of other users requested
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`); visual baselines regenerated in the pinned container
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–8 and 13.
2. In DevTools, `document.body.innerText.match(/\/100|\bscore\b|\d+%/i)` → `null`.
3. Toggle dark mode in `/settings/appearance`: charts remain legible; planned (dashed) vs completed (solid) distinguishable in greyscale (emulate `forced-colors` or print preview).
4. Keyboard only: Tab reaches the domain filter on `/progress/timeline` and "Load more"; screen reader (VoiceOver/NVDA) reads each chart's `aria-label` sentence.

#### Out of scope

- Comeback screens and the Today banner (E11-05 (#119)).
- Weekly Review content (E10) — Progress links to `/review` only if E10 has shipped; otherwise no link.
- Exporting or sharing progress (PRD §78 later).

#### Notes for the implementing agent

- Follow `apps/web/src/pages/TodayPage.tsx` + `hooks/useToday.ts` (E05-04 (#46)) for the load/refresh/error pattern and `components/today/` for component granularity.
- Load the `dataviz` skill before writing chart code; keep series colours from the theme, points muted, and add the hidden table — x-charts' built-in a11y does not cover tabular equivalents.
- `@mui/x-charts` components accept `height` and fill width; do not wrap them in fixed-width boxes.
- Reuse `apps/web/src/utils/greeting.ts`-style pure helpers for copy (`momentumCopy.ts` in `apps/web/src/utils/`) so the no-score test can also run over the copy module.
- Do not touch the five coupled breakpoint gates; the page's own `md` grid is a local layout choice (as E05-04 (#46) documents).
- `Grid` with the `size` prop (MUI v7+ API), no `Grid2`.

---

### E11-05 `feat(web): add comeback flow screens and Today welcome-back banner` — #119

**Part of epic:** E11 · **Blocked by:** E11-02 (#112), E05-04 (#46), E05-05 (#48) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §57 specifies the comeback experience as three screens — "You're still on the Path." → "No catching up. Which area feels most important to restart?" (or the AI recommendation) → a small action — and the completion "Back on Path."; §56 says what the return must **not** show; §109 requires a restart experience and a single next action; VISION §32 and §56 give the tone ("Missing does not mean quitting."). E11-02 (#112) provides the state and the restart commitment; E05-05 (#48)'s `/start/:commitmentId` runs it; nothing renders the offer.

#### Proposed solution

A full-screen `/comeback` route (outside `Layout`, like `/activate` and `/start/:commitmentId`) with three steps and a done screen, a Today banner while an offer is open, and a return hop from the Start flow.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E11-02 (#112)).

**UI (frontend-dev)**

Types (`apps/web/src/types/index.ts`): `ComebackState`, `ComebackTrigger`, `ComebackStatus`, `ComebackCompletion`; `TodayResponse.comeback` (E11-02 (#112) slot).

`apps/web/src/services/api.ts`: `getComeback()`, `chooseComebackDomain(domain)`, `startComeback()`, `completeComeback(body?)`, `dismissComeback()`.

Hook `apps/web/src/hooks/useComeback.ts` — `{ status, loading, error, choose, start, complete, dismiss, refresh }`.

Route (`apps/web/src/App.tsx`): `<Route path="/comeback" element={<ComebackPage />} />` and `<Route path="/comeback/done" element={<ComebackDonePage />} />` as siblings of `/activate` and `/start/:commitmentId` (inside `ProtectedRoute` and the E01/E04 gates, outside `NotificationProvider`+`Layout`). Add `'/comeback'` to `UNOWNED_ROUTES` in `apps/web/src/config/destinations.ts` (no destination highlights; no nav mounted).

Page `apps/web/src/pages/ComebackPage.tsx` (`Box minHeight: 100dvh`, content max-width 600px centred, a step indicator `aria-label="Step 2 of 3"`, focus moves to the step's `h1` on change):

- **Step 1** — `h1` "You're still on the Path.", body "No catching up. We start from today." and, when `status.trigger === 'INACTIVITY'`, "Last {idleDays} days got away from you. Let's restart with one thing today." (VISION §56); buttons **Continue** (primary) and **Not now** (`dismiss` → `/`). When `status.state === 'NONE'` the page renders "Nothing to restart — you're on today's path." with a link to `/`.
- **Step 2** — `h1` "Which area feels most important to restart?"; the recommended domain first as a `Card` with `Chip label="Recommended"` and the `recommendation.reason`; the `alternatives` as cards ("{title} · {minutes} min"); buttons **Take the recommendation** (primary → `start()`) or a card's **Choose** (`choose(domain)` then `start()`). Domains with no alternative are not listed.
- **Step 3** — `h1` = `restart.title`; "{minutes} min · {Domain}"; "Why it matters" from the outcome when present; the `wording.note`; primary **Start** → `navigate('/start/<restart.id>', { state: { returnTo: '/comeback/done' } })`; secondary **Choose a different area** (back to step 2).
- Step is derived from `status.state` on load (`OFFERED` → 1, `IN_PROGRESS` → 3), so a reload lands on the right step.

`apps/web/src/pages/StartFlowPage.tsx` (E05-05 (#48), existing): after a successful `complete`/`partial`, navigate to `location.state?.returnTo ?? '/'` — a one-line generalisation; no other change.

Page `apps/web/src/pages/ComebackDonePage.tsx` — on mount calls `completeComeback()` (idempotent server-side; a 409 `NO_COMEBACK_OFFER` on a reload is treated as already done and the page renders from `getComeback` + the last known result kept in `sessionStorage` key `comeback.done`); `h1` "Back on Path.", body "The important part was not that you missed. It was that you returned."; if `milestone` → the milestone title in an `Alert severity="success"` (the E11-04 (#117) toast is **not** also shown for it — `ComebackDonePage` acknowledges it via `acknowledgeMilestone`); **Next up** card with `nextCommitment` (title, local time) or "Nothing planned yet"; when `planReviewSuggested` a `Button` **Review my plan** → `/coach` with `state: { prompt: 'I fell off' }` (E06-07 (#86)'s suggested prompt `fell_off`); primary **Back to Today** → `/`.

Today banner — `apps/web/src/components/today/ComebackBanner.tsx` `{ comeback: TodayResponse['comeback']; onDismiss }` rendered by `TodayPage` (E05-04 (#46)) above the NBA card when `today.comeback !== null`: `Alert severity="info" icon={<Replay/>}` with title "Welcome back. No catching up." and body "We start from today. One small thing is enough."; actions **Restart with one thing** (→ `/comeback`) and **Dismiss** (`dismissComeback` then `refresh`). The banner has `role="status"`; it never lists what was missed.

Copy guard: `apps/web/src/utils/comebackCopy.ts` exports every string used by the flow and the banner; a test asserts none matches `/\b(overdue|behind|failed|streak|lazy|guilt|catch up)\b/i` — the same list as the API (E11-02 (#112)).

Responsive: full-viewport pages, single column at every width, buttons full-width below `sm` via `Stack` (local, not a shell gate); the banner spans the Today grid's left column at ≥ `md` and full width below.

a11y: one `h1` per step; focus management on step change (`ref.focus()` on the heading with `tabIndex={-1}`); `aria-live="polite"` region announcing the step title; all buttons ≥ 44px; the step indicator is text, not only dots; colour is never the only state carrier (recommended card has the chip text).

**Tests (testing-dev)**

- MSW: `/comeback`, `/comeback/choose`, `/comeback/start`, `/comeback/complete` (first call returns a `FIRST_COMEBACK` milestone, second 409), `/comeback/dismiss`; `/today` fixture with `comeback: { state: 'OFFERED', … }`.
- `apps/web/src/__tests__/pages/ComebackPage.test.tsx` — `OFFERED` → step 1 copy incl. the idle-days sentence; Continue → step 2 lists the recommended card first with "Recommended" and the alternatives; "Take the recommendation" posts `/comeback/start` and shows step 3 with the restart title and minutes; "Choose" on Work posts `{domain:'WORK'}` then start; Start navigates to `/start/<id>` with `state.returnTo === '/comeback/done'`; `IN_PROGRESS` on load → step 3 directly; `NONE` → "Nothing to restart"; Not now → dismiss + `/`; focus is on the `h1` after each step change; axe clean.
- `apps/web/src/__tests__/pages/ComebackDonePage.test.tsx` — posts complete once; renders "Back on Path." and the milestone alert; acknowledges the milestone; 409 on remount renders the done state from `sessionStorage`; "Review my plan" shown only when `planReviewSuggested`; navigates to `/coach` with the prompt state.
- `apps/web/src/__tests__/components/today/ComebackBanner.test.tsx` — visible only when `today.comeback` is non-null; Restart navigates to `/comeback`; Dismiss posts and the banner disappears; `role="status"`.
- `apps/web/src/__tests__/pages/StartFlowPage.test.tsx` (extend) — completion navigates to `state.returnTo` when set, `/` otherwise.
- `apps/web/src/__tests__/utils/comebackCopy.test.ts` — banned-word regex over every exported string.
- `apps/web/src/__tests__/config/destinations.test.ts` — `/comeback` and `/comeback/done` are unowned.

**Docs (docs-dev)** — `CLAUDE.md` "Repository Structure": the two pages and `components/today/ComebackBanner.tsx`; `docs/specs/momentum-and-recovery.md` (E11-06 (#121)) "Comeback screens" section drafted in this PR.

#### Acceptance criteria

- [ ] With an open offer, `/` shows the "Welcome back. No catching up." banner above the next-best-action and no list of missed items anywhere on Today.
- [ ] `/comeback` renders the three PRD §57 screens in order with the exact headlines "You're still on the Path.", "Which area feels most important to restart?", and the restart action; a reload lands on the correct step.
- [ ] Taking the recommendation or choosing an alternative ends in `/start/<restartId>`, and completing there returns to `/comeback/done`, which shows "Back on Path." and the next planned commitment.
- [ ] On the first comeback the done screen shows the `FIRST_COMEBACK` milestone once and acknowledges it (no duplicate toast on `/progress`).
- [ ] "Review my plan" appears only when the API says `planReviewSuggested` and opens the coach with the "I fell off" prompt.
- [ ] Dismiss (banner or step 1) clears the offer server-side and the banner does not return on refresh.
- [ ] No string in the flow or banner contains overdue / behind / failed / streak / lazy / guilt / catch up.
- [ ] Focus lands on each step's `h1`; the step indicator is readable as text; axe reports zero violations on all three pages.
- [ ] `/comeback` and `/comeback/done` mount no rail, AppBar or BottomNav; `UNOWNED_ROUTES` lists `/comeback`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 409 `NO_COMEBACK_OFFER` handled as "already done" / "nothing to restart"; network errors keep the step and show an `Alert`
- [ ] Observability: n/a (client)
- [ ] Security: ids come from the API only; `sessionStorage` holds the last completion payload (no tokens)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 9–13 at desktop width, then again on a 360×740 viewport (DevTools device toolbar): the three screens are single-column with full-width buttons; the banner sits above the NBA card.
2. On step 3 press browser back → step 2; Start → `/start/<id>` → browser back → Today shows the restart row with **Continue** (E05-05 (#48) behaviour); tap it and finish → `/comeback/done`.
3. Reload `/comeback/done` → same "Back on Path." screen, no second `recovery` evidence (`SELECT count(*) FROM evidence_items WHERE evidence_type='recovery';` → 1).
4. Dismiss from the banner on a fresh offer → `SELECT comeback_state FROM user_profiles;` → `NONE`; the restart row is `CANCELLED`.

#### Out of scope

- The Progress screen (E11-04 (#117)); notification deep links into `/comeback` (E12, N6).
- AI conversation inside the comeback flow — "Review my plan" hands off to the Coach screen.
- Voice or animation beyond MUI transitions; no confetti (PRD §77).

#### Notes for the implementing agent

- Copy the full-screen route placement and page shell from `apps/web/src/pages/StartFlowPage.tsx` (E05-05 (#48)) / `ActivateDevicePage.tsx`; keep the pages outside `Layout` so no nav gate is involved.
- `StartFlowPage`'s `returnTo` must default to `/` so E05's tests and the deep link (`/?commitment=…&action=start`) keep working.
- `useIsMounted` (`apps/web/src/hooks/useIsMounted.ts`) guards async state updates; `useNavigate` with `state` for the return hop and the coach prompt.
- The E11-04 (#117) `useMilestoneToasts` hook must skip a milestone already acknowledged by `ComebackDonePage` — ack before navigating away.
- Keep every user-facing string in `comebackCopy.ts`; the test is the guard the PRD asks for (§56, §129).

---

### E11-06 `test(tests): E11 end-to-end verification` — #121

**Part of epic:** E11 · **Blocked by:** E11-01 (#98), E11-02 (#112), E11-03 (#115), E11-04 (#117), E11-05 (#119), E01-10 (#30) · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → docs-dev

#### Problem statement

PRD §109 is an acceptance list that is only meaningful in a browser against real data: after multiple missed days, overdue items do not flood Today, the user gets a restart experience, prior misses remain evidence, one next action is recommended, and plan review becomes available. PRD §53 requires the momentum formula to be testable and §54 forbids a score. The epic needs Playwright proof of both against the fake OpenAI server (E01-10 (#30)), plus the spec later epics (E12's independence reader, E10's review) will read.

#### Proposed solution

Two Playwright specs with an API seeding helper that uses E11-02 (#112)'s non-production helpers (`simulate-idle`, `jobs/run`), the `docs/specs/momentum-and-recovery.md` document, and the docs/back-link updates.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a. (If `POST /api/auth/test/simulate-idle` or `jobs/run` is missing, this child is blocked on E11-02 (#112), not worked around.)

**UI (frontend-dev)** — add stable `data-testid`s where role/text is ambiguous: `progress-momentum-WORK|FAMILY|HEALTH`, `progress-momentum-state`, `progress-evidence-bullet`, `progress-timeline`, `progress-consistency`, `milestone-toast`, `today-comeback-banner`, `comeback-step-1|2|3`, `comeback-take-recommendation`, `comeback-choose-<DOMAIN>`, `comeback-start`, `comeback-done`, `comeback-next-commitment`.

**Tests (testing-dev)**

`tests/e2e/helpers/progress.helper.ts` (new): `seedRoutinePlan(ctx, { domain, title, minimumMinutes })` (outcome → plan with one routine, returns ids), `seedHistory(ctx, { domain, routineId, planVersionId, days: Array<{ offset: number; outcome: 'complete' | 'complete_min' | 'skip' | 'leave' }> })` (creates commitments at `offset` days ago 09:00 local and drives them with E05-02 (#40) actions), `simulateIdle(request, email, days)` → `POST /api/auth/test/simulate-idle`, `runJob(request, job, email)` → `POST /api/auth/test/jobs/run`, `progress(ctx)` → `GET /api/progress`. `apiContext` and `uniqueEmail` are reused from E02-08 (#62)/E05-07 (#55) helpers.

`tests/e2e/specs/progress.spec.ts` (new; fresh user per test via `loginAsTestUser` with `withAiKey: true`; run with `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`):

1. **Momentum states from seeded evidence** — HEALTH: 6 rows over 3 weeks, 5 completed (one `complete_min`), 1 left; WORK: 6 rows, 3 oldest completed, 3 newest skipped; open `/progress`; `progress-momentum-HEALTH` state text is `Steady` or `Improving` with a bullet matching `/5 of 6 planned (workouts|health commitments) completed/`; `progress-momentum-WORK` reads `Slipping` with `/3 in a row not started/`; `progress-momentum-FAMILY` reads `Not enough data` (the UI word for `INSUFFICIENT_DATA`); `GET /api/progress` agrees on all three states.
2. **No score anywhere** — `expect(await page.locator('body').innerText()).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/)`, `.not.toMatch(/\bscore\b/i)`, `.not.toMatch(/\d+\s*%/)`; repeat on `/progress/timeline` and `/`.
3. **Timeline** — reschedule one WORK row twice (E02-04 (#47) transition) and start the successor; `/progress` Evidence shows "Started … after 2 postponements" with the notable styling and "Completed … — minimum version" for the fallback row; **See all** → `/progress/timeline`; filter Health → only Health rows.
4. **Consistency & recovery** — `progress-consistency` caption matches `/\d+ weeks? building momentum|first successful week/`; recovery card shows "No misses to recover from yet" (nothing MISSED yet); coach dependency shows the "Available once…" copy.
5. **Milestone toast** — seed 10 HEALTH `commitmentType: 'workout'` completions, `runJob('milestones')`, open `/progress` → `milestone-toast` with "10 workouts completed."; close it; reload → no toast; `GET /api/progress/milestones?unacknowledged=true` → `[]`.
6. **axe** — `AxeBuilder` on `/progress` and `/progress/timeline`, both projects: no serious/critical violations.

`tests/e2e/specs/comeback.spec.ts` (new):

1. **Sweep produces no overdue flood** — seed HEALTH routine plan + history (2 completed, 2 `leave`), plus one WORK `leave`; `simulateIdle(email, 4)`; `runJob('comeback')` → response `closedCount 3`, `trigger 'INACTIVITY'`, `comebackState 'OFFERED'`; `GET /api/commitments?from=<40d ago>&to=<start of today>&status=PLANNED,READY` → `[]`; `GET /api/evidence?from&to` count equals the pre-sweep count; open `/` → `today-comeback-banner` visible with "Welcome back. No catching up."; no text matching `/overdue|missed \d/i` on the page; the domain cards list only today's items (the restart row).
2. **Comeback flow to Back on Path** — click **Restart with one thing** → `/comeback`, `comeback-step-1` heading "You're still on the Path." → Continue → `comeback-step-2` shows the Health card with "Recommended" and a Work alternative → `comeback-take-recommendation` → `comeback-step-3` shows the restart title and `/1[0-5] min/` → `comeback-start` → `/start/<id>` → choose the preset matching the restart minutes (or default), Begin → **Done for now** → **Complete** → `/comeback/done` shows "Back on Path." and the `FIRST_COMEBACK` milestone alert "First comeback — you returned."; `GET /api/comeback` → `state 'NONE'`; `GET /api/evidence?…` → newest row `evidenceType 'recovery'`; `GET /api/progress/milestones` → contains `FIRST_COMEBACK` with `acknowledgedAt` set; `/` no longer shows the banner.
3. **Choose a different area** — new user, offer as in 1; step 2 → `comeback-choose-WORK` → step 3 shows the Work routine's minimum; `GET /api/comeback` → `restart.domain 'WORK'`; the previous restart row is `CANCELLED` (`GET /api/commitments?…&status=CANCELLED` → 1).
4. **Plan review suggested** — new user with 5 `leave` rows over 5 days; idle 4; sweep → `GET /api/comeback` `planReviewSuggested true`; after completing the flow, `/comeback/done` shows **Review my plan** → `/coach` with the "I fell off" prompt prefilled.
5. **Dismiss** — new user, offer; banner **Dismiss** → banner gone; reload → still gone; `GET /api/comeback` → `NONE`.
6. **AI down keeps the loop working** — as the admin fixture set `PUT /api/ai-settings { baseUrl: 'http://fake-openai:1/v1' }` (E05-07 (#55)'s technique), run case 1–2 for a fresh user: step 3 title equals the routine's `fallbackBehavior` text; restore in `afterEach`.
7. **Momentum after comeback** — after case 2, `GET /api/progress` → `momentum.HEALTH.state === 'RECOVERING'` with a bullet `/Returned \d+ days? after a miss/`, and `GET /api/today` → `momentum.HEALTH.state 'RECOVERING'`.
8. **axe** on `/comeback` (each step) and `/comeback/done`, both projects.

`tests/e2e/playwright.config.ts`: no change beyond E02-08 (#62)'s (`mobile-chromium` project, fake-provider compose command). Run: `cd tests/e2e && npx playwright test progress.spec.ts comeback.spec.ts`.

**Docs (docs-dev)**

- `docs/specs/momentum-and-recovery.md` (new): purpose and PRD/VISION links (§52–§57, §75–§77, §109, §136; VISION §30–§33, §56); the engine contract and every constant (`WINDOW_DAYS`, `MIN_PLANNED`, `BUILDING_*`, `TREND_DELTA`, `SLIP_CONSECUTIVE_MISSES`, `RECOVERY_*`), the decided/success definitions, the state precedence table, the evidence-bullet templates and the "counts, never a score" rule with the test regexes; consistency-run rules (Monday weeks in user tz, 0.6 threshold, one grace per 4, neutral empty weeks); recovery latency; independence reader contract for E12-06 (#69); comeback triggers, the sweep algorithm (what is closed, what is never touched, STARTED rows), the restart picker rule and clamps, the AI wording contract and banned-word list, the state machine `NONE → OFFERED → IN_PROGRESS → NONE`, `planReviewSuggested` rules; timeline mapping table and milestone rules incl. repeatable sequences and the dormant `REDUCED_REMINDERS`; celebration intensity by significance; the `simulate-idle` decision (data shift vs time travel) and why; rejected alternatives (single score, daily streaks, a new `comebacks` table, AI-chosen momentum states, closing STARTED rows).
- `docs/API.md`: verify "Progress" (`/progress`, `/progress/timeline`, `/progress/milestones`, `ack`), "Comeback" (5 routes) and the two test-auth helpers are complete with examples and error codes (`NO_COMEBACK_OFFER`).
- `docs/TESTING.md`: E2E section — `progress.spec.ts`, `comeback.spec.ts`, the `simulate-idle` / `jobs/run` helpers and their non-production guard, how to run only E11's specs.
- `CLAUDE.md`: "Database Tables" (`milestones`, `user_profiles` comeback columns), endpoints blocks (Progress, Comeback), a "Momentum & recovery" pointer paragraph to the spec (do not restate rules), and the test-auth helper note under Security Guidelines.
- `docs/epics/README.md`: E11 row gets "Verified by `tests/e2e/specs/progress.spec.ts`, `comeback.spec.ts`; spec `docs/specs/momentum-and-recovery.md`". `docs/epics/E11-momentum-progress-recovery.md`: add a "Verification" line under the epic's manual script pointing at the two specs.

#### Acceptance criteria

- [ ] `cd tests/e2e && npx playwright test progress.spec.ts comeback.spec.ts` passes on `chromium` and `mobile-chromium` against `base+dev+fake-openai` compose from a clean database, twice in a row.
- [ ] `progress.spec.ts` proves the three seeded momentum states in the UI and the API agree, and that no page under test renders `N/100`, a percentage, or the word "score".
- [ ] `comeback.spec.ts` case 1 proves the PRD §109 list: no overdue items on Today after the sweep, evidence count unchanged, one restart action offered.
- [ ] Case 2 proves the full loop ends in "Back on Path." with `recovery` evidence and an acknowledged `FIRST_COMEBACK` milestone; case 7 proves momentum reads `RECOVERING` afterwards.
- [ ] Case 6 proves the loop works with the AI base URL unreachable (template wording).
- [ ] `docs/specs/momentum-and-recovery.md` exists, documents every constant and rule listed above, and is linked from `docs/epics/README.md` and `CLAUDE.md`; a Jest test `apps/api/test/docs/momentum-doc.spec.ts` asserts every exported constant name from `momentum-engine.ts`, `consistency-run.ts` and `comeback-detector.ts` appears in the spec.
- [ ] `docs/API.md` covers all 11 E11 routes (4 progress, 5 comeback, 2 test-auth); `docs/TESTING.md` explains the helpers.
- [ ] `npm test` (`apps/api`) and `npm run test:run` (`apps/web`) are green on the epic branch.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: specs use unique users per test, restore AI settings in `afterEach`, and assert through the API with the body printed on mismatch
- [ ] Observability: Playwright HTML report + trace on first retry (existing config)
- [ ] Security: helpers hit only `/api/auth/test/*` routes that are absent in production; fake `sk-test-…` key only
- [ ] Config & secrets: `BASE_URL` respected; no new secrets
- [ ] Tests listed above pass locally (e2e in `tests/e2e`)
- [ ] Docs updated (spec, API.md, TESTING.md, CLAUDE.md, epics README)

#### Manual test script

1. Epic script steps 1–2 (stack up with the fake provider, migrated, seeded).
2. `cd tests/e2e && npm ci && npx playwright install chromium && npx playwright test progress.spec.ts comeback.spec.ts --project=chromium --project=mobile-chromium` → all passed; `npx playwright show-report` → open the `comeback.spec.ts` case 2 trace and confirm the "You're still on the Path." and "Back on Path." screenshots.
3. `cd apps/api && npm test -- momentum-doc` → passes; open `docs/specs/momentum-and-recovery.md` and cross-check the precedence table against `momentum-engine.ts` by eye.
4. Run the epic-level manual verification steps 1–15 once end to end.

#### Out of scope

- Visual pixel baselines for Progress (E11-04 (#117) owns them).
- E12 flows (notification-driven comeback, independence data).
- CI workflow files (declined project-wide; local runs only).

#### Notes for the implementing agent

- Reuse `tests/e2e/helpers/auth.helper.ts` (`withAiKey`, `withOnboarding`) and E05-07 (#55)'s `commitments.helper.ts`; do not fork a login helper.
- Seed through the API, never `psql`, so the specs also exercise E02-04 (#47)/E05-02 (#40) contracts; `simulate-idle` is the only "unnatural" step and it is a documented non-production helper.
- The sweep's day boundary uses the user's profile timezone; set the test user's timezone to `UTC` (E04's `PATCH /me/profile`) so `offset` arithmetic in `seedHistory` is exact.
- Keep timing assertions tolerant (`toPass` polling); the Start flow timer is not under test here.
- The spec file is the last child: if a case fails because an earlier child deviated, fix the child under its own issue and reference it in the commit.

---
