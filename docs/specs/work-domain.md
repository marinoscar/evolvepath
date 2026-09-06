# The Work domain: focus sessions and anti-procrastination

**Epic E07** · PRD §22–§29, §104, §120 · VISION §8–§10

The written contract for everything under `apps/api/src/work/`,
`apps/web/src/components/work/`, and the Work branches of the Start flow and the
Today row. Read this before changing a threshold, a rung or a sentence in any of
them.

Like [`domain-model.md`](./domain-model.md) and
[`today-and-nba.md`](./today-and-nba.md), it exists because a later epic will
read these rules, believe them, and ship against them — E10's weekly review
reads §6's counts, and E12's N2/N3 notifications read §3's ladder level. A stale
one is worse than none.

---

## 0. The one promise this epic is built around

**Work is about EXECUTION, not storage.** VISION §8 rejects enterprise task
import outright; the product's job is not to hold a list of things, it is to get
somebody to begin one of them.

That shapes three things you will see repeated below:

1. **Starting is a first-class outcome.** VISION §10: ten minutes on something
   avoided for three days is meaningful progress, and PRD §104 requires start to
   be recorded *separately* from completion. `abandoned` still writes evidence.
2. **The product diagnoses friction rather than repeating itself.** VISION §9's
   question — "You've moved this twice. What is making it hard to start?" — is
   only worth asking because the eight answers go somewhere different, and
   because it is asked **once** (§4).
3. **Everything except the wording works with the model down** (PRD §120). The
   plan, the ladder, the intervention and the summary are all deterministic; the
   coach writes sentences about decisions that have already been made.

---

## 1. Session planning

`apps/api/src/work/planning/`. PRD §24.

### The contract

`work-session-plan.schema.ts` is one Zod object read by three consumers: the
`planner` persona's structured-output contract (`schemaName: work_session_plan`,
`promptVersion: work-session-plan.v1`), the shape the deterministic template must
satisfy, and the shape an edited copy is re-validated against at `apply`. A
second declaration anywhere would let the user apply something the model could
never have produced — or let the model produce something the apply transaction
has no column for.

```ts
{
  milestones: [{ title: 3..120, order: int }],        // 1..8
  sessions: [{                                        // 1..20
    title: 3..120,
    scheduledStart: ISO-8601 with offset,
    durationMinutes: 10..120,
    milestoneIndex: int,
    minimumStart: { title: 3..160, minutes: 2..15 },  // REQUIRED
  }],
  implementationIntention: { when: 3..160, then: 3..160 },
  reviewCadence: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY',
  rationale: <= 800,
}
```

`minimumStart` is required on **every** session, not optional. VISION §10's
promise — that the product can always offer a ten-minute version of the thing
being avoided — is only guaranteeable if a plan without one is refused.

### The guardrails

`work-session-plan.guardrails.ts`, pure, applied to **all three sources**
identically — a rule enforced on only one of them is a rule the other two can
break, and the user-edited copy is the one that reaches the database.

| Rule | Constant |
|---|---|
| `milestones[].order` are `0..n-1`, no gaps or duplicates | — |
| every `milestoneIndex < milestones.length` | — |
| every `scheduledStart` on or after the start of the current local day | — |
| every `scheduledStart` before the target date's local end, or 14 days out with no target date | DEFAULT_HORIZON_DAYS = 14 |
| at most two sessions on one local calendar day | MAX_SESSIONS_PER_DAY = 2 |
| the per-day total never exceeds the day's budget | request → `user_profiles.weekday_minutes` → DEFAULT_AVAILABLE_MINUTES_PER_DAY = 60 |
| `minimumStart.minutes < durationMinutes` | — |
| sessions listed in ascending order of start | — |

**The lower bound is the start of the current local day, not the instant of
validation.** A plan proposed at 09:00 whose first session is at 09:00 must not
become invalid at 09:01 while the user is reading it; a plan whose sessions are
yesterday still fails.

**Failures come back as sentences, not codes.** They are rendered verbatim in
the `PROPOSAL_INVALID` response, read by a person looking at a form they just
filled in. "3 sessions on 2026-09-08 — at most 2 fit in a day" is actionable and
`DAILY_CAP` is not.

**A model plan that breaks a guardrail is treated as a `schema` failure and
NOTHING IS STORED.** A plan the server had to correct is not the plan the user
would be agreeing to.

### The template

`work-session-templates.ts`, pure. PRD §120's answer for planning is not an
error page with a retry button — it is a plan the user can actually apply, made
of the only two things the server knows without a model: which days are
weekdays, and how many minutes the user said they have.

| Constant | Value |
|---|---|
| TEMPLATE_MAX_SESSIONS | 10 |
| TEMPLATE_DEFAULT_SESSIONS (no target date) | 5 |
| TEMPLATE_MAX_SESSION_MINUTES | 45 |
| TEMPLATE_SESSION_TIME | `'09:00'` local |
| `TEMPLATE_MILESTONES` | Clarify what done looks like · Produce a rough first version · Refine and finish |

Days are **spread evenly** across the weekdays up to the target date rather than
taken from the front: a plan for a deadline six weeks out that front-loads every
session into next week is not a plan for that deadline. The range falls back to
every day when it contains no weekday at all — a Sunday deadline on a Saturday
is a real request, and answering it with an empty plan would be a refusal
dressed as a feature.

**It says out loud that it is generic**, in its own `rationale`. A template
pretending to be a bespoke plan would be worse than an outage: the user would
follow it believing a coach wrote it.

### Apply

`POST /outcomes/:id/plan-sessions/apply` is the PRD §15 approval step and the
only path that creates rows. One transaction:

1. The outcome's `Plan` and its ACTIVE `PlanVersion`, **created only when the
   outcome had none** (an outcome created from the Path screen has no plan, and
   a session plan is not a reason to refuse).
2. One `work_milestones` row per milestone. `order` continues from the outcome's
   current maximum, so a second plan appends rather than colliding with the
   unique `(outcome_id, order)`.
3. One `EVENT`-triggered `Routine` on that active version, reusing the outcome's
   existing focus routine when one is there rather than creating a second.
4. One `PLANNED` `WORK` commitment per session, `commitment_type =
   'FOCUS_SESSION'`, carrying all three sizes.
5. The proposal marked `APPLIED` with `appliedPlan` = the copy that was applied.

Then, outside the transaction: `work:sessions_applied` in `audit_events`, with
`{ source, edited, milestones, sessions, routineId }` — ids and counts, never a
title.

---

## 2. Focus sessions

`apps/api/src/work/focus/`. PRD §27–§28.

**A LAYER OVER E05's TIMER, NOT A SECOND ONE.** `commitments.activeSince` /
`activeSeconds` / `timerMinutes` remain the only clock, and every status change
goes through `CommitmentActionsService` — `start` on start, `continue` on
extend, `complete` / `partial` / `pause` on stop. Re-implementing any of them
would produce a second set of `APP_FLOW` evidence rows for the same moment, and
then two different answers to "how long did this take".

What the table adds is what a commitment has no column for: how long the user
*meant* to focus, how many times they continued, what distracted them, and how
it ended.

| Field | Why it is here |
|---|---|
| `plannedMinutes` | The intention, which `extend` grows |
| `continuedCount` | The behaviour VISION §10 wants reinforced |
| `distractionNotes` | PRD §28, up to MAX_DISTRACTION_NOTES = 20. Server-side because E05-05 kept them in React state and a reload lost them — and the user types these while distracted, which is exactly when a tab gets reloaded |
| `outcome` | `DONE` / `PARTIAL` / `ABANDONED` |
| `actualMinutes` | Read back from the commitment's banked seconds at `stop`, floored at 1 |
| `evidenceId` | The `TIMER` row this session produced |

### Three rules

**`stop` writes a `TIMER` `focus_session` evidence row for every outcome**, with
`quantitative_value` = the minutes focused and `qualitative_value` = the outcome.
That row is distinct from the `APP_FLOW started` row E05 wrote at the beginning:
PRD §104's "start is recorded separately from completion" is these two rows.

**`abandoned` PAUSES rather than closing.** The commitment stays open so the
next-best-action engine's "STARTED is the NBA" pre-rule keeps offering it, and
the evidence is still written. It also skips the `pause` call entirely when the
timer is already paused, because `pause` is not an available action then and a
409 would strand a session the user is trying to close.

**`start` compensates rather than nesting.** `CommitmentActionsService.start`
opens its own `$transaction`, which cannot nest inside another interactive one,
so the session row is written first and **deleted** if the action then throws.
The failure this protects against is real — `start` raises 409
`INVALID_TRANSITION` from the matrix, and a session pointing at a commitment
that never started would show up on `GET /focus-sessions/active` forever.

`GET /focus-sessions` returns at most 100 rows, newest first, over a window of
at most MAX_LIST_DAYS = 93 days — the same cap E02-04's evidence query uses.

### One active session per user

Enforced **in the service, deliberately not by a partial unique index**. A
crashed client must always be able to recover through
`GET /focus-sessions/active` and take the old one over; a database constraint
would turn that recovery into a 500. A second start answers 409
`FOCUS_SESSION_ACTIVE` with the running session's id, and `takeOver: true` ends
it as `ABANDONED` first — explicit rather than implicit, because a client that
silently took over would end somebody's running session because a stale tab woke
up.

---

## 3. Avoidance detection and the intervention ladder

`apps/api/src/work/avoidance/`. PRD §25–§26.

### The rule, verbatim

Copied from `avoidance-detector.ts`'s file header. **If you change one, change
both.**

1. A signal is ACTIVE when it crosses its threshold:

   | Signal | Threshold |
   |---|---|
   | `RESCHEDULED_TWICE` | `rescheduleCount >= 2` |
   | `UNCHANGED_3_DAYS` | `daysUnchanged >= 3` |
   | `SHORT_SKIPS` | `shortSkipCount >= 2` |
   | `EXPLICIT_LATER` | `explicitLaterCount >= 2`, **or** `>= 1` when any other signal is active |
   | `DISPLACED_BY_LOWER_IMPORTANCE` | `count >= 2` |
   | `SAME_WINDOW_FAILURES` | `count >= 3` |

   No active signal → level 0, and stop.

2. `base` is the highest rung among the signals active by their OWN threshold:

   | Signal | Rung |
   |---|---|
   | `UNCHANGED_3_DAYS` | 1 |
   | `SHORT_SKIPS` | 2 |
   | `RESCHEDULED_TWICE` | 3 |
   | `EXPLICIT_LATER` | 3 |
   | `DISPLACED_BY_LOWER_IMPORTANCE` | 4 |
   | `SAME_WINDOW_FAILURES` | 5 |

3. `extra` is the occurrences beyond each active signal's threshold, summed and
   clamped at zero. An `EXPLICIT_LATER` active only by the "at least one,
   alongside another signal" clause contributes `explicitLaterCount` itself and
   does **not** raise `base` — one "later" is corroboration, not a rung. The
   level rises ONE STEP PER ADDITIONAL OCCURRENCE: `level = base + extra`.

4. Caps:
   - `level <= 4` unless `weeksOfEvidence >= 3` (WEEKS_FOR_PLAN_CHALLENGE = 3).
     Levels 5 and 6 challenge the PLAN and the GOAL, and PRD §26 L6 says "for
     three weeks" — you cannot tell somebody their plan is wrong on the evidence
     of four days.
   - Level 5 additionally requires `SAME_WINDOW_FAILURES` active (PRD §26 L5 is
     "keeps failing at 4 PM"); otherwise clamp to 4.
   - Final `level = min(level, 6)`.

**A single reschedule, a single skip and a single "later" each leave the user at
level 0.** PRD §25 says avoidance must not be inferred from one miss, and
everything else the ladder does is only defensible if that holds. It is the
first thing `avoidance-detector.spec.ts` asserts.

### The rungs and what they offer

| Level | `interventionType` | `suggestedAction` | The row shows |
|---|---|---|---|
| 0 | `NORMAL_REMINDER` | `NONE` | nothing extra |
| 1 | `ACTIVATION_REDUCTION` | `MINIMUM` | "Do the minimum (N min)" |
| 2 | `DECOMPOSITION` | `DECOMPOSE` | "Break it down" |
| 3 | `FRICTION_DIAGNOSIS` | `FRICTION_QUESTION` | VISION §9's question, with "Answer" |
| 4 | `ENVIRONMENT_CHANGE` | `ENVIRONMENT` | "Put email and Slack aside for 15 minutes before you start" |
| 5 | `PLAN_CHALLENGE` | `PLAN_REVIEW` | "This keeps slipping — review it with the coach" |
| 6 | `GOAL_CHALLENGE` | `PLAN_REVIEW` | the same link |

All seven names are members of E06-03's `INTERVENTION_TYPES`.

**Having answered once, level 3 offers `DECOMPOSE` instead** for seven days
(ASKED_RECENTLY_DAYS = 7). The question is a diagnosis, not a nag: having
heard the answer, the product owes the user an action.

**The client branches on `suggestedAction`, never on the level.** The level is
the server's reasoning and the action is its conclusion; a row deciding "level 3
means ask the question" would be a second copy of the rule that produced it.

### The signals

`avoidance-signals.service.ts`. **Every date lives here** — the detector is pure
and takes counts, which is what makes one test per rung trivial and keeps every
timezone question in one file.

| Signal | Definition | Window |
|---|---|---|
| `rescheduleCount` | the column, which travels with the intention | — |
| `daysUnchanged` | whole local days open in `PLANNED`/`READY`/`RESCHEDULED` with **no evidence at all**; zero the moment any exists | — |
| `shortSkipCount` | `SKIPPED` or `MISSED` commitments of the same outcome | SKIP_WINDOW_DAYS = 14 |
| `explicitLaterCount` | same-outcome skips with `skipReason: 'AVOIDED'` or a note matching `/\b(later|tomorrow|not now)\b/i` | 14 |
| `displacedByLowerImportanceCount` | days this was due and untouched while a **lower-importance** WORK commitment was completed | 14 |
| `sameWindowFailureCount` | same-outcome failures in the same `timeWindowOf` bucket | WINDOW_FAILURE_DAYS = 21 |
| `weeksOfEvidence` | whole weeks since the **outcome** was created | — |

`daysUnchanged` collapsing to zero once evidence exists is load-bearing: a
commitment somebody started on Monday and has not finished is *in progress*, and
telling them it has been ignored for four days would be false.

**`collectMany` issues a constant four queries** whether it is asked about one
commitment or ten. `GET /today` calls it on every app open for every WORK card;
a per-commitment loop would be a query storm on the product's most-hit endpoint
and would look fine in a test with one row.

### There is no stored `avoidanceLevel` column

Rejected deliberately. The signals move every day — "untouched for three days"
becomes four overnight without anybody touching a row — so a persisted level
would contradict `GET /today` within hours of being written, and the
contradiction would be invisible.

### How it reaches Today

`GET /today` carries `avoidance` on every **WORK** card and `null` on every
other domain. That null is a statement, not a gap: the ladder reasons about
avoiding work, and a family dinner that moved twice is a week.

`resolveInterventionMode` reads the level rather than a raw reschedule count:
`CHALLENGE_PLAN` at `>= 5`, `DIAGNOSE` at `>= 3`, `REDUCE` at `>= 1`. A non-WORK
candidate carries `avoidanceLevel: null` and keeps E05's original rules
unchanged. See [`today-and-nba.md`](./today-and-nba.md) §6.

**An assessment failure must not fail the day.** `TodayService` degrades to
`avoidance: null` with a warn log — Today is about the next hour, and a ladder
reading is a secondary annotation on it.

---

## 4. The friction question

`POST /api/commitments/:id/friction`. VISION §9.

### The eight answers

`friction-answers.ts` on the API; `components/work/frictionAnswers.ts` copies the
keys and labels for the dialog, and a Vitest asserts the two agree.

| `FrictionAnswer` | Label | `interventionType` | `Obstacle.type` |
|---|---|---|---|
| `DONT_KNOW_WHERE_TO_BEGIN` | I don't know where to begin | `ACTIVATION_REDUCTION` | `AMBIGUOUS_WORK_TASK` |
| `TOO_BIG` | It feels too big | `DECOMPOSITION` | `TASK_TOO_LARGE` |
| `TIRED` | I'm tired | `REDUCE_SCOPE` | `LOW_ENERGY_WINDOW` |
| `DONT_WANT_TO` | I don't want to do it | `RECONNECT_REASON` | `LOW_MOTIVATION` |
| `SOMETHING_URGENT` | Something more urgent came up | `PROTECTED_RESCHEDULE` | `URGENCY_DISPLACEMENT` |
| `WORRIED_ABOUT_QUALITY` | I'm worried I won't do it well | `PERFECTIONISM_REFRAME` | `PERFECTIONISM` |
| `NEED_MORE_INFO` | I need more information | `CLARIFY` | `AMBIGUOUS_WORK_TASK` |
| `OTHER` | Other (`text` required) | `FRICTION_DIAGNOSIS` | `OTHER` |

`PERFECTIONISM_REFRAME` and `PROTECTED_RESCHEDULE` were **appended** to E06-03's
`INTERVENTION_TYPES`; `TASK_TOO_LARGE`, `LOW_MOTIVATION` and
`URGENCY_DISPLACEMENT` were appended to `ObstacleType`. Both enums only ever
grow: the values are persisted on every coach message and every obstacle row.

### What the answer writes

One transaction:

- a `Reflection` with `frictionTags: [answer]` — the **answer key**, not a
  `SkipReason`. `avoidance-signals.service.ts` tells the two apart by that list,
  which is how "asked once" works;
- the user's `Obstacle` for `(WORK, type)`, created at `observedCount: 1` /
  `confidence: 1/3` or incremented, with `confidence = min(1, count/3)` and an
  `interventionHistory` entry (MAX_INTERVENTION_HISTORY = 50).

Then, outside it: `work:friction_answered` in `audit_events` with
`{ answer, level, interventionType, source }`. **Never the text** — that is the
user telling their coach why something is hard.

### The coach writes the sentence; it does not make the decision

The coach is called as the `coach` persona at prompt version
`work-friction.v1` (FRICTION_PROMPT_VERSION).
`requiredInterventionType` is computed from the answer **before** the model is
called, and the reply is discarded — silently, in favour of the template — when
it does any of four things:

1. claims an intervention type other than the one the answer routes to;
2. recommends more than MAX_RECOMMENDED_MINUTES = 15 minutes (VISION §10: the point is
   a first move somebody avoiding this can actually make);
3. names another commitment's id;
4. returns a plan proposal or a friction question of its own.

Each of those would be the model quietly overruling a deterministic decision,
and the user cannot tell a confident wrong sentence from a right one. The
override is logged as `Friction ai_override reason=<…>`.

`intervention.source` says which was used, and **`template` is a complete
answer, not a degraded one** — the dialog captions it "Standard suggestion — the
coach is unavailable" rather than hiding it, because a user who thought a coach
wrote that sentence would read more into it than is there.

### Safety runs before the model

Free `text` goes through `SafetyPolicyService.evaluate({ surface: 'coach' })`
first. A `redirect` returns the professional-care copy and **writes nothing** —
no reflection, no obstacle, no gateway call. At that moment the product has one
job and it is not coaching somebody through a deadline.

### The protected reschedule

`POST /commitments/:id/actions/reschedule` takes `protected?: boolean`. When the
user has answered `SOMETHING_URGENT` on that commitment within
PROTECTED_RESCHEDULE_WINDOW_MS (24 hours), the move happens normally — new
row, evidence, `RESCHEDULED` on the old one — but **`rescheduleCount` does not
grow**. Having a job is not avoidance, and counting it as such would push an
honest user up the ladder.

Sent without that reflection it is a 400 `PROTECTED_RESCHEDULE_NOT_ALLOWED`: a
flag a client could set freely would be a way to make every move invisible to
the detector. The window is a day because the answer is about *today's*
collision; a reason from last week would quietly make every move that followed
it free.

`suggestedReschedule` is computed **deterministically** — tomorrow, in the same
`timeWindowOf` bucket, in the first free quarter-hour — and never proposed by
the model, which could collide with the very meeting that displaced the work.

---

## 5. Time windows

`work/avoidance/time-window.ts`. One definition, two readers: the ladder's
`SAME_WINDOW_FAILURES` signal and the weekly summary's per-window rates.

Boundaries are **not restated** there — `greetingFor` (E05-01) owns them:
05:00–11:59 morning, 12:00–17:59 afternoon, else evening. PRD §29 asks the
review to say "4 of 5 before 9 AM and only 1 of 4 after 4 PM", and that sentence
is only true if the buckets it counts are the ones the ladder reasoned about.

---

## 6. The weekly summary

`GET /api/work/summary?weekStart=`. PRD §29. `apps/api/src/work/summary/`.

Deterministic and **AI-free**: E10's weekly reviewer reads these counts, so a
provider outage changes the words and never the numbers.
`aggregateWorkWeek` is pure and free of Prisma types — narrow row interfaces are
declared beside it, so a fixture is small enough to read and the aggregator
cannot start depending on a column nobody passed it.

### Definitions

- **Due** — `scheduledStart` inside `[Monday 00:00, next Monday 00:00)` in the
  user's own zone. Both edges come from `localDayBounds`, so a week containing a
  DST change is 167 or 169 hours long.
- **Started** — `startedAt` set, **or** an `APP_FLOW started` or any `TIMER`
  evidence row. Starting is counted separately from completing (PRD §104).
- **`focusSessions.planned`** — due WORK commitments with
  `commitmentType === 'FOCUS_SESSION'`.
- **`done` / `partial` / `abandoned`** — decided by the commitment's **latest**
  session: somebody who abandoned at lunchtime and finished in the evening
  finished. Every session's minutes still count towards `actualMinutes`.
- **`repeatedlyPostponed`** — REPEATEDLY_POSTPONED_RESCHEDULES = 2 or more
  moves, due in the week **or** moved out of it. The most postponed commitment
  of a week is very often the one that got pushed past its end, and would vanish
  from a report that only looked inside the bounds. The service loads
  commitments over a ±LOOKAROUND_DAYS = 7 day window for exactly this.
- **`bestWindow` / `worstWindow`** — ignore any window with fewer than
  MIN_PLANNED_FOR_WINDOW_VERDICT = 2 planned; below that a rate is noise. A tie
  resolves to the earlier part of the day.

### Rates are `null`, not `0`

"Nothing was planned" and "nothing got done" are different weeks and E10's
reviewer has to tell them apart. A 0 for both produces "you completed 0% of your
morning sessions" for a week with no morning sessions in it — a sentence about
nothing that reads like a failure.

A failed ladder reading degrades to `level: 0` rather than taking down a report
whose every count is already correct, and only the postponed rows are assessed
at all: assessing every commitment of a fortnight would be four more queries for
numbers nothing in the response reports.

---

## 7. The screens

### The outcome detail, Work variant

`components/work/WorkOutcomeDetail.tsx`, rendered for `domain === 'WORK'` below
the plan summary in E02-06's existing grid. **No new route and no new
breakpoint** — the stacking is that grid's, and the dialogs' `fullScreen` below
`sm` is a local layout choice inside each one, not one of CLAUDE.md's five
coupled gates.

Milestone progress is **completed sessions**, never a self-assessment: a
milestone is done when the work under it is done, and asking the user to rate it
would be one more thing to keep up to date.

`PlanSessionsDialog` is propose → review → apply, and **the review step is the
product**. The plan arrives editable and nothing is written until Apply. An
edited session goes back to the server and is re-validated against the same
guardrails the model was held to, so a plan the user broke comes back with
readable reasons rather than being silently corrected.

### The Start flow

`/start/:commitmentId` branches **inside** `useStartSession` / `StartFlowPage` on
`commitment.domain`; it is not forked. Family and Health keep every call E05
made and the timer derivation stays the one shared copy in
`utils/commitmentTimer.ts`. The WORK branch is documented in
[`today-and-nba.md`](./today-and-nba.md) §6.

`useFocusSession` re-anchors from the response's `serverNow` on mount and on
every `visibilitychange` and `focus` — a phone that slept through half a session
comes back with a clock that is right and an interval that is not.

### The friction dialog

`components/work/FrictionDialog.tsx` asks, and then **becomes the answer in
place** rather than closing and opening something else. The user is being asked
because they are stuck, and a second modal is one more thing between them and a
ten-minute start.

Every branch of `InterventionCard` ends in something they can press that starts
a timer within ten minutes. A message with no move attached is the sympathy a
user closes the app over.

---

## 8. Decisions, and what was rejected

**`WorkMilestone`, not `Milestone`.** E11 (#115) already owns `Milestone` /
`milestones` for the things worth celebrating once — the fourth four-week
stretch, the tenth workout. A work milestone is a deliverable inside one outcome,
reached and then superseded; the two share nothing but a noun. The API still
calls the field `milestoneId` on the wire, because in the Work context there is
only one kind.

**No stored `avoidanceLevel` column.** Rejected: the signals change daily and a
stale column would contradict `GET /today` within hours, invisibly (§3).

**No partial unique index for "one active focus session".** Rejected so a
crashed client can always recover through `GET /focus-sessions/active` (§2).

**No new `PlanVersion` per applied session plan.** Sessions are commitments
under the outcome's *current* active version, not a change of strategy. A
version per apply would make E06-07's diff view show a "strategy change" every
time somebody scheduled five mornings, and E06-04's proposal protocol owns
version creation.

**Session plans do not ride on `plan_change_proposals`.** Its `changes` column
is typed `PlanChange[]`, and a session plan cannot fit through it without
breaking the coach's diff view. Hence a table of its own.

**No `PlanChangeProposal` for the protected reschedule.** E06-04's `PlanChange`
ops target a routine's `preferredTime` / `triggerValue`, not a single
commitment's date. A guarded flag on E05-02's `reschedule` is smaller and keeps
`rescheduleCount` honest.

**`TOO_BIG` → `DECOMPOSITION`, `DONT_KNOW_WHERE_TO_BEGIN` →
`ACTIVATION_REDUCTION`.** The epic's plan text had these the other way round.
VISION §9's own worked example settles it: "build the strategy presentation"
felt *too big* and was answered by breaking it into a twelve-minute storyline
slice. Not knowing where to begin is an activation problem, answered by making
the first move trivially small.

**No Pomodoro cycles, no break scheduling, no sound.** PRD §28 is explicit that
this is "not a full Pomodoro application".

**No calendar integration** for protecting time (PRD §69). A session is a
commitment with a `scheduledStart`.

**No enterprise task import.** VISION §8 rejects it outright.

---

## 9. Testing notes

`tests/e2e/specs/work.spec.ts` runs against `base + dev + fake-openai` compose
with a migrated, seeded database. See
[`docs/TESTING.md`](../TESTING.md#e2e-testing-with-playwright).

The fake server's two E07 fixtures live in
`tools/fake-openai/scenarios/index.mjs`:

- **`work_session_plan`** — five weekday sessions at **noon UTC**, three
  milestones. Dates are computed at request time from the `today` the planner
  was given; a canned set of timestamps would pass on the day it was written and
  turn into a 503 the following week, a failure that reads like a broken planner
  rather than a stale fixture. Noon is the one hour that lands on the same
  calendar day in every zone from UTC-11 to UTC+11, which keeps the "at most two
  per local day" and "not in the past" guardrails satisfied without the fake
  server resolving a wall-clock time in an arbitrary timezone.
- **`coach_reply` for a friction turn** — selected by the
  `requiredInterventionType` the service puts in the input, echoed back with a
  ten-minute action naming the commitment it was given.

**The misbehaviour lever is a sentinel in the user's own text**
(`force-wrong-intervention`), not a header. `tools/fake-openai/scenarios` says
why in its own header: the API calls that server, the browser does not, so a
Playwright spec has no way to set a header on the request that matters. The only
thing a spec can influence is what the user types.
