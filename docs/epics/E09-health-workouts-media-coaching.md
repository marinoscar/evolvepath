# E09 — Health Domain: Workout Programs, Runner & Media Coaching

<!-- epic-meta: slug=health-workouts-media-coaching phase=3 -->
<!-- epic-issue: #66 -->

> GitHub epic: [#66](https://github.com/marinoscar/evolvepath/issues/66)

## Epic

### Goal
Make Health a real product capability instead of a chat transcript (VISION §14): the AI drafts a structured, safety-checked workout program the user approves; the program lives in tables, schedules itself onto Today as Health commitments with full/short/minimum versions (VISION §15, PRD §44); a full-screen runner logs sets, weight, reps, RPE and discomfort and works with intermittent connectivity (PRD §41, §121); the next session shows "last time" and a conservative, deterministic progression suggestion the AI only explains (PRD §42); repeated skips or over-long sessions become plan-change proposals the user accepts through E06's mutation protocol (PRD §43, §15); and the E03 media pipeline is put to its intended use — form-check videos, equipment photos, meal photos — with behavior-level nutrition advice and no calorie accounting (VISION §16, PRD §46). Every non-AI path keeps working when the provider is down (PRD §120). PRD §106 is the acceptance list this epic satisfies.

### Background
Codebase facts this epic builds on (verified 2026-09-04):

- **Existing `apps/api/src/health/`** is the liveness/readiness probe module (`GET /api/health/live|ready`, public, OpenAPI tag `Health`). Product code for the Health domain must **not** go there: workouts live in `apps/api/src/workouts/` (new) and body weight / nutrition in `apps/api/src/health-domain/` (new). The URL prefix `/api/health/weight` is served by a second controller with `@Controller('health/weight')`; NestJS allows it, and the probe controller keeps its `@Public()` routes untouched.
- **E02** domain model: `Outcome` (domain `WORK|FAMILY|HEALTH`), `Plan`/`PlanVersion` (version, status, `userApproved`, `createdBy USER|AI`, `previousVersionId`), `Routine`, `Commitment` (status `PLANNED, READY, STARTED, COMPLETED, PARTIALLY_COMPLETED, RESCHEDULED, SKIPPED, MISSED, CANCELLED`; `fullVersion`/`shortVersion`/`minimumVersion`; `rescheduleCount`; `skipReason`), `Evidence` (source `USER_LOG|TIMER|WORKOUT_LOG|APP_FLOW`), `DomainMode`. The commitments module `apps/api/src/commitments/` (E02-04 (#47)) owns `POST /commitments` and `POST /commitments/:id/transition`.
- **E05-02 (#40)** intent-named actions `POST /commitments/:id/actions/{start,pause,continue,complete,partial,fallback,reschedule,skip}` in `CommitmentActionsService`; every method loads `where: {id, userId}` and throws `NotFoundException` (404, never 403). E09-03 (#81) calls these (not the matrix) so evidence and audit stay in one place. **E05-05 (#48)** `/start/:commitmentId` is the model for a full-screen route inside `ProtectedRoute` but outside `Layout`; `'/start'` is in `UNOWNED_ROUTES` (`apps/web/src/config/destinations.ts`). **E05-06 (#52)** `QuickAddSheet` renders a disabled **Workout** button ("Coming with workout programs") — E09-09 (#111) enables it and adds **Meal check**.
- **E04-01 (#100)** `user_profiles.healthBaseline Json?` validated by `healthBaselineSchema = { experience NONE|BEGINNER|INTERMEDIATE|ADVANCED, daysPerWeek 1–7, minutesPerSession 10–120, equipment string[], preferences?, limitations? }`. **Decision:** the baseline stays on the profile as JSON; E09 adds no `HealthBaseline` table. The program builder reads it as defaults and the safety rules read `limitations`.
- **E01** gateway: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, attachments?, schema, schemaName})` → `{ok:true, output}` | `{ok:false, error:{code,message}}`; never throws for provider problems. Personas used here: `workout_programmer` (program generation), `coach` (explains a deterministic progression), `media_analyst` (vision; the only persona that accepts `attachments`). Fake OpenAI server: `tools/fake-openai/server.mjs`, fixtures in `tools/fake-openai/fixtures/`, `infra/compose/fake-openai.compose.yml`, `x-fake-behaviour` header.
- **E03** media: `MediaAttachment` (`purpose WORKOUT_FORM|EQUIPMENT|MEAL|GENERAL`, polymorphic `targetType`/`targetId`, `aiSummary Json?`), `MEDIA_TARGET_TYPES` already includes `'workout_session'`, `MediaAttachmentsService.getOwned(id, userId)`, `processingStatus`, `POST /media/attachments/:id/ask` and `AskAboutMediaDialog`/`MediaAdviceCard`. Videos expand to frames from `metadata._processing['video-frames'].frames[{objectId,timestampMs}]`; `MediaAttachmentPicker` props `{ purpose, targetType?, targetId?, maxFiles?, onAttached, disabled? }` with `capture="environment"` below `sm`. E09-06 (#92) adds purpose-specific prompts and contracts on top of the same attachment.
- **E06**: `PlanChangeProposal` (E06-01 (#61); structured diff JSON, status `PROPOSED|ACCEPTED|EDITED|REJECTED`, reason, `appliedPlanVersionId`), `POST /proposals/:id/accept|edit|reject` (E06-04 (#76)), `ProposalsService.createFromSource(userId, sourceKind, …)` and the `PlanChange` diff shape `{ op: move|reduce|replace|add|remove|pause, target: {type: 'routine'|'commitment', id}, before, after (routine snapshots), reason }` applied by the pure `applyChanges` (E06-04 (#76), `apps/api/src/coach/proposals/`), and `SafetyPolicyService.evaluate({ userId, text, surface })` → `SafetyDecision { decision: 'allow'|'conservative'|'redirect', category, userFacingNote? }` (E06-06 (#82), `apps/api/src/coach/safety/`, exported by `SafetyModule`). E09 creates proposals through that service and runs the safety evaluation before every AI call over user free text; it never applies a plan change itself.
- Shell: `apps/web/src/components/common/Layout.tsx` (rail at `up('sm')`, `<main>` `pb: { xs: 10, sm: 3 }`), `apps/web/src/components/navigation/BottomNav.tsx` (`down('sm')`), `App.tsx` route tree. **None of the five coupled breakpoint gates is touched by this epic**; the runner is full-screen by being a route outside `Layout`, exactly like `/activate` and `/start/:id`.
- Patterns to copy: `apps/api/src/pat/pat.controller.ts` (`@Auth()` + ownership service + `ParseUUIDPipe` + `nestjs-zod`), `apps/api/src/email/email-settings.service.ts` (audit via `prisma.auditEvent.create`), `apps/api/src/openapi/tags.ts` (declare every `@ApiTags`), `apps/api/src/storage/tasks/storage-cleanup.task.ts` (`@Cron`), `apps/api/src/common/decorators/trace.decorator.ts` (`@Trace`), `apps/api/test/helpers/test-app.helper.ts` (`createTestApp` + `overrideProviders`), `apps/api/test/mocks/prisma.mock.ts` (`createMockPrismaService`), `apps/web/src/__tests__/mocks/handlers.ts` (MSW), `tests/e2e/helpers/auth.helper.ts` (`loginAsTestUser` + `withAiKey`), `tests/e2e/helpers/media.helper.ts` (E03-08 (#103) `uploadViaPicker`).
- Chart guidance: no chart library is installed in `apps/web` and the repo docs carry no dataviz guidance, so E09-10 (#113) fixes the rule itself — **trend line only, no daily judgment copy, accessible colors, meaning never carried by color alone** (PRD §47).
- No new permissions. Every endpoint here is a per-user resource (`@Auth()` + ownership by `userId`, 404 for foreign ids). The exercise catalog is readable by every signed-in user; custom exercises are per user.

Specs this epic produces: `docs/specs/health-domain.md` (E09-11 (#114)). Specs it reads: `docs/specs/domain-model.md` (E02-08 (#62)), `docs/specs/today-and-nba.md` (E05-07 (#55)), `docs/specs/media-attachments.md` (E03-08 (#103)), `docs/specs/ai-gateway.md` (E01-12 (#32)).

### Scope
- [ ] #72 feat(db): add workout schema and starter exercise catalog (E09-01)
- [ ] #77 feat(api): add AI workout program builder with safety validation and approval (E09-02)
- [ ] #81 feat(api): add workout session runner endpoints with idempotent set logging (E09-03)
- [ ] #85 feat(api): add deterministic double-progression rules with AI explanation (E09-04)
- [ ] #88 feat(api): add workout adaptation detector producing plan-change proposals (E09-05)
- [ ] #92 feat(api): add form-check, equipment-check and meal-check media coaching (E09-06)
- [ ] #95 feat(web): add program builder wizard and program views (E09-07)
- [ ] #109 feat(web): add full-screen workout runner with rest timer and offline set queue (E09-08)
- [ ] #111 feat(web): add health media flows from the runner, builder and quick add (E09-09)
- [ ] #113 feat(api): add nutrition behavior templates and body-weight trend (E09-10)
- [ ] #114 test(tests): E09 end-to-end verification (E09-11)

### Out of scope
- Wearables, step counting, heart rate, smart scales (PRD §100; VISION §13).
- Calorie, macro or food-database features; meal photos yield behavior-level advice only (PRD §46, VISION §16).
- Periodization beyond double progression, 1RM calculators, deload automation (PRD §42: "conservative deterministic rules").
- Exercise demonstration media (`media_reference_future`, PRD §39) — the catalog carries `instructions` text only.
- Weekly review of health data and domain-mode changes (E10); momentum states (E11); workout notifications (E12) — E09 emits nothing they cannot read from `workout_sessions`, `set_logs` and `evidence`.
- Coach chat about workouts in free text (E06-07 (#86) mounts the picker; E09-06 (#92) exposes typed endpoints instead of prompts).
- Rescheduling logic and the family/work runners — E05's generic actions and timer remain for non-workout Health commitments (walks, meal prep).

### Sequencing
- **E09-01 (#72)** first (schema + seed); everything else reads it.
- **E09-02 (#77)**, **E09-03 (#81)**, **E09-10 (#113)** are API-only and independent of each other after E09-01 (#72); run in parallel. E09-02 (#77) needs E06-06 (#82) (safety pre-check) and E02-03 (#42) (plan versions); E09-03 (#81) needs E05-02 (#40) (actions).
- **E09-04 (#85)** depends on E09-03 (#81) (session history); **E09-05 (#88)** depends on E09-03 (#81) and E06-01 (#61)/E06-04 (#76); **E09-06 (#92)** depends on E09-03 (#81) and E03-04 (#83)/E03-06 (#91) (attachments) and E01-06 (#26) (resolver).
- **E09-07 (#95)** depends on E09-02 (#77); **E09-08 (#109)** depends on E09-03 (#81) + E09-04 (#85) (it renders the suggestion); **E09-09 (#111)** depends on E09-06 (#92), E09-07 (#95), E09-08 (#109) and E05-06 (#52) (quick add).
- **E09-11 (#114)** last; needs E01-10 (#30) (fake server) and E03-08 (#103) (media fixtures + helper).
- Critical path: E09-01 (#72) → E09-03 (#81) → E09-04 (#85) → E09-08 (#109) → E09-09 (#111) → E09-11 (#114).

### Manual end-to-end verification
Prerequisites: E01–E06 merged. Run from a clean clone.

1. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`, and the MinIO block from E03 (`S3_ENDPOINT=http://minio:9000`, `S3_BUCKET=evolvepath-dev`, `AWS_ACCESS_KEY_ID=minioadmin`, `AWS_SECRET_ACCESS_KEY=minioadmin`, `S3_FORCE_PATH_STYLE=true`).
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f minio.compose.yml -f fake-openai.compose.yml up --build`. In another shell: `docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:migrate && docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:seed`. Seed log shows `✓ Seeded 44 exercises`.
3. `docker compose … exec postgres psql -U postgres -d appdb -c "select substitution_group, count(*) from exercises where is_custom = false group by 1 order by 1;"` → 10 groups, 44 rows.
4. Open http://localhost:3535/testing/login; sign in as `health@test.local`, role `contributor`, **with AI key** (E01-10 (#30) `withAiKey`). Complete onboarding (E04) selecting Health, Beginner, 3 days, 40 min, equipment "Dumbbells", "Gym". Land on `/`.
5. Open http://localhost:3535/health/programs → empty state "No program yet" → **Build a program**. The wizard is prefilled from the baseline (Beginner · 3 days · 40 min · Dumbbells, Gym). Goal "Get stronger and look better", limitations blank → **Generate**. Observe a spinner "Building your program…" then a review screen: program name, 3 weekdays, per-template tables (Exercise / Sets / Target, as VISION §14's Upper A) with **Full / Short / Minimum** tabs, a substitutions list and a rationale paragraph.
6. `psql -c "select name, status, duration_weeks from workout_programs;"` → one `DRAFT` row. `select count(*) from commitments where domain='HEALTH' and workout_template_id is not null;` → `0` (nothing scheduled before approval).
7. Click **Approve**. `select status, plan_id from workout_programs;` → `ACTIVE` with a plan id; `select version, status, created_by, user_approved from plan_versions where plan_id='<plan_id>' order by version;` → latest row `AI`, `true`; `select count(*) from commitments where workout_template_id is not null;` → 6 (3 days × 2 weeks). Audit: `select action from audit_events where action like 'workout_program:%' order by created_at;` → `generate`, `approve`.
8. Open `/` (set one commitment's `scheduled_start` to now via psql if today is not a training day). The Health card shows **Upper A · 40 min** with **Start workout**. Tap it → `/workout/<sessionId>` full-screen: no AppBar, rail or bottom bar; header "Upper A · Workout 1 of 18"; first exercise "Dumbbell Bench Press" with "Last time: —" and set 1 inputs (weight kg, reps, RPE optional, discomfort segmented None / Mild / Sharp pain).
9. Enter 20 kg × 12, **Complete set** → a rest timer "Rest 90 s" counts down; switch to another tab for 20 s and back — the timer reflects real elapsed time. Log sets 2 and 3 (12, 12, RPE 7). Stop the `api` container (`docker compose stop api`), log set 1 of the next exercise → row shows a "Saved on this device" badge; start `api` again → badge clears within 5 s. `select exercise_id, set_number, weight_kg, reps, client_id from set_logs order by logged_at;` → 4 rows, no duplicates.
10. Tap **Use short version** → the exercise list collapses to the SHORT template; **Finish workout** → summary "5 sets · 720 kg volume" → back on `/`, the row is completed. `select status, variant, discomfort_flag from workout_sessions;` → `COMPLETED`, `SHORT`, `false`. `select source, type, quantitative_value from evidence where commitment_id='<id>' order by created_at;` includes `WORKOUT_LOG workout_completed {sets:5, volumeKg:720, minutes:…}`. Commitment status `PARTIALLY_COMPLETED` (short version) — start another session on the same template with full sets and confirm `COMPLETED`.
11. Complete a second Upper A session logging 3 × 12 at RPE ≤ 8 on Dumbbell Bench Press. Start a third: the exercise shows "Last time: 20 kg × 12, 12, 12" and a chip **Suggest 22.5 kg** with an explanation line ("Two sessions at the top of the range and comfortable — a small increase"). `curl …/api/workouts/sessions/<id> | jq '.data.exercises[0].progression'` → `{ action: "increase", suggestedWeightKg: 22.5, … }`.
12. On a set, choose **Sharp pain** → the app shows the safety card (PRD §45 copy: stop, do not push through sharp pain, consider professional evaluation) with **Stop this exercise** / **End workout**; no programming advice. `select discomfort_flag from workout_sessions where id='<id>';` → `true`.
13. During a session tap **Check my form** → on a phone the camera opens (`capture="environment"`); on desktop pick `tests/e2e/fixtures/media/clip.mp4`. "Processing…" → "Ready" → **Ask** → observations, cues and (from the fake fixture) a risk flag rendered as a warning. `select purpose, target_type, ai_summary->>'kind' from media_attachments order by created_at desc limit 1;` → `WORKOUT_FORM`, `workout_session`, `form_check`. `select persona, status, attachment_count from ai_invocations order by created_at desc limit 1;` → `media_analyst`, `succeeded`, `4`.
14. From `/health/programs/new` step "Equipment" tap **Photograph your equipment**, upload `photo.jpg` → chips of detected equipment and a substitution list ("Lat Pulldown → Band Pulldown: no cable machine visible").
15. On `/` tap `+` → **Meal check** → upload `photo.jpg` → advice card with observations and behavior suggestions; the text contains no "kcal", "calories", "grams of protein". `ai_summary->>'kind'` = `meal_check`.
16. `/health` → **Log weight** 82.4 → repeat for a few dates with the date picker → the 30-day chart shows muted points and one rolling-7-day line, a caption "7-day trend: −0.3 kg", no per-day red/green. `select date_local, weight_kg from body_weight_logs order by date_local;`.
17. Adaptation: `psql -c "update commitments set status='SKIPPED', skip_reason='NO_TIME' where workout_template_id='<upperA>' and status='PLANNED';"` for two rows, then `curl -X POST …/api/workouts/adaptation/run` → `{ created: 1 }`. `select source_kind, status, changes->0->>'op' as op, changes->0->'after'->>'estimatedDurationMinutes' as after_min from plan_change_proposals order by created_at desc limit 1;` → `WORKOUT`, `PROPOSED`, `reduce`, `25`. Open `/coach` → the proposal card → **Accept** → `select version from plan_versions where plan_id='<plan_id>' order by version desc limit 1;` incremented; `select target_minutes from workout_templates where id='<upperA>';` → 25.
18. Stop `fake-openai`; repeat step 5 → "The coach is unavailable — start from a starter template" with a **Use starter template** button that yields a 3-day full-body draft; steps 8–10 still work.
19. `cd tests/e2e && npx playwright test specs/health.spec.ts` passes (E09-11 (#114)).

## Child issues

### E09-01 `feat(db): add workout schema and starter exercise catalog` — #72

**Part of epic:** E09 · **Blocked by:** E02-01 (#36), E04-01 (#100) · **Component:** database · **Priority:** P0 · **Agents:** database-dev → testing-dev → docs-dev

#### Problem statement
PRD §38 requires workout plans to be stored structurally, §39 fixes the exercise object, §40 the template, §41–§42 imply per-set history, §47 an optional weight log. Nothing in `apps/api/prisma/schema.prisma` models any of it, and there is no exercise catalog for the builder to resolve names against (PRD §37 "substitutions"). VISION §52 lists Workout Program, Workout, Exercise and Workout Session as core persistent objects.

#### Proposed solution
Eight Prisma models, the enums below, a `Commitment` link column, migration `add_workouts`, and a seed of 44 catalog exercises grouped by `substitutionGroup`.

**Data (database-dev)** — append to `apps/api/prisma/schema.prisma`:

```prisma
enum Equipment { BODYWEIGHT DUMBBELL BARBELL MACHINE CABLE KETTLEBELL BAND BENCH }
enum MovementPattern { PUSH_H PUSH_V PULL_H PULL_V SQUAT HINGE LUNGE CARRY CORE ACCESSORY }
enum ProgressionMethod { DOUBLE_PROGRESSION }
enum WorkoutProgramStatus { DRAFT ACTIVE ARCHIVED }
enum WorkoutVariant { FULL SHORT MINIMUM }
enum WorkoutSessionStatus { IN_PROGRESS COMPLETED ABANDONED }
enum Discomfort { NONE MILD SHARP_PAIN }

model Exercise {
  id                   String            @id @default(uuid()) @db.Uuid
  name                 String
  nameKey              String            @map("name_key")        // lower(trim(name)), set by the service
  scope                String            @default("catalog")     // 'catalog' or the creating user's id
  equipment            Equipment[]
  movementPattern      MovementPattern   @map("movement_pattern")
  instructions         String            @db.Text
  contraindicationTags String[]          @map("contraindication_tags")
  substitutionGroup    String            @map("substitution_group")
  isCustom             Boolean           @default(false) @map("is_custom")
  createdByUserId      String?           @map("created_by_user_id") @db.Uuid
  createdAt            DateTime          @default(now()) @map("created_at") @db.Timestamptz
  createdBy            User?             @relation("UserCustomExercises", fields: [createdByUserId], references: [id], onDelete: SetNull)
  templateExercises    WorkoutTemplateExercise[]
  setLogs              SetLog[]
  @@unique([scope, nameKey])
  @@index([substitutionGroup])
  @@map("exercises")
}

model WorkoutProgram {
  id                String               @id @default(uuid()) @db.Uuid
  userId            String               @map("user_id") @db.Uuid
  name              String
  durationWeeks     Int                  @map("duration_weeks")
  weeklyStructure   Json                 @map("weekly_structure")  // [{ weekday: 0-6, templateId }]
  progressionMethod ProgressionMethod    @default(DOUBLE_PROGRESSION) @map("progression_method")
  status            WorkoutProgramStatus @default(DRAFT)
  planId            String?              @map("plan_id") @db.Uuid   // E02 Plan of the Health outcome; set at approve
  generationInput   Json?                @map("generation_input")   // the validated builder request (E09-02 (#77))
  rationale         String?              @db.Text
  substitutions     Json?                                           // [{ exerciseId, alternativeExerciseIds[] }]
  createdAt         DateTime             @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime             @updatedAt @map("updated_at") @db.Timestamptz
  user              User                 @relation("UserWorkoutPrograms", fields: [userId], references: [id], onDelete: Cascade)
  plan              Plan?                @relation(fields: [planId], references: [id], onDelete: SetNull)
  templates         WorkoutTemplate[]
  @@index([userId, status])
  @@map("workout_programs")
}

model WorkoutTemplate {
  id                   String          @id @default(uuid()) @db.Uuid
  programId            String          @map("program_id") @db.Uuid
  name                 String
  variant              WorkoutVariant
  targetMinutes        Int             @map("target_minutes")
  fallbackOfTemplateId String?         @map("fallback_of_template_id") @db.Uuid  // SHORT/MINIMUM point at their FULL sibling
  routineId            String?         @unique @map("routine_id") @db.Uuid         // E02 Routine created at approve (FULL templates only); E06 proposals target it
  program              WorkoutProgram  @relation(fields: [programId], references: [id], onDelete: Cascade)
  routine              Routine?        @relation(fields: [routineId], references: [id], onDelete: SetNull)
  fallbackOf           WorkoutTemplate?  @relation("TemplateFallbacks", fields: [fallbackOfTemplateId], references: [id], onDelete: Cascade)
  fallbacks            WorkoutTemplate[] @relation("TemplateFallbacks")
  exercises            WorkoutTemplateExercise[]
  sessions             WorkoutSession[]
  commitments          Commitment[]
  @@unique([programId, name, variant])
  @@map("workout_templates")
}

model WorkoutTemplateExercise {
  id          String          @id @default(uuid()) @db.Uuid
  templateId  String          @map("template_id") @db.Uuid
  exerciseId  String          @map("exercise_id") @db.Uuid
  order       Int
  sets        Int
  repMin      Int             @map("rep_min")
  repMax      Int             @map("rep_max")
  restSeconds Int             @map("rest_seconds")
  notes       String?
  template    WorkoutTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  exercise    Exercise        @relation(fields: [exerciseId], references: [id], onDelete: Restrict)
  @@unique([templateId, order])
  @@map("workout_template_exercises")
}

model WorkoutSession {
  id             String               @id @default(uuid()) @db.Uuid
  userId         String               @map("user_id") @db.Uuid
  commitmentId   String?              @unique @map("commitment_id") @db.Uuid
  templateId     String               @map("template_id") @db.Uuid
  variant        WorkoutVariant
  startedAt      DateTime             @map("started_at") @db.Timestamptz
  finishedAt     DateTime?            @map("finished_at") @db.Timestamptz
  status         WorkoutSessionStatus @default(IN_PROGRESS)
  discomfortFlag Boolean              @default(false) @map("discomfort_flag")
  user           User                 @relation("UserWorkoutSessions", fields: [userId], references: [id], onDelete: Cascade)
  commitment     Commitment?          @relation(fields: [commitmentId], references: [id], onDelete: SetNull)
  template       WorkoutTemplate      @relation(fields: [templateId], references: [id], onDelete: Cascade)
  setLogs        SetLog[]
  @@index([userId, templateId, status, startedAt])
  @@map("workout_sessions")
}

model SetLog {
  id         String         @id @default(uuid()) @db.Uuid
  sessionId  String         @map("session_id") @db.Uuid
  exerciseId String         @map("exercise_id") @db.Uuid
  setNumber  Int            @map("set_number")
  weightKg   Decimal?       @map("weight_kg") @db.Decimal(6, 2)
  reps       Int
  rpe        Int?                                  // 1–10, validated at the API boundary
  discomfort Discomfort     @default(NONE)
  loggedAt   DateTime       @map("logged_at") @db.Timestamptz
  clientId   String         @unique @map("client_id")   // UUID minted by the client; offline replay idempotency
  session    WorkoutSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  exercise   Exercise       @relation(fields: [exerciseId], references: [id], onDelete: Restrict)
  @@unique([sessionId, exerciseId, setNumber])
  @@map("set_logs")
}

model BodyWeightLog {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  dateLocal String   @map("date_local")           // YYYY-MM-DD in the user's timezone
  weightKg  Decimal  @map("weight_kg") @db.Decimal(5, 2)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz
  user      User     @relation("UserBodyWeightLogs", fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, dateLocal])
  @@map("body_weight_logs")
}
```

Also: `Commitment` gains `workoutTemplateId String? @map("workout_template_id") @db.Uuid` (relation `WorkoutTemplate`, `onDelete: SetNull`) and `workoutSession WorkoutSession?`; `Plan` gains `workoutPrograms WorkoutProgram[]`; `Routine` gains `workoutTemplate WorkoutTemplate?`; `User` gains `customExercises Exercise[] @relation("UserCustomExercises")`, `workoutPrograms WorkoutProgram[] @relation("UserWorkoutPrograms")`, `workoutSessions WorkoutSession[] @relation("UserWorkoutSessions")`, `bodyWeightLogs BodyWeightLog[] @relation("UserBodyWeightLogs")`. **`HealthBaseline` decision:** no table — it stays as `user_profiles.health_baseline` JSON (E04-01 (#100) `healthBaselineSchema`); E09-10 (#113) extends that Zod schema with `nutritionBehaviors?`. Migration: `cd apps/api && npm run prisma:migrate:dev -- --name add_workouts`.

Seed (`apps/api/prisma/seed.ts`): add `EXERCISES` const and `seedExercises()` (upsert on `scope_nameKey` with `scope: 'catalog'`), called in `main()` after `seedInitialAdminAllowlist()`; log `✓ Seeded ${EXERCISES.length} exercises`. Every row has one-paragraph `instructions` and `contraindicationTags` from the fixed vocabulary `['shoulder','knee','lower_back','wrist','hip','elbow','neck','overhead']`. The 44 catalog exercises by `substitutionGroup`:

- `horizontal_push`: Barbell Bench Press, Dumbbell Bench Press, Incline Dumbbell Press, Machine Chest Press, Push-Up
- `vertical_push`: Barbell Overhead Press, Dumbbell Shoulder Press, Machine Shoulder Press, Pike Push-Up
- `horizontal_pull`: Seated Cable Row, Dumbbell Row, Barbell Row, Inverted Row, Band Row
- `vertical_pull`: Lat Pulldown, Pull-Up, Assisted Pull-Up, Band Pulldown
- `squat`: Goblet Squat, Barbell Back Squat, Leg Press, Hack Squat, Bodyweight Squat
- `hinge`: Barbell Romanian Deadlift, Dumbbell Romanian Deadlift, Trap Bar Deadlift, Kettlebell Swing, Glute Bridge, Machine Leg Curl
- `lunge`: Walking Lunge, Reverse Lunge, Bulgarian Split Squat, Step-Up
- `carry`: Farmer's Carry, Suitcase Carry
- `core`: Plank, Side Plank, Dead Bug, Cable Pallof Press, Hanging Knee Raise
- `arms`: Triceps Pressdown, Dumbbell Overhead Triceps Extension, Dumbbell Curl, Band Curl (movementPattern `ACCESSORY`)

**API (backend-dev)** — n/a here beyond `npm run prisma:generate`. `Decimal` columns are serialized as strings by Prisma; E09-03 (#81)'s DTOs convert to numbers.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)** — `apps/api/test/integration/workouts-schema.integration.spec.ts` (new, real test DB as the other `*.integration.spec.ts` under `test/integration/` do): migration applies on a clean DB; `seedExercises` is idempotent (run twice → 44 rows); `@@unique([scope, nameKey])` rejects a duplicate catalog name and accepts the same name under a user scope; `SetLog.clientId` unique violation returns `P2002`; deleting a `WorkoutProgram` cascades templates, template exercises and sessions; deleting a `User` cascades programs and weight logs and nulls `exercises.created_by_user_id`; deleting an `Exercise` referenced by a template is rejected (`Restrict`).

**Docs (docs-dev)** — `CLAUDE.md` "Database Tables": add `exercises`, `workout_programs`, `workout_templates`, `workout_template_exercises`, `workout_sessions`, `set_logs`, `body_weight_logs`. `docs/specs/health-domain.md` (E09-11 (#114)) "Data model" section.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database creates the seven tables and seven enums named above
- [ ] `npm run prisma:seed` inserts exactly 44 catalog exercises (`is_custom = false`, `scope = 'catalog'`) across 10 substitution groups and is idempotent
- [ ] Every seeded exercise has non-empty `instructions`, ≥ 1 `equipment` value and a `movement_pattern`
- [ ] `commitments.workout_template_id` and `workout_templates.routine_id` exist, nullable, `ON DELETE SET NULL`
- [ ] `set_logs.client_id` is unique and `(session_id, exercise_id, set_number)` is unique
- [ ] `body_weight_logs (user_id, date_local)` is unique
- [ ] `Equipment`, `MovementPattern`, `WorkoutVariant`, `Discomfort` are importable from `@prisma/client`

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (column names, enums, cascades)
- [ ] Error handling: seed aborts with a non-zero exit on a failed upsert; unique violations surface as `P2002` for the API layer to map
- [ ] Observability: seed logs the exercise count
- [ ] Security: every product table carries `user_id` with `onDelete: Cascade`; `exercises` is the only shared table and its custom rows carry `created_by_user_id`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–3.
2. `psql -c "\d set_logs"` → `client_id` unique index and the composite unique index present.
3. `psql -c "select name, equipment, movement_pattern from exercises where substitution_group='vertical_pull' order by name;"` → 4 rows including `Band Pulldown {BAND} PULL_V`.

#### Out of scope
- Exercise media, translations, per-user catalog editing UI (E09-07 (#95) lists the catalog read-only).
- Any endpoint (E09-02 (#77)/E09-03 (#81)).

#### Notes for the implementing agent
- `ACCESSORY` is a deliberate addition to the movement-pattern enum so VISION §14's Upper A example (Triceps Pressdown, Dumbbell Curl) seeds without mislabeling; keep the other nine values exactly.
- `nameKey` is computed by the service (`name.trim().toLowerCase().replace(/\s+/g, ' ')`) and in the seed; there is no DB generated column so the migration stays portable.
- Use `npm run prisma:migrate:dev -- --name add_workouts`, never bare `npx prisma`. Follow the existing `@map` snake_case convention and `@db.Timestamptz`.
- `weeklyStructure`, `substitutions`, `generationInput` are JSON typed by Zod in `apps/api/src/workouts/programs/workout-program.schema.ts` (E09-02 (#77)); do not add Prisma-level typing.

---

### E09-02 `feat(api): add AI workout program builder with safety validation and approval` — #77

**Part of epic:** E09 · **Blocked by:** E09-01 (#72), E02-03 (#42), E06-06 (#82) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §37 fixes the builder's inputs (goal, experience, days/week, time/session, equipment, preferences, limitations) and outputs (name, weekly structure, workouts, exercises, sets, rep ranges, rest, progression method, substitutions, full/short/minimum versions). PRD §14.5 says the Workout Programming Reasoner "must operate inside safety rules"; PRD §15 says AI output becomes a plan only after user approval; PRD §120 says the product must not be load-bearing on model availability. VISION §14: "the plan should exist outside the conversation." No `workout_programmer` call site exists.

#### Proposed solution
A `WorkoutsModule` with a program service that runs safety pre-check → gateway call with a strict Zod contract → deterministic post-validation (catalog resolution, safety rules, time budget) → `DRAFT` program rows; an approve endpoint that activates the program, links it to the Health outcome's plan as a new user-approved `PlanVersion`, and schedules the first two weeks of commitments; and a deterministic 3-day full-body starter template for when the AI is unavailable or its output is rejected.

**Data (database-dev)** — n/a (E09-01 (#72)). Reads `user_profiles.health_baseline`, `outcomes`, `plans`, `plan_versions`.

**API (backend-dev)** — `apps/api/src/workouts/` (new): `workouts.module.ts` (imports `PrismaModule`, `AiModule`, `CoachModule` for the E06-06 (#82) safety service, `PlansModule` (E02-03 (#42)), `CommitmentsModule` (E02-04 (#47)/E05-02 (#40)), `MediaModule`, `NotificationsModule`; exports `WorkoutProgramsService`, `WorkoutSessionsService`; registered in `app.module.ts` after `TodayModule`), `programs/workout-programs.controller.ts` (`@ApiTags('Workouts')`, `@Controller('workouts/programs')`), `programs/workout-programs.service.ts`, `programs/workout-program-generator.service.ts` (prompt + gateway + validation), `programs/workout-program.schema.ts` (Zod contract, `PROGRAM_PROMPT_VERSION = 'workout_programmer.v1'`), `programs/workout-program-rules.ts` (pure safety/budget rules), `programs/starter-program.ts` (pure template), `exercises/exercise-resolver.service.ts` (fuzzy catalog match), `exercises/exercises.controller.ts` (`GET /workouts/exercises`), `dto/*.dto.ts` via `createZodDto`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/workouts/exercises` | `@Auth()` | query `q?`, `group?` | 200 `{ items: ExerciseDto[] }` — catalog rows plus the caller's custom rows |
| POST | `/api/workouts/programs/generate` | `@Auth()` | `GenerateProgramRequest` (below) | 201 `{ program: WorkoutProgramDto, source: 'ai' }`; 200 `{ program, source: 'starter', reason: 'invalid_output' \| 'ai_unavailable' \| 'safety_redirect', message }` when the AI result is rejected or unavailable (starter is **not** persisted until `approve`… see semantics); 412 `AI_KEY_REQUIRED`; 400 on schema errors |
| GET | `/api/workouts/programs` | `@Auth()` | `status?` | 200 `{ items: WorkoutProgramSummaryDto[] }` |
| GET | `/api/workouts/programs/:id` | `@Auth()`, owner | — | 200 `WorkoutProgramDto` (templates with exercises, grouped FULL→SHORT→MINIMUM) |
| POST | `/api/workouts/programs/:id/approve` | `@Auth()`, owner | `{ preferredTime?: "HH:MM" (default 07:00), startDate?: YYYY-MM-DD (default tomorrow) }` | 200 `{ program, planVersionId, commitmentIds[] }`; 409 if not `DRAFT` |
| POST | `/api/workouts/programs/:id/archive` | `@Auth()`, owner | — | 200; cancels future PLANNED commitments of its templates |
| DELETE | `/api/workouts/programs/:id` | `@Auth()`, owner | — | 204 only for `DRAFT` |

`GenerateProgramRequest` (`dto/generate-program.dto.ts`): `{ goal: string 3..200, experience: 'BEGINNER'|'INTERMEDIATE', daysPerWeek: int 2..5, minutesPerSession: int 20..75, equipment: Equipment[] (non-empty), preferences?: string ≤ 500, limitations?: string ≤ 500, useStarter?: boolean }`. Defaults for the wizard come from `user_profiles.health_baseline` (mapped by the client; the API does not merge).

Zod contract (`workout-program.schema.ts`, also the gateway `schema`, `schemaName: 'workout_program'`):

```ts
export const workoutProgramProposalSchema = z.object({
  programName: z.string().min(3).max(80),
  durationWeeks: z.number().int().min(4).max(12),
  weeklyStructure: z.array(z.object({ weekday: z.number().int().min(0).max(6), templateName: z.string() })).min(2).max(5),
  templates: z.array(z.object({
    name: z.string(), variant: z.enum(['FULL','SHORT','MINIMUM']), targetMinutes: z.number().int().min(8).max(90),
    exercises: z.array(z.object({ exerciseName: z.string(), sets: z.number().int().min(1).max(6), repMin: z.number().int().min(1).max(30), repMax: z.number().int().min(1).max(30), restSeconds: z.number().int().min(30).max(240), notes: z.string().max(200).optional() })).min(1).max(10),
  })).min(3),
  progressionMethod: z.literal('DOUBLE_PROGRESSION'),
  substitutions: z.array(z.object({ exerciseName: z.string(), alternatives: z.array(z.string()).min(1).max(3) })),
  rationale: z.string().max(1200),
}).superRefine(/* every FULL template has a SHORT and a MINIMUM with the same name; every weeklyStructure.templateName is a FULL template; weekdays unique; repMin ≤ repMax */);
```

Generation (`WorkoutProgramGeneratorService.generate(userId, req)`):
1. `SafetyPolicyService.evaluate({ userId, text: [goal, preferences, limitations].join('\n'), surface: 'workout_programmer' })` (E06-06 (#82)). `redirect` → return `{ source: 'starter', reason: 'safety_redirect', message: decision.userFacingNote }` and audit; `conservative` → append `SAFETY_CONSERVATIVE_INSTRUCTIONS` (E06-06 (#82) `safety-copy.ts`) plus "prefer machine and bodyweight variants, lower volume by a third"; pass `safetyDecision` to `invoke` so it lands on the `ai_invocations` row.
2. `ai.invoke({ persona: 'workout_programmer', userId, promptVersion: PROGRAM_PROMPT_VERSION, instructions: PROGRAM_INSTRUCTIONS, input: { request: req, catalog: names + substitutionGroup of catalog exercises filtered to req.equipment (+ BODYWEIGHT), rules: { maxDaysBeginner: 4, minutesTolerancePct: 10 } }, schema, schemaName: 'workout_program', maxOutputTokens: 4000 })`. `PROGRAM_INSTRUCTIONS`: choose only exercise names from the catalog when possible; each FULL day needs SHORT (major movements only, ≈ 60 % of minutes) and MINIMUM (≤ 12 min, 2–3 movements) siblings; beginners ≤ 4 days; respect limitations; rest 60–120 s compounds, 45–90 s accessories; rationale in plain language (VISION §41).
3. `{ok:false}` → `no_user_key` → 412 (reuse `AiKeyRequiredException`); anything else → starter with `reason: 'ai_unavailable'`.
4. Post-validation (`workout-program-rules.ts`, pure, returns `RuleViolation[]`): (a) `exerciseResolver.resolveMany(names, userId)` — exact `nameKey`, then Dice-coefficient ≥ 0.85 on `nameKey`; unresolved names are created as custom rows `{ isCustom: true, scope: userId, createdByUserId: userId, substitutionGroup: 'custom', equipment: req.equipment, movementPattern: 'ACCESSORY', instructions: '' }`; (b) `experience === 'BEGINNER' && weeklyStructure.length > 4` → violation; (c) an exercise whose `contraindicationTags` intersects tags derived from `limitations` (keyword map in `workout-program-rules.ts`: "shoulder"→`shoulder`, "knee"→`knee`, "back"→`lower_back`, "wrist"→`wrist`, "hip"→`hip`, "elbow"→`elbow`, "neck"→`neck`, "overhead"→`overhead`) → violation; (d) FULL template minutes estimate (`Σ sets × (avg reps × 3 s + restSeconds)` + 5 min) > `minutesPerSession × 1.1` → violation; (e) `weeklyStructure.length !== daysPerWeek` → violation. Any violation → `{ source: 'starter', reason: 'invalid_output', message }`, audit `workout_program:generate` with `meta.violations`, and an `ai_invocations` note is left to E01's log (status `invalid_output` is the gateway's own when the schema fails; rule failures are recorded in audit meta only).
5. Persist: `WorkoutProgram { status: DRAFT, generationInput: req, rationale, substitutions (resolved ids), weeklyStructure (templateIds after insert) }`, templates and template exercises in one `$transaction`. The starter path (`buildStarterProgram(req)`) persists the same way so the UI has one shape; `useStarter: true` skips the AI call entirely.

Starter (`starter-program.ts`, pure): "Full Body A/B/C" on weekdays Mon/Wed/Fri (or the first `daysPerWeek` of Mon/Wed/Fri/Sat/Tue), FULL = Goblet Squat 3×8–12, Dumbbell Bench Press or Push-Up 3×8–12, Dumbbell Row or Band Row 3×8–12, Dumbbell Romanian Deadlift or Glute Bridge 3×8–12, Plank 2×30–45 s (encoded as reps 30–45, note "seconds"); SHORT = first three; MINIMUM = Bodyweight Squat 2×10 + Push-Up 2×8 (10 min); equipment-aware picks from the same substitution groups; `durationWeeks: 6`.

Approve (`WorkoutProgramsService.approve(id, userId, body)`), one `$transaction`: 409 unless `DRAFT`; find the active Health `Outcome` (domain `HEALTH`, not archived; create "Train consistently" with `whyItMatters` = goal when none); its `Plan` (create when none) → `POST`-equivalent of E02-03 (#42) `createVersion(planId, { createdBy: source === 'ai' ? 'AI' : 'USER', userApproved: true, rationale, expectedWeeklyLoad: Σ FULL minutes, fallbackStrategy: 'SHORT/MINIMUM workout variants' })`; archive any other `ACTIVE` program of the user (and cancel its future commitments); set `status: ACTIVE`, `planId`; create **one `Routine` per FULL template** (title = template name, `triggerType 'WEEKDAY'`, `triggerValue` = its weekdays, `preferredTime`, `estimatedDurationMinutes` = FULL `targetMinutes`, `minimumDurationMinutes` = MINIMUM `targetMinutes`, `fallbackBehavior` = "Short or minimum version of <name>") under the plan and set `workout_templates.routine_id` — this 1:1 link is what lets E06 proposals (routine-targeted diffs) reach a template in E09-05 (#88); schedule commitments for 14 days from `startDate`: for each day whose weekday ∈ `weeklyStructure` → `Commitment { domain: HEALTH, outcomeId, routineId: template.routineId, workoutTemplateId: FULL id, title: templateName, scheduledStart: date+preferredTime in the profile timezone, durationMinutes: FULL.targetMinutes, fullVersion: {title, minutes}, shortVersion: {title: name+' (short)', minutes: SHORT.targetMinutes}, minimumVersion: {…MINIMUM}, importance: 4, status: PLANNED }`. After commit: audit `workout_program:approve` `{ programId, planVersionId, commitments }` and `notifications.notify('health.program_activated', userId, { programName })` — register that event in `NOTIFICATION_EVENTS` (channels `browser`, `defaultEnabled: true`) with a browser template only.

Audit actions: `workout_program:generate` `{ programId?, source, reason?, violations?, invocationId? }`, `workout_program:approve`, `workout_program:archive`, `workout_program:delete`. OpenAPI: add tag `Workouts` (group "Health", new) to `apps/api/src/openapi/tags.ts`.

**UI (frontend-dev)** — n/a (E09-07 (#95)).

**Tests (testing-dev)**
- `programs/workout-program.schema.spec.ts`: accepts the fake-server fixture `tools/fake-openai/fixtures/workout_program.json`; rejects a FULL template without SHORT/MINIMUM, duplicate weekdays, `repMin > repMax`, a `weeklyStructure.templateName` that is not a FULL template.
- `programs/workout-program-rules.spec.ts`: beginner with 5 days → violation `BEGINNER_MAX_DAYS`; limitation "bad shoulder" + Barbell Overhead Press (`shoulder`,`overhead`) → `CONTRAINDICATED`; minutes 60 vs requested 40 → `OVER_TIME_BUDGET`; a clean proposal → `[]`.
- `exercises/exercise-resolver.service.spec.ts`: "dumbbell bench press" → catalog id; "DB Bench Press" (Dice < 0.85) → custom row created with `scope = userId`; a second resolve reuses the custom row.
- `programs/starter-program.spec.ts`: output passes the schema and the rules for every `daysPerWeek` 2–5 and for equipment `[BODYWEIGHT]` only (no dumbbell picks).
- `programs/workout-program-generator.service.spec.ts` (gateway + safety mocked): `redirect` → no `invoke` call, `reason: 'safety_redirect'`; `{ok:false, code:'no_user_key'}` → 412; `{ok:false, code:'timeout'}` → starter `ai_unavailable`; `{ok:true}` with a rule violation → starter `invalid_output` and audit meta lists it; happy path calls `invoke` with `persona 'workout_programmer'`, `schemaName 'workout_program'`, `promptVersion 'workout_programmer.v1'`.
- `apps/api/test/workouts/workout-programs.integration.spec.ts` (new, `createTestApp` + `overrideProviders` for `AiGatewayService` and the safety service): 401 on every route; generate → 201 with 9 templates (3 FULL + siblings) and zero `commitments` rows; approve → `ACTIVE`, one `plan_versions` row with `userApproved: true`, 6 commitments with `workoutTemplateId`, audit rows; approve again → 409; foreign id → 404; `DELETE` on `ACTIVE` → 409.

**Docs (docs-dev)** — `docs/API.md` "Workouts" section; `CLAUDE.md` endpoints block; `docs/specs/health-domain.md` (E09-11 (#114)) "Program builder contract" and "Safety rules".

#### Acceptance criteria
- [ ] `POST /api/workouts/programs/generate` returns a `DRAFT` program whose every FULL template has SHORT and MINIMUM siblings and whose exercises all reference `exercises` rows (catalog or newly created custom rows)
- [ ] A beginner request with `daysPerWeek: 5` never yields an AI program with 5 days: either the AI honours the rule or the response is `source: 'starter', reason: 'invalid_output'`
- [ ] A proposal containing an exercise whose contraindication tag matches the stated limitation is rejected as `invalid_output`
- [ ] With the AI unavailable the endpoint returns the starter program (200, `reason: 'ai_unavailable'`) and it can be approved
- [ ] `approve` sets `ACTIVE`, creates or reuses the Health outcome and plan, adds a `PlanVersion` with `userApproved: true`, creates one `Routine` per FULL template linked by `workout_templates.routine_id`, and schedules exactly the next 14 days' training-day commitments with `workoutTemplateId`
- [ ] Nothing is written to `plans`, `plan_versions`, `routines` or `commitments` before `approve`
- [ ] Audit rows `workout_program:generate` and `workout_program:approve` exist with the documented meta
- [ ] `GET /api/workouts/exercises?q=row` returns catalog rows and the caller's custom rows only

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (paths, DTOs, schema, rule codes)
- [ ] Error handling: 412 for no user key; starter fallback for every other gateway error and for rule violations; 409 for state conflicts; 404 for foreign ids
- [ ] Observability: `ai_invocations` row per attempt (gateway); audit per generate/approve; `@Trace('workouts.program.generate')` span with `workout.source`, `workout.violations` attributes; no prompt content in logs
- [ ] Security: all routes `@Auth()`; every query scoped by `userId`; limitations text is passed to the gateway and stored in `generationInput` only — never logged
- [ ] Config & secrets: none new
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–4, then with a token from `/testing/login`:
2. `curl -s -X POST http://localhost:3535/api/workouts/programs/generate -H "Authorization: Bearer <t>" -H 'Content-Type: application/json' -d '{"goal":"Get stronger","experience":"BEGINNER","daysPerWeek":3,"minutesPerSession":40,"equipment":["DUMBBELL","BENCH"]}' | jq '.data | {source, name: .program.name, templates: (.program.templates|length)}'` → `source: "ai"`, 9 templates.
3. Repeat with header `x-fake-behaviour: workout_program_unsafe` (E09-11 (#114) adds it; until then set `daysPerWeek: 5` with `experience: BEGINNER` against a fixture that echoes 5 days) → `source: "starter"`, `reason: "invalid_output"`.
4. `curl -X POST …/api/workouts/programs/<id>/approve -d '{}'` → 200; epic step 7 DB checks.

#### Out of scope
- Editing a generated program by hand (E09-07 (#95) offers regenerate; per-exercise edits are a follow-up).
- Program adaptation (E09-05 (#88)); progression (E09-04 (#85)).

#### Notes for the implementing agent
- Import `SafetyPolicyService` from `apps/api/src/coach/safety/safety-policy.service.ts` (`SafetyModule`, E06-06 (#82)); do not re-implement keyword classification here.
- Use E02-03 (#42)'s plan-version service to create the version so "only one active version" stays enforced in one place; do not insert `plan_versions` rows directly.
- Timezone: reuse `localDayBounds`/`localDate` from `apps/api/src/today/local-date.ts` (E05-01 (#38)) to build `scheduledStart` from `preferredTime`.
- Register the `Workouts` tag in `tags.ts` before writing the controller; the OpenAPI spec test fails on undeclared tags.
- Do not put anything in `apps/api/src/health/` — that module is the liveness probe.

---

### E09-03 `feat(api): add workout session runner endpoints with idempotent set logging` — #81

**Part of epic:** E09 · **Blocked by:** E09-01 (#72), E05-02 (#40) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §41 defines the session experience (header "Upper A · Workout 3 of 18", current exercise, last-time line, set inputs, `Complete set`, rest timer); §106 requires "User can start workout … log sets/reps/load … History appears next session"; §121 requires queued, replayable logging under intermittent connectivity; §44 requires short/minimum variants during a session; §45 requires that sharp pain is not treated as ordinary fatigue. VISION §14: "Next time, EvolvePath remembers. That history becomes evidence." No session or set-log endpoint exists, and Health commitments currently run E05's generic timer.

#### Proposed solution
Session endpoints in `apps/api/src/workouts/sessions/` that start a session (through E05-02 (#40)'s `start` action so evidence and audit stay consistent), return the runner view with per-exercise history and the E09-04 (#85) suggestion, accept set logs idempotently by `clientId`, switch variant, and finish with a `WORKOUT_LOG` evidence row and the right commitment status.

**Data (database-dev)** — n/a (E09-01 (#72)).

**API (backend-dev)** — `sessions/workout-sessions.controller.ts` (`@ApiTags('Workouts')`, `@Controller('workouts/sessions')`), `sessions/workout-sessions.service.ts`, `sessions/session-view.builder.ts` (pure: template + logs + history → `WorkoutSessionView`), `sessions/dto/{start-session,log-set,finish-session,switch-variant}.dto.ts`, `safety/workout-safety-copy.ts` (`PAIN_SAFETY_COPY`, the PRD §45 text: "Stop this exercise. Sharp pain is not something to train through. If it persists, sharpens, or comes with numbness or weakness, get it checked by a professional before your next session." — no programming advice).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/workouts/sessions` | `@Auth()` | `{ commitmentId?: uuid, templateId?: uuid, variant?: 'FULL'\|'SHORT'\|'MINIMUM' (default FULL) }` — exactly one of `commitmentId`/`templateId` | 201 `WorkoutSessionView`; 409 `SESSION_IN_PROGRESS` (returns the open session's id in `details`) |
| GET | `/api/workouts/sessions/:id` | `@Auth()`, owner | — | 200 `WorkoutSessionView` |
| GET | `/api/workouts/sessions` | `@Auth()` | `status?`, `templateId?`, `limit` (20) | 200 `{ items: WorkoutSessionSummaryDto[] }` newest first |
| POST | `/api/workouts/sessions/:id/sets` | `@Auth()`, owner | `{ clientId: uuid, exerciseId: uuid, setNumber: int 1..12, weightKg?: number 0..500 (step 0.25), reps: int 0..100, rpe?: int 1..10, discomfort: 'NONE'\|'MILD'\|'SHARP_PAIN', loggedAt?: ISO }` | 201 `{ set: SetLogDto, safety?: { copy: string, action: 'stop_exercise' } }`; **200** with the existing row when `clientId` already exists (idempotent replay); 409 `SESSION_NOT_OPEN` |
| POST | `/api/workouts/sessions/:id/sets/batch` | `@Auth()`, owner | `{ sets: LogSet[] (≤ 50) }` | 200 `{ accepted: SetLogDto[], duplicates: clientId[], rejected: [{clientId, reason}] }` — the offline-queue replay entry point |
| POST | `/api/workouts/sessions/:id/switch-variant` | `@Auth()`, owner | `{ variant }` | 200 `WorkoutSessionView` (exercise list re-derived from the sibling template; logged sets for exercises not in the new variant are kept and shown under "Also logged") |
| POST | `/api/workouts/sessions/:id/finish` | `@Auth()`, owner | `{ status: 'COMPLETED'\|'ABANDONED', notes?: string ≤ 1000 }` | 200 `{ session, summary: { sets, volumeKg, minutes, exercisesCompleted, exercisesPlanned }, commitmentStatus }` |

`WorkoutSessionView`: `{ id, status, variant, startedAt, finishedAt, discomfortFlag, program: { id, name }, template: { id, name, variant, targetMinutes }, header: { title: 'Upper A', sessionIndex: 3, sessionTotal: 18 }, availableVariants: ['FULL','SHORT','MINIMUM'], exercises: [{ order, exerciseId, name, equipment, instructions, sets, repMin, repMax, restSeconds, notes, lastTime: { sessionDate, sets: [{ weightKg, reps, rpe }] } | null, progression: ProgressionSuggestion | null (E09-04 (#85); null until it lands), logged: SetLogDto[] }], alsoLogged: SetLogDto[], safety: { copy } | null }`. `sessionIndex` = count of the user's sessions for templates of the same program with status ≠ ABANDONED started before or at this one; `sessionTotal` = `durationWeeks × weeklyStructure.length`. `lastTime` = the sets of the most recent `COMPLETED` session of the same user for the same `exerciseId` (any template), ordered by `setNumber`.

Semantics (`WorkoutSessionsService`; every method loads `where: {id, userId}` → 404):
- **start**: with `commitmentId` → load the commitment (owner, `workoutTemplateId` required else 400 `NOT_A_WORKOUT_COMMITMENT`), template = FULL id (variant sibling chosen by `variant`), then `commitmentActions.start(commitmentId, userId, { minutes: template.targetMinutes })` (E05-02 (#40) → STARTED + evidence) and, when `variant !== 'FULL'`, `commitmentActions.fallback(commitmentId, userId, { version: variant.toLowerCase() })`; with `templateId` → ad-hoc session, no commitment. One `IN_PROGRESS` session per user at a time (409 with the open id). Audit `workout_session:start` `{ sessionId, templateId, variant, commitmentId }`.
- **log set**: 409 unless `IN_PROGRESS`; `exerciseId` must be in the program (any variant) else 400; upsert semantics: existing `clientId` → return it (200, no write); existing `(sessionId, exerciseId, setNumber)` with a different `clientId` → overwrite the row and keep the new `clientId` (a corrected set); `discomfort === 'SHARP_PAIN'` → set `discomfortFlag = true`, return `safety: { copy: PAIN_SAFETY_COPY, action: 'stop_exercise' }`, audit `workout_session:discomfort` `{ sessionId, exerciseId }` — **no** programming advice, no AI call. `loggedAt` defaults to now; a client value is accepted only if within `[startedAt, now + 5 min]`.
- **batch**: per item the same rules; never fails the whole batch for one bad item.
- **switch-variant**: 400 if the sibling does not exist; updates `variant`; when a commitment is attached and the variant is not FULL, call `commitmentActions.fallback` (idempotent on the same version).
- **finish**: 409 unless `IN_PROGRESS`; `finishedAt = now`; summary from logged sets (`volumeKg = Σ weightKg × reps`, `minutes = (finishedAt − startedAt)/60000` rounded); commitment mapping when attached: `COMPLETED` + variant FULL + every FULL exercise has ≥ 1 set → `commitmentActions.complete(id, userId, { minutesSpent })`; `COMPLETED` otherwise → `commitmentActions.partial`; `ABANDONED` with ≥ 1 set → `partial`; `ABANDONED` with 0 sets → leave the commitment STARTED (the user can still skip/reschedule from Today). Evidence: `prisma.evidence.create({ userId, commitmentId, source: 'WORKOUT_LOG', type: status === 'COMPLETED' ? 'workout_completed' : 'workout_abandoned', quantitativeValue: { sets, volumeKg, minutes, variant }, qualitativeValue: { notes, discomfortFlag } })` — written by this service (E05's actions write their own `USER_LOG` rows; both exist, by design: one is the commitment outcome, the other is the workout record). Audit `workout_session:finish`.
- Notifications: none here (E12).

OpenAPI tag `Workouts` (E09-02 (#77)). Error codes: `SESSION_IN_PROGRESS`, `SESSION_NOT_OPEN`, `NOT_A_WORKOUT_COMMITMENT`, `EXERCISE_NOT_IN_PROGRAM`, `VARIANT_NOT_DEFINED`.

**UI (frontend-dev)** — n/a (E09-08 (#109)).

**Tests (testing-dev)**
- `sessions/session-view.builder.spec.ts`: `lastTime` picks the latest COMPLETED session only (an ABANDONED newer one is ignored); `sessionIndex`/`sessionTotal` for 3 days × 6 weeks after two prior sessions → `3 of 18`; `alsoLogged` after switching to SHORT; `Decimal` weights serialize as numbers.
- `sessions/workout-sessions.service.spec.ts` (Prisma + `CommitmentActionsService` mocked): start via commitment calls `start` with the template minutes and `fallback` only for non-FULL; second start → 409 with the open id; duplicate `clientId` → 200 and no `create`; same set number new `clientId` → `update`; `SHARP_PAIN` → `discomfortFlag` update, safety copy returned, `aiGateway.invoke` **never** called; finish mapping table (FULL complete → `complete`; SHORT → `partial`; ABANDONED 0 sets → no action); evidence payload exact; `loggedAt` outside the window → 400.
- `apps/api/test/workouts/workout-sessions.integration.spec.ts` (new): full flow start → 3 sets → finish → `GET` shows `COMPLETED`; second session on the same template → `lastTime.sets.length === 3`; batch with one duplicate and one bad exercise → `accepted 1, duplicates 1, rejected 1`; foreign session → 404; 401 unauthenticated.

**Docs (docs-dev)** — `docs/API.md` sessions block; `CLAUDE.md` endpoints; `docs/specs/health-domain.md` (E09-11 (#114)) "Session lifecycle", "Idempotent set logging", "Finish → commitment status table", "Pain safety".

#### Acceptance criteria
- [ ] `POST /api/workouts/sessions {commitmentId}` creates an `IN_PROGRESS` session, moves the commitment to `STARTED` (E05 evidence `started` exists) and returns the header `"<template> · Workout N of M"` data
- [ ] Posting the same `clientId` twice creates one `set_logs` row and the second call returns 200 with that row
- [ ] `sets/batch` accepts, de-duplicates and rejects per item without failing the batch
- [ ] A set with `discomfort: SHARP_PAIN` flags the session, returns the PRD §45 copy, and triggers no AI call
- [ ] `finish {status: COMPLETED}` after a FULL session with every exercise logged → commitment `COMPLETED`; after `switch-variant SHORT` → `PARTIALLY_COMPLETED`; in both cases one `evidence` row `source WORKOUT_LOG` with `{sets, volumeKg, minutes, variant}`
- [ ] The next session on the same exercise shows `lastTime` with the previous COMPLETED session's sets in order
- [ ] A second `POST /sessions` while one is open returns 409 with the open session id
- [ ] All routes 404 for another user's ids and 401 unauthenticated

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (view shape, status mapping, evidence type strings)
- [ ] Error handling: the five error codes above; batch never all-or-nothing
- [ ] Observability: audit `workout_session:start|discomfort|finish`; log line per finish with session id, sets, minutes (no notes text); `@Trace('workouts.session.finish')`
- [ ] Security: `@Auth()` + `userId` scoping on every query; `clientId` is opaque and never used to look up across users (`where: {clientId, session: {userId}}`)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script through step 7; take a `commitmentId` with `workout_template_id`.
2. `curl -s -X POST …/api/workouts/sessions -d '{"commitmentId":"<c>"}' | jq '.data | {id, header, first: .exercises[0].name}'` → header `sessionIndex 1`, `sessionTotal 18`.
3. `curl -s -X POST …/api/workouts/sessions/<s>/sets -d '{"clientId":"11111111-1111-4111-8111-111111111111","exerciseId":"<e>","setNumber":1,"weightKg":20,"reps":12,"rpe":7,"discomfort":"NONE"}'` → 201; repeat identical → 200; `select count(*) from set_logs;` → 1.
4. Post a set with `"discomfort":"SHARP_PAIN"` → response has `safety.copy`; `select discomfort_flag from workout_sessions;` → `t`.
5. `curl -X POST …/finish -d '{"status":"COMPLETED"}'` → summary; `select status from commitments where id='<c>';` → `COMPLETED`; `select source, type from evidence where commitment_id='<c>';` includes `WORKOUT_LOG workout_completed`.

#### Out of scope
- Progression computation (E09-04 (#85)) — this issue returns `progression: null` until E09-04 (#85) wires the builder.
- Rest-timer state on the server; the client derives it from `loggedAt` (E09-08 (#109)).
- Editing or deleting sets after `finish`.

#### Notes for the implementing agent
- Call `CommitmentActionsService` (E05-02 (#40)) for every commitment transition; never `prisma.commitment.update` status directly — the transition matrix and evidence live there.
- `Prisma.Decimal` → `Number(...)` in DTO mappers; validate `weightKg` step with `z.number().multipleOf(0.25)`.
- Keep `PAIN_SAFETY_COPY` a constant in `safety/workout-safety-copy.ts`; E09-06 (#92) and E09-08 (#109) import the same string.
- The `clientId` unique index is the idempotency mechanism; catch `P2002` on create and re-read rather than pre-checking (race-safe).

---

### E09-04 `feat(api): add deterministic double-progression rules with AI explanation` — #85

**Part of epic:** E09 · **Blocked by:** E09-03 (#81) · **Component:** api, core · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §42: "Progression should initially use conservative deterministic rules … The core progression rule should not be reinvented by the LLM every workout. The AI can explain." VISION §14's example coaching ("Last time you completed all three pulldown sets at the top of the target range and marked the exercise 'comfortable.' I recommend a small increase today.") is exactly a deterministic rule plus one explanatory sentence. E09-03 (#81) returns `progression: null`.

#### Proposed solution
A pure `suggestProgression(history, prescription)` in `apps/api/src/workouts/progression/double-progression.ts` (new), wired into `session-view.builder.ts`, plus an optional one-sentence explanation from the `coach` persona with a template fallback.

**Data (database-dev)** — n/a. Reads `set_logs` of the last two `COMPLETED` sessions per exercise.

**API (backend-dev)**

```ts
// apps/api/src/workouts/progression/double-progression.ts (new)
export interface SetRecord { weightKg: number | null; reps: number; rpe: number | null; discomfort: 'NONE'|'MILD'|'SHARP_PAIN' }
export interface SessionRecord { sessionId: string; date: string; sets: SetRecord[] }   // sets ordered by setNumber
export interface Prescription { sets: number; repMin: number; repMax: number; equipment: Equipment[] }
export type ProgressionAction = 'increase' | 'hold' | 'reduce';
export interface ProgressionSuggestion {
  action: ProgressionAction;
  currentWeightKg: number | null;      // last session's heaviest working weight
  suggestedWeightKg: number | null;    // null for bodyweight / when no weight was logged
  deltaKg: number | null;
  reason: 'top_of_range_twice' | 'below_min_twice' | 'first_session' | 'building' | 'discomfort' | 'insufficient_history';
  basis: { sessions: number; lastReps: number[]; lastRpe: (number|null)[] };
}
export const INCREMENT_KG: Record<'DUMBBELL'|'BARBELL'|'KETTLEBELL'|'MACHINE'|'CABLE', number> = { DUMBBELL: 2.5, BARBELL: 5, KETTLEBELL: 4, MACHINE: 5, CABLE: 2.5 };
export function suggestProgression(history: SessionRecord[] /* newest first, ≤ 2 */, p: Prescription): ProgressionSuggestion
```

Rules, evaluated in order: (1) no history → `first_session`, `hold`, weights null. (2) any `SHARP_PAIN` in the last session for this exercise → `hold`, `reason: 'discomfort'` (E09-03 (#81) already redirected; the suggestion must not push). (3) **increase** when in **each** of the last two sessions every logged set has `reps ≥ repMax` and (`rpe === null || rpe ≤ 8`) and `sets.length ≥ p.sets` → `deltaKg` = increment for the first weighted equipment in `p.equipment` (`BODYWEIGHT`/`BAND`/`BENCH` only → `suggestedWeightKg: null`, action still `increase` with `reason 'top_of_range_twice'` — the client shows "add a rep or a harder variation"); `suggestedWeightKg = currentWeightKg + deltaKg` rounded to 0.25. (4) **reduce** when in each of the last two sessions at least one set has `reps < repMin` → `suggestedWeightKg = round(current × 0.95 / 0.25) × 0.25`, `reason 'below_min_twice'`. (5) only one session so far → `hold`, `reason 'insufficient_history'`. (6) else `hold`, `reason 'building'`. "Comfortable" = `rpe ≤ 8` or `rpe === null` (the RPE field is optional, PRD §41).

Wiring: `session-view.builder.ts` fills `exercises[].progression` from `suggestProgression(historyFor(exerciseId), prescription)`; `WorkoutSessionsService.getView` loads the last two COMPLETED sessions' sets per exercise in one query (`set_logs` join `workout_sessions` where `userId`, `status = COMPLETED`, `exerciseId in (…)`, ordered by `startedAt desc`).

Explanation: `progression/progression-explainer.service.ts` — `explain(userId, exerciseName, suggestion)` → `coach` persona with `promptVersion 'progression-explain.v1'`, `schema z.object({ sentence: z.string().max(200) })`, `schemaName 'progression_explanation'`, `maxOutputTokens 80`, instructions "one sentence, plain, no new numbers, do not change the recommendation"; the deterministic template is returned on `{ok:false}` or when the sentence contains a number that is not `suggestedWeightKg`/`deltaKg`/`repMax` (guard against the LLM altering the load). Templates: increase → "Two sessions at the top of the range and comfortable — a small increase to {kg} kg."; reduce → "You've missed the lower bound twice; drop to {kg} kg and rebuild."; hold/building → "Keep the weight and work toward {repMax} reps on every set."; discomfort → the E09-03 (#81) `PAIN_SAFETY_COPY` first sentence. Exposed as `GET /api/workouts/sessions/:id/exercises/:exerciseId/explain` → 200 `{ sentence, source: 'ai'|'template' }` (`@Auth()`, owner), cached per `(sessionId, exerciseId)` in memory for the session's lifetime so the runner can call it lazily without a second invocation.

**UI (frontend-dev)** — n/a (E09-08 (#109) renders the chip and calls `explain` on tap).

**Tests (testing-dev)**
- `progression/double-progression.spec.ts` with fixtures in `progression/__fixtures__/*.json`: (a) two sessions 3×12@RPE 7 on 20 kg dumbbell → `increase`, `22.5`; (b) barbell → `+5`; (c) machine → `+5`; (d) one session at top → `hold insufficient_history`; (e) two sessions with a set at 6 reps under `repMin 8` → `reduce`, `19` (from 20); (f) mixed (one top, one middle) → `hold building`; (g) RPE 9 at the top → `hold`; (h) `SHARP_PAIN` last time → `hold discomfort`; (i) bodyweight push-ups at top twice → `increase` with null weights; (j) fewer sets than prescribed → `hold`; (k) rounding to 0.25 (`17.3 → 17.25`).
- `progression-explainer.service.spec.ts`: `{ok:true, sentence: 'Go to 30 kg'}` when suggestion is 22.5 → template used; `{ok:false}` → template; happy path → `source 'ai'`.
- Extend `workout-sessions.integration.spec.ts`: third session after two COMPLETED top-of-range sessions returns `progression.action === 'increase'` for that exercise and `first_session` for one never logged.

**Docs (docs-dev)** — `docs/specs/health-domain.md` "Progression rules" table (verbatim thresholds and increments); `docs/API.md` explain endpoint.

#### Acceptance criteria
- [ ] After two COMPLETED sessions with every set ≥ `repMax` at RPE ≤ 8 (or no RPE), the next `GET /sessions/:id` shows `progression.action = increase` with `+2.5 kg` for dumbbell and `+5 kg` for barbell/machine exercises
- [ ] After two sessions with a set below `repMin`, the suggestion is `reduce` at 95 % rounded to 0.25 kg
- [ ] Any sharp-pain set in the last session yields `hold` with `reason discomfort`
- [ ] One prior session never yields `increase`
- [ ] The explanation endpoint returns a sentence from the `coach` persona or the template, and never a load different from the deterministic suggestion
- [ ] The function is pure: same inputs → same output, no Prisma import in `double-progression.ts`

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (thresholds, increments, reason codes)
- [ ] Error handling: gateway failure → template; explanation never blocks `GET /sessions/:id`
- [ ] Observability: `ai_invocations` row per explanation; no extra audit (read-only)
- [ ] Security: owner-scoped; no user text in the explain prompt beyond the exercise name and numbers
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script step 11 via API: complete two sessions with `3 × 12 @ 20 kg, rpe 7` on Dumbbell Bench Press; start a third; `jq '.data.exercises[] | select(.name=="Dumbbell Bench Press") | .progression'` → `increase`, `suggestedWeightKg 22.5`.
2. `curl …/exercises/<e>/explain` → a sentence containing `22.5`. Stop `fake-openai` and call again on a new session → `source: "template"`.

#### Out of scope
- Autoregulation, deloads, per-set weight suggestions, rep-in-reserve models.
- Changing the template's prescription (E09-05 (#88) proposals do that through E06).

#### Notes for the implementing agent
- Keep `double-progression.ts` dependency-free (no Nest, no Prisma) so the fixtures test runs in milliseconds and the rule can be documented verbatim.
- Equipment precedence for the increment: first match in `p.equipment` against `INCREMENT_KG` keys; `BENCH` is not a load.
- The number-guard in the explainer is a regex over `\d+(\.\d+)?` compared to the allowed set; keep it strict.

---

### E09-05 `feat(api): add workout adaptation detector producing plan-change proposals` — #88

**Part of epic:** E09 · **Blocked by:** E09-03 (#81), E06-01 (#61), E06-04 (#76) · **Component:** api · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement
PRD §43 lists when the AI should adapt (duration repeatedly exceeds capacity, exercise repeatedly skipped, user dislikes an exercise, …) and gives the example proposal; VISION §14: "You've skipped this 55-minute session three times… The plan is too long. Let's rebuild it as a 30-minute session." PRD §15 and §106 require that structural changes are proposed and user-approved, never applied by the AI. E06 ships the proposal object and accept/edit/reject; nothing produces workout proposals.

#### Proposed solution
A deterministic detector over commitments, sessions and set logs that emits at most one `PlanChangeProposal` per template per 14 days, run by a daily `@Cron` and on demand, plus a "dislike" signal endpoint. Applying an accepted proposal updates the template through E06-04 (#76)'s accept hook.

**Data (database-dev)** — E06-01 (#61)'s `PlanChangeProposal` already carries `sourceKind ProposalSourceKind` (`WORKOUT` is a declared value). Migration `add_workout_dislike`: `WorkoutTemplateExercise` gains `dislikedAt DateTime? @map("disliked_at")`.

**API (backend-dev)** — `apps/api/src/workouts/adaptation/` (new): `workout-adaptation.service.ts` (`detect(userId, now)` → `AdaptationCandidate[]`, `run(userId)` → creates proposals, `proposeSubstitution(userId, programId, substitutions, reason)` used by E09-06 (#92)), `adaptation-rules.ts` (pure detectors), `workout-adaptation.task.ts` (`@Cron(config.workouts.adaptationCron)` over users with an `ACTIVE` program, `@Trace('workouts.adaptation.cron')`), `workout-adaptation.controller.ts` (`@ApiTags('Workouts')`), `workout-proposal-effects.ts` (the workout side of accept, below).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/workouts/adaptation/run` | `@Auth()` | — | 200 `{ created: number, proposalIds: string[] }` (caller's own programs only) |
| POST | `/api/workouts/templates/:templateId/exercises/:id/dislike` | `@Auth()`, owner | `{ disliked: boolean }` | 200 `{ dislikedAt }` |
| GET | `/api/workouts/adaptation/candidates` | `@Auth()` | — | 200 `{ items: AdaptationCandidate[] }` (debug/explain view; what `run` would create) |

Change shape. Proposals reuse E06-04 (#76)'s `planChangeSchema` verbatim and target the FULL template's `Routine` (`workout_templates.routine_id`, E09-02 (#77)): a duration change is `{ op: 'reduce', target: { type: 'routine', id: routineId }, before: { estimatedDurationMinutes: 40 }, after: { estimatedDurationMinutes: 25 }, reason }`; an exercise swap is `{ op: 'replace', target: { type: 'routine', id }, before: { title: 'Upper A' }, after: { title: 'Upper A' }, reason: 'Replace Lat Pulldown with Pull-Up: …', workout: { templateId, replaceExercise: { templateExerciseId, alternativeExerciseId } } }`. The `workout` field is an **additive optional** extension this issue adds to `plan-change.schema.ts` (`workout: z.object({ templateId: uuid, replaceExercise: z.object({ templateExerciseId: uuid, alternativeExerciseId: uuid }).optional() }).optional()`); `applyChanges` ignores it, so E06's pure diff and coach proposals are unaffected.

Detectors (`adaptation-rules.ts`, pure over a `WorkoutSignals` input the service loads for the last 14 days): `SKIPPED_TWICE` — ≥ 2 commitments of the same FULL template with status `SKIPPED|MISSED` in 14 days → `reduce` to `max(15, round(targetMinutes × 0.65 / 5) × 5)` with reason "Skipped <k> times in two weeks — the plan is probably too long" (when the template has ≥ 5 exercises the reason adds "accessory work can move to another day"); `TOO_LONG` — ≥ 2 COMPLETED sessions of the template with `minutes > targetMinutes + 15` → the same `reduce` with reason "Sessions ran <avg> min against a <target> min plan"; `EXERCISE_SKIPPED` — an exercise of a FULL template with 0 logged sets in the last 3 COMPLETED sessions of that template → `replace` with the first alternative from `program.substitutions`, else the first catalog exercise in the same `substitutionGroup` whose equipment ⊆ the program's `generationInput.equipment`, reason "Skipped in the last 3 sessions"; `DISLIKED` — `dislikedAt` set → the same `replace`, reason "You marked this exercise as disliked". `proposeSubstitution` (called by E09-06 (#92)'s equipment check) emits `replace` changes with reason "No <equipment> available". De-dup: skip a candidate when a `PROPOSED|EDITED|ACCEPTED` proposal with `sourceKind WORKOUT` and the same `target.id` + `op` exists within 14 days.

Proposal creation: `proposals.createFromSource(userId, 'WORKOUT', { planId: program.planId, summary: '<VISION §14-style sentence, ≤ 300>', changes, invocationId: null })` (E06-04 (#76)) — one proposal per template per run, changes grouped. Audit `workout_adaptation:propose` `{ proposalId, detector, templateId }`. Register `plan.proposal_created` in `NOTIFICATION_EVENTS` (`channels: ['browser']`, `defaultEnabled: true`, browser template `{ title: 'Your coach has a suggestion', body: summary, link: '/coach' }`) and `notify` it after commit; E06 currently raises no event on proposal creation, so this registration is E09's.

Apply (workout effects on accept). E06-04 (#76)'s `ProposalsService.accept` creates the new `PlanVersion` from the routine diff (so the `reduce` already lowers `Routine.estimatedDurationMinutes` and reschedules nothing). This issue adds a small effect hook: `apps/api/src/coach/proposals/proposal-effects.ts` exporting the `PROPOSAL_EFFECT` multi-provider token and `interface ProposalEffect { sourceKind: ProposalSourceKind; apply(tx, proposal, result: ApplyResult): Promise<void> }`; `accept` runs the matching effect **inside its transaction** after `applyChanges` succeeds. `WorkoutProposalEffect` (`workout-proposal-effects.ts`): for each `reduce` on a routine linked to a template → `workout_templates.target_minutes = after.estimatedDurationMinutes` and future `PLANNED` commitments of that template get `durationMinutes`/`fullVersion.minutes` updated; for each `workout.replaceExercise` → update `workout_template_exercises.exercise_id` on the FULL template and on SHORT/MINIMUM siblings where the same exercise appears; audit `workout_adaptation:applied`. Reject → nothing (E06-04 (#76) audits). `list(userId, {status?, planId?})` gains `sourceKind?` so the UI can filter.

**UI (frontend-dev)** — n/a; E06-07 (#86)'s Coach proposal card renders `changes[]` generically. E09-07 (#95) shows "Proposed change" badges on the program detail from `GET /proposals?sourceKind=WORKOUT&status=PROPOSED` (filter added above).

**Tests (testing-dev)**
- `adaptation/adaptation-rules.spec.ts`: each detector with fixtures (two SKIPPED → `reduce` 40 → 25 on the template's routine; one SKIPPED → none; 2 long sessions → `reduce`; 3 sessions without sets for an exercise → `replace` with the substitution alternative and a `workout.replaceExercise`; disliked → `replace`); every emitted change passes E06-04 (#76)'s `planChangeSchema`; de-dup window.
- `workout-adaptation.service.spec.ts` (Prisma mocked): `run` creates one proposal per template max; existing PROPOSED for the same target → skipped; audit + notify called once per proposal.
- `apps/api/test/workouts/workout-adaptation.integration.spec.ts`: seed program + two SKIPPED commitments → `POST /adaptation/run` → `created 1`; `POST /proposals/:id/accept` (E06-04 (#76)) → `target_minutes` updated, `routines.estimated_duration_minutes` updated on the new active version, one new `plan_versions` row, future commitments' minutes updated; a `replace` proposal accepted → `workout_template_exercises.exercise_id` swapped on FULL and SHORT; `reject` → template untouched; `GET /proposals?sourceKind=WORKOUT` filters; cron method callable directly with a fixed `now`.

**Docs (docs-dev)** — `docs/specs/health-domain.md` "Adaptation detectors" table (thresholds, change ops); `docs/API.md`; `CLAUDE.md` endpoints.

#### Acceptance criteria
- [ ] Two skipped/missed commitments of one template within 14 days produce exactly one `PROPOSED` proposal with `sourceKind WORKOUT` and a `reduce` change; a third skip within the window produces none
- [ ] Two completed sessions running ≥ 15 min over target produce a `reduce` proposal with the measured average in the reason
- [ ] An exercise with zero sets in the last three completed sessions produces a `replace` change whose `after` is an alternative from the program's substitutions or the same substitution group
- [ ] `POST …/dislike {disliked:true}` produces a `replace` proposal on the next run
- [ ] Accepting through `POST /proposals/:id/accept` changes the template (and the linked routine on the new plan version), future commitments, and creates a new plan version; rejecting changes nothing
- [ ] No workout table is modified by the detector itself
- [ ] The daily cron runs for users with an `ACTIVE` program only and is idempotent across runs

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (E06-04 change shape + optional `workout` extension, thresholds, de-dup window)
- [ ] Error handling: a failure for one user in the cron is logged and does not stop the loop
- [ ] Observability: audit `workout_adaptation:propose`; cron span with `workout.users`, `workout.proposals` attributes; log line per run
- [ ] Security: `run` scoped to the caller; cron uses a system actor (`actorId null`) in audit meta
- [ ] Config & secrets: `WORKOUT_ADAPTATION_CRON` (default `0 4 * * *`) in `configuration.ts` + `.env.example`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script step 17.
2. `curl -X POST …/api/workouts/templates/<t>/exercises/<te>/dislike -d '{"disliked":true}'`; `POST …/adaptation/run` → `created 1`; `select changes->0->>'op', changes->0->'workout'->'replaceExercise' from plan_change_proposals order by created_at desc limit 1;` → `replace` with the two ids.

#### Out of scope
- Travel and "available days changed" signals (E10 weekly planning captures them and can call `proposeSubstitution`/`reduce` later).
- Free-text AI rewrites of programs (regeneration is E09-07 (#95)'s explicit user action).

#### Notes for the implementing agent
- Read E06-04 (#76) first (`plan-change.schema.ts`, `apply-changes.ts`, `proposals.service.ts`); extend, do not fork. The `workout` extension must stay optional so `PlanChangeDiff`/`ProposalCard.tsx` (E06-07 (#86)) render workout proposals unchanged; the effect hook is the only change to `accept`.
- Do not emit `move`, `add`, `remove` or `pause` from the detectors; a workout proposal is always `reduce` or `replace` on a template's routine.
- Cron pattern: `apps/api/src/storage/tasks/storage-cleanup.task.ts`.
- All time windows use the profile timezone via `apps/api/src/today/local-date.ts`.

---

### E09-06 `feat(api): add form-check, equipment-check and meal-check media coaching` — #92

**Part of epic:** E09 · **Blocked by:** E09-03 (#81), E03-04 (#83), E03-06 (#91), E01-06 (#26) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
The E03 pipeline exists so the coach can look at a set, the equipment in front of the user, or a plate (E03 Goal), but E03-07 (#96)'s generic `/ask` knows nothing about the exercise, load or reps of the set being filmed, cannot turn a photo of a gym into program substitutions, and has no typed contract for form cues or nutrition behaviors. PRD §45/§81 require that pain or injury signals redirect to professional care instead of programming advice; PRD §46 and VISION §16 forbid turning meal photos into calorie accounting.

#### Proposed solution
Three typed endpoints in `apps/api/src/workouts/media/` (form-check, equipment-check) and `apps/api/src/health-domain/nutrition/` (meal-check), each: `MediaAttachmentsService.getOwned` + purpose check → `media_analyst` persona with a purpose-specific prompt, session/exercise context and one attachment → Zod contract → safety post-processing → stored in `MediaAttachment.aiSummary` with a `kind` discriminator.

**Data (database-dev)** — n/a. `media_attachments.ai_summary` (E03-02 (#74)) stores `{ kind: 'form_check'|'equipment_check'|'meal_check', ...output, askedAt, invocationId, promptVersion, model, context }`.

**API (backend-dev)** — files: `workouts/media/form-check.service.ts`, `workouts/media/equipment-check.service.ts`, `workouts/media/workout-media.controller.ts` (`@ApiTags('Workouts')`), `workouts/media/prompts/{form-check,equipment-check}.prompt.ts`, `workouts/media/schemas/{form-check,equipment-check}.schema.ts`; `health-domain/nutrition/meal-check.service.ts`, `health-domain/nutrition/nutrition.controller.ts` (`@ApiTags('Health Domain')`, `@Controller('nutrition')`), `health-domain/nutrition/prompts/meal-check.prompt.ts`, `health-domain/nutrition/schemas/meal-check.schema.ts`; `health-domain/health-domain.module.ts` (imports `PrismaModule`, `AiModule`, `MediaModule`; registered in `app.module.ts`).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/workouts/sessions/:id/form-check` | `@Auth()`, owner of session and attachment | `{ attachmentId: uuid, exerciseId: uuid, setNumber?: int }` | 200 `{ ok: true, result: FormCheckResult, attachmentId, invocationId }` or 200 `{ ok: false, error: { code, message } }`; 400 wrong purpose (must be `WORKOUT_FORM`) or processing failed; 409 still processing; 429 (reuse E03-07 (#96) `mediaAskThrottle`, 10/min) |
| POST | `/api/workouts/equipment-check` | `@Auth()` | `{ attachmentId: uuid (purpose EQUIPMENT), programId?: uuid }` | 200 `{ ok: true, result: EquipmentCheckResult }` / `{ ok: false, error }` |
| POST | `/api/nutrition/meal-check` | `@Auth()` | `{ attachmentId: uuid (purpose MEAL), question?: string ≤ 300 }` | 200 `{ ok: true, result: MealCheckResult }` / `{ ok: false, error }` |

Contracts:

```ts
export const formCheckSchema = z.object({
  observations: z.array(z.string().max(200)).max(6),
  cues: z.array(z.string().max(160)).max(3),
  riskFlags: z.array(z.enum(['pain_reported','joint_instability','spinal_rounding_under_load','loss_of_control','unclear_footage','none'])).min(1),
  safetyNote: z.string().max(300).optional(),
  confidence: z.enum(['low','medium','high']),
});
export const equipmentCheckSchema = z.object({
  equipmentDetected: z.array(z.enum(['BODYWEIGHT','DUMBBELL','BARBELL','MACHINE','CABLE','KETTLEBELL','BAND','BENCH'])),
  notes: z.array(z.string().max(200)).max(5),
});
export const mealCheckSchema = z.object({
  observations: z.array(z.string().max(200)).max(5),
  behaviorSuggestions: z.array(z.object({ key: z.enum(NUTRITION_BEHAVIOR_KEYS /* E09-10 (#113) */), text: z.string().max(200) })).max(3),
});
```

Form-check: input `{ exercise: { name, instructions, pattern }, set: { weightKg, reps, rpe } | null, video: { durationMs, frameTimestampsMs } }` (`set` from the latest `set_logs` row for `exerciseId`/`setNumber` when given); instructions (`FORM_CHECK_PROMPT_VERSION = 'form_check.v1'`): describe only what is visible; up to 3 cues in plain language; set `riskFlags` from the fixed list, `pain_reported` when the user's set has `discomfort !== NONE` (passed in input) — never diagnose (VISION §48). Post-processing: if `riskFlags` ∩ `{pain_reported, joint_instability}` ≠ ∅ **or** the session's `discomfortFlag` is true → `result.cues = []`, `result.safetyNote = PAIN_SAFETY_COPY` (E09-03 (#81)), `result.redirected = true`; audit `workout_media:form_check` `{ sessionId, exerciseId, attachmentId, invocationId, ok, riskFlags, redirected }`. Attachment target must be `('workout_session', sessionId)` or unset (then set it).

Equipment-check: instructions (`equipment_check.v1`) list equipment from the enum only; post-processing (deterministic, no AI): for the user's `ACTIVE` program (or `programId`) find FULL-template exercises whose `equipment` ∩ `equipmentDetected ∪ {BODYWEIGHT}` = ∅ and pick the first catalog exercise in the same `substitutionGroup` whose equipment fits → `result.substitutions: [{ exerciseId, exerciseName, alternativeExerciseId, alternativeName, reason: 'No <equipment> detected' }]`; response `EquipmentCheckResult = { equipmentDetected, notes, substitutions }`. When `substitutions.length > 0` and a program is active, call `WorkoutAdaptationService.proposeSubstitution(userId, programId, substitutions, 'equipment_unavailable')` (E09-05 (#88)) so the change goes through E06's accept — the check itself mutates nothing. Audit `workout_media:equipment_check`.

Meal-check: instructions (`meal_check.v1`): observe at the behavior level (protein source present, vegetables present, portion pattern, eating context); suggest at most three behaviors from `NUTRITION_BEHAVIOR_KEYS` (E09-10 (#113); until it lands, the enum literal list from PRD §46 is defined here and moved later); **never** estimate calories, macros, grams or weight; never judge the person. Post-processing guard: reject (`{ ok: false, error: { code: 'schema', message: 'The coach returned numbers we do not use' } }`) when any output string matches `/\b(kcal|calorie|calories|carbs?|macros?|grams? of|\d+\s?g\b)\b/i`. Audit `nutrition:meal_check`.

All three persist `aiSummary` via `MediaAttachmentsService.storeSummary(id, userId, summary)` (add this small method in `apps/api/src/media/media-attachments.service.ts`; it replaces the whole JSON). Gateway call shape for all: `ai.invoke({ persona: 'media_analyst', userId, promptVersion, instructions, input, attachments: [{ storageObjectId, detail: kind === 'VIDEO' ? 'low' : 'auto' }], schema, schemaName: 'form_check'|'equipment_check'|'meal_check', maxOutputTokens: 600 })`.

OpenAPI: tag `Health Domain` (group "Health") added to `tags.ts` alongside `Workouts`.

**UI (frontend-dev)** — n/a (E09-09 (#111)).

**Tests (testing-dev)**
- `form-check.service.spec.ts` (gateway + media mocked): builds input with the set context; `riskFlags ['pain_reported']` → cues emptied, `safetyNote === PAIN_SAFETY_COPY`, `redirected true`; session `discomfortFlag` → redirected even with `['none']`; wrong purpose → 400; processing → 409; `{ok:false}` passthrough, `aiSummary` untouched; stored summary has `kind 'form_check'`.
- `equipment-check.service.spec.ts`: detected `[DUMBBELL, BENCH]` with a program containing Lat Pulldown (CABLE/MACHINE) → substitution to Band Pulldown? no — `BAND` not detected → next fit in `vertical_pull` with `BODYWEIGHT|DUMBBELL|BENCH` → Pull-Up (`BODYWEIGHT`); `proposeSubstitution` called once; no program → `substitutions []` and no call.
- `meal-check.service.spec.ts`: output containing "≈ 600 kcal" → `ok false, code schema`; clean output → stored with `kind 'meal_check'`; `behaviorSuggestions` keys validated against the enum.
- Prompt specs: form-check instructions contain "only what is visible" and "never diagnose"; meal-check instructions contain "never" and "calories".
- `apps/api/test/workouts/workout-media.integration.spec.ts`: with `AiGatewayService` and the resolver stubbed — form-check 200 `ok:true`; foreign attachment → 404; purpose `MEAL` on form-check → 400; meal-check 200; equipment-check creates a WORKOUT proposal when substitutions exist.

**Docs (docs-dev)** — `docs/API.md` three endpoints with both 200 shapes; `docs/specs/health-domain.md` "Media coaching contracts", "Safety redirect", "No-calorie guard"; `docs/specs/media-attachments.md` gets a one-line pointer "purpose-specific consumers: E09-06 (#92)"; `CLAUDE.md` endpoints.

#### Acceptance criteria
- [ ] `POST /api/workouts/sessions/:id/form-check` with a ready `WORKOUT_FORM` video returns observations, cues and risk flags, and stores them on the attachment with `kind: 'form_check'`
- [ ] When the AI flags pain/instability or the session has `discomfortFlag`, the response carries the PRD §45 copy and **no cues**
- [ ] `POST /api/workouts/equipment-check` returns detected equipment and, for an active program, substitutions from the same substitution group — and creates a `WORKOUT` proposal rather than editing the program
- [ ] `POST /api/nutrition/meal-check` returns behavior-level observations and suggestions; any output containing calorie/macro/gram numbers is rejected
- [ ] Wrong purpose → 400; foreign attachment → 404; still processing → 409; provider failures → 200 `{ ok: false }`
- [ ] `ai_invocations` rows show `persona media_analyst` with `attachment_count` = frame count for videos

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (schemas, purpose checks, guard regex)
- [ ] Error handling: gateway results never throw; safety post-processing runs on every `ok: true`
- [ ] Observability: audit per call with `riskFlags`/`redirected`; `@Trace` spans `workouts.media.form_check` etc.; no image bytes or prompt text logged
- [ ] Security: owner checks on both session and attachment; attachment purpose enforced; outputs stored only after schema validation
- [ ] Config & secrets: none new (reuses `AI_VIDEO_MAX_FRAMES`)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script through step 9; upload `tests/e2e/fixtures/media/clip.mp4` via `POST /api/storage/objects` and attach with `purpose WORKOUT_FORM`, `targetType workout_session`, `targetId <s>` (E03-04 (#83)). Poll until `ready`.
2. `curl -X POST …/api/workouts/sessions/<s>/form-check -d '{"attachmentId":"<a>","exerciseId":"<e>","setNumber":1}' | jq .data.result` → observations/cues/riskFlags. With header `x-fake-behaviour: form_check_pain` (E09-11 (#114)) → `cues: []`, `safetyNote` present.
3. Attach `photo.jpg` as `EQUIPMENT`; `POST …/api/workouts/equipment-check` → `equipmentDetected` and `substitutions`; `select source_kind from plan_change_proposals order by created_at desc limit 1;` → `WORKOUT` when substitutions were non-empty.
4. Attach `photo.jpg` as `MEAL`; `POST …/api/nutrition/meal-check` → no "kcal" anywhere in the JSON.

#### Out of scope
- Rendering (E09-09 (#111)). Free-form questions on workout media (E03-07 (#96) `/ask` remains for that).
- Rep counting, tempo measurement or any biomechanical scoring.

#### Notes for the implementing agent
- Copy `MediaAttachmentsService.ask` (E03-07 (#96)) for the gateway/throttle/audit skeleton; differences are the prompt, the schema, the context input and the post-processing.
- `PAIN_SAFETY_COPY` comes from `apps/api/src/workouts/safety/workout-safety-copy.ts` (E09-03 (#81)); do not duplicate the text.
- `NUTRITION_BEHAVIOR_KEYS` lives in `apps/api/src/health-domain/nutrition/nutrition-behaviors.ts` (E09-10 (#113)); if E09-10 (#113) has not landed, create that file here with the PRD §46 list and E09-10 (#113) extends it.

---

### E09-07 `feat(web): add program builder wizard and program views` — #95

**Part of epic:** E09 · **Blocked by:** E09-02 (#77), E02-05 (#51) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §37 requires a builder with the seven inputs; VISION §14 shows the review format (a per-workout table of Exercise / Sets / Target) and insists the plan "exist outside the conversation"; PRD §44 requires full/short/minimum versions to be visible and clearly not equivalent; PRD §106 "User can create workout program. Program persists." No web surface exists for programs.

#### Proposed solution
Three routes under `/health/programs` inside `Layout`: a list, a builder wizard with a proposal review, and a program detail with the weekly structure and FULL/SHORT/MINIMUM tabs.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E09-02 (#77)).

**UI (frontend-dev)**
- Routes (`apps/web/src/App.tsx`, inside the `NotificationProvider`+`Layout` group): `/health/programs` → `WorkoutProgramsPage`, `/health/programs/new` → `ProgramBuilderPage`, `/health/programs/:programId` → `WorkoutProgramPage`. Register `'/health'` in `DESTINATION_ROUTES.path` (`apps/web/src/config/destinations.ts`; Health programs are part of the Path hierarchy) and add title entries "Programs", "Build a program", "<program name>" to the AppBar title resolver.
- `apps/web/src/types/index.ts`: `Equipment`, `MovementPattern`, `WorkoutVariant`, `Exercise`, `WorkoutProgram`, `WorkoutProgramSummary`, `WorkoutTemplate`, `WorkoutTemplateExercise`, `GenerateProgramRequest`, `GenerateProgramResult`. `services/api.ts`: `listExercises(params)`, `generateWorkoutProgram(body)`, `listWorkoutPrograms(status?)`, `getWorkoutProgram(id)`, `approveWorkoutProgram(id, body)`, `archiveWorkoutProgram(id)`, `deleteWorkoutProgram(id)`. Hook `hooks/useWorkoutPrograms.ts` (`{ programs, isLoading, error, refresh, generate, approve, archive, remove }`).
- `pages/WorkoutProgramsPage.tsx`: list of `ProgramCard`s (name, status chip, days/week, weeks, "Active" badge); empty state "No program yet" + **Build a program**; below `sm` one column, ≥ `sm` a 2-column grid; FAB "Build" below `sm`.
- `pages/ProgramBuilderPage.tsx` with `components/workouts/builder/`: `BuilderWizard.tsx` (steps **Goal** → **You** (experience radio, days 2–5 toggle group, minutes slider 20–75) → **Equipment** (chips from the `Equipment` enum + the **Photograph your equipment** slot E09-09 (#111) fills; hidden until then) → **Preferences & limitations** (two text fields; helper "Tell me about pain or injuries in plain words — I'll keep the plan conservative and won't diagnose") → **Review**); defaults from `user.profile.healthBaseline` (E04) mapped `experience` (`NONE`→`BEGINNER`, `ADVANCED`→`INTERMEDIATE`), `daysPerWeek` clamped 2–5, `minutesPerSession` clamped, equipment strings mapped to the enum where they match. **Generate** → `aria-busy` skeleton "Building your program…" → `ProgramProposalReview.tsx`: program name, duration, weekday chips, one `TemplateTable` per FULL template with tabs **Full / Short / Minimum** (`Tabs` — parallel content: three views of one workout, allowed by the Settings-UI rule), columns Exercise / Sets / Target (`8–12`) / Rest, substitutions list, rationale `<blockquote>`, and a `source === 'starter'` `Alert` with the reason copy ("The coach is unavailable — start from a starter template" / "The coach's draft broke a safety rule, so here is a safe starter instead" / the professional-care copy for `safety_redirect`). Buttons **Approve** (opens `ApproveDialog`: preferred time `TextField type="time"` default 07:00, start date default tomorrow) and **Regenerate** (re-posts with the same inputs; `DELETE` the previous draft first). On approve → navigate to `/health/programs/:id` with a snackbar "Your first two weeks are on Today".
- `pages/WorkoutProgramPage.tsx`: header (name, status, **Archive** menu), `WeeklyStructure.tsx` (7 weekday cells, training days show the template name), per-template `TemplateTable` with the Full/Short/Minimum tabs and the target minutes per variant plus the fixed caption "Short and minimum versions keep you on the path — they are not the same training stimulus" (PRD §44), "Proposed change" badge per template when `GET /proposals?sourceKind=WORKOUT&status=PROPOSED` (E06-04 (#76)) has one, linking to `/coach`. Exercise rows expand to the catalog `instructions`.
- Responsive: tables become stacked cards below `sm` (`useMediaQuery(down('sm'))`, local choice, not a coupled gate). a11y: wizard steps are a `Stepper` with `aria-current`; tabs have `aria-controls`; tables have `<caption>`; the busy state is announced via `aria-live="polite"`; touch targets ≥ 44 px.

**Tests (testing-dev)** — MSW handlers for the E09-02 (#77) endpoints with mutable state (`apps/web/src/__tests__/mocks/handlers.ts`, fixtures `mocks/workouts.data.ts`). `__tests__/pages/ProgramBuilderPage.test.tsx`: defaults from the baseline; the wire test asserts the exact `generate` body; skeleton then review with 3 template tables; starter `Alert` per reason; **Approve** posts `{ preferredTime, startDate }` and navigates; **Regenerate** deletes then generates. `__tests__/pages/WorkoutProgramPage.test.tsx`: tabs switch variant content; caption present; proposal badge rendered; archive confirm → `archive` called. `__tests__/pages/WorkoutProgramsPage.test.tsx`: empty state; grid vs list at the `sm` boundary. `__tests__/config/destinations.test.ts`: `/health/*` owned by `path`. `vitest-axe` on all three pages in both layouts.

**Docs (docs-dev)** — `docs/specs/health-domain.md` "Web surfaces" section (via E09-11 (#114)); `CLAUDE.md` no change (not a settings page).

#### Acceptance criteria
- [ ] `/health/programs` lists the user's programs and offers **Build a program** when empty
- [ ] The wizard prefills from the onboarding health baseline and posts the exact `GenerateProgramRequest`
- [ ] The review shows one table per FULL template with Full/Short/Minimum tabs, substitutions and the rationale
- [ ] `source: 'starter'` shows the reason-specific alert and still allows approval
- [ ] **Approve** activates the program and lands on its detail page; the detail shows the weekly structure and the non-equivalence caption
- [ ] Below 600 px tables render as cards; at ≥ 600 px as tables; axe reports no violations
- [ ] `/health/*` highlights the Path destination; the route-ownership test passes

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (routes, api functions, registry)
- [ ] Error handling: 412 → link to `/settings/ai-key`; 409 on approve → refresh and show the current status; network errors keep the wizard inputs
- [ ] Observability: none beyond API audit
- [ ] Security: AI strings rendered as text only
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 5–7 and 18.
2. Resize below 600 px on the review: tables become cards; the BottomNav is visible (this route is inside `Layout`).

#### Out of scope
- Per-exercise manual editing of a program (follow-up); equipment photo slot content (E09-09 (#111)).

#### Notes for the implementing agent
- Copy the wizard shell from `apps/web/src/pages/OnboardingPage.tsx` (E04-03 (#102)) rather than building a new stepper.
- Keep `ProgramProposalReview` free of runner concerns; E09-08 (#109) owns everything under `/workout`.

---

### E09-08 `feat(web): add full-screen workout runner with rest timer and offline set queue` — #109

**Part of epic:** E09 · **Blocked by:** E09-03 (#81), E09-04 (#85), E05-05 (#48) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §41 specifies the runner (header "Upper A · Workout 3 of 18", current exercise with "Last time", set inputs, `Complete set`, rest timer); PRD §11 says the workout runner replaces the bottom navigation while a workout runs; PRD §121 requires queued, replayable logging under intermittent connectivity; PRD §123 mobile-first with large targets; PRD §44 short/minimum switch; PRD §45 pain handling. E05's generic `/start/:id` timer is not a workout runner.

#### Proposed solution
`/workout/:sessionId`, a full-screen route inside `ProtectedRoute` and the E01/E04 gates but outside `NotificationProvider`+`Layout` — exactly the `/start/:commitmentId` pattern — with a set-logging screen, a timestamp-based rest timer, variant switching, a `localStorage` outbox keyed by `clientId` that replays through `sets/batch`, and the E09-04 (#85) suggestion rendered as a chip with a tappable explanation.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E09-03 (#81)/E09-04 (#85)).

**UI (frontend-dev)**
- Route (`apps/web/src/App.tsx`): `<Route path="/workout/:sessionId" element={<WorkoutRunnerPage />} />` as a sibling of `/start/:commitmentId` and `/activate`. Add `'/workout'` to `UNOWNED_ROUTES` in `apps/web/src/config/destinations.ts`. **Do not touch** `Layout.tsx`, `BottomNav.tsx`, `SettingsHub.tsx` or `AppBar.tsx` gates — the route mounts no shell, so no nav exists to hide.
- Entry points: Today's Health `CommitmentRow` (E05-04 (#46)) shows **Start workout** instead of `Start N min` when `commitment.workoutTemplateId` is set (E02-04 (#47)'s card DTO must expose it — add `workoutTemplateId` to `CommitmentCard` in E09-03 (#81) if missing); it calls `startWorkoutSession({ commitmentId, variant })` (variant picker: Full / Short / Minimum with minutes) then navigates to `/workout/:id`. A `409 SESSION_IN_PROGRESS` navigates to the open session. Program detail (E09-07 (#95)) gets **Start this workout** on each FULL template (ad-hoc session by `templateId`).
- Types/api: `WorkoutSessionView`, `SetLog`, `ProgressionSuggestion`, `FinishSummary`; `startWorkoutSession`, `getWorkoutSession`, `logWorkoutSet`, `logWorkoutSetsBatch`, `switchWorkoutVariant`, `finishWorkoutSession`, `explainProgression`.
- `pages/WorkoutRunnerPage.tsx` + `components/workouts/runner/`: `RunnerHeader.tsx` (`"Upper A · Workout 3 of 18"`, elapsed time, ⋯ menu: **Use short version / Use minimum version**, **Check my form** (E09-09 (#111) slot), **End workout**), `ExerciseCard.tsx` (name, equipment, prescription `3 × 8–12 · rest 90 s`, "Last time: 20 kg × 12, 12, 11" or "Last time: —", `ProgressionChip` (`Suggest 22.5 kg` / `Hold 20 kg` / `Try 19 kg`; tap → `explainProgression` → sentence in a `Popover`; `discomfort` reason renders the safety copy), `SetRow` list with the suggested weight prefilled for set 1 and the last logged weight for later sets), `SetInputs.tsx` (weight `TextField type="number" inputMode="decimal" step=0.25`, reps `inputMode="numeric"`, RPE optional `Slider` 1–10 collapsed behind "Add RPE", discomfort `ToggleButtonGroup` None / Mild / Sharp pain; **Complete set** primary button, min height 56 px), `RestTimer.tsx` (starts at `Date.now()` on complete; remaining = `restSeconds − (now − startedAt)/1000` recomputed on every tick and on `visibilitychange`, so backgrounding the tab does not drift; **Skip rest** / **+30 s**; announces "Rest over" via `aria-live` and vibrates when `navigator.vibrate` exists), `SafetyCard.tsx` (PRD §45 copy from the API response; buttons **Stop this exercise** (marks remaining sets skipped locally, advances) / **End workout**; no programming advice), `FinishDialog.tsx` (summary `sets · volume · minutes`, notes, **Finish** → `finish {status: COMPLETED}` → navigate `/` with a snackbar; **Abandon** → `ABANDONED`).
- Offline outbox `hooks/useSetLogOutbox.ts`: on **Complete set** mint `clientId = crypto.randomUUID()`, append `{ clientId, sessionId, body, loggedAt }` to `localStorage['workout.outbox.<sessionId>']`, render the set optimistically with a "Saved on this device" badge, then `logWorkoutSet`; on success remove from the outbox and clear the badge; on network error (or `!navigator.onLine`) keep it and retry every 5 s and on `online`; replay uses `logWorkoutSetsBatch` when ≥ 2 items are queued; `duplicates` are treated as success; `rejected` items show an inline error with **Edit** / **Discard**. On mount, replay any outbox for this session before rendering the view. Wrap all `localStorage` access in try/catch (private mode). Outbox for sessions no longer `IN_PROGRESS` is discarded with a snackbar.
- Reload safety: the page loads `GET /sessions/:id` on mount; the rest timer restarts from the newest `logged[].loggedAt` when younger than `restSeconds`.
- Responsive/a11y: one column at every width, `maxWidth="sm"` centered ≥ `sm`; high-contrast mode via `theme.palette.mode` with 4.5:1 text; all controls reachable by keyboard; the current exercise is an `<h2>`; `Complete set` is a `type="submit"` so Enter works.

**Tests (testing-dev)** — MSW handlers with mutable session state (`mocks/workouts.data.ts`). `__tests__/pages/WorkoutRunnerPage.test.tsx` (fake timers): header text; last-time line; suggested weight prefilled; **Complete set** posts the exact body with a UUID `clientId` and `discomfort 'NONE'`; rest timer counts down and, after `vi.setSystemTime(+60 s)` plus a `visibilitychange`, shows the right remaining value; sharp pain → `SafetyCard` and no further set inputs for that exercise; variant switch re-renders the SHORT exercise list; finish → navigates to `/` and posts `COMPLETED`; 404 → "This workout is gone" with a link home. `__tests__/hooks/useSetLogOutbox.test.ts`: enqueue → success removes; network error keeps and retries on `online`; batch replay with a `duplicates` response clears the item; `rejected` surfaces; corrupt/unavailable `localStorage` does not throw. `__tests__/components/today/CommitmentRow.test.tsx` (extend): **Start workout** appears for `workoutTemplateId`; 409 navigates to the open session. `__tests__/config/destinations.test.ts`: `/workout/:sessionId` unowned. axe on the runner in light and dark themes.

**Docs (docs-dev)** — `docs/specs/health-domain.md` "Runner & offline outbox" (queue key, replay order, idempotency contract); `docs/TESTING.md` fake-timer note.

#### Acceptance criteria
- [ ] `/workout/<id>` renders full-screen — no AppBar, rail or BottomNav — and the five coupled gates are untouched (diff shows no change to `Layout.tsx`, `BottomNav.tsx`, `SettingsHub.tsx`, `AppBar.tsx`)
- [ ] Header reads `<template> · Workout N of M`; each exercise shows the last-time line and the progression chip with an explanation on tap
- [ ] **Complete set** logs the set with a client-minted `clientId`, prefilling the next set, and starts a rest timer that stays correct after the tab is backgrounded
- [ ] With the API unreachable, completed sets stay visible with "Saved on this device" and are replayed in order once online, producing no duplicate rows
- [ ] Reloading the page mid-session restores logged sets and the running rest timer
- [ ] Choosing **Sharp pain** shows the PRD §45 safety card and offers only stop/end actions
- [ ] Switching to Short/Minimum re-renders the exercise list; **Finish** returns to Today with the commitment updated
- [ ] Touch targets ≥ 44 px; axe clean in both themes

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (route, outbox key, batch replay)
- [ ] Error handling: 409 on start → open session; 404 → friendly page; outbox never blocks logging
- [ ] Observability: none client-side beyond existing error boundary
- [ ] Security: outbox holds only set numbers/weights/reps; cleared on finish; no tokens
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 8–12.
2. Chrome DevTools → Network → Offline; complete two sets; badges appear; go Online; badges clear; `select count(*) from set_logs where session_id='<s>';` equals the sets shown.

#### Out of scope
- Form-check capture inside the runner (E09-09 (#111) fills the menu slot).
- Editing past sessions; a history screen (E11 progress timeline reads `evidence`).

#### Notes for the implementing agent
- Copy `pages/StartFlowPage.tsx` (E05-05 (#48)) for the full-screen route wiring and the server-derived timer approach; the rest timer is client-only but uses the same "compute from timestamps, never count" rule.
- `crypto.randomUUID()` is available in all supported browsers; do not add a UUID dependency.
- Never touch the five coupled breakpoint gates (CLAUDE.md, Settings UI rule 5); full-screen comes from route placement only.

---

### E09-09 `feat(web): add health media flows from the runner, builder and quick add` — #111

**Part of epic:** E09 · **Blocked by:** E09-06 (#92), E09-07 (#95), E09-08 (#109), E03-06 (#91), E05-06 (#52) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
The three E09-06 (#92) endpoints need entry points where the user actually is: filming a set from the runner (PRD §41 context), photographing the gym while building a program (PRD §43 "equipment unavailable"), and checking a meal from Today's quick add (PRD §12.1 quick add, VISION §16). E03-06 (#91)'s `MediaAttachmentPicker` and E03-07 (#96)'s `MediaAdviceCard` exist; nothing mounts them for these purposes.

#### Proposed solution
Three thin flows reusing `MediaAttachmentPicker` (with `capture="environment"` below `sm`) and a shared `HealthMediaResult` renderer, each: pick → attach with the right purpose/target → wait for `ready` (processing state while frames are sampled) → call the typed endpoint → render inline and keep the result on the attachment.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (E09-06 (#92)). `services/api.ts`: `formCheck(sessionId, body)`, `equipmentCheck(body)`, `mealCheck(body)`. Types: `FormCheckResult`, `EquipmentCheckResult`, `MealCheckResult`, `HealthMediaResult` union with `kind`.

**UI (frontend-dev)**
- `components/workouts/media/FormCheckSheet.tsx` (`{ open, onClose, sessionId, exerciseId, exerciseName, setNumber? }`): opened from the runner's ⋯ menu **Check my form** and from a small camera icon on each `ExerciseCard` (E09-08 (#109) slot). Body: `MediaAttachmentPicker purpose="WORKOUT_FORM" targetType="workout_session" targetId={sessionId} maxFiles={1}`; while `processingStatus === 'processing'` show `LinearProgress` + "Sampling frames from your video…"; when ready, **Ask the coach** → `formCheck` → `FormCheckResultCard` (observations list, cues as numbered steps, risk flags as `Chip`s with an icon **and** text, `safetyNote` as an `Alert severity="warning"` with the PRD §45 copy when `redirected`; cues hidden when redirected). Container: `SwipeableDrawer anchor="bottom"` below `sm`, `Dialog maxWidth="sm"` otherwise (local layout choice — not a coupled gate). The runner stays mounted behind it; the rest timer keeps running.
- `components/workouts/builder/EquipmentPhotoStep.tsx`: fills the E09-07 (#95) **Equipment** step slot: **Photograph your equipment** (`MediaAttachmentPicker purpose="EQUIPMENT"`), processing state, then `equipmentCheck({ attachmentId })` → detected equipment becomes **pre-selected chips** the user can still edit (the API result never overrides a manual choice), notes shown as helper text. On the program detail page (E09-07 (#95)) the same component under **Equipment changed?** additionally passes `programId` and renders the substitutions list with "Proposed change sent to your coach" when the API created a proposal.
- `components/today/MealCheckSheet.tsx`: E05-06 (#52)'s `QuickAddSheet` gains two enabled kinds — **Workout** (now enabled: lists the active program's FULL templates → `startWorkoutSession({ templateId })` → `/workout/:id`; disabled with "Build a program first" when none, linking `/health/programs/new`) and **Meal check** (`MediaAttachmentPicker purpose="MEAL"`, optional question, **Check** → `mealCheck` → `MealCheckResultCard`: observations and up to three behavior suggestions, each with **Add as a commitment** which opens E05-06 (#52)'s `CommitmentEditorForm` prefilled with the behavior title from E09-10 (#113)'s registry, domain HEALTH, tonight). Explicit copy line under the result: "I look at habits, not calories."
- Shared `components/health/HealthMediaResultCard.tsx` renders any `HealthMediaResult` by `kind`; also used by E03-07 (#96)'s `MediaLibraryPage` for attachments whose `aiSummary.kind` is one of the three (extend `MediaAdviceCard`'s switch).
- a11y: risk flags never color-only; the processing state uses `role="status"`; sheets trap focus; camera button labelled "Record a video of your set".

**Tests (testing-dev)** — MSW handlers for the three endpoints and the E03 attachment endpoints (reuse E03-06 (#91)'s mutable mock). `__tests__/components/workouts/media/FormCheckSheet.test.tsx`: capture input below `sm`; processing → ready → **Ask** posts `{ attachmentId, exerciseId, setNumber }`; redirected result hides cues and shows the warning; `ok:false no_user_key` shows the `/settings/ai-key` link. `EquipmentPhotoStep.test.tsx`: detected equipment pre-selects chips; user deselection persists in the wizard state; with `programId` the substitutions list renders. `MealCheckSheet.test.tsx`: **Workout** kind enabled only with an active program; meal result renders suggestions; **Add as a commitment** opens the editor with the prefilled title; no "kcal" text in the fixture render. `HealthMediaResultCard.test.tsx` per kind + axe.

**Docs (docs-dev)** — `docs/specs/health-domain.md` "Media entry points" (via E09-11 (#114)).

#### Acceptance criteria
- [ ] From the runner, **Check my form** opens the camera below 600 px (input has `capture="environment"`) and a drop zone at ≥ 600 px, shows a processing state while frames are sampled, and renders observations, cues and risk flags inline without leaving the session
- [ ] A redirected form-check shows the safety warning and no cues
- [ ] In the builder, an equipment photo pre-selects detected equipment chips that the user can still change
- [ ] Today's quick add offers **Workout** (starts a session from the active program) and **Meal check**; the meal result shows behavior suggestions and the "habits, not calories" line, and a suggestion can become a Health commitment
- [ ] Results persist: reopening the attachment in `/media` shows the same card
- [ ] axe clean in both layouts; risk flags carry text labels

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (props, purposes, targets)
- [ ] Error handling: 409 processing → keep polling; 400 wrong purpose → inline error; `ok:false` → retry + key link
- [ ] Observability: none client-side
- [ ] Security: media never leaves the E03 upload path; AI strings rendered as text
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 13–15.
2. Chrome device mode (390 px): in the runner tap the camera icon on an exercise → the file input carries `capture="environment"`.

#### Out of scope
- Trimming or previewing video before upload; multi-video comparisons; a nutrition log.

#### Notes for the implementing agent
- Reuse `apps/web/src/components/media/MediaAttachmentPicker.tsx` and `useMediaUpload` (E03-06 (#91)) verbatim; the only new logic is which endpoint to call once `processingStatus === 'ready'`.
- The `QuickAddSheet` change replaces the disabled **Workout** button E05-06 (#52) left; keep its test file and update the assertion.

---

### E09-10 `feat(api): add nutrition behavior templates and body-weight trend` — #113

**Part of epic:** E09 · **Blocked by:** E09-01 (#72), E04-01 (#100), E05-06 (#52) · **Component:** api, web · **Priority:** P0 · **Agents:** backend-dev → frontend-dev → testing-dev → docs-dev

#### Problem statement
PRD §46 fixes the V1 nutrition scope as behaviors (planned breakfast, meal preparation, protein target behavior, vegetables, water, reducing late-night eating, weekday meal planning, restaurant strategy, planned snacks) and VISION §16 lists concrete examples; PRD §47 makes weight tracking optional, trend-oriented ("30-day trend") and explicitly forbids "bad day" judgments from one measurement. Neither a behavior registry nor a weight log exists.

#### Proposed solution
A static nutrition-behavior registry served by the API and used by quick add and the onboarding health step, weight log endpoints with a server-computed rolling 7-day mean, and a `/health` page with the log form and a 30-day trend chart that shows a trend line only.

**Data (database-dev)** — `BodyWeightLog` (E09-01 (#72)). `healthBaselineSchema` (E04-01 (#100), `apps/api/src/user-profile/`) gains `nutritionBehaviors: z.array(z.enum(NUTRITION_BEHAVIOR_KEYS)).max(3).optional()` — JSON column, no migration.

**API (backend-dev)** — `apps/api/src/health-domain/` (module from E09-06 (#92) or created here): `nutrition/nutrition-behaviors.ts` (`NUTRITION_BEHAVIORS` registry, modeled on `notification-events.ts`: `{ key, title, description, defaultTime: 'MORNING'|'MIDDAY'|'EVENING', fullVersion: {title, minutes}, minimumVersion: {title, minutes} }`; keys `planned_breakfast, meal_prep, protein_with_meals, vegetables_with_dinner, water_with_meals, no_late_night_eating, weekday_meal_plan, restaurant_strategy, planned_snacks, eat_at_table, limit_alcohol_work_nights`; `NUTRITION_BEHAVIOR_KEYS` derived), `nutrition/nutrition.controller.ts` (E09-06 (#92) file, extended), `weight/body-weight.controller.ts` (`@ApiTags('Health Domain')`, `@Controller('health/weight')` — **not** in `apps/api/src/health/`), `weight/body-weight.service.ts`, `weight/rolling-mean.ts` (pure).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/nutrition/behaviors` | `@Auth()` | — | 200 `{ items: NutritionBehavior[] }` (registry order) |
| POST | `/api/nutrition/behaviors/:key/commit` | `@Auth()` | `{ scheduledStart?: ISO (default today at `defaultTime` in the profile tz), repeatDays?: int 1..7 (default 1) }` | 201 `{ commitmentIds[] }` — creates HEALTH commitments via E02-04 (#47) `CommitmentsService.create` with full/minimum versions from the registry and `metadata.nutritionBehaviorKey` |
| PUT | `/api/health/weight` | `@Auth()` | `{ dateLocal: YYYY-MM-DD (≤ today in the profile tz, ≥ today − 365), weightKg: number 20..400 step 0.1 }` | 200 `BodyWeightLogDto` — upsert on `(userId, dateLocal)` |
| GET | `/api/health/weight` | `@Auth()` | `from?`, `to?` (default last 30 days) | 200 `{ items: [{ dateLocal, weightKg }], trend: [{ dateLocal, rolling7Kg: number \| null }], summary: { first, last, deltaKg, days } \| null }` |
| DELETE | `/api/health/weight/:dateLocal` | `@Auth()` | — | 204 |

`rollingMean(items, window = 7)`: for each date in `[from, to]` the mean of logged values within the previous 7 calendar days including that day; `null` when fewer than 2 values fall in the window. `summary.deltaKg` = last rolling value − first non-null rolling value (rounded 0.1). No per-day classification, no "goal weight", no arrows per day — the DTO deliberately carries **no** field a client could use for daily judgment (assert in tests). Audit `health_weight:log` (`meta: { dateLocal }`, never the value), `health_weight:delete`, `nutrition:commit`.

**UI (frontend-dev)**
- Route `/health` → `pages/HealthPage.tsx` inside `Layout` (owned by `path`, E09-07 (#95) registered the prefix); AppBar title "Health". Sections: **Programs** (active program card → `/health/programs`), **Nutrition behaviors** (`NutritionBehaviorList.tsx`: registry cards with **Add to this week** → `commitNutritionBehavior(key, { repeatDays: 5 })` and a snackbar), **Weight** (`WeightLogForm.tsx`: date `TextField type="date"` default today, weight `inputMode="decimal"`, **Save**; `WeightTrendChart.tsx`).
- `WeightTrendChart.tsx`: inline SVG (no chart dependency — none is installed and one line chart does not justify one), `viewBox` responsive, `role="img"` with an `aria-label` summarizing "30-day trend: −0.3 kg over 21 logged days" and a visually-hidden `<table>` of the points for screen readers; **points muted** (`theme.palette.text.disabled`, r=3), **one trend line** for `rolling7Kg` (`theme.palette.primary.main`, 2 px), gaps where `null`; y-axis padded ±1 kg around the data; no red/green, no per-day markers or arrows, no annotations; caption text from `summary` ("7-day trend: −0.3 kg") or "Log a few more days to see a trend" when `summary === null`. Copy rule enforced in tests: no string in the component matches `/bad|good|great|oops|guilt/i`. Meaning is never carried by color alone (line vs points differ in shape and the caption states the number).
- Quick add (E05-06 (#52) `QuickAddSheet`): kind **Nutrition behavior** → list from `GET /nutrition/behaviors` → `commit`. Onboarding (E04-03 (#102) `HealthBaselineStep`): optional chips "Pick up to three eating habits to start with" saved into `healthBaseline.nutritionBehaviors`; `HealthPage` shows those as "Behaviors you chose" with the same **Add to this week** button (no automatic commitments at approve — stated decision, keeps E04-02 (#101)'s guardrails untouched).
- Types/api: `NutritionBehavior`, `BodyWeightLog`, `WeightTrend`; `listNutritionBehaviors`, `commitNutritionBehavior`, `putWeight`, `getWeight`, `deleteWeight`.

**Tests (testing-dev)**
- API: `weight/rolling-mean.spec.ts` (window edges, nulls under 2 values, unsorted input, month boundary); `body-weight.service.spec.ts` (upsert; future date → 400; delete idempotent; DTO has no keys beyond the documented ones — snapshot of `Object.keys`); `nutrition-behaviors.spec.ts` (unique keys, every entry has full/minimum versions with `minimum.minutes ≤ full.minutes`); `apps/api/test/health-domain/weight.integration.spec.ts` (PUT twice same date → one row; GET default 30-day window; 401; foreign user sees nothing); `nutrition.integration.spec.ts` (`commit` creates `repeatDays` HEALTH commitments with versions from the registry).
- Web: `__tests__/components/health/WeightTrendChart.test.tsx` (renders one `<path>` for the trend and N muted circles; `aria-label` contains the delta; empty and single-point states; no judgment words; axe); `__tests__/pages/HealthPage.test.tsx` (save posts `{ dateLocal, weightKg }`; behaviors list renders registry; **Add to this week** posts `commit`); `QuickAddSheet.test.tsx` extension; `HealthBaselineStep.test.tsx` extension (max 3 chips).

**Docs (docs-dev)** — `docs/API.md` nutrition + weight; `CLAUDE.md` endpoints and tables; `docs/specs/health-domain.md` "Nutrition behaviors registry" and "Weight trend rules" (rolling window, null rule, the no-judgment rule and why the DTO carries no daily classification).

#### Acceptance criteria
- [ ] `GET /api/nutrition/behaviors` returns the 11 registry behaviors; `POST …/:key/commit {repeatDays:5}` creates five HEALTH commitments with full and minimum versions
- [ ] `PUT /api/health/weight` upserts one row per local date; a future date is rejected
- [ ] `GET /api/health/weight` returns points, a rolling 7-day series with `null` where fewer than two values exist, and a summary delta — and no per-day judgment field
- [ ] `/health` shows the chart with muted points and one trend line, a caption with the 7-day delta, and no red/green or "bad day" copy; the chart has an `aria-label` and a hidden data table
- [ ] Quick add offers **Nutrition behavior**; the onboarding health step lets the user pick up to three behaviors that appear on `/health`
- [ ] Audit rows never contain the weight value

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified (registry keys, DTO shapes, chart rules)
- [ ] Error handling: 400 validation with field messages; 404 on foreign/absent dates
- [ ] Observability: audit `health_weight:log|delete`, `nutrition:commit`
- [ ] Security: owner-scoped; weight values excluded from logs and audit meta
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script step 16.
2. `curl -X PUT …/api/health/weight -d '{"dateLocal":"2099-01-01","weightKg":80}'` → 400.
3. `curl …/api/nutrition/behaviors/vegetables_with_dinner/commit -d '{"repeatDays":3}'` → 3 ids; Today's Health card lists "Vegetables with dinner" tonight.

#### Out of scope
- Calorie/macro logging, goal weights, BMI, body-fat, photos of the scale (PRD §46/§100).
- Weekly weight review copy (E10) and momentum from weight (E11 — momentum reads behavior evidence, not weight).

#### Notes for the implementing agent
- Chart rule of record for this epic (no dataviz skill guidance exists in the repo docs): trend line only, no daily judgment copy, accessible colors from the theme, meaning never carried by color alone.
- The registry pattern to copy is `apps/api/src/notifications/notification-events.ts`; the commit endpoint must go through E02-04 (#47)'s `CommitmentsService` so validation and audit match quick add.
- `@Controller('health/weight')` coexists with the probe controller; do not add `@Public()` and verify no path-based auth exemption exists for `/health*` in `apps/api/src/auth/` before wiring.

---

### E09-11 `test(tests): E09 end-to-end verification` — #114

**Part of epic:** E09 · **Blocked by:** E09-01 (#72), E09-02 (#77), E09-03 (#81), E09-04 (#85), E09-05 (#88), E09-06 (#92), E09-07 (#95), E09-08 (#109), E09-09 (#111), E09-10 (#113), E01-10 (#30), E03-08 (#103) · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → ops-dev → docs-dev

#### Problem statement
PRD §106 is a user-observable list (create program, persists, start workout, log sets, history next session, short/minimum available, AI recommends adjustment, user approves structural changes). Every child above proves its slice with unit and integration tests; nothing proves the loop through the real browser against the compose stack, and the epic has no spec document.

#### Proposed solution
A Playwright spec `tests/e2e/specs/health.spec.ts` driven by the fake OpenAI server extended with schema-driven fixtures for the four E09 schemas, a workouts API helper, `docs/specs/health-domain.md`, and the API/CLAUDE/README updates.

**Data (database-dev)** — n/a.

**API (backend-dev)** — Fake OpenAI server (`tools/fake-openai/server.mjs`, E01-10 (#30)): add fixtures `tools/fake-openai/fixtures/workout_program.json` (3 FULL templates "Upper A"/"Lower"/"Upper B" on weekdays 1/3/5 with SHORT and MINIMUM siblings, catalog exercise names only, `durationWeeks 6`), `form_check.json` (`riskFlags: ['none']`, 2 cues), `equipment_check.json` (`[DUMBBELL, BENCH]`), `meal_check.json` (no numbers), `progression_explanation.json`; behaviours `x-fake-behaviour: workout_program_unsafe` (same program with 5 weekdays and a Barbell Overhead Press under limitation "shoulder") and `form_check_pain` (`riskFlags: ['pain_reported']`). Fixture selection stays by `schemaName`, as E03-08 (#103) established.

**Infra (ops-dev)** — `tests/e2e/playwright.config.ts` `webServer.command` already includes `minio.compose.yml` and `fake-openai.compose.yml` (E03-08 (#103)); no change unless E03-08 (#103) left them out. Set `WORKOUT_ADAPTATION_CRON=0 0 31 2 *` (never) in the e2e env so only the on-demand run fires.

**UI (frontend-dev)** — `data-testid`s: `program-generate`, `program-approve`, `program-template-<name>`, `runner-header`, `runner-last-time`, `runner-progression-chip`, `runner-weight`, `runner-reps`, `runner-complete-set`, `runner-rest-timer`, `runner-safety-card`, `runner-finish`, `runner-form-check`, `form-check-result`, `weight-date`, `weight-value`, `weight-save`, `weight-trend-line`, `quickadd-meal-check`, `meal-check-result`.

**Tests (testing-dev)**
- `tests/e2e/helpers/workouts.helper.ts` (new): `apiPost/apiGet` (reuse E05-07 (#55)'s), `seedProgramViaApi(page, opts)` (generate + approve), `completeSessionViaApi(page, commitmentId, sets)` for fast history seeding, `moveCommitmentToNow(page, id)` (E05-02 (#40) reschedule action).
- `tests/e2e/specs/health.spec.ts`, fresh user per test via `loginAsTestUser` with `withAiKey`, onboarding completed through the API (E04-02 (#101) `skip-ai` + `approve`):
  1. **builds and approves a program** — `/health/programs/new`; fill goal, pick Beginner / 3 / 40 / Dumbbells+Bench; `program-generate`; expect three `program-template-*` tables and the Full/Short/Minimum tabs; `program-approve` → URL `/health/programs/<id>`; `apiGet('/api/workouts/programs/<id>')` → `status ACTIVE`; `apiGet('/api/commitments?from=&to=')` → 6 rows with `workoutTemplateId`.
  2. **unsafe draft falls back to the starter** — set the fake behaviour header via the E01-10 (#30) default-behaviour endpoint; generate with limitation "shoulder"; expect the starter alert text "safety rule" and approvability.
  3. **runs a session from Today, logs sets, finishes** — `moveCommitmentToNow`; `/`; click **Start workout** → Full; URL `/workout/<id>`; `runner-header` matches `/Upper A · Workout 1 of 18/`; `runner-last-time` reads "—"; log 3 sets (20 × 12); after each, `runner-rest-timer` visible; `runner-finish` → Complete; back on `/` row completed; `apiGet` session → `COMPLETED`; `GET /api/evidence?commitmentId=` includes `WORKOUT_LOG`.
  4. **offline queue replays without duplicates** — start a session; `context.setOffline(true)`; log 2 sets; expect two "Saved on this device" badges; `setOffline(false)`; `expect.poll` badges gone; `apiGet` session → `logged.length === 2`.
  5. **next session shows last time and a progression suggestion** — `completeSessionViaApi` twice with 3 × 12 @ RPE 7; start a third from the program page; `runner-last-time` contains "20 kg × 12, 12, 12"; `runner-progression-chip` contains "22.5"; click → popover sentence contains "22.5".
  6. **sharp pain shows the safety card** — choose Sharp pain, complete set → `runner-safety-card` visible with "professional"; no cues text.
  7. **form-check on a fixture video** — in the runner `runner-form-check`; `uploadViaPicker(page, 'fixtures/media/clip.mp4')` (E03-08 (#103) helper); wait for ready; Ask; `form-check-result` shows 2 cues; with `form_check_pain` behaviour the result shows the warning and no cues.
  8. **adaptation proposal after two skips** — skip the same template twice via the E05-02 (#40) skip action; `apiPost('/api/workouts/adaptation/run')` → `created 1`; `/coach` shows a proposal card with "min"; Accept; `apiGet` program → the template's `targetMinutes` reduced; `plan_versions` count +1 via `GET /plans/:id/versions`.
  9. **weight log and trend** — `/health`; log 8 dates via `PUT /api/health/weight` (API) then one via the form; `weight-trend-line` is a `<path>` with a non-empty `d`; the caption matches `/7-day trend: [−-]?\d+\.\d kg/`; no element text matches `/bad day/i`.
  10. **meal check from quick add** — `/` → `+` → `quickadd-meal-check`; upload `photo.jpg`; Check; `meal-check-result` visible; page text has no `kcal`.
  11. **mobile: runner is full-screen** (mobile project) — in `/workout/<id>` no `nav`/`role=navigation` element exists and the viewport height equals the page's scrollable height ± 1.

**Docs (docs-dev)**
- `docs/specs/health-domain.md` (new): scope and principles (VISION §13–§16, PRD §36–§47); data model with ER sketch; program builder contract (request, Zod contract, rules table with codes, starter template, approve semantics and the commitment scheduling formula); session lifecycle and the finish → commitment status table; idempotent set logging and the outbox protocol; progression rules verbatim; adaptation detectors table and de-dup window; media coaching contracts, safety redirect and the no-calorie guard; nutrition registry; weight trend rules and the no-judgment rule; env vars (`WORKOUT_ADAPTATION_CRON`); "Reading a workout session" psql snippet; rejected alternatives (LLM-computed progression, a `HealthBaseline` table, tabs for program pages vs routes, a chart library, server-side rest timer); follow-ups (manual program editing, deloads, exercise media).
- `docs/API.md`: Workouts and Health Domain sections; `CLAUDE.md`: endpoints, tables, env var, one line under "Adding a Notification" for `health.program_activated`; `docs/TESTING.md`: `health.spec.ts`, fake behaviours; `docs/epics/README.md` back-link to this file and the spec.

#### Acceptance criteria
- [ ] `cd tests/e2e && npx playwright test specs/health.spec.ts` passes on a clean clone with the compose stack (`minio` + `fake-openai` overlays), desktop and mobile projects
- [ ] The fake server answers `workout_program`, `form_check`, `equipment_check`, `meal_check` and `progression_explanation` schema names, and the two new behaviours
- [ ] `docs/specs/health-domain.md` exists and is linked from `CLAUDE.md`, `docs/API.md` and `docs/epics/README.md`
- [ ] Every PRD §106 line maps to at least one spec case (table in the spec doc)
- [ ] No `page.waitForTimeout` in the spec; readiness is polled through the API

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: each spec case fails with a named assertion, not a timeout
- [ ] Observability: the spec doc's psql snippets read `workout_sessions`, `set_logs`, `evidence`, `plan_change_proposals`, `ai_invocations`
- [ ] Security: fixtures synthetic; no real keys (fake server accepts `sk-test-…` only)
- [ ] Config & secrets: e2e env documented in `docs/TESTING.md`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script step 19 → 11 passed (desktop) + the mobile case.
2. Open `docs/specs/health-domain.md` and run its "Reading a workout session" snippet against the rows the spec created.

#### Out of scope
- Visual-regression baselines for the runner (add when the visual harness covers full-screen routes).
- Load testing the outbox replay.

#### Notes for the implementing agent
- Reuse `tests/e2e/helpers/media.helper.ts` (E03-08 (#103)) and the E05-07 (#55) API helpers; do not duplicate login or upload code.
- Fixture selection in `tools/fake-openai/server.mjs` is by `schemaName`; add files, not branches.
- Keep the spec independent of wall-clock weekdays: `moveCommitmentToNow` reschedules the first workout commitment to now instead of waiting for a training day.

---
