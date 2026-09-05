# The Health domain

**Status:** implemented (epic E09 — issues #72, #77, #81, #85, #88, #92, #95,
#109, #111, #113, #114)
**Audience:** anyone changing `apps/api/src/workouts/`,
`apps/api/src/health-domain/`, `apps/web/src/components/workouts/`,
`apps/web/src/components/health/`, or building on top of them.

This document is the written contract for the Health domain: workout programs,
the session runner, progression, adaptation, media coaching, nutrition
behaviours and the weight trend. Like [`domain-model.md`](./domain-model.md),
[`today-and-nba.md`](./today-and-nba.md) and
[`family-domain.md`](./family-domain.md), it exists because a later epic will
read these rules, believe them, and ship against them — so a stale one is worse
than none. Where a constant is named below, it is named exactly as the code
names it, **with its current value**, and
`apps/api/test/docs/health-domain-doc.spec.ts` fails the build when the two
disagree.

---

## 1. What the Health domain is for

VISION §13–§16 and PRD §36–§47 ask for one thing: a person who wants to train
should get **a real program, executable today, that survives a bad week**. Not a
library of exercises, not a log book, and not a coach that renegotiates the plan
every morning.

Four principles run through every file below. Each of them is a decision that
looks like extra work until the day it is not.

1. **The deterministic path is the product; AI is an accelerator.** PRD §120.
   The program builder falls back to a starter program, the progression rule has
   no model in it at all, the explanation falls back to a template sentence, and
   the media checks answer 200 with `source: 'template'` or `'none'`. Nothing in
   this epic returns a 5xx because a provider was unavailable.
2. **The AI never changes a plan.** PRD §15, §89. Adaptation writes
   `plan_change_proposals` rows and stops; the plan changes when — and only
   when — the user calls `POST /api/proposals/:id/accept`.
3. **There is always a version of this you can do today.** PRD §44, §57. FULL,
   SHORT and MINIMUM are separate template rows created together, not modifiers
   computed at read time, and the program contract refuses a FULL template whose
   siblings are missing.
4. **Nothing here scores a person.** Sharp pain gets constant professional-care
   copy and no programming advice (PRD §45); a meal photograph gets behaviours,
   never calories (PRD §46, VISION §16); a weigh-in gets a seven-day mean,
   never a verdict about the day (PRD §47).

---

## 2. The data model

```
User ──┬─< WorkoutProgram ──< WorkoutTemplate ──< WorkoutTemplateExercise >── Exercise
       │        (DRAFT/ACTIVE/ARCHIVED)   │              (prescription)        (catalog)
       │                                  └── routineId ──> Routine (on the ACTIVE PlanVersion)
       │
       ├──< WorkoutSession ──< SetLog          (one run of one template, one row per set)
       │        │
       │        └── commitmentId ──> Commitment ── workoutTemplateId ──> WorkoutTemplate
       │
       └──< BodyWeightLog                       (one row per user per local day)
```

| Table | What one row is | The rule that is easy to break |
|---|---|---|
| `exercises` | One movement, global or user-owned | `@@unique([scope, nameKey])`; `scope` is `'global'` or the owner's user id |
| `workout_programs` | One program, `DRAFT`/`ACTIVE`/`ARCHIVED` | At most one `ACTIVE` per user; approve archives the previous one |
| `workout_templates` | One session shape at one size | `@@unique([programId, name, variant])`; `routineId` is `@unique` and nullable |
| `workout_template_exercises` | One prescription line | `onDelete: Restrict` on the exercise — a catalog row in use cannot vanish |
| `workout_sessions` | One attempt at one template | `IN_PROGRESS`, `COMPLETED`, `ABANDONED`; at most one `IN_PROGRESS` per user |
| `set_logs` | One set | `clientId` is `@unique` **across the table**, and `@@unique([sessionId, exerciseId, setNumber])` |
| `body_weight_logs` | One weigh-in | `@@unique([userId, dateLocal])`; `dateLocal` is text in the user's timezone |

`commitments` gained one nullable column, `workout_template_id` (`SET NULL`), so
a commitment on Today knows which session shape it is. Nothing about the
commitment lifecycle changed: E05's transition matrix, timer and `APP_FLOW`
evidence still own it, and this epic never writes a status directly.

**Ownership is a 404, never a 403** — the same rule as the rest of the product
(see [`domain-model.md`](./domain-model.md) §"Ownership"). A foreign program,
session or weight row is indistinguishable from one that never existed.

### The exercise catalog

`apps/api/prisma/exercise-catalog.ts` seeds 44 global movements. Two fields
decide everything downstream:

- **`equipment` is EVERYTHING the movement needs, not a list of things it could
  use.** A row meaning "dumbbells *or* kettlebells" is read as "dumbbells *and*
  kettlebells" and silently vanishes from every catalog filter it appears in.
  The e2e equipment check found this; the interface says so in a comment.
- **`contraindicationTags`** are what the safety rules match a user's stated
  limitation against (`CONTRAINDICATION_TAGS`).

The model **names** exercises and never identifies them:
`ExerciseResolverService` matches the name against the catalog, accepting a near
match at a Dice coefficient of `NEAR_MATCH_THRESHOLD = 0.85`, and creating a
user-scoped custom row for anything still unresolved. Asking a model for uuids
invites it to invent one, and an invented uuid is a foreign-key error at insert
time instead of a name a human can read and correct.

---

## 3. The program builder

`POST /api/workouts/programs/generate` takes the PRD §37 request:

| Field | Contract |
|---|---|
| `goal` | 3–200 chars |
| `experience` | `BEGINNER` \| `INTERMEDIATE` |
| `daysPerWeek` | 2–5 |
| `minutesPerSession` | 20–75 |
| `equipment` | at least one `Equipment` value |
| `preferences`, `limitations` | ≤ 500 chars, optional |
| `useStarter` | optional; skips the model entirely |

The persona is `workout_programmer`, the contract is
`workoutProgramProposalSchema` (`PROGRAM_SCHEMA_NAME = 'workout_program'`) and
the prompt version is `PROGRAM_PROMPT_VERSION = 'workout_programmer.v1'`.
`superRefine` enforces the three things a flat schema cannot say: every FULL
template has a SHORT **and** a MINIMUM sibling, `repMin <= repMax`, and every
scheduled weekday names a FULL template.

### The rules run after the model, not instead of it

`workout-program-rules.ts` is pure — no Prisma, no Nest, no clock — because
three callers read it: the generator applies it, the starter program is asserted
against it, and a table-driven spec walks it.

| Code | Fires when | Constant |
|---|---|---|
| `BEGINNER_MAX_DAYS` | a beginner's week schedules more than four days | `BEGINNER_MAX_DAYS` = `4` |
| `CONTRAINDICATED` | an exercise carries a tag the user's limitations matched | `LIMITATION_KEYWORDS` |
| `OVER_TIME_BUDGET` | a FULL template's estimate exceeds the request by more than the tolerance | `MINUTES_TOLERANCE_PCT` = `10` |
| `DAYS_MISMATCH` | the week does not schedule the number of days that was asked for | — |

The estimate is deliberately rest-dominated:

```
minutes = round( Σ sets × ( avgReps × SECONDS_PER_REP + restSeconds ) / 60 ) + SESSION_OVERHEAD_MINUTES
```

with `SECONDS_PER_REP` = `3` and `SESSION_OVERHEAD_MINUTES` = `5`. Three sets of
eight with two minutes rest is six minutes of rest and twenty-four seconds of
work; estimating from sets alone is why "40 minute" programs run an hour.

Limitation matching is a keyword map (`shoulder`, `knee`, `lower_back`, `wrist`,
`hip`, `elbow`, `neck`, `overhead`), **not** a model call: it runs on the
fallback path too, and a safety filter that needs the provider to be up is not a
safety filter. It is generous on purpose — "my shoulder is fine now" costs the
user an overhead press; the other kind of mistake costs them a shoulder.

**A violation is never a 500 and never an exception.** It degrades the response
to the deterministic starter program, which is a worse program and a working
product.

### The starter program

`starter-program.ts` builds a week from five fixed slots (squat, press, row,
hinge, brace) by picking the first candidate whose equipment the user actually
has — the last candidate in every slot requires nothing, so a user with no
equipment still gets a program. Days are laid out in `WEEKDAY_ORDER` = Mon, Wed,
Fri, Sat, Tue (spaced first, then filled in), and `effectiveDaysPerWeek()`
clamps a beginner to `BEGINNER_MAX_DAYS`. If a FULL template still lands over
budget, a seven-rung `LADDER` degrades it — fewer movements, then fewer sets,
then shorter rest, with a floor of two movements at two sets — rather than
shipping a program the rules reject.

The plank is prescribed as **20–30 seconds held, with the note "seconds held,
not reps"**: the output contract caps a rep at 30, and encoding a 45-second hold
as `repMax: 45` fails validation. The progression rule reads the same numbers
either way.

### Approve

`POST /api/workouts/programs/:id/approve` is **one `$transaction`**, because a
half-applied approval is a user looking at a program that is live on one screen
and absent from another. In order:

1. Find or create the user's HEALTH outcome and its plan.
2. `PlanVersionsService.createAndActivateInTx(...)` — a new ACTIVE `PlanVersion`
   whose routines are the FULL templates, matched by title.
3. Point each `workout_templates.routine_id` at the routine it produced.
4. Archive the previously ACTIVE program and cancel its future `PLANNED`
   commitments through E05's transition matrix.
5. Write `SCHEDULE_DAYS` = `14` days of commitments: for each local day in the
   window, for each `weeklyStructure` entry whose weekday matches, one
   commitment at the user's preferred time (default `07:00`) carrying
   `workoutTemplateId` and all three sizes
   (`fullVersion`/`fullMinutes`, `shortVersion`/`shortMinutes`,
   `minimumVersion`/`minimumMinutes`).

`notify('health.program_activated', …)` is sent **after the commit**, never
inside it: `notify` is detached and would otherwise announce a program a
rollback removed.

Audit actions: `workout_program:generate`, `workout_program:approve`.

---

## 4. The session

`POST /api/workouts/sessions` starts one, from **exactly one** of
`commitmentId` or `templateId` (the schema refuses both and neither), with a
`variant` defaulting to `FULL`. Starting from a commitment goes through E05's
`start` action, so the timer, the transition and the `APP_FLOW` evidence are
written by the code that already owns them — this service never sets a
commitment status directly.

The runner view carries the header (`sessionIndex` — the count of this program's
non-abandoned sessions up to and including this one), the exercises with their
prescriptions, **last time** for each movement and the progression suggestion.
`HISTORY_SESSIONS = 2` sessions of history are fetched for every movement in
**one** query, not one query per exercise.

### Logging a set is idempotent, and that is the whole offline story

`POST /api/workouts/sessions/:id/sets` and `.../sets/batch` (≤ 50) take a
`clientId` the **client** minted. It is part of the contract, not an
implementation detail: a server-generated id cannot deduplicate a replay,
because the client never saw the response it would have had to compare against.

The server attempts the insert and catches Prisma's `P2002`:

| Situation | Answer |
|---|---|
| Same `clientId` again | the existing row, unchanged — a replay |
| Same `(sessionId, exerciseId, setNumber)`, new `clientId` | the row is **updated** — a correction |
| Anything else | the new row |

`loggedAt` is accepted from the client only inside `CLOCK_SKEW_MS` (5 minutes)
of the server's clock. A client clock is not evidence.

### The outbox (PRD §121)

`apps/web/src/hooks/useSetLogOutbox.ts` is the other half. Sets are written to
`localStorage` under `outboxKey(sessionId)` = `workout.outbox.<sessionId>`,
retried every `RETRY_INTERVAL_MS` = `5000` ms, and sent through the batch route
once `BATCH_THRESHOLD` = `2` items are queued. Every storage access is wrapped
in try/catch (a private window throws on read), a **4xx stops the retry** — a
rejected set will be rejected forever — and a duplicate is treated as success,
because that is exactly what the server's idempotency means. Until a set is
acknowledged the card shows "Saved on this device".

### Finishing

`POST /api/workouts/sessions/:id/finish` takes `status: 'COMPLETED' | 'ABANDONED'`
and settles the commitment, if there is one:

| Session finish | Variant | Exercises | Commitment becomes |
|---|---|---|---|
| `COMPLETED` | `FULL` | all planned ones logged | `COMPLETED` |
| `COMPLETED` | `SHORT` / `MINIMUM` | any | `PARTIALLY_COMPLETED` |
| `COMPLETED` | `FULL` | some missing | `PARTIALLY_COMPLETED` |
| `ABANDONED` | any | at least one set logged | `PARTIALLY_COMPLETED` |
| `ABANDONED` | any | no sets | unchanged |

Finishing writes its own evidence row with `source: 'WORKOUT_LOG'` and
`evidenceType` `workout_completed` or `workout_abandoned`. That is a **separate**
row from the `USER_LOG` evidence E05's completion action writes about the
intention: one is "this workout happened", the other is "the commitment was
kept", and collapsing them would lose the distinction the weekly review reads.

`POST /api/workouts/sessions/:id/switch-variant` moves a running session to the
SHORT or MINIMUM sibling. It is a mid-session decision, which is the entire point
of PRD §44 — the small version has to be reachable **after** the day has already
gone wrong.

### Sharp pain

`workout-safety-copy.ts` holds one constant and there are no variations of it:

> Stop this exercise. Sharp pain is not something to train through. If it
> persists, sharpens, or comes with numbness or weakness, get it checked by a
> professional before your next session.

`PAIN_SAFETY_ACTION` is `stop_exercise`. A set logged with
`discomfort: 'SHARP_PAIN'` surfaces this copy, and the progression rule holds —
pain outranks every other rule, so the runner never follows "stop this exercise"
with "add 2.5 kg". Nothing about this sentence is generated, which is why it
works when the provider is down.

---

## 5. Progression, verbatim

PRD §42: *"the core progression rule should not be reinvented by the LLM every
workout. The AI can explain."* So `double-progression.ts` is the rule and there
is no model in it. It is pure, and the rules are evaluated **in this order**:

| # | Rule | Action | `reason` |
|---|---|---|---|
| 1 | No history at all | hold, no weight named | `first_session` |
| 2 | The last session logged `SHARP_PAIN` | hold | `discomfort` |
| 3 | Two sessions where **every** set hit `repMax` and no RPE exceeded `COMFORTABLE_RPE` = `8` | increase | `top_of_range_twice` |
| 4 | Two sessions where **any** set fell below `repMin` | reduce | `below_min_twice` |
| 5 | Exactly one session of history | hold | `insufficient_history` |
| 6 | Anything else | hold | `building` |

An increase adds `incrementFor(equipment)` from `INCREMENT_KG` —
`DUMBBELL` `2.5`, `BARBELL` `5`, `KETTLEBELL` `4`, `MACHINE` `5`, `CABLE` `2.5`
kg — and a reduction multiplies by `REDUCE_FACTOR` = `0.95`. Every weight the
product ever names is rounded to `WEIGHT_STEP_KG` = `0.25` kg.

**Two sessions, not one.** One good day is a good day; two is a trend. Increasing
off a single session is how a beginner ends up adding weight they cannot control
in week three.

**Bodyweight tops out too.** With no loadable implement the action is still
`increase` with `suggestedWeightKg: null` — the client says "add a rep or make it
harder". Reporting `hold` would tell a user who is plainly progressing that they
are not.

### The explanation

`GET /api/workouts/sessions/:id/exercises/:exerciseId/explain` returns
`{ sentence, source }` and is **always 200**. `templateExplanation()` is the
deterministic sentence for every reason; the `progression_explanation` persona
(`PROGRESSION_PROMPT_VERSION = 'progression-explain.v1'`) may rewrite it, and
`numbersAreSafe()` rejects the rewrite if it contains **any** number the
recommendation did not already contain. A model that invents "start with 40 kg"
in a sentence about a 22.5 kg suggestion is the failure this guard exists for,
and it is not detectable by reading the sentence for tone.

---

## 6. Adaptation

`adaptation-rules.ts` is pure and deliberately not a model. *"Has this been
skipped twice in a fortnight?"* is counting; a model asked the same question
answers differently on different days, and the answer decides whether a user is
shown a proposal about their own failure — the one place in this product where a
false positive is actively unkind.

| Detector | Fires when | Produces |
|---|---|---|
| `SKIPPED_TWICE` | a template's commitments were skipped `SIGNAL_THRESHOLD` times in the window | `reduce` the session length |
| `TOO_LONG` | sessions ran `OVER_RUN_MINUTES` past target, `SIGNAL_THRESHOLD` times | `reduce` |
| `EXERCISE_SKIPPED` | one movement absent from the last `EXERCISE_SKIP_SESSIONS` sessions | `replace` that exercise |
| `DISLIKED` | the user marked the movement disliked (`dislikedAt`) | `replace` |

Constants: `SIGNAL_THRESHOLD` = `2`, `WINDOW_DAYS` = `14`, `OVER_RUN_MINUTES` =
`15`, `EXERCISE_SKIP_SESSIONS` = `3`, `REDUCE_FACTOR` = `0.65`,
`MINIMUM_MINUTES` = `15`, `ACCESSORY_HINT_EXERCISES` = `5`. A reduction keeps
0.65 of the target — 0.65 of 40 minutes is 26, a real change rather than a
nudge — and never proposes a session shorter than `MINIMUM_MINUTES`.

**Every detector emits `reduce` or `replace`, never `move`, `add`, `remove` or
`pause`.** The other ops would need a reason this data cannot supply.

**And nothing here writes a plan.** The rules return candidates;
`WorkoutAdaptationService` turns them into `plan_change_proposals` rows through
`ProposalsService.createFromSource` (audit `workout_adaptation:propose`), and
the plan changes only when the user accepts.

### The accept seam

Accepting a proposal has to do two things at once: write the new `PlanVersion`
(which `applyChanges` already does) **and** update the workout template the
routine mirrors. `proposal-effects.ts` is that seam:

```ts
export const PROPOSAL_EFFECT = Symbol('PROPOSAL_EFFECT');

export interface ProposalEffect {
  readonly sourceKind: ProposalSourceKind;
  apply(tx: Prisma.TransactionClient, context: ProposalEffectContext): Promise<void>;
}
```

Effects are registered in `coach.module.ts` through a factory returning an array
(Nest has no `multi: true`) and run **inside the accept transaction**.
`WorkoutProposalEffect` updates the template's `targetMinutes`, the future
`PLANNED` commitments' `fullMinutes`, swaps the exercise on the FULL template and
its siblings, and **re-points `workout_templates.routine_id` at the new version's
routine** — a template still pointing at the superseded version's routine is a
program that silently stops adapting. Audit: `workout_adaptation:applied`.

One consequence worth naming: an exercise swap changes no scalar field on the
routine, so `applyChanges` explicitly allows a `replace` whose only content is
`workout.replaceExercise` instead of rejecting it as `nothing_changes`.

The sweep is `@Cron('0 4 * * *')`, daily, and one user's failure is logged and
skipped rather than ending the run. Set `WORKOUT_ADAPTATION_CRON_DISABLED=true`
to stop it — the same shape as `WEEKLY_REVIEW_CRON_DISABLED`, and for the same
reason: a background job that writes proposals for every seeded user turns a
deterministic test into a race.

---

## 7. Media coaching

Three narrow contracts, not one "describe this image". A typed output is what
lets the safety post-processing act on it: `riskFlags` is a closed list
precisely so that "the model mentioned pain somewhere in a paragraph" is not
something anybody has to detect with a regex over prose.

| Route | Persona / prompt version | Output |
|---|---|---|
| `POST /api/workouts/sessions/:id/form-check` | `form_check.v1` | `observations`, `cues` (≤ 3), `riskFlags`, `safetyNote`, `confidence` |
| `POST /api/workouts/equipment-check` | `equipment_check.v1` | `equipmentDetected`, `notes` |
| `POST /api/nutrition/meal-check` | `meal_check.v1` | `observations`, `behaviorSuggestions` (registry keys only) |

**What is absent is the point.** There is no score, no rep count, no tempo and no
"form grade" on the form check — PRD §106 excludes biomechanical scoring — and
no calorie, macro or portion weight anywhere. A field the model cannot fill is a
field it cannot invent.

### The safety redirect

`REDIRECTING_FLAGS` is `['pain_reported', 'joint_instability']`. When the model
raises either one, the service **empties the cues**, replaces the answer with
`PAIN_SAFETY_COPY` and sets `redirected: true`. The model is not asked to decide
this and cannot opt out of it: the cues it wrote are dropped by the server, which
is what makes the e2e assertion ("the warning is shown and no cues are")
meaningful.

### The no-calorie guard

```ts
export const CALORIE_PATTERN =
  /\b(kcal|calorie|calories|carbs?|macros?|grams? of|protein content|\d+\s?g\b)\b/i;
```

`mentionsAccounting()` **rejects the whole output** rather than editing it. A
stripped sentence reads as an omission, and we would be publishing the rest of a
reply that had already ignored its instructions. The rejected answer stores
nothing and the user gets the deterministic response.

### Attachments

E09 reads media through the existing `storage_objects` upload path.
`MediaSummaryService` is the **one-method seam** where E03's richer attachment
model will land: it stores the coaching result under the object's
`metadata.` + `COACHING_SUMMARY_KEY` (`_coaching`). When E03 ships its
attachment tables, that method is the only thing that has to move.

---

## 8. Nutrition is behaviours

PRD §46 fixes V1 nutrition as behaviours and nothing else. `NUTRITION_BEHAVIORS`
is a static registry modelled on `notification-events.ts` — adding one is a
single entry, not a migration and a seed:

`planned_breakfast`, `meal_prep`, `protein_with_meals`,
`vegetables_with_dinner`, `water_with_meals`, `no_late_night_eating`,
`weekday_meal_plan`, `restaurant_strategy`, `planned_snacks`, `eat_at_table`,
`limit_alcohol_work_nights`.

`BEHAVIOUR_TIMES` resolves the three slots in the user's own timezone:
`MORNING` `07:30`, `MIDDAY` `12:30`, `EVENING` `18:30`.

**Every behaviour has a minimum version, and it is never zero.** PRD §57's three
sizes are what keep a habit alive on a bad day, and "protein with one meal" is a
real thing somebody can do on the worst Tuesday of the month.

Nothing here is per-user. A behaviour becomes personal when the user commits to
it (`POST /api/nutrition/behaviors/:key/commit`, audit `nutrition:commit`), and
that produces an ordinary HEALTH commitment through the same service quick add
uses.

---

## 9. The weight trend

PRD §47 is unusually explicit about what this must **not** do: weight tracking is
optional, it is about the trend, and one measurement is never a "bad day". Body
weight moves two kilos on salt, sleep and the time of day; a product that reacts
to a single reading teaches people to be afraid of their scale.

So: a rolling mean over `TREND_WINDOW_DAYS` = `7` calendar days, and nothing
else. No per-day classification, no arrow, no goal, no colour. **The DTO carries
no field a client could use to judge a day even if it wanted to**, and a test
asserts the key list.

`rollingMean()` emits one point per calendar day in the window — every day, not
only the logged ones, because a chart that skipped unlogged days would compress a
fortnight of silence into the same width as a fortnight of daily readings and the
line would lie about the slope. A day with fewer than
`MIN_POINTS_FOR_TREND` = `2` readings behind it reports `null`: a "trend" drawn
through one point is a line the user will read as a direction, and it has none.
The chart leaves a gap and the caption says to log a few more days.

`PUT /api/health/weight` upserts on `(userId, dateLocal)` and accepts a backfill
up to `MAX_BACKFILL_DAYS` (365) old; the list defaults to `DEFAULT_WINDOW_DAYS`
(30). The audit row carries `{ dateLocal }` and no weight — an audit trail of
somebody's body weight is not a thing this product keeps.

---

## 10. The UI map

| Route | Screen | Note |
|---|---|---|
| `/health` | Nutrition behaviours, weight form, trend chart | inside the shell |
| `/health/programs` | Program list | |
| `/health/programs/new` | Builder wizard | |
| `/health/programs/:id` | One program, templates by size | routes, **not tabs** on the list page |
| `/workout/:sessionId` | The runner | **full-screen** |

The runner is full-screen because it is placed **outside `Layout`** in
`App.tsx`, beside `/start/:commitmentId`, and is listed in `UNOWNED_ROUTES`. It
is not full-screen because anything touched a breakpoint gate: the five coupled
gates in `CLAUDE.md` move together or not at all, and a route that wants no
navigation says so by where it is mounted. The mobile e2e case asserts the
absence of any `nav` element for exactly this reason.

The trend chart is inline SVG — muted points, one line, broken across runs of
`null` — with a visually hidden `<table>` carrying the same numbers. A chart
library for one line would be a dependency, a bundle and a theming problem.

---

## 11. Operations

| Variable | Default | What it does |
|---|---|---|
| `WORKOUT_ADAPTATION_CRON_DISABLED` | `false` | Stops the daily 04:00 adaptation sweep. Set `true` for e2e and integration runs |

Reading a workout session end to end:

```sql
-- The session, its sets, and what the commitment made of it
SELECT s.id, s.status, s.variant, s.started_at, s.finished_at,
       t.name AS template, c.status AS commitment_status
  FROM workout_sessions s
  JOIN workout_templates t ON t.id = s.template_id
  LEFT JOIN commitments c ON c.id = s.commitment_id
 WHERE s.user_id = :user_id
 ORDER BY s.started_at DESC LIMIT 5;

SELECT sl.set_number, e.name, sl.weight_kg, sl.reps, sl.rpe, sl.discomfort, sl.client_id
  FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
 WHERE sl.session_id = :session_id
 ORDER BY e.name, sl.set_number;

-- What the session produced
SELECT evidence_type, source, occurred_at FROM evidence_items
 WHERE commitment_id = :commitment_id ORDER BY occurred_at;

-- What adaptation proposed, and whether it was accepted
SELECT id, source_kind, status, applied_plan_version_id, created_at
  FROM plan_change_proposals
 WHERE user_id = :user_id ORDER BY created_at DESC LIMIT 5;

-- Every AI call this epic made, with no prompt content
SELECT persona, prompt_version, validation_result, latency_ms, created_at
  FROM ai_invocations
 WHERE user_id = :user_id ORDER BY created_at DESC LIMIT 20;
```

---

## 12. PRD §106 against the e2e spec

`tests/e2e/specs/health.spec.ts` runs on both Playwright projects (`chromium`
and `mobile-chromium`) against the compose stack with the fake OpenAI overlay.
Every PRD §106 line maps to at least one case:

| PRD §106 line | Spec case |
|---|---|
| User can create a workout program | 1 — builds and approves a program |
| The program persists and is retrievable | 1 — `GET /workouts/programs/:id` is `ACTIVE`, 14 days of commitments carry `workoutTemplateId` |
| Programs respect stated safety limitations | 2 — an unsafe draft falls back to the starter program |
| User can start a workout from the plan | 3 — Today → Start workout → `/workout/:id` |
| User can log sets | 3 — three sets logged, session `COMPLETED`, `WORKOUT_LOG` evidence |
| Sets survive a lost connection | 4 — offline queue replays with no duplicates |
| Next session shows last time | 5 — `runner-last-time` reads the previous session's sets |
| Progression is suggested | 5 — `runner-progression-chip` and its explanation |
| A shorter version is always available | 3, 6 — the size chooser and the mid-session switch |
| Pain is handled safely | 6 — `runner-safety-card`, professional-care copy, no cues |
| Media coaching on form | 7 — form check on a fixture clip, and its pain variant |
| AI recommends an adjustment when the plan is not working | 8 — two skips → one proposal |
| Structural changes need approval | 8 — `plan_versions` count moves only on accept |
| Weight is a trend, not a verdict | 9 — the trend line, no "bad day" text |
| Nutrition is behaviours, not calories | 10 — meal check, no `kcal` anywhere on the page |
| The runner is full-screen on a phone | 11 — no `nav` element in the mobile project |

The fake server answers `workout_program`, `form_check`, `equipment_check`,
`meal_check` and `progression_explanation` by schema name, with an unsafe
program variant selected by the word the user typed. See
[`../TESTING.md`](../TESTING.md) → "E2E Testing with Playwright".

---

## 13. Rejected alternatives

- **LLM-computed progression.** PRD §42 rules it out and the reasons are
  practical: it must be the same every week, it must work with the provider
  down, and it must be readable on one page. The model writes the sentence, and
  even that is guarded against inventing a number.
- **A `HealthBaseline` table.** The builder request already carries experience,
  days, minutes, equipment and limitations, and a stored baseline would be a
  second copy going stale from the day it was written. E04's onboarding fills
  the form's defaults instead.
- **Tabs for the program pages.** `settings-ui.md` §2's distinction applies
  outside settings too: a program is a destination, not content parallel to the
  list. The sizes inside one program are a tab strip, correctly, because FULL,
  SHORT and MINIMUM are three views of one question.
- **A chart library.** One line, muted points, a hidden table. See §10.
- **A server-side rest timer.** The rest timer counts down from a moment in the
  client's own hands and nothing depends on its accuracy; the **session** timer
  is server-derived precisely because something does. Deriving both from the
  server would put a network round trip between a set and the next one.
- **Deduplicating set logs on `(session, exercise, setNumber)` alone.** That is
  the correction case, not the replay case. Without `clientId` a genuine fourth
  set logged after a reconnect is indistinguishable from a replay of the third.
- **Making adaptation write the plan directly.** PRD §15. The proposal is the
  product: a user reading "you have skipped this three times" needs a choice
  attached to it, not a fait accompli.

---

## 14. Follow-ups

- **Manual program editing.** Today a program changes through adaptation
  proposals or a new build. Direct editing needs the same versioning story the
  plan has, and it should reuse `plan_change_proposals` rather than mutating
  templates.
- **Deloads.** The progression rule has no notion of accumulated fatigue. A
  deload is a fourth action, and it needs sessions-since-increase to be
  something the rule can see.
- **Exercise media.** The catalog carries names and tags; a demonstration clip
  per movement belongs with E03's attachment model.
- **Program sharing and templates between users.** Out of scope for V1 and it
  raises the same consent question `family-domain.md` §2 raises.

---

## 15. Related documents

- [`domain-model.md`](./domain-model.md) — the `Commitment` lifecycle every workout commitment goes through
- [`today-and-nba.md`](./today-and-nba.md) — how a workout reaches Today, and the sizes
- [`coach-and-memory.md`](./coach-and-memory.md) — the proposal protocol adaptation writes into
- [`weekly-review.md`](./weekly-review.md) — the counts a completed session feeds
- [`family-domain.md`](./family-domain.md) — the same rules for the other life domain
- [`ai-gateway.md`](./ai-gateway.md) — the contract every AI call here uses
- [`../API.md`](../API.md) — the routes, with request and response shapes
- [`../TESTING.md`](../TESTING.md) — the e2e suite and the fake OpenAI server
