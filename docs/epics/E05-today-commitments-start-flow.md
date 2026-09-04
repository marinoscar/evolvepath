# E05 — Today Screen, Commitments Lifecycle & Start Flow

<!-- epic-meta: slug=today-commitments-start-flow phase=2 -->

## Epic

### Goal

Make `/` the product's primary surface: a Today screen that answers "what matters, what is next, why it matters" (VISION §27, PRD §12) with one deterministic **Next Best Action** (PRD §13), Work/Family/Health commitment cards, and the **Start** flow that treats starting as evidence distinct from completing (VISION §10, PRD §27, principle P4). Every commitment action a user can take from Today — start, pause, continue, complete, partial, use-fallback, reschedule, skip, make-it-smaller — becomes a server-side state transition with evidence, so later epics (E07 avoidance ladder, E10 planned-vs-actual, E11 momentum, E12 notification deep links) read real state instead of inferring it. The whole screen must render and every non-AI action must work with the AI provider down (PRD §120).

### Background

- E02 ships the domain model this epic drives: `Outcome`, `Plan`/`PlanVersion`, `Routine`, `Commitment` (status enum `PLANNED, READY, STARTED, COMPLETED, PARTIALLY_COMPLETED, RESCHEDULED, SKIPPED, MISSED, CANCELLED`; `fullVersion`/`shortVersion`/`minimumVersion`; `rescheduleCount`; `skipReason`), `Evidence` (source `USER_LOG | TIMER | WORKOUT_LOG | APP_FLOW`), `Reflection`, `DomainMode` (`GROW | MAINTAIN | RECOVER | PAUSE`), and the commitments module `apps/api/src/commitments/` with `POST /commitments/:id/transition` and its transition matrix (E02-04). E05 adds **intent-named actions** on top of that matrix; it does not re-implement it.
- E02-05 replaces `apps/web/src/config/destinations.ts` `DESTINATIONS` with Today / Path / Coach / Progress / Profile; the `today` destination owns `/`. Today is a placeholder there. E05-04 makes it real.
- E04-01 adds `user_profiles` (`timezone`, `coachingStyle GENTLE|BALANCED|DIRECT`, `weekdayMinutes`, `quietHours`). The scorer's "stated availability" and the local-day boundary come from that row.
- E01 fixes the AI contract: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` → `{ok:true, output}` | `{ok:false, error:{code,message}}`, never throws for provider problems. E05 uses only the `coach` persona (insight + decomposition) and always has a deterministic fallback. E01-10's fake OpenAI server (`infra/compose/fake-openai.compose.yml`, `tools/fake-openai/server.mjs`) is what the e2e runs against.
- Existing patterns to copy: `apps/api/src/pat/pat.controller.ts` (`@Auth()` + ownership-scoped service, `ParseUUIDPipe`, `nestjs-zod` DTOs), `apps/api/src/email/email-settings.service.ts` (direct `prisma.auditEvent.create` with `action '<domain>:<verb>'`), `apps/api/src/openapi/tags.ts` (every `@ApiTags` name declared in a group), `apps/api/test/helpers/test-app.helper.ts` (`createTestApp` + `overrideProviders`), `apps/web/src/__tests__/mocks/handlers.ts` (MSW), `tests/e2e/helpers/auth.helper.ts` (`loginAsTestUser` via `/testing/login`).
- Shell facts that constrain the UI: `apps/web/src/components/common/Layout.tsx` mounts the rail at `up('sm')` and pads `<main>` `pb: { xs: 10, sm: 3 }`; `BottomNav` self-gates at `down('sm')`. `/activate` is the model for a full-screen route inside `ProtectedRoute` but outside `Layout` — `/start/:commitmentId` follows it. None of the five coupled breakpoint gates (CLAUDE.md, Settings UI rule 5) are touched by this epic.
- No new permissions. Every endpoint here is a per-user resource: plain `@Auth()` with ownership resolved by `userId`, and a foreign or missing id is a **404** (never 403 — do not leak existence).
- Specs this epic produces: `docs/specs/today-and-nba.md` (E05-07). Specs it reads: `docs/specs/domain-model.md` (E02-08), `docs/specs/ai-gateway.md` (E01-12).

### Scope

- [ ] E05-01 `feat(api): add deterministic next-best-action engine and GET /today`
- [ ] E05-02 `feat(api): add commitment action endpoints with evidence and AI decomposition`
- [ ] E05-03 `feat(api): add daily check-in and end-of-day reflection endpoints`
- [ ] E05-04 `feat(web): add Today screen with next-best-action and domain cards`
- [ ] E05-05 `feat(web): add full-screen Start flow with server-derived timer`
- [ ] E05-06 `feat(web): add quick-add sheet and commitment editor`
- [ ] E05-07 `test(tests): E05 end-to-end verification`

### Out of scope

- Focus-session records, distraction notes and the avoidance intervention ladder (E07) — E05 records `startedAt`/`activeSeconds` on the commitment and `rescheduleCount`; E07 builds on them.
- Family rituals / recurrence, "I'm in" presence copy, family member records (E08). Today renders Family commitments with the generic action set.
- Workout quick-add, workout runner, WORKOUT_LOG evidence (E09). `Start` on a HEALTH commitment runs the generic timer in E05.
- Momentum states and evidence timeline (E11) — `GET /today` returns `momentum: null`; E11 fills it.
- Notification scheduling and push (E12) — E05 only honours the `?commitment=<id>&action=start` deep link E12 will emit.
- Coach chat, plan-change proposals, memory (E06). "Make it smaller" returns a proposal the user applies; it never creates a `PlanVersion`.
- Closing stale commitments as MISSED (E11 comeback loop). E05 never auto-transitions anything; yesterday's PLANNED rows are simply not candidates.

### Sequencing

- E05-01, E05-02, E05-03 are API-only and independent of each other; run them in parallel. All three depend on E02-01/E02-04 (models + matrix) and E04-01 (`user_profiles.timezone`). E05-01's check-in input is optional until E05-03 lands (scorer treats missing check-in as `NORMAL`).
- E05-04 depends on E05-01 + E05-02 + E05-03 (it renders check-in chips and the reflection prompt). E05-05 depends on E05-02 only and can run in parallel with E05-04; E05-06 depends on E02-04's `POST /commitments` and E05-04 (the FAB lives on Today).
- Critical path: E02-04 → E05-02 → E05-04 → E05-07. E05-07 is last.

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed`.
3. Open http://localhost:3535/testing/login, sign in as `owner@test.local` role `admin` with the AI-key checkbox (E01-10 `withAiKey`). Complete onboarding (E04) **or** seed directly with the CLI: `evopath login`, then
   `evopath api POST /api/outcomes --data '{"domain":"WORK","title":"Ship the Q4 proposal","whyItMatters":"Free my evenings","importance":5}'` → note `outcomeId`;
   `evopath api POST /api/commitments --data '{"domain":"WORK","outcomeId":"<outcomeId>","title":"Draft the proposal storyline","scheduledStart":"<today 09:00 local ISO>","fullVersion":{"title":"Draft the storyline","minutes":25},"shortVersion":{"title":"Write the decision statement","minutes":10},"minimumVersion":{"title":"Open the doc and write one sentence","minutes":5},"importance":5}'`;
   repeat for a FAMILY commitment (`"Phone-free dinner"`, 19:00, minutes 45) and a HEALTH commitment (`"Upper A"`, 18:00, full 38 / short 20 / minimum 10).
4. http://localhost:3535/ — observe: greeting "Good <morning|afternoon|evening>, <name>", state line "3 commitments today.", the NBA card shows **Draft the proposal storyline · 25 min · Work** with a rationale sentence and buttons `Start 25 min` and `Make it smaller`; three domain cards each listing their commitment; the coach insight card first shows a skeleton then a sentence (fake AI) or the template sentence.
5. Tap the check-in chip **Low energy**. The NBA card re-renders with the minimum version ("Open the doc and write one sentence · 5 min") and rationale mentioning low energy. `SELECT feel, date_local FROM daily_check_ins;` → one row `LOW_ENERGY`, today.
6. Tap `Start 5 min` → full-screen `/start/<id>`: title, "Why it matters: Free my evenings", timer at 05:00 counting down, `Pause`. Reload the page: the timer continues from the server-derived elapsed time (not from 05:00). Press `Pause`, wait 5 s, `Continue`.
7. When the timer reaches 0 → prompt "Continue another 15?" / "Done for now". Press `Done for now` → completion dialog → `Complete`. You land on `/` with the commitment shown as completed and the NBA now the next candidate. `SELECT source, type FROM evidence WHERE commitment_id='<id>' ORDER BY created_at;` → `APP_FLOW started`, `APP_FLOW paused`, `APP_FLOW continued`, `USER_LOG completed`. `SELECT status, started_at, active_seconds FROM commitments WHERE id='<id>';` → `COMPLETED`, non-null, ≥ 5.
8. On the HEALTH card open the ⋯ menu → **Reschedule** → pick tomorrow 07:00 → save. Repeat once more. `evopath api GET /api/commitments/<healthId> | jq .data.rescheduleCount` → `2`; status `RESCHEDULED`; card no longer shows it today.
9. On the FAMILY card → **Skip** → reason "Unexpected conflict", text "in-laws visiting" → `SELECT friction_tags, user_text FROM reflections ORDER BY created_at DESC LIMIT 1;` → `{UNEXPECTED_CONFLICT}`, text present; commitment status `SKIPPED`.
10. Tap `Make it smaller` on the NBA (re-seed a WORK commitment first) → proposal dialog lists steps from the fake AI with a first step → `Use this` → a new smaller commitment appears on the Work card and becomes the NBA. Stop the `fake-openai` container and repeat: the dialog shows "The coach is unavailable — start with 5 minutes instead" and `Start 5 min`.
11. Quick add: tap the `+` FAB → sheet (phone width) / dialog (≥600px) → "Family intention", title "Read with Mia", tonight 20:00, 15 min → save → appears on the Family card after reload.
12. Bottom of Today after 18:00 local (or `?reflect=1`): "Anything EvolvePath should learn from today?" → **Too much** + text → `SELECT * FROM reflections WHERE related_type='day';` → one row, `friction_tags = {TOO_MUCH}`.
13. Audit: `SELECT action, target_id FROM audit_events WHERE action LIKE 'commitment:%' OR action LIKE 'today:%' ORDER BY created_at;` → `commitment:start`, `commitment:pause`, `commitment:continue`, `commitment:complete`, `commitment:reschedule` ×2, `commitment:skip`, `commitment:decompose_apply`, `today:check_in`, `today:reflection`.
14. Resize the browser below 600px: single column, BottomNav visible, the FAB sits above it; at ≥ 900px: NBA + insight on the left, three domain cards on the right.

## Child issues

### E05-01 `feat(api): add deterministic next-best-action engine and GET /today`

**Part of epic:** E05 · **Blocked by:** E02-04, E04-01 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §12 requires Today to show one recommended action with rationale, duration, fallback and mode; PRD §13 requires that ranking to be **deterministic** ("The AI should not freely invent priority. The deterministic engine generates candidates."), and PRD §120 requires Today to work when AI is unavailable. VISION §21 gives the eight coach modes the intervention mode enum encodes. Nothing in the API computes any of this today; the web app's `/` is a placeholder (E02-05).

#### Proposed solution

A new `apps/api/src/today/` module with a pure scorer, a candidate loader, a deterministic mode/sizing resolver, `GET /today`, and a separate non-blocking `GET /today/insight` backed by the `coach` persona with a template fallback.

**Data (database-dev)** — n/a (reads `commitments`, `outcomes`, `plans`/`plan_versions`, `domain_modes`, `evidence`, `user_profiles`, and — once E05-03 lands — `daily_check_ins`). No migration.

**API (backend-dev)**

Files (all new):

- `apps/api/src/today/today.module.ts` — imports `PrismaModule`, `AiModule` (for `AiGatewayService`), `CommitmentsModule` (E02-04, for the card mapper); exports `TodayService`.
- `apps/api/src/today/today.controller.ts` — `@ApiTags('Today')`, `@Controller('today')`.
- `apps/api/src/today/today.service.ts` — `getToday(userId, now = new Date())`, `getInsight(userId)`.
- `apps/api/src/today/local-date.ts` — `localDate(now: Date, timeZone: string): string` (`YYYY-MM-DD` via `Intl.DateTimeFormat`, no date library), `localDayBounds(dateLocal, timeZone): {start: Date, end: Date}`, `greetingFor(now, timeZone): 'morning'|'afternoon'|'evening'` (05–11 / 12–17 / else).
- `apps/api/src/today/nba/nba-scorer.ts` — the pure function described below.
- `apps/api/src/today/nba/nba-sizing.ts` — `chooseVersion(input): {version: 'full'|'short'|'minimum', title, durationMinutes}` and `fallbackFor(input, chosen)`.
- `apps/api/src/today/nba/intervention-mode.ts` — `resolveInterventionMode(ctx): InterventionMode`.
- `apps/api/src/today/nba/candidate-loader.service.ts` — loads today's candidates and the `ScoringContext` from Prisma.
- `apps/api/src/today/insight/today-insight.service.ts` — AI insight with per-day cache and template fallback.
- `apps/api/src/today/dto/today-response.dto.ts`, `dto/today-insight.dto.ts` — `nestjs-zod` `createZodDto` over the Zod schemas below (the Zod schema is the contract; the DTO is derived, as in `apps/api/src/email/dto/update-email-settings.dto.ts`).

Scorer contract (`nba-scorer.ts`):

```ts
export const IMPORTANCE_WEIGHT = 30;
export const URGENCY_WEIGHT = 25;
export const REPEATED_AVOIDANCE_WEIGHT = 20;
export const PLAN_RELEVANCE_WEIGHT = 10;
export const DOMAIN_BALANCE_WEIGHT = 10;
export const CONTEXTUAL_FIT_WEIGHT = 10;
export const EFFORT_MISMATCH_PENALTY = 25;
export const CONFLICT_PENALTY = 40;
export const FATIGUE_PENALTY = 15;

export type Domain = 'WORK' | 'FAMILY' | 'HEALTH';
export type DomainModeValue = 'GROW' | 'MAINTAIN' | 'RECOVER' | 'PAUSE';
export type CheckInFeel = 'NORMAL' | 'PACKED' | 'LOW_ENERGY' | 'UNEXPECTED_PROBLEM';

export interface CandidateCommitment {
  id: string; domain: Domain; importance: number;            // importance 1..5
  scheduledStart: Date; scheduledEnd: Date | null;
  status: 'PLANNED' | 'READY' | 'RESCHEDULED' | 'STARTED';
  rescheduleCount: number; planId: string | null; planIsActive: boolean;
  outcomeTargetDate: Date | null;
  versions: { full: {title: string; minutes: number}; short?: {title; minutes}; minimum?: {title; minutes} };
  createdAt: Date;
}
export interface ScoringContext {
  now: Date; checkIn: CheckInFeel | null;
  domainModes: Record<Domain, DomainModeValue>;
  completedTodayByDomain: Record<Domain, number>;
  availableMinutesRemaining: number;                          // from user_profiles.weekdayMinutes minus minutes completed today, floor 0
  startedCommitmentId: string | null;                         // any STARTED commitment today
}
export interface CandidateInput { commitment: CandidateCommitment; context: ScoringContext; chosenMinutes: number }
export interface ScoreBreakdown { importance; urgency; repeatedAvoidance; planRelevance; domainBalance; contextualFit; effortMismatch; conflict; fatigue }
export function scoreCandidate(input: CandidateInput): { score: number; breakdown: ScoreBreakdown }
export function rankCandidates(candidates: CandidateInput[]): CandidateInput[]   // stable: score desc, scheduledStart asc, createdAt asc, id asc
```

Term definitions (each is `weight × factor`, factor ∈ [0,1]):

- `importance` = `importance / 5`.
- `urgency` = `max(scheduleUrgency, deadlineUrgency)`; `scheduleUrgency = clamp(1 − hoursUntil(scheduledStart)/12, 0, 1)` (overdue → 1); `deadlineUrgency = outcomeTargetDate ? clamp(1 − daysUntil/7, 0, 1) : 0`.
- `repeatedAvoidance` = `min(rescheduleCount, 3) / 3`.
- `planRelevance` = `planIsActive ? 1 : planId ? 0.5 : 0` (quick-adds with no plan score 0 here, not excluded).
- `domainBalance` = `modeFactor × (completedTodayByDomain[domain] === 0 ? 1 : 0.25)`, `modeFactor` GROW 1, RECOVER 0.75, MAINTAIN 0.5. PAUSE never reaches the scorer (excluded by the loader; the scorer throws if it sees one — a programming error, not a data state).
- `contextualFit` = 1 if `now ∈ [scheduledStart − 60 min, (scheduledEnd ?? scheduledStart + chosenMinutes) + 60 min]`, else 0.
- `effortMismatch` = 1 if `chosenMinutes > availableMinutesRemaining`, else 0.
- `conflict` = 1 if `startedCommitmentId && startedCommitmentId !== commitment.id`, else 0.
- `fatigue` = `feelFactor × clamp(chosenMinutes / 60, 0, 1)`, `feelFactor` LOW_ENERGY 1, PACKED 0.5, UNEXPECTED_PROBLEM 0.5, NORMAL/null 0.

Sizing (`nba-sizing.ts`, pure): `LOW_ENERGY` → `minimum ?? short ?? full`; `PACKED` / `UNEXPECTED_PROBLEM` → `short ?? minimum ?? full`; `NORMAL`/none → `full`, downgraded to the largest version whose minutes ≤ `availableMinutesRemaining` when `full` does not fit (never below `minimum`). `fallbackFor` = the next smaller declared version than the chosen one; when none exists, `{title: '5-minute start', durationMinutes: 5}` (PRD §28: a daily win must be possible in minutes).

Intervention mode (`intervention-mode.ts`, pure; first rule that matches wins, in this order — mapped from VISION §21):

| Mode | Rule |
|---|---|
| `RECOVER` | `daysSinceLastEvidence >= 3` and the user has any evidence ever |
| `CHALLENGE_PLAN` | top candidate's routine has ≥ 4 `MISSED`/`SKIPPED` occurrences in the last 14 days |
| `DIAGNOSE` | top candidate `rescheduleCount >= 2` |
| `REDUCE` | check-in `PACKED` or `UNEXPECTED_PROBLEM`, or chosen version still exceeds `availableMinutesRemaining` |
| `RECONNECT` | check-in `LOW_ENERGY` |
| `CLARIFY` | top candidate's outcome has neither `whyItMatters` nor `successDefinition` |
| `REINFORCE` | ≥ 3 completions in the last 7 days and no `MISSED` in that window |
| `ACT` | otherwise |

Rationale is a template per mode filled from the candidate (e.g. `DIAGNOSE`: "You have moved this {n} times. Starting matters more than finishing right now."; `RECONNECT`: "You said: “{whyItMatters}”. The {minutes}-minute version keeps that alive today."). Templates live in `apps/api/src/today/nba/rationale-templates.ts`. Confidence = `clamp((top.score − second.score) / max(top.score, 1), 0.2, 0.95)`; `0.9` when there is a single candidate.

Pre-rule: if a `STARTED` commitment exists today, it **is** the NBA (`interventionMode: 'ACT'`, rationale "You already started this — continue.", `durationMinutes` = its `timerMinutes` remainder); the scorer still runs for the rest so `confidence` is defined.

Candidate loader (`candidate-loader.service.ts`): commitments of the user with `scheduledStart` inside `localDayBounds(dateLocal, timezone)` and status ∈ {PLANNED, READY, RESCHEDULED, STARTED}, joined to outcome (`whyItMatters`, `successDefinition`, `targetDate`), plan version (`isActive`), and the user's `domain_modes`; **domains in `PAUSE` are excluded from candidates but still returned as a domain card with `mode: 'PAUSE'`**. Timezone = `user_profiles.timezone ?? 'UTC'`. `availableMinutesRemaining = max(0, (weekdayMinutes ?? 60) − minutesCompletedToday)`. Yesterday's rows are never candidates (no catch-up debt, VISION §33; E11 closes them).

Endpoints:

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/today` | `@Auth()` (own data) | — | `TodayResponse` (below) |
| GET | `/api/today/insight` | `@Auth()` | — | `{ text: string, source: 'ai' \| 'template', generatedAt: string }` |

`TodayResponse` Zod schema (`apps/api/src/today/today.schema.ts`):

```ts
export const commitmentCardSchema = z.object({
  id: z.string().uuid(), title: z.string(), domain: domainEnum,
  status: commitmentStatusEnum, scheduledStart: z.string().datetime(), scheduledEnd: z.string().datetime().nullable(),
  durationMinutes: z.number().int(),
  versions: z.object({ full: versionSchema, short: versionSchema.nullable(), minimum: versionSchema.nullable() }),
  rescheduleCount: z.number().int(),
  startedAt: z.string().datetime().nullable(),
  timer: z.object({ activeSince: z.string().datetime().nullable(), activeSeconds: z.number().int(), timerMinutes: z.number().int().nullable() }).nullable(),
  availableActions: z.array(commitmentActionEnum),   // computed from E02-04's matrix: ['start','complete',...]
});
export const todayResponseSchema = z.object({
  greeting: z.string(),                    // "Good morning, Alex"
  stateLine: z.string(),                   // "3 commitments today. Health is in maintenance mode this week."
  dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkIn: z.object({ feel: checkInFeelEnum }).optional(),
  nextBestAction: z.object({
    commitmentId: z.string().uuid(), title: z.string(), domain: domainEnum, durationMinutes: z.number().int(),
    version: z.enum(['full','short','minimum']),
    rationale: z.string(),
    fallback: z.object({ title: z.string(), durationMinutes: z.number().int() }),
    interventionMode: z.enum(['ACT','CLARIFY','REDUCE','DIAGNOSE','RECONNECT','CHALLENGE_PLAN','RECOVER','REINFORCE']),
    confidence: z.number().min(0).max(1),
  }).nullable(),
  domains: z.array(z.object({ domain: domainEnum, mode: domainModeEnum, commitments: z.array(commitmentCardSchema) })).length(3),
  momentum: z.null(),                      // E11 replaces with its schema
  coachInsight: z.null(),                  // always null here; the client fetches /today/insight separately
});
```

`GET /today` never calls AI. `GET /today/insight` (`today-insight.service.ts`): builds `instructions` from `coachingStyle` (E04-01) and `input = {dateLocal, checkIn, nba, domains: counts+modes, last7Days: {completed, missed, skipped}}`; calls `AiGatewayService.invoke({persona:'coach', userId, promptVersion:'today-insight.v1', schema: z.object({text: z.string().max(280)}), schemaName:'TodayInsight'})`; on `{ok:false}` (any code, including `no_user_key`/`ai_disabled`) returns the deterministic template (`apps/api/src/today/insight/insight-templates.ts`, keyed by intervention mode) with `source:'template'`. Cache: in-memory `Map<`${userId}:${dateLocal}`, TodayInsight>` in the service, evicted at the user's local midnight and on `POST /today/check-in` (E05-03 calls `TodayInsightService.invalidate(userId)`); documented as per-process. Timeout is the gateway's; the endpoint never blocks `GET /today`.

Audit: none for reads. Log line on insight: `today.insight user=<id> source=<ai|template> latencyMs=<n>` (never the text).

Error codes: 401 unauthenticated; 500 only on programming errors (a PAUSE domain reaching the scorer).

OpenAPI: add tag `Today` ("The signed-in user's day: next best action, domain cards, check-in, reflection and the coach insight.") to a new group `Product` in `apps/api/src/openapi/tags.ts` (the `openapi-document.spec.ts` assertion fails on an undeclared tag).

**UI (frontend-dev)** — n/a (E05-04 consumes). Add the response types to `apps/web/src/types/index.ts` in E05-04.

**Tests (testing-dev)**

- `apps/api/src/today/nba/nba-scorer.spec.ts` — one `describe` per term proving `weight × factor` at factor 0, 0.5, 1 (`importance` 1/3/5; `urgency` overdue → `URGENCY_WEIGHT`, 24 h away → 0, deadline in 3 days → `URGENCY_WEIGHT × 4/7`; `repeatedAvoidance` 0/1/3/7 caps at 1; `planRelevance` none/inactive/active; `domainBalance` GROW-untouched 10, MAINTAIN-with-completion 1.25; `contextualFit` inside/outside window; `effortMismatch`; `conflict` other-started vs self-started; `fatigue` LOW_ENERGY×60 min = 15, NORMAL = 0); breakdown sums to score; `rankCandidates` tie order (equal score → earlier `scheduledStart`, then `createdAt`, then id); PAUSE candidate throws.
- `apps/api/src/today/nba/nba-sizing.spec.ts` — `LOW_ENERGY` prefers minimum, falls to short then full when absent; `PACKED` prefers short; `NORMAL` with `availableMinutesRemaining` 12 and full 25/short 10 → short; fallback next-smaller / 5-minute default.
- `apps/api/src/today/nba/intervention-mode.spec.ts` — one case per row of the mode table plus precedence (RECOVER beats DIAGNOSE).
- `apps/api/src/today/local-date.spec.ts` — `America/Costa_Rica` vs `UTC` day boundaries at 23:30 UTC; greeting bands.
- `apps/api/src/today/today.service.spec.ts` — STARTED pre-rule; PAUSE domain card present with no candidates; `nextBestAction: null` when no commitments; `checkIn` echoed when a `daily_check_ins` row exists; `momentum`/`coachInsight` null.
- `apps/api/src/today/insight/today-insight.service.spec.ts` — `{ok:false}` from a stubbed gateway → template + `source:'template'`; second call same day does not invoke the gateway; `invalidate` forces a new call.
- `apps/api/test/today/today.integration.spec.ts` (`createTestApp` + `overrideProviders: [{provide: AiGatewayService, useValue: stub}]`) — 401 without token; 200 shape validated with `todayResponseSchema.safeParse`; user B's commitments never appear for user A; `GET /today/insight` returns 200 with `source:'template'` when the stub rejects.

**Docs (docs-dev)** — `docs/API.md` new section "Today"; CLAUDE.md "API Endpoints" adds `GET /api/today`, `GET /api/today/insight`; `docs/specs/today-and-nba.md` is created by E05-07 (this issue leaves a stub heading list in the PR description only).

#### Acceptance criteria

- [ ] `GET /api/today` returns a body that passes `todayResponseSchema` for a user with zero commitments (`nextBestAction: null`, three domain entries) and for a user with commitments in all three domains.
- [ ] Ranking is reproducible: two calls with the same data and the same `now` return the same `nextBestAction`; the unit spec proves every weight constant is used and the breakdown sums to the score.
- [ ] A commitment in a domain whose `DomainMode` is `PAUSE` is never the NBA and its domain card reports `mode: 'PAUSE'`.
- [ ] With a `LOW_ENERGY` check-in, the NBA's `version` is `minimum` when the commitment declares one, and the `fallback` is the 5-minute default.
- [ ] A `STARTED` commitment is always the NBA with `interventionMode: 'ACT'`.
- [ ] A commitment scheduled yesterday and still `PLANNED` is not a candidate today.
- [ ] `GET /api/today` completes without any call to `AiGatewayService` (spy asserts zero calls).
- [ ] `GET /api/today/insight` returns `source:'template'` with HTTP 200 when the gateway returns `{ok:false}` for any error code, and `source:'ai'` against the fake OpenAI server.
- [ ] `dateLocal` and the candidate window follow `user_profiles.timezone` (`America/Costa_Rica` at 23:30 UTC is still "today" locally).
- [ ] Another user's commitment id never appears in the response.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (schema names, constant names, mode enum, file paths)
- [ ] Error handling: gateway failures never surface as non-200 on `/today/insight`; invalid `user_profiles.timezone` falls back to `UTC` with a warn log
- [ ] Observability: `today.insight` log line with source/latency; the gateway's own span covers the AI call; no rationale/insight text in logs
- [ ] Security: `@Auth()` on both routes; every query filtered by `userId`; no cross-user id leakage
- [ ] Config & secrets: none new; weights are code constants (documented in the spec), not env vars
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated (`docs/API.md`, CLAUDE.md endpoints)

#### Manual test script

1. Epic script steps 1–4 (seed three commitments), then `evopath api GET /api/today | jq '.data.nextBestAction'` → `commitmentId` of the WORK commitment, `version: "full"`, `durationMinutes: 25`, `interventionMode: "ACT"`, confidence between 0.2 and 0.95.
2. `evopath api GET /api/today | jq '.data.domains[] | {domain, mode, n: (.commitments|length)}'` → three rows, one commitment each.
3. Insert a `PAUSE` mode for HEALTH (`evopath api PUT /api/domain-modes/HEALTH --data '{"mode":"PAUSE"}'`, E02-04) → HEALTH card `mode: "PAUSE"`, its commitment absent from candidates (reschedule the WORK one two days out to see HEALTH would otherwise win — it does not).
4. `evopath api GET /api/today/insight` → `{text, source:"ai"}` with fake-openai up; `docker compose stop fake-openai` → `source:"template"`, still 200.
5. After E05-03: check in `LOW_ENERGY` → `version: "minimum"`, `durationMinutes: 5`, `interventionMode: "RECONNECT"`.

#### Out of scope

- Momentum (E11), coach chat (E06), historical "successful time windows" input (E07/E10 — `contextualFit` uses only the scheduled window in E05).
- Persisting scores; they are recomputed per request.
- Any write to commitments from this issue.

#### Notes for the implementing agent

- Zod v4 and `nestjs-zod` are the validation stack (see `apps/api/src/pat/dto/create-pat.dto.ts`); no class-validator.
- Keep `scoreCandidate` free of Prisma, `Date.now()` and I/O — it receives `context.now`. The loader is the only place that touches the database.
- Register `TodayModule` in `apps/api/src/app.module.ts`; register the `Today` tag or `test/openapi/openapi-document.spec.ts` fails.
- Do not import the `daily_check_ins` Prisma delegate until E05-03 has merged; read `checkIn` through an injectable `CheckInReader` interface with a null implementation so E05-01 can land first.
- The E02-04 matrix export name may differ from `availableActionsFor(commitment)`; use whatever E02-04 exports rather than re-deriving the matrix here.

---

### E05-02 `feat(api): add commitment action endpoints with evidence and AI decomposition`

**Part of epic:** E05 · **Blocked by:** E02-04 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

VISION §10 lists the verbs a work action must support (start for 5/10/20, continue, pause, reschedule, break this down) and PRD P4/§27 say starting is evidence distinct from completing. PRD §10.9 forbids inferring completion from plans, PRD §44 requires fallback versions to be usable and recorded as such (§101 Day 2: "Evidence: fallback completed"), and PRD §25 needs `rescheduleCount` to be a real counter. E02-04 exposes a generic `transition` endpoint; the UI and later epics need intent-named actions that also write evidence, persist timer state, and audit.

#### Proposed solution

Nine action endpoints under `/commitments/:id/actions/*` in the existing commitments module, each a thin orchestration over E02-04's transition matrix plus evidence, timer fields and audit; one AI-backed proposal endpoint (`decompose`) that mutates nothing until `decompose/apply`.

**Data (database-dev)** — migration `add_commitment_execution_fields` on `Commitment` (skip any column E02-01 already created with the same meaning):

| Field | Type | Notes |
|---|---|---|
| `startedAt` | `DateTime? @db.Timestamptz` | first `start`; never cleared |
| `activeSince` | `DateTime? @db.Timestamptz` | non-null while the timer is running; null when paused/finished |
| `activeSeconds` | `Int @default(0)` | accumulated active time up to the last pause |
| `timerMinutes` | `Int?` | the 5/10/20/custom target chosen at start |
| `versionUsed` | `CommitmentVersion?` (new enum `FULL, SHORT, MINIMUM`) | set by `fallback`; defaults to `FULL` on `complete` when null |
| `completedAt` | `DateTime? @db.Timestamptz` | set by `complete`/`partial` |
| `minutesSpent` | `Int?` | from `complete`/`partial` body, else derived from `activeSeconds` |
| `steps` | `Json?` | Zod `z.array({title: string, minutes: int})`; set by `decompose/apply`; shown by the Start flow |
| `decomposedFromId` | `String? @db.Uuid` | self-relation `Commitment.decomposedFrom`, `onDelete: SetNull` |
| `skipNote` | `String?` | free text from `skip` (the enum goes in E02's `skipReason`) |

Index `@@index([userId, status, activeSince])` (the "any STARTED commitment" lookup in E05-01). Seed: n/a.

**API (backend-dev)**

Files: `apps/api/src/commitments/actions/commitment-actions.controller.ts` (new, `@ApiTags('Commitments')` — reuse E02-04's tag), `commitment-actions.service.ts` (new), `commitment-timer.ts` (new, pure: `elapsedSeconds({activeSince, activeSeconds}, now)`), `dto/commitment-action.dtos.ts` (new, one Zod schema per body), `decomposition/decomposition.service.ts` (new), `decomposition/decomposition.schema.ts` (new).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/commitments/:id/actions/start` | `@Auth()`, owner | `{ minutes?: int 1..180 }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/pause` | `@Auth()`, owner | — | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/continue` | `@Auth()`, owner | `{ extraMinutes?: int 1..180 }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/complete` | `@Auth()`, owner | `{ notes?: string ≤ 1000, minutesSpent?: int 0..1440 }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/partial` | `@Auth()`, owner | `{ notes?: string, minutesSpent?: int }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/fallback` | `@Auth()`, owner | `{ version: 'short' \| 'minimum' }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/reschedule` | `@Auth()`, owner | `{ scheduledStart: ISO datetime, scheduledEnd?: ISO }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/skip` | `@Auth()`, owner | `{ reason: SkipReason, text?: string ≤ 1000 }` | 200 `CommitmentCard` |
| POST | `/api/commitments/:id/actions/decompose` | `@Auth()`, owner | `{ hint?: string ≤ 300 }` | 200 `DecompositionProposal` — **no mutation** |
| POST | `/api/commitments/:id/actions/decompose/apply` | `@Auth()`, owner | `DecompositionProposal` (echoed back, possibly edited) | 201 `CommitmentCard` of the **new** commitment |

`SkipReason = TOO_MUCH | BAD_TIMING | UNEXPECTED_CONFLICT | LOW_ENERGY | AVOIDED | OTHER` (PRD §74 quick options minus "Plan worked", which is not a reason to skip).

Semantics (`CommitmentActionsService`; every method loads the row with `where: {id, userId}` and throws `NotFoundException` (404) when absent — never 403):

- **start** — matrix transition → `STARTED`; sets `startedAt = now` (only if null), `activeSince = now`, `activeSeconds = 0`, `timerMinutes = body.minutes ?? null`. Evidence `{source: APP_FLOW, type: 'started', quantitativeValue: timerMinutes, confidence: 1}`. If the row is already `STARTED` and paused, behaves as `continue`. Any *other* STARTED commitment of the user is auto-paused first (one running timer per user) with its own `paused` evidence. Audit `commitment:start`.
- **pause** — requires `STARTED` with `activeSince` set; `activeSeconds += now − activeSince`, `activeSince = null`. Evidence `APP_FLOW paused` (quantitativeValue = elapsed seconds). Status stays `STARTED` (there is no PAUSED status in PRD §10.7; paused is `STARTED` with `activeSince: null`). Audit `commitment:pause`.
- **continue** — requires `STARTED` and `activeSince == null`; `activeSince = now`; `timerMinutes += extraMinutes` when given (the "Continue another 15?" prompt). Evidence `APP_FLOW continued`. Audit `commitment:continue`.
- **complete** — allowed from `PLANNED | READY | RESCHEDULED | STARTED` (matrix); if running, folds elapsed into `activeSeconds`; `completedAt = now`, `minutesSpent = body.minutesSpent ?? round(activeSeconds/60)`, `versionUsed ??= FULL`. Evidence `{source: USER_LOG, type: 'completed', quantitativeValue: minutesSpent, qualitativeValue: {notes, versionUsed, fallbackUsed: versionUsed !== 'FULL'}}`. Audit `commitment:complete`.
- **partial** — same as complete but → `PARTIALLY_COMPLETED`, evidence type `partially_completed`. Audit `commitment:partial`.
- **fallback** — requires the named version to exist (400 `VERSION_NOT_DEFINED` otherwise); sets `versionUsed`; no status change; evidence `{source: APP_FLOW, type: 'fallback_selected', qualitativeValue: {version, fallbackUsed: true}}`. Audit `commitment:fallback`.
- **reschedule** — **same row** (decision, see Notes): `scheduledStart/End` updated, `rescheduleCount += 1`, status → `RESCHEDULED` via the matrix (from `PLANNED | READY | RESCHEDULED`; a `STARTED` row is 409 `ALREADY_STARTED`). Evidence `{source: APP_FLOW, type: 'rescheduled', qualitativeValue: {from: previousScheduledStart, to: scheduledStart, count: rescheduleCount}}` keeps the history. Audit `commitment:reschedule` with `meta {from, to, rescheduleCount}`.
- **skip** — → `SKIPPED`; `skipReason = reason`, `skipNote = text`; creates a `Reflection {relatedType: 'commitment', relatedId: id, userText: text, frictionTags: [reason]}` (a failed plan is information, P5) — no evidence row (a skip is not execution). Audit `commitment:skip` with `meta {reason}` (never the text).
- **decompose** — `DecompositionService.propose(userId, commitment, hint)`: `AiGatewayService.invoke({persona:'coach', promptVersion:'decompose.v1', instructions: <coachingStyle-aware, "3–5 concrete steps, first step ≤ 10 minutes, no new goals">, input: {title, domain, versions, whyItMatters, rescheduleCount, hint}, schema: decompositionProposalSchema, schemaName: 'DecompositionProposal'})`. Schema: `{ steps: z.array(z.object({title: z.string().min(1).max(120), minutes: z.number().int().min(1).max(60)})).min(1).max(5), firstStep: z.object({title, minutes: int 1..15}), message: z.string().max(240), source: z.enum(['ai','template']) }`. On `{ok:false}` return the deterministic fallback `{steps: [{title: 'Open it and do the first 5 minutes', minutes: 5}], firstStep: same, message: 'The coach is unavailable — start with 5 minutes instead.', source: 'template'}` with HTTP 200. **Nothing is written.** Log `commitment.decompose source=<ai|template>`.
- **decompose/apply** — validates the posted proposal with the same schema, creates a new `Commitment` `{userId, domain, outcomeId, planId (copied), title: firstStep.title, scheduledStart: now, fullVersion: {title: firstStep.title, minutes: firstStep.minutes}, minimumVersion: {title: firstStep.title, minutes: min(5, firstStep.minutes)}, steps, decomposedFromId: id, status: PLANNED, importance (copied)}`; the original is left untouched (it remains in the plan; the small one is today's move). Audit `commitment:decompose_apply` with `meta {sourceCommitmentId, stepCount}`.

`CommitmentCard` is E05-01's `commitmentCardSchema`; put the mapper in `apps/api/src/commitments/commitment-card.mapper.ts` so E05-01 and this issue share it (whichever merges first creates it).

Error codes: 404 (unknown/foreign id), 409 `INVALID_TRANSITION` (from the matrix, message names current status and action), 409 `ALREADY_STARTED`, 400 `VERSION_NOT_DEFINED`, 400 Zod validation.

OpenAPI: reuse tag `Commitments` (E02-04); add `@ApiOperation` summaries per action.

**UI (frontend-dev)** — n/a (E05-04/E05-05 consume).

**Tests (testing-dev)**

- `apps/api/src/commitments/actions/commitment-timer.spec.ts` — elapsed while running, while paused, across pause/continue cycles.
- `apps/api/src/commitments/actions/commitment-actions.service.spec.ts` (prisma mock) — start sets `startedAt` once and writes `APP_FLOW started`; start while another is running pauses the other; pause/continue arithmetic; complete derives `minutesSpent` from `activeSeconds` and tags `fallbackUsed` correctly for FULL vs MINIMUM; partial → `PARTIALLY_COMPLETED`; fallback on undefined version → 400; reschedule increments and writes `{from,to}`; reschedule on STARTED → 409; skip writes `Reflection` with `frictionTags` and no evidence; decompose returns template on `{ok:false}` and never calls `prisma.commitment.create`; apply creates the child with `decomposedFromId` and leaves the parent unchanged; foreign id → 404 for every action.
- `apps/api/src/commitments/decomposition/decomposition.schema.spec.ts` — rejects 6 steps, a 20-minute first step, empty titles.
- `apps/api/test/commitments/commitment-actions.integration.spec.ts` — full app with `AiGatewayService` stub: start → complete produces two evidence rows in order; reschedule twice → `rescheduleCount 2`; user B gets 404 on user A's id for every route; audit rows `commitment:<action>` exist with `targetType 'commitment'`; response bodies validate against `commitmentCardSchema`.

**Docs (docs-dev)** — `docs/API.md` "Commitment actions" subsection under the E02 Commitments section; CLAUDE.md "API Endpoints" adds the ten routes and the `Database Tables` line for `commitments` gains "(+ execution fields, E05-02)".

#### Acceptance criteria

- [ ] `POST …/actions/start` moves a PLANNED commitment to STARTED, persists `startedAt`/`activeSince`, and writes exactly one `APP_FLOW started` evidence row; a second start on a paused row resumes instead of erroring.
- [ ] `POST …/actions/complete` on a never-started commitment succeeds (completion without start is legal) and writes `USER_LOG completed`; on a started one, `minutesSpent` defaults to the timer's active seconds rounded to minutes.
- [ ] Start and completion are separate evidence rows with distinct `type` values; nothing is ever created from a PLANNED row without a user action.
- [ ] `fallback {version:'minimum'}` then `complete` yields evidence with `fallbackUsed: true` and `versionUsed: 'MINIMUM'`.
- [ ] Two reschedules on the same row give `rescheduleCount: 2`, status `RESCHEDULED`, and two `rescheduled` evidence rows with `from`/`to`.
- [ ] `skip` stores the enum in `skipReason`, the text in `skipNote`, creates a `Reflection` with `frictionTags: [reason]`, and creates no evidence.
- [ ] `decompose` returns HTTP 200 with `source:'template'` when the gateway fails and writes nothing; `decompose/apply` creates one new PLANNED commitment linked by `decomposedFromId` with `steps` persisted.
- [ ] Every action on another user's commitment returns 404; every successful action writes an `audit_events` row `commitment:<action>`.
- [ ] Invalid transitions (e.g. `pause` on PLANNED) return 409 `INVALID_TRANSITION`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (paths, bodies, evidence `source`/`type` strings, enum names)
- [ ] Error handling: 404 for ownership, 409 for matrix violations, 400 for undefined versions; decompose degrades to template
- [ ] Observability: audit per action; `commitment.decompose` log line; evidence rows are the product's observability
- [ ] Security: `@Auth()` + `userId` in every `where`; skip text and notes never in audit meta or logs
- [ ] Config & secrets: none new
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated (`docs/API.md`, CLAUDE.md)

#### Manual test script

1. Epic script steps 1–3, then: `evopath api POST /api/commitments/<workId>/actions/start --data '{"minutes":10}' | jq '.data | {status, startedAt, timer}'` → `STARTED`, non-null, `{activeSince: <now>, activeSeconds: 0, timerMinutes: 10}`.
2. Wait 10 s; `…/actions/pause` → `activeSince: null`, `activeSeconds ≈ 10`. `…/actions/continue --data '{"extraMinutes":15}'` → `timerMinutes: 25`.
3. `…/actions/complete --data '{"notes":"done"}'` → `COMPLETED`; `psql`: `SELECT type, source, quantitative_value FROM evidence WHERE commitment_id='<workId>' ORDER BY created_at;` → started/APP_FLOW/10, paused/APP_FLOW, continued/APP_FLOW, completed/USER_LOG.
4. `…/actions/reschedule --data '{"scheduledStart":"<tomorrow 07:00 ISO>"}'` twice on `<healthId>` → `rescheduleCount: 2`; a third `start` on it still works (RESCHEDULED is startable).
5. `…/actions/skip --data '{"reason":"AVOIDED","text":"dreading it"}'` on `<familyId>` → `SKIPPED`; `SELECT friction_tags FROM reflections;` → `{AVOIDED}`.
6. `…/actions/decompose --data '{}'` on a fresh WORK commitment → proposal with `source:"ai"` (fake server) → `…/actions/decompose/apply --data '<the proposal JSON>'` → 201 new commitment with `steps`. `SELECT count(*) FROM commitments WHERE decomposed_from_id='<id>';` → 1. Stop fake-openai → decompose returns `source:"template"`.
7. Using a second test user's token, run any action against `<workId>` → 404.

#### Out of scope

- Focus-session rows and distraction notes (E07); workout runner start (E09) — HEALTH commitments use this generic start.
- Bulk actions, undo, editing a commitment's text (E05-06 uses E02-04's `PATCH /commitments/:id`).
- Notifications on completion (E12).

#### Notes for the implementing agent

- **Reschedule keeps the same row** (decision): the PRD models `reschedule_count` as a field on the commitment and E07's avoidance detection reads it from the live row; a new row per reschedule would reset the count and double-list the item in date-range queries. History lives in the `rescheduled` evidence rows. `RESCHEDULED` behaves like `PLANNED` for every other action and for the E05-01 loader.
- Paused = `STARTED` with `activeSince: null`; do not add a PAUSED status (PRD §10.7 is the enum, E02-01 owns it).
- Call `AiGatewayService.invoke` outside any `$transaction`; it never throws for provider errors but check `ok` before touching `output`.
- Audit with direct `prisma.auditEvent.create` as in `apps/api/src/email/email-settings.service.ts`; `targetType: 'commitment'`.
- Zod v4 + `nestjs-zod` DTOs; Fastify (no Express `res`). Use `@HttpCode(HttpStatus.OK)` on the POST actions and `CREATED` on `decompose/apply`.
- Run `npm run prisma:migrate:dev -- --name add_commitment_execution_fields` then `npm run prisma:generate`; never bare `npx prisma`.

---

### E05-03 `feat(api): add daily check-in and end-of-day reflection endpoints`

**Part of epic:** E05 · **Blocked by:** E02-04, E04-01 · **Component:** api, database · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §73: an optional one-tap "How does today feel?" (Normal / Packed / Low energy / Unexpected problem) that "can alter suggested action size" — the E05-01 scorer needs a persisted per-day answer. PRD §74: an optional end-of-day reflection with quick options that "creates structured friction data" for the weekly review (E10) and pattern analysis (E06). Both must stay brief ("avoid daily emotional interrogation").

#### Proposed solution

A `daily_check_ins` table (one row per user per local day, upserted) and two endpoints in the `today` module; reflections reuse E02-01's `Reflection` model with `relatedType: 'day'`.

**Data (database-dev)** — migration `add_daily_check_ins`:

```prisma
enum CheckInFeel { NORMAL PACKED LOW_ENERGY UNEXPECTED_PROBLEM }

model DailyCheckIn {
  id        String      @id @default(uuid()) @db.Uuid
  userId    String      @map("user_id") @db.Uuid
  dateLocal String      @map("date_local")            // YYYY-MM-DD in the user's timezone
  feel      CheckInFeel
  createdAt DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime    @updatedAt @map("updated_at") @db.Timestamptz
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, dateLocal])
  @@map("daily_check_ins")
}
```

`Reflection` (E02-01) must carry `relatedType String`, `relatedId String`, `userText String?`, `frictionTags String[]`; if E02-01 named them differently, adapt the service — do not add a second reflections table. Seed: n/a.

**API (backend-dev)** — files: `apps/api/src/today/check-in/check-in.service.ts` (new), `apps/api/src/today/reflection/day-reflection.service.ts` (new), `apps/api/src/today/dto/check-in.dto.ts`, `dto/day-reflection.dto.ts` (new); routes added to `today.controller.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/today/check-in` | `@Auth()` | `{ feel: 'NORMAL' \| 'PACKED' \| 'LOW_ENERGY' \| 'UNEXPECTED_PROBLEM' }` | 200 `{ dateLocal, feel, updatedAt }` |
| GET | `/api/today/check-in` | `@Auth()` | — | 200 `{ dateLocal, feel, updatedAt } \| null` (wrapped in `data`) |
| POST | `/api/today/reflection` | `@Auth()` | `{ quickOption: 'PLAN_WORKED' \| 'TOO_MUCH' \| 'BAD_TIMING' \| 'UNEXPECTED_CONFLICT' \| 'LOW_ENERGY' \| 'AVOIDED' \| 'OTHER', text?: string ≤ 1000 }` | 201 `{ id, dateLocal, quickOption, text, createdAt }` |
| GET | `/api/today/reflection` | `@Auth()` | — | 200 today's latest day reflection or `null` |

- `CheckInService.upsert(userId, feel, now)`: `dateLocal = localDate(now, timezone)` (E05-01 helper); `prisma.dailyCheckIn.upsert` on `(userId, dateLocal)`; then `TodayInsightService.invalidate(userId)`; audit `today:check_in` `meta {dateLocal, feel}`. Implements E05-01's `CheckInReader` (`readForDate(userId, dateLocal)`), replacing the null implementation.
- `DayReflectionService.create(userId, dto, now)`: `prisma.reflection.create({relatedType: 'day', relatedId: dateLocal, userText: text, frictionTags: [quickOption]})`; audit `today:reflection` `meta {dateLocal, quickOption}` (never the text). Multiple reflections per day are allowed; `GET` returns the latest.

Error codes: 400 Zod; 401. OpenAPI tag `Today` (E05-01).

**UI (frontend-dev)** — n/a (E05-04 renders the chips and the prompt).

**Tests (testing-dev)**

- `apps/api/src/today/check-in/check-in.service.spec.ts` — upsert twice same day → one row with the latest feel; `dateLocal` computed in the profile timezone; invalidate called; audit written.
- `apps/api/src/today/reflection/day-reflection.service.spec.ts` — `frictionTags` equals `[quickOption]`; `relatedType 'day'`; text absent → `userText null`.
- `apps/api/src/today/dto/check-in.dto.spec.ts` — rejects `'low_energy'` (case), unknown values, missing `feel`; reflection rejects text > 1000.
- `apps/api/test/today/check-in.integration.spec.ts` — POST then `GET /today` echoes `checkIn.feel`; `LOW_ENERGY` changes `nextBestAction.version` to `minimum` on a seeded commitment; user B's `GET /today/check-in` is `null` after user A checks in; reflection round-trip.

**Docs (docs-dev)** — `docs/API.md` "Today" section (four routes); CLAUDE.md "Database Tables" adds `daily_check_ins`; endpoints list.

#### Acceptance criteria

- [ ] `POST /api/today/check-in {feel:'PACKED'}` twice in one local day leaves exactly one `daily_check_ins` row for that user/day with `feel = 'PACKED'`.
- [ ] After a `LOW_ENERGY` check-in, `GET /api/today` returns `checkIn.feel = 'LOW_ENERGY'` and an NBA sized to the minimum version.
- [ ] A check-in at 23:30 UTC by a user in `America/Costa_Rica` is stored under the Costa Rica local date.
- [ ] `POST /api/today/reflection {quickOption:'TOO_MUCH', text:'…'}` creates one `reflections` row with `friction_tags = {TOO_MUCH}` and `related_type = 'day'`.
- [ ] Both writes produce audit rows (`today:check_in`, `today:reflection`) whose `meta` contains no free text.
- [ ] Invalid `feel`/`quickOption` values return 400 with a Zod error body.
- [ ] The cached coach insight is invalidated after a check-in (next `GET /today/insight` calls the gateway again — spy asserts).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 400/401 only; upsert races resolved by the unique index (retry once on `P2002`)
- [ ] Observability: audit rows; no reflection text in logs
- [ ] Security: `@Auth()`; `userId` scoping; cascade delete with the user
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–3. `evopath api POST /api/today/check-in --data '{"feel":"LOW_ENERGY"}'` → `{dateLocal: "<today>", feel: "LOW_ENERGY"}`.
2. `evopath api GET /api/today | jq '.data | {checkIn, v: .nextBestAction.version}'` → `LOW_ENERGY`, `"minimum"`.
3. `evopath api POST /api/today/check-in --data '{"feel":"NORMAL"}'`; `psql -c "SELECT feel FROM daily_check_ins"` → one row, `NORMAL`.
4. `evopath api POST /api/today/reflection --data '{"quickOption":"BAD_TIMING","text":"evenings are chaos"}'` → 201; `SELECT related_type, related_id, friction_tags FROM reflections;` → `day`, today, `{BAD_TIMING}`.
5. `SELECT action, meta FROM audit_events WHERE action LIKE 'today:%';` → two rows, `meta` without the text.

#### Out of scope

- Mood / perceived difficulty / satisfaction fields (PRD §10.10 optional; not in V1 UI).
- Reflection prompts by notification (E12 N8/N9) and weekly aggregation (E10).
- Per-commitment reflections (E05-02 skip creates those).

#### Notes for the implementing agent

- Store `dateLocal` as a `YYYY-MM-DD` string, not `@db.Date`: it is a label in the user's timezone, and Prisma's `Date` mapping would shift it through UTC.
- Reuse `localDate` from `apps/api/src/today/local-date.ts` (E05-01); if E05-03 lands first, create that helper here with the same signature.
- `PLAN_WORKED` is a valid reflection option but not a `SkipReason` (E05-02); keep the two enums separate.

---

### E05-04 `feat(web): add Today screen with next-best-action and domain cards`

**Part of epic:** E05 · **Blocked by:** E05-01, E05-02, E05-03, E02-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

VISION §27 ("Here is your path today") and PRD §12 define Today as the product's primary surface: greeting and state, one Next Best Action with `Start` and `Make it smaller`, Work/Family/Health cards, coach insight, quick add. PRD §120 requires the screen to render fully when AI is down, PRD §123 requires mobile-first, and E12 will deep-link into it (`/today?commitment=<id>&action=start`). Today `/` is E02-05's placeholder.

#### Proposed solution

`TodayPage` at `/` composed of small components over `GET /today`, with the insight loaded separately after first paint, per-commitment action menus wired to E05-02, check-in chips and an evening reflection prompt wired to E05-03, and a deep-link handler.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E05-01/02/03).

**UI (frontend-dev)**

Routes (`apps/web/src/App.tsx`): `<Route path="/" element={<TodayPage />} />` replaces the E02-05 placeholder (delete `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/home/QuickActions.tsx` and their tests if E02-05 left them). `/` stays owned by the `today` destination in `DESTINATIONS` (E02-05); no registry change. Deep link: `TodayPage` reads `useSearchParams()` on mount — `action=start` → `navigate('/start/<id>', {replace: true})`; `action ∈ {complete, fallback, skip, reschedule}` → opens that dialog on the matching card; unknown id → snackbar "That commitment is no longer on today's path"; params are removed with `setSearchParams({}, {replace: true})` after handling.

Types (`apps/web/src/types/index.ts`): `Domain`, `DomainMode`, `CommitmentStatus`, `CommitmentVersion`, `CommitmentCard`, `NextBestAction`, `InterventionMode`, `TodayResponse`, `TodayInsight`, `CheckInFeel`, `DailyCheckIn`, `ReflectionQuickOption`, `DayReflection`, `DecompositionProposal`, `SkipReason` — mirroring the E05-01/02/03 Zod schemas field for field.

`apps/web/src/services/api.ts` functions: `getToday()`, `getTodayInsight()`, `getCheckIn()`, `postCheckIn(feel)`, `postDayReflection({quickOption, text})`, `startCommitment(id, {minutes?})`, `pauseCommitment(id)`, `continueCommitment(id, {extraMinutes?})`, `completeCommitment(id, body)`, `partialCommitment(id, body)`, `useCommitmentFallback(id, version)`, `rescheduleCommitment(id, {scheduledStart, scheduledEnd?})`, `skipCommitment(id, {reason, text?})`, `proposeDecomposition(id, {hint?})`, `applyDecomposition(id, proposal)` — all through the existing `api` `ApiService` (no raw `fetch`).

Hooks: `apps/web/src/hooks/useToday.ts` (`{today, loading, error, refresh}`; refetch on window focus and after every action), `useTodayInsight.ts` (starts after `today` resolves; `{insight, loading}`; never blocks), `useCommitmentActions.ts` (`{start, pause, complete, partial, fallback, reschedule, skip, decompose, applyDecomposition, pending}` with optimistic status update + rollback on `ApiError`, snackbar on 409 with the server message), `useCheckIn.ts`.

Components (`apps/web/src/components/today/`): `TodayGreeting.tsx` (`{greeting, stateLine}`), `CheckInChips.tsx` (`{value, onChange}` — four MUI `Chip`s in a `role="radiogroup"`), `NextBestActionCard.tsx` (`{nba, onStart, onMakeSmaller, onFallback}` — title, `durationMinutes · domain`, rationale, primary `Button` "Start N min", secondary "Make it smaller"; when `interventionMode === 'RECOVER'` primary label is "Restart"; when `nba` is null renders "Nothing planned — add something small" with the quick-add trigger), `DomainCard.tsx` (`{domain, mode, commitments, onAction}` — header with mode tag when not GROW, `CommitmentRow` list, empty copy per domain), `CommitmentRow.tsx` (`{commitment, onAction}` — status icon, title, time, version chip when `versionUsed !== FULL`, `rescheduleCount` badge ≥ 1, primary action button from `availableActions[0]`, ⋯ `CommitmentActionsMenu`), `CommitmentActionsMenu.tsx` (renders only the `availableActions` the API sent), `CoachInsightCard.tsx` (`{insight, loading}` — skeleton → text; caption "template" when `source === 'template'`), `dialogs/CompleteDialog.tsx` (notes, minutes; Complete / Partially), `dialogs/RescheduleDialog.tsx` (MUI `DateTimePicker`, default tomorrow same time), `dialogs/SkipDialog.tsx` (reason radio from `SkipReason`, text), `dialogs/MakeItSmallerDialog.tsx` (proposal steps as editable list, first step highlighted, `Use this` → apply → navigate to `/start/<newId>`; template fallback shows "Start 5 min"), `ReflectionPrompt.tsx` (shown when local hour ≥ 18 or `?reflect=1`; seven quick-option chips + optional text; hidden after submit for the day via `localStorage` key `today.reflection.<dateLocal>`).

Page: `apps/web/src/pages/TodayPage.tsx` — `Container maxWidth="lg"`; `Grid` `size={{ xs: 12, md: 5 }}` for greeting + chips + NBA + insight, `size={{ xs: 12, md: 7 }}` for the three domain cards (single column below `md`; the `sm` boundary is untouched — it belongs to the shell's five gates). The quick-add FAB (E05-06) is positioned `bottom: { xs: 80, sm: 24 }` so it clears `BottomNav` on phones.

Responsive: no new `down('sm')`/`up('sm')` gates; the page uses `md` for its own two-column layout only. Visual harness: add a `today` scene to `apps/web/visual/main.tsx` with a fake `TodayResponse` and regenerate baselines in the pinned Playwright container.

A11y: NBA card is a `section` with `aria-labelledby`; each domain card `aria-label="Work commitments"`; action menu buttons `aria-label="Actions for <title>"`; chips keyboard-navigable; dialogs use MUI `Dialog` focus trap; axe passes in the page test.

**Tests (testing-dev)**

- MSW: extend `apps/web/src/__tests__/mocks/handlers.ts` with `/today`, `/today/insight`, `/today/check-in`, `/today/reflection`, `/commitments/:id/actions/*` (mutable in-memory state so a `start` flips the row to STARTED); fixtures in `apps/web/src/__tests__/mocks/today.data.ts`.
- `apps/web/src/__tests__/pages/TodayPage.test.tsx` — renders greeting/state line; NBA title and "Start 25 min"; three domain cards; insight skeleton then text (resolves after `today`); insight 500 leaves the page intact; `Low energy` chip posts `{feel:'LOW_ENERGY'}` and re-renders NBA from the updated mock; `?commitment=<id>&action=start` navigates to `/start/<id>`; unknown id → snackbar; axe.
- `apps/web/src/__tests__/components/today/NextBestActionCard.test.tsx` — null state; RECOVER label; buttons call handlers.
- `apps/web/src/__tests__/components/today/CommitmentRow.test.tsx` — only `availableActions` are rendered; badge at `rescheduleCount 2`.
- `apps/web/src/__tests__/components/today/dialogs/*.test.tsx` — Skip posts `{reason, text}`; Reschedule posts ISO; MakeItSmaller renders template fallback and calls apply with the edited proposal.
- `apps/web/src/__tests__/hooks/useToday.test.ts`, `useCommitmentActions.test.ts` (optimistic update + rollback on 409).
- `apps/web/src/__tests__/config/destinations.test.ts` — still passes (`/` owned by `today`).

**Docs (docs-dev)** — `docs/specs/today-and-nba.md` UI section (E05-07 owns the file; this issue adds the component map to the PR); CLAUDE.md "Service URLs" unchanged.

#### Acceptance criteria

- [ ] `/` renders greeting, state line, NBA card with `Start N min` and `Make it smaller`, and Work/Family/Health cards from a single `GET /today`.
- [ ] The coach insight card appears after the rest of the page and a failing `/today/insight` never blocks or breaks the page.
- [ ] Tapping a check-in chip persists it and the NBA re-renders with the API's new sizing without a full reload.
- [ ] Each commitment row shows exactly the actions the API lists in `availableActions`; a 409 from an action shows the server message and reverts the optimistic state.
- [ ] `Make it smaller` shows the proposal (or the template fallback with `Start 5 min` when AI is down); `Use this` creates the child commitment and opens `/start/<newId>`.
- [ ] `/?commitment=<id>&action=start` opens `/start/<id>` and the URL no longer carries the params.
- [ ] Below 600px the page is a single column with BottomNav visible and the FAB above it; at ≥ 900px NBA/insight and domain cards sit side by side.
- [ ] The reflection prompt appears after 18:00 local (or `?reflect=1`), posts to `/today/reflection`, and is hidden for the rest of the day after submit.
- [ ] axe reports no violations on the page test.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: page renders on `/today/insight` failure; action errors surface via snackbar with rollback; unknown deep-link id handled
- [ ] Observability: n/a client-side beyond existing `ApiError` logging
- [ ] Security: only `api` service calls; no tokens in URLs; deep-link params are ids only
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`); visual baselines regenerated
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–5, 8–11, 14.
2. Open http://localhost:3535/?commitment=<workId>&action=start → lands on `/start/<workId>`; browser back returns to `/` without the params.
3. Stop `fake-openai`; reload `/` → page complete, insight shows the template sentence with the "template" caption; `Make it smaller` shows the 5-minute fallback.

#### Out of scope

- Start flow screen (E05-05); quick-add sheet content (E05-06 — this issue only reserves the FAB slot).
- Momentum summary (E11) — render nothing when `momentum` is null; no placeholder card.
- Family-specific copy ("I'm in") and workout cards (E08/E09).

#### Notes for the implementing agent

- Follow `apps/web/src/pages/Admin/EmailSettingsPage.tsx` + `hooks/useEmailSettings.ts` for the hook/page split and `ApiError` handling.
- Do not touch `Layout.tsx`, `BottomNav.tsx`, `AppBar.tsx`, `SettingsHub.tsx` breakpoints (five coupled gates). The page's own `md` grid is a local layout choice.
- `useSearchParams` from `react-router-dom` v6; strip params with `replace: true` so history stays clean for E12's notification clicks.
- Keep `momentum`/`coachInsight` in the `TodayResponse` type as `null` so E11 changes the type in one place.

---

### E05-05 `feat(web): add full-screen Start flow with server-derived timer`

**Part of epic:** E05 · **Blocked by:** E05-02 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

VISION §10: Start is "one of the most important buttons" and must support 5/10/20-minute starts, continue, pause; PRD §27 specifies the Start screen (title, why it matters, timer, one-sentence instruction, stop/continue, "Continue another 15 minutes?"); PRD §28 lists 5/10/20/custom, silent timer, continuation, completion evidence. PRD §11 allows execution screens to replace bottom navigation. A timer that lives only in React state dies on reload — E05-02 persists `startedAt`/`activeSince`/`activeSeconds` so the client can derive it.

#### Proposed solution

`/start/:commitmentId`, a full-screen route inside `ProtectedRoute` but outside `Layout` (exactly like `/activate`), that starts the commitment on the server if not yet started, shows why it matters and the steps, runs a countdown derived from server timer fields, and posts completion.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a; uses E05-02 `start`/`pause`/`continue`/`complete`/`partial` and E02-04 `GET /commitments/:id` (must return `CommitmentCard` fields incl. `timer`, `steps`, and `outcome: {whyItMatters, successDefinition}` — add the `outcome` include to E02-04's detail endpoint if missing, as a one-line change in this issue's backend step).

**UI (frontend-dev)**

Route (`apps/web/src/App.tsx`): `<Route path="/start/:commitmentId" element={<StartFlowPage />} />` as a sibling of `/activate` (inside `ProtectedRoute` and the E01/E04 gates, outside `NotificationProvider`+`Layout`). Add `'/start'` to `UNOWNED_ROUTES` in `apps/web/src/config/destinations.ts` (no destination highlights; the route mounts no nav) so the route-ownership test stays green.

Page `apps/web/src/pages/StartFlowPage.tsx`: loads the commitment; if `status` is not `STARTED`, shows the pre-start view; otherwise the running view.

- Pre-start view: title; "Why it matters" (`outcome.whyItMatters`, fallback `successDefinition`, hidden when both empty); `TimerPicker` (`5 / 10 / 20 / Custom` `ToggleButtonGroup`, custom = number input 1–180, default = the version's minutes when it is one of the presets, else 10); `StepsList` when `steps` is non-empty (else the version title as the one-sentence instruction); CTA `Begin MM:00` → `startCommitment(id, {minutes})`.
- Running view: large `MM:SS` countdown (`aria-live="polite"` every 60 s, not every tick), `Pause`/`Continue`, `Done for now` (opens `CompleteDialog` from E05-04 → `complete` or `partial`), optional distraction note textarea (kept in component state; posted as `notes` on completion). At 00:00: prompt "Continue another 15?" → `continueCommitment(id, {extraMinutes: 15})` or `Done for now`.
- Timer derivation (`apps/web/src/hooks/useStartSession.ts` + pure `apps/web/src/utils/commitmentTimer.ts`): `elapsed = activeSeconds + (activeSince ? (now − activeSince) : 0)`, `remaining = timerMinutes*60 − elapsed`; `now` ticks locally with `setInterval(1000)` but the anchor is the server's `activeSince`; on mount/reload/focus the hook refetches the commitment and re-anchors, so a reload never resets the countdown. Clock skew guard: if `activeSince` is in the future by > 5 s, anchor at local `now` and log a console warning.
- Leaving the page (browser back) does not pause the timer (server state is authoritative; Today shows "Continue" on the row). A `beforeunload` handler is not added.
- Completion navigates to `/` with a snackbar "Recorded: N minutes on <title>" (evidence is written by E05-02; the client shows nothing it did not receive back).

Responsive: full-viewport `Box` with `minHeight: 100dvh`, content max-width 600px centered; timer digits scale with `clamp(3rem, 12vw, 6rem)`. No shell gates involved. Wake lock: `navigator.wakeLock?.request('screen')` while running, released on pause/unmount (feature-detected, no error surfaced).

A11y: `role="timer"` on the countdown; buttons ≥ 44px; `Escape` does nothing destructive; colour is not the only pause indicator.

**Tests (testing-dev)**

- `apps/web/src/__tests__/utils/commitmentTimer.test.ts` — running/paused elapsed; remaining floors at 0; future `activeSince` guard.
- `apps/web/src/__tests__/pages/StartFlowPage.test.tsx` (fake timers + MSW) — pre-start shows why-it-matters and steps; `Begin 10:00` posts `{minutes:10}`; countdown advances with `vi.advanceTimersByTime`; remount with the same MSW state resumes at the right remaining time (the reload case); `Pause` posts and freezes; at 00:00 prompt appears; `Continue another 15` posts `{extraMinutes:15}`; `Done for now` → complete → navigates to `/`; 404 commitment shows "not found" with a link to `/`.
- `apps/web/src/__tests__/config/destinations.test.ts` — `/start/:commitmentId` is deliberately unowned.

**Docs (docs-dev)** — `docs/specs/today-and-nba.md` "Start flow" section (via E05-07); CLAUDE.md nothing.

#### Acceptance criteria

- [ ] `/start/<id>` renders full-screen without rail, AppBar or BottomNav.
- [ ] Choosing `10` and pressing `Begin 10:00` moves the commitment to STARTED on the server (evidence `APP_FLOW started` with `quantitativeValue 10`).
- [ ] Reloading the page mid-timer resumes at the server-derived remaining time (± 2 s), never at the full duration.
- [ ] `Pause` stops the countdown and persists; `Continue` resumes from the same remaining time.
- [ ] At 00:00 the "Continue another 15?" prompt appears; accepting extends `timerMinutes` by 15 and keeps counting.
- [ ] `Done for now` → `Complete` records completion and returns to `/` where the row is shown completed; `Partially done` records `PARTIALLY_COMPLETED`.
- [ ] Decomposition `steps` (from E05-02 apply) are listed as numbered instructions; without steps the version title is shown as the instruction.
- [ ] A foreign or deleted id shows a not-found state, not a blank screen.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 404 state; action 409s shown and state refetched; wake-lock failures ignored
- [ ] Observability: n/a client-side
- [ ] Security: ownership enforced by the API; the page never trusts the URL id beyond fetching it
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 6–7.
2. During the countdown press browser back → Today shows the row with `Continue`; tap it → `/start/<id>` resumes.
3. Let the timer expire → accept "Continue another 15?" → countdown shows 15:00; `evopath api GET /api/commitments/<id> | jq .data.timer.timerMinutes` → original + 15.

#### Out of scope

- Focus-session records / distraction analytics (E07 — the note is only posted as completion `notes`).
- Workout runner (E09) — HEALTH commitments run this generic timer.
- Sounds, notifications at timer end (E12), background timers when the tab is closed.

#### Notes for the implementing agent

- Copy the full-screen route placement of `/activate` (`apps/web/src/pages/ActivateDevicePage.tsx`) — same `ProtectedRoute` nesting, no `Layout`.
- `useIsMounted` (`apps/web/src/hooks/useIsMounted.ts`) guards state updates after async actions.
- Keep `commitmentTimer.ts` pure so the unit test needs no React.
- Do not add a PAUSED status client-side; paused is `timer.activeSince === null` while `status === 'STARTED'`.

---

### E05-06 `feat(web): add quick-add sheet and commitment editor`

**Part of epic:** E05 · **Blocked by:** E02-04, E05-04 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §12.1 "Quick add: allow user to add commitment, workout, family intention, work action." Without it, Today can only show what onboarding (E04) or the Path screen (E02-06) created, and VISION §28's five-minute win cannot be added on the spot. Workout quick-add needs the E09 program model and is deferred.

#### Proposed solution

A `QuickAddSheet` opened from Today's FAB — a bottom sheet (`SwipeableDrawer anchor="bottom"`) below 600px and a `Dialog` at ≥ 600px — wrapping a `CommitmentEditorForm` used for create (quick add) and edit (from the row menu), posting to E02-04's `POST /commitments` / `PATCH /commitments/:id`.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a. Contract owner is E02-04: read `apps/api/src/commitments/dto/create-commitment.dto.ts` (E02-04's name may differ) before writing the form and send exactly its fields; if `commitmentType` is required there, map kind → type as documented in E02-04.

**UI (frontend-dev)**

- `apps/web/src/components/today/QuickAddFab.tsx` — MUI `Fab color="primary" aria-label="Add"`, `position: fixed`, `bottom: { xs: 80, sm: 24 }`, `right: 24`.
- `apps/web/src/components/today/QuickAddSheet.tsx` (`{open, onClose, onCreated, initialDomain?}`) — kind chooser as three large buttons: **Commitment** (any domain), **Work action** (domain WORK preset), **Family intention** (domain FAMILY preset); a fourth, **Workout**, is rendered disabled with helper text "Coming with workout programs" (E09). Container: `useMediaQuery(theme.breakpoints.down('sm'))` → `SwipeableDrawer` (bottom) else `Dialog maxWidth="sm"`. This is a local presentation choice, documented in a comment as *not* one of the five coupled gates.
- `apps/web/src/components/today/CommitmentEditorForm.tsx` (`{mode: 'create' | 'edit', initial?, onSubmit, submitting}`) — fields: `domain` (segmented WORK/FAMILY/HEALTH), `title` (required, ≤ 120), `outcomeId` (optional `Select` from `GET /outcomes?domain=` — E02-02 — "No outcome (just today)"), `scheduledStart` (`DateTimePicker`, default next full hour today), `durationMinutes` (5/10/20/30/45/60 chips + custom), `importance` (1–5 rating, default 3), collapsible **Versions**: `shortVersion` and `minimumVersion` `{title, minutes}` (minimum minutes must be < short < full; validated client-side with Zod in `apps/web/src/utils/commitmentForm.schema.ts`). Submit maps to E02-04's body (`fullVersion = {title, minutes: durationMinutes}`).
- Edit entry point: `CommitmentActionsMenu` (E05-04) gains **Edit** for statuses `PLANNED | READY | RESCHEDULED`, opening the same sheet in `edit` mode → `PATCH /commitments/:id`.
- `services/api.ts`: `createCommitment(body)`, `updateCommitment(id, body)`, `getOutcomes(params)` (if E02-06 did not add it).
- After create: `onCreated` → `useToday.refresh()`; snackbar "Added to today" with an **Undo** action that calls E02-04's `DELETE /commitments/:id` (or `transition → CANCELLED` if delete is not exposed) within 6 s.
- A11y: sheet has `aria-labelledby` title; first field autofocused; `Escape`/swipe-down closes; errors announced via `helperText` + `aria-invalid`.

**Tests (testing-dev)**

- `apps/web/src/__tests__/utils/commitmentForm.schema.test.ts` — title required; minimum < short < full ordering; custom duration bounds.
- `apps/web/src/__tests__/components/today/QuickAddSheet.test.tsx` — renders `SwipeableDrawer` under 600px and `Dialog` at ≥ 600px (mock `matchMedia`); Workout disabled; Family intention preset domain; submit posts the exact E02-04 body (assert JSON); Undo calls delete/cancel.
- `apps/web/src/__tests__/components/today/CommitmentEditorForm.test.tsx` — edit mode prefills and PATCHes only changed fields.
- `apps/web/src/__tests__/pages/TodayPage.test.tsx` — FAB opens the sheet; new commitment appears after refresh (MSW state).

**Docs (docs-dev)** — `docs/specs/today-and-nba.md` "Quick add" paragraph (via E05-07).

#### Acceptance criteria

- [ ] The FAB is visible on `/` at every width and never overlaps `BottomNav` below 600px.
- [ ] Below 600px the quick-add opens as a bottom sheet; at ≥ 600px as a centred dialog.
- [ ] "Family intention" preselects FAMILY; "Work action" preselects WORK; "Workout" is disabled with the deferral text.
- [ ] Submitting title + time + duration creates a commitment via `POST /api/commitments` and it appears on the correct domain card without a full reload.
- [ ] Declaring short/minimum versions with non-decreasing minutes is rejected client-side with a field error.
- [ ] Edit from a row's menu opens the same form prefilled and saves via `PATCH`.
- [ ] Undo within 6 s removes the just-added commitment from Today.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: API 400 messages mapped to field errors; network errors keep the sheet open with the values intact
- [ ] Observability: n/a
- [ ] Security: only `api` service calls; no HTML in titles (rendered as text)
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script step 11 at phone width and at desktop width.
2. Add a WORK action with short (10) and minimum (5) versions; check in `Low energy`; the NBA shows the 5-minute version.
3. Row menu → Edit → change the time → save → row moves accordingly after refresh.
4. Add, then press Undo in the snackbar → row disappears; `evopath api GET /api/commitments/<id>` → 404 or `CANCELLED` per E02-04.

#### Out of scope

- Workout quick-add and meal photo quick-add (E09).
- Recurring/ritual creation (E08) — quick add creates single occurrences only.
- Attaching media to a commitment (E03 picker is not wired here).

#### Notes for the implementing agent

- Model the sheet/dialog switch on `components/ai/PersonaModelTable.tsx`'s (E01-07) documented local `down('sm')` usage: it is presentation inside one page, not a shell gate.
- MUI X `DateTimePicker` is already used by `RescheduleDialog` (E05-04); share the `LocalizationProvider` setup.
- Keep the Zod form schema in `apps/web/src/utils/` so it is testable without React.

---

### E05-07 `test(tests): E05 end-to-end verification`

**Part of epic:** E05 · **Blocked by:** E05-01, E05-02, E05-03, E05-04, E05-05, E05-06, E01-10 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → docs-dev

#### Problem statement

The epic's promise (PRD §101 Day 1–3: start recorded as evidence, fallback completed, "moved this twice") is only real if a browser can drive it against the API and database. The epic needs one Playwright spec that proves the loop against the fake OpenAI server (E01-10), plus the spec document future epics (E07, E11, E12) will read for the contracts fixed here.

#### Proposed solution

A Playwright spec `tests/e2e/specs/today.spec.ts` with API-seeded data, an API helper for commitments, the `docs/specs/today-and-nba.md` document, API.md/CLAUDE.md updates, and the `docs/epics` back-link.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (if seeding reveals a gap in E02-04's create DTO, file it against E02-04; do not patch here).

**UI (frontend-dev)** — add stable `data-testid`s only where selectors by role/text are ambiguous: `today-nba`, `today-nba-start`, `today-nba-smaller`, `today-domain-WORK|FAMILY|HEALTH`, `today-checkin-LOW_ENERGY`, `start-timer`, `start-begin`, `start-done`, `quick-add-fab`.

**Tests (testing-dev)**

- `tests/e2e/helpers/commitments.helper.ts` (new): `apiContext(page)` (reads the access token the way `auth.helper.ts`'s login leaves it), `createOutcome(ctx, {domain, title, whyItMatters})`, `createCommitment(ctx, {...})`, `getCommitment(ctx, id)`, `todayAt(hour, tz)` (ISO for today in the test user's timezone; the test user's profile is set to `UTC` via E04's `PATCH /me/profile` or the E04 test-login extension).
- `tests/e2e/specs/today.spec.ts` (run with `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`), fresh user per test via `loginAsTestUser` with a unique email and `withAiKey` (E01-10):
  1. **Today → Start → Done → evidence**: seed WORK (full 25 / short 10 / minimum 5, importance 5, now+30 min), FAMILY, HEALTH; open `/`; expect NBA title = WORK commitment and button `Start 25 min`; click → URL `/start/<id>`; choose `5`, `Begin 05:00`; expect timer text to match `/0[45]:\d\d/`; reload; expect the timer not to have reset to `05:00` after ≥ 3 s elapsed; `Pause` → text frozen for 2 s; `Continue`; `Done for now` → `Complete`; back on `/` the row shows completed; `getCommitment` → `status COMPLETED`, `startedAt` non-null; `GET /api/evidence?commitmentId=` (E02-04) → types `['started','paused','continued','completed']`.
  2. **Reschedule twice**: on the HEALTH row menu → Reschedule → tomorrow → save, twice; `getCommitment(healthId).rescheduleCount === 2`, `status === 'RESCHEDULED'`; row absent from today's HEALTH card.
  3. **Low energy sizes the NBA**: seed a WORK commitment with minimum version; click `today-checkin-LOW_ENERGY`; expect NBA duration text `5 min` and title = minimum title; `GET /api/today` → `nextBestAction.version === 'minimum'`.
  4. **Make it smaller with fake AI**: click `today-nba-smaller`; dialog lists ≥ 1 step; `Use this` → URL `/start/<newId>`; `getCommitment(newId).decomposedFromId === workId`.
  5. **AI down keeps Today working**: request context sets header `x-fake-behaviour: timeout` is not possible from the browser, so instead point the platform at an unreachable base URL for this test's admin (`PUT /api/ai-settings {baseUrl: 'http://fake-openai:1/v1'}` via the admin fixture) → reload `/` → page renders, insight shows the template caption; `Make it smaller` shows `Start 5 min`; restore `baseUrl` in `afterEach`.
  6. **Skip with reason** → `SKIPPED` and a reflection row via `GET /api/reflections?relatedId=` (E02-04).
  7. **Quick add**: FAB → Family intention → title/time → save → appears on the FAMILY card.
  8. **Deep link**: `page.goto('/?commitment=<id>&action=start')` → `/start/<id>`.
- Run with `npm test` in `tests/e2e` (`BASE_URL` default http://localhost:3535); update `tests/e2e/package.json` scripts if a `test:today` filter is useful.

**Docs (docs-dev)**

- `docs/specs/today-and-nba.md` (new): purpose; `GET /today` schema; scorer terms, weights and tie rules; sizing and fallback rules; intervention-mode table with precedence; STARTED pre-rule; candidate window and timezone; insight caching and template fallback; commitment action semantics table (status before/after, evidence `source`/`type`, audit action), the same-row reschedule decision and paused-as-STARTED decision; timer derivation formula; deep-link contract for E12; check-in and reflection contracts; what E07/E10/E11/E12 read from here; rejected alternatives (new row per reschedule, PAUSED status, AI-ranked NBA).
- `docs/API.md`: "Today" section (6 routes) and "Commitment actions" (10 routes) with request/response examples.
- `CLAUDE.md`: endpoints list, `daily_check_ins` in Database Tables, a "Today & NBA" pointer paragraph to the spec (do not restate rules).
- `docs/TESTING.md`: E2E section mentions `today.spec.ts` and the fake-openai compose file.
- `docs/epics/README.md`: E05 row links to this file and to `docs/specs/today-and-nba.md`.

#### Acceptance criteria

- [ ] `tests/e2e/specs/today.spec.ts` passes against the compose stack with `fake-openai.compose.yml` on a clean database.
- [ ] Case 1 proves start and completion are separate evidence rows and that a reload mid-timer does not reset the countdown.
- [ ] Case 2 proves `rescheduleCount === 2` through the public API after two UI reschedules.
- [ ] Case 3 proves a `LOW_ENERGY` check-in switches the NBA to the minimum version in the UI and in `GET /api/today`.
- [ ] Case 5 proves Today, Start and Make-it-smaller (template) work with the AI base URL unreachable.
- [ ] `docs/specs/today-and-nba.md` exists and documents every constant, enum and decision listed above; `docs/API.md` covers all 16 routes; `docs/epics/README.md` links to both.
- [ ] `npm test` (`apps/api`) and `npm run test:run` (`apps/web`) are green on the epic branch.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: spec cleans up (`afterEach` restores AI settings; unique users per test avoid cross-talk)
- [ ] Observability: Playwright trace on first retry (existing config)
- [ ] Security: no real OpenAI key anywhere; `withAiKey` seeds the fake `sk-test-…` key only
- [ ] Config & secrets: `OPENAI_BASE_URL` documented in `.env.example` (E01-12) — no additions
- [ ] Tests listed above pass locally (e2e in `tests/e2e`)
- [ ] Docs updated (spec, API.md, CLAUDE.md, TESTING.md, epics README)

#### Manual test script

1. `cd tests/e2e && npx playwright test specs/today.spec.ts` with the stack from the epic script step 2 running → 8 passed.
2. Open `docs/specs/today-and-nba.md` and cross-check the weight constants against `apps/api/src/today/nba/nba-scorer.ts` (they must match by name and value).
3. Run the epic-level manual verification steps 1–14 once end to end.

#### Out of scope

- Visual-regression baselines for Today (E05-04 owns them).
- E07/E11/E12 flows that build on these hooks.
- CI workflow files (declined project-wide; local runs only).

#### Notes for the implementing agent

- Reuse `tests/e2e/helpers/auth.helper.ts` and E01-10's `withAiKey` extension; do not create a second login helper.
- Seed through the API, never through `psql`, so the spec also exercises E02-04's create contracts.
- Keep timing assertions tolerant (regex on `MM:SS`, `toPass` polling), never exact seconds.
- The spec file is the last child: if a case fails because an earlier child deviated, fix the child under its own issue and reference it in the commit.

---
