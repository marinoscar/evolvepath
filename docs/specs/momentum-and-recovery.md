# Momentum, Progress and Recovery

**Epic E11** · PRD §52–§57, §75–§77, §109, §136 · VISION §30–§33, §56

The written contract for everything under `apps/api/src/progress/`,
`apps/web/src/components/progress/` and the comeback screens. Read this before
changing a constant, a rule or a sentence in any of them.

---

## 0. The one promise this epic is built around

**There is no number here that scores the person.** PRD P13 and §54 are
explicit — "Avoid: Health Score: 77/100" — and VISION §30 explains why: momentum
evaluates *behaviour*, tolerates normal life, and "one missed day should not
erase weeks of effort".

That promise is kept structurally rather than by discipline, at four layers:

1. **The engine's ratios never leave the server.** `computeMomentum` compares
   ratios to detect a trend; `progress.schema.ts` serialises counts only. A
   ratio on the wire is one pull request away from a percentage badge.
2. **Every sentence lives in one pure module.** `momentum-evidence.ts` on the
   API, `apps/web/src/utils/momentumCopy.ts` on the web — so a test can run the
   whole module over every state and assert nothing it produces matches
   `/\d+\s*%|\/\s*100|score/i`.
3. **The rendered page is swept.** `ProgressPage.test.tsx` and
   `progress.spec.ts` read `body.innerText` on `/progress`,
   `/progress/timeline` and `/` and apply the same three regexes.
4. **PRD §75's "percent completed without reminder" is rendered as a
   fraction** — "7 of 10 completed without a reminder". A percentage is the
   shape a score wears.

The only `ratio` in any payload is `independence.ratio`, which measures the
**product** — how often the user acts unprompted — not the person.

---

## 1. The momentum engine

`apps/api/src/progress/momentum/momentum-engine.ts`. **Pure**: no Nest, no
Prisma, no `Date.now()`. `now` arrives on the input. PRD §53 asks for a formula
that is "deterministic and testable", and the only way to be sure of that is for
the function to have no way of reading anything the caller did not hand it.

### Constants

| Constant | Value | What it means |
|---|---|---|
| `WINDOW_DAYS` | 28 | The whole window momentum is read from |
| `HALF_WINDOW_DAYS` | 14 | Where the trend comparison splits it |
| `MIN_PLANNED` | 3 | Below this there is nothing honest to say |
| `BUILDING_MAX_HISTORY_DAYS` | 14 | A user younger than this is still building |
| `BUILDING_MIN_RATIO` | 0.5 | …and keeping at least half of it |
| `TREND_DELTA` | 0.15 | How far the halves must diverge to be a trend |
| `SLIP_CONSECUTIVE_MISSES` | 3 | A run of not-started that is worth naming |
| `RECOVERY_IDLE_DAYS` | 3 | A gap shorter than this is a week, not an absence |
| `RECOVERY_LOOKBACK_DAYS` | 7 | How recent a return has to be to still be one |
| `MAX_EVIDENCE_BULLETS` | 3 | So the card stays readable on a phone |

### What counts

A commitment is **decided** when it is `COMPLETED`, `PARTIALLY_COMPLETED`,
`MISSED`, `SKIPPED`, or still `PLANNED`/`READY` with its `scheduledStart`
already past. That last clause is the important one: the numbers are then
identical before and after the E11-02 sweep closes a stale row, so the two
halves of the epic can never disagree about the same week.

`CANCELLED` (removed by a plan change, E06-04) and `RESCHEDULED` (closed by a
reschedule whose successor row carries the intention, E02-04) are excluded
**entirely**. Neither a plan edit nor a postponement is a failure, and counting
the closed row as well as its successor would report two workouts where the user
intended one.

A **success** is `COMPLETED` or `PARTIALLY_COMPLETED`. A completion at the SHORT
or MINIMUM size is a completion (PRD §44, P7) — labelled in a bullet, never
diminished in the count.

**The window has no upper bound.** `isDecided` already excludes a still-open row
whose time has not come, so filtering on `scheduledStart < now` in the loader as
well would drop something *completed early* — which is exactly what the comeback
restart is (scheduled an hour out, done immediately), and what any user who
finishes this evening's run at lunchtime produces. A completion the engine
cannot see is a completion the user did and the product denies.

### The signals

`planned` (decided rows), `completed`, `partial`, `fallback` (successes done at
SHORT or MINIMUM), `missed`, `skipped`, `openPastDue`, `rescheduledTwice`
(`rescheduleCount ≥ 2`), `ratio`, `recentRatio` / `priorRatio` (the same ratio
over `[now − 14d, now)` and `[now − 28d, now − 14d)`, `null` when that half has
fewer than `MIN_PLANNED` decided rows), `consecutiveMisses` (the trailing run of
not-done when decided rows are ordered by `scheduledStart` ascending),
`historyDays`, `lastCompletionAt`, `lastMissAt`, `returnedAfterIdleDays`.

**`returnedAfterIdleDays`** is the one with two conditions, and the second is
what matters: for the latest success within `RECOVERY_LOOKBACK_DAYS`, the whole
days since the previous success (or `firstActivityAt`), counted only when that
gap is at least `RECOVERY_IDLE_DAYS` **and contains at least one miss**. A person
who trains Monday and Friday has a three-day gap every week and is not
recovering from anything; calling that RECOVERING would tell them they lapsed
every time they rested.

### The state, by the FIRST matching rule

The order is the contract, not an implementation detail.

| # | State | Rule |
|---|---|---|
| 1 | `INSUFFICIENT_DATA` | `planned < MIN_PLANNED` |
| 2 | `RECOVERING` | `returnedAfterIdleDays !== null` |
| 3 | `SLIPPING` | `consecutiveMisses ≥ SLIP_CONSECUTIVE_MISSES`, **or** both half ratios non-null and `priorRatio − recentRatio ≥ TREND_DELTA` |
| 4 | `BUILDING` | `historyDays < BUILDING_MAX_HISTORY_DAYS` and `ratio ≥ BUILDING_MIN_RATIO` |
| 5 | `IMPROVING` | both half ratios non-null and `recentRatio − priorRatio ≥ TREND_DELTA` |
| 6 | `STEADY` | otherwise |

**`RECOVERING` outranks `SLIPPING` on purpose.** A person who came back after
three misses deserves to read that they came back, not that they lapsed
(VISION §31). Two fixtures in `momentum-engine.spec.ts` pin the overlap, and a
third pins `RECOVERING` over `BUILDING`.

### Evidence bullets

`momentum-evidence.ts`, at most three, in this priority. Counts and sentences
only — no template contains a `%` or a division.

1. `"{successes} of {planned} planned {noun} completed"`
2. `"Returned {n} day(s) after a miss"` — when `returnedAfterIdleDays !== null`
3. `"{consecutiveMisses} in a row not started"` — at 2 or more
4. `"{fallback} completed with the short or minimum version"`
5. `"{rescheduledTwice} moved more than once"`
6. `"Last two weeks: {a} of {b}, before that {c} of {d}"` — only when both
   halves exist and the state is IMPROVING or SLIPPING
7. `INSUFFICIENT_DATA` returns **exactly one** bullet and returns early:
   `"Not enough planned {noun} yet — momentum appears after {MIN_PLANNED}"`

The **noun** is the specific one only when EVERY decided row agrees: HEALTH →
`workouts` when all are `commitmentType: 'workout'`, else `health commitments`;
WORK → `focus sessions` when all are `focus_session`, else `work actions`;
FAMILY → `family commitments`. A window holding one workout and two other health
commitments is "3 planned health commitments", because "3 planned workouts"
would be a false statement about what the user intended.

---

## 2. The consistency run

`consistency-run.ts`. **Counted in weeks, not days** (PRD §55). VISION §31 says
why: a daily streak erases weeks of effort over one bad Tuesday, and the product
that shows one teaches people that the honest thing to do after a bad Tuesday is
to stop looking.

| Constant | Value |
|---|---|
| `WEEK_SUCCESS_RATIO` | 0.6 |
| `GRACE_EVERY_N_WEEKS` | 4 |
| `RUN_LOOKBACK_WEEKS` | 26 |
| `WEEKLY_CHART_WEEKS` | 12 |

- Weeks are **Monday-start in the user's own timezone** — the convention E08
  fixed for the family summary and E10 reuses for the weekly review. A second
  week convention would make "this week" answer two questions on two screens.
- A week is **successful** when `planned ≥ 1` and
  `completed / planned ≥ WEEK_SUCCESS_RATIO`.
- A week with `planned = 0` is **neutral**: it neither extends nor breaks the
  run and is not counted. A week in which the user promised nothing is not a
  week they broke a promise.
- Walking completed weeks newest-first, each successful week adds 1. A
  non-successful week is **graced** — the run continues and `graceUsed` rises —
  when at least `GRACE_EVERY_N_WEEKS` counted weeks have passed since the last
  grace; otherwise it ends the run.
- The current, incomplete week is reported with `current: true` and **never
  counted**.
- `weekly` is the last 12 weeks, ascending.

The grace is **stated out loud** on the screen ("1 grace week used"). A week the
product quietly forgave is a week the user cannot reconcile against their own
memory, which makes the whole number feel invented.

## 3. Recovery latency

`recovery-latency.ts`, `RECOVERY_LOOKBACK_DAYS = 90`. For each `MISSED` row, the
days to the next success **in any domain**; the **median** over those samples,
rounded to one decimal; `null` with `samples: 0` when there are no misses or no
return yet.

A median rather than a mean, because one three-week holiday would otherwise
define a user who normally returns the next day. Cross-domain, because returning
at all is the behaviour being measured. A miss with no return yet is **excluded**
rather than counted as a very large number — that would be a guess about a
future that has not happened.

## 4. Coach dependency (the independence reader)

`independence/independence-reader.ts` declares the seam and
`NullIndependenceReader` fills it with `{ ratio: null, completedWithoutReminder:
0, sampleSize: 0 }`.

**E12-06 (#69) rebinds the `INDEPENDENCE_READER` token and nothing else in this
module changes.** The alternative — omitting the field until E12 — would mean
the Progress screen grows a new section later and every client learns about it
twice. A `null` ratio is a complete answer: the UI says "Available once
notifications learn your rhythm", which is a sentence about the product rather
than a zero about the person.

---

## 5. The comeback loop

`apps/api/src/progress/comeback/`. PRD §136's loop: Miss → Slip → No shame →
Reduce scope → Restart → Record recovery. VISION §33: **no catch-up debt**.

### State machine

`NONE → OFFERED → IN_PROGRESS → NONE`, held on `user_profiles` rather than in a
new table. There is at most **one** open offer per user by design — PRD §56 asks
for one restart action — and a table would make two representable. The history
of comebacks lives where history belongs: `evidence_items` rows of type
`recovery`, and `milestones`.

### Triggers (`comeback-detector.ts`, pure)

| Constant | Value |
|---|---|
| `INACTIVITY_DAYS` | 3 |
| `MISSES_WINDOW_DAYS` | 7 |
| `MISSES_THRESHOLD` | 4 |
| `PLAN_DRIFT_MISSES_14D` | 4 |
| `PLAN_DRIFT_CLOSED` | 5 |

`INACTIVITY` when the user has history and `lastActiveAt` is null or at least
`INACTIVITY_DAYS` old; otherwise `REPEATED_MISSES` at `MISSES_THRESHOLD` misses
in `MISSES_WINDOW_DAYS`; otherwise none.

Two rules that look like details and are not:

- **A user with no history is never offered a comeback.** There is nothing to
  come back to, and "welcome back" to somebody who has not started yet is the
  product telling them a story about themselves that is not true.
- **An open offer suppresses everything.** Offers never stack; a second sweep
  finding the same silence must not turn one kind sentence into two.

### What counts as activity

A commitment acted on, evidence logged, a check-in, a day reflection, a coaching
turn. **Opening the app is not activity** (PRD §57 counts behaviour): a person
who opens the app every morning and does nothing has not been active in any
sense worth protecting them from a kind sentence over.

`ActivityTrackerService.record()` is detached and swallows its own failures, and
writes at most once per `ACTIVITY_WRITE_INTERVAL_MS` (5 minutes) per user. It
lives in its own two-import `ActivityModule`: `ProgressModule` imports
`CommitmentsModule`, so putting the tracker in `ProgressModule` would close a
cycle, and Nest circular imports fail at **boot** rather than at compile time.
Inside `CommitmentActionsService` the stamp rides on the private `audit()`
helper — the one place every mutating action lands exactly once, post-commit.

### The sweep

`ComebackService.sweepUser`, run daily at **04:00** (after the 03:00 token
cleanup) and on demand through the non-production job route.

1. Resolve the profile and the user's timezone; `startOfToday =
   localDayBounds(localDate(now, tz), tz).start`. Never `setHours(0,0,0,0)` on
   a UTC `Date`.
2. Close every `PLANNED`/`READY` commitment with `scheduledStart < startOfToday`
   to `MISSED`, checking `canTransition` on each row first.
3. Count misses over 7 and 14 days; establish whether the user has any history.
4. Run the detector. No trigger → stamp `lastSweepAt` and stop.
5. Pick the restart, ask the coach for wording, create the commitment, move the
   profile to `OFFERED`, and set `planReviewSuggestedAt` when
   `suggestsPlanReview`.

**THE SWEEP CHANGES STATUS AND NOTHING ELSE.** `evidence_items` is never
written, updated or deleted here. PRD §109 requires prior misses to remain
evidence, and "close as historical" is a status change — not an edit to a
history. `comeback.spec.ts` counts evidence through the public API before and
after the sweep; that is the assertion that would catch a sweep that tidied.

**A `STARTED` row is never closed.** The transition matrix has no
`STARTED → MISSED` and should not: something you began and did not finish is
`PARTIALLY_COMPLETED` or `SKIPPED`, and only the user knows which.

### The restart picker (`restart-picker.ts`, pure)

`RESTART_MIN_MINUTES = 10`, `RESTART_MAX_MINUTES = 15`,
`DOMAIN_PREFERENCE = ['HEALTH', 'WORK', 'FAMILY']`.

In order:

1. Domains in `PAUSE` are excluded outright. The user put them down
   deliberately, and offering them back is the product overruling them.
2. Highest outcome importance.
3. Tie → the domain with the most recent completion. VISION §32 rebuilds what
   was already working; a return is not the moment to introduce a new habit.
4. Tie → the fixed domain preference (VISION §56: "a ten-minute health action or
   small Work start").

The title is the routine's own `fallbackBehavior` where it has one, else its
title. Minutes are clamped to 10–15: small enough to be winnable on the first
day. A user with **no** active routine still gets an offer — a ten-minute walk,
which needs no plan behind it.

The restart commitment is `commitmentType: 'restart'`, scheduled at the
routine's preferred time when that is still ahead, otherwise an hour from now,
and never past **21:00 local** — an offer a user cannot act on before bed is a
reminder that they did not.

### The AI's part, and its limit

`RestartWordingService`, persona `coach`, prompt version
`comeback-restart.v1`. **The model names the thing; it never chooses it.** The
domain, the routine and the minutes are already decided when it is called, so a
provider outage changes the wording and nothing else (PRD §120).

The banned-word gate applies to the **output**, not only to the prompt:

```
/\b(overdue|behind|failed|failing|streak|lazy|guilt|guilty)\b/i
```

plus `UNNEGATED_CATCH_UP` — "catching up" is banned as a *proposal* and required
as a *denial*, because VISION §33's own sentence is "No catching up". Asking a
model not to shame somebody is a request; checking is a guarantee, and this is
the one screen where the wrong word does the specific damage the feature exists
to prevent. The same list guards the web copy
(`apps/web/src/utils/comebackCopy.ts`): the screens and the notifications are
one voice.

Deterministic copy, which ships on every provider outage:

- offer note — *"No catching up. We start from today."*
- celebration — *"Back on Path."*
- celebration body — *"The important part was not that you missed. It was that you returned."*
- banner — *"Welcome back. No catching up."*

### `planReviewSuggested`

Raised at four or more misses in fourteen days, or five or more rows closed by
one sweep. It is a **flag and a link**, never a plan change: PRD §15 means
nothing in this module writes a `PlanVersion`. The done screen offers "Review my
plan", which opens the coach with the "I fell off" prompt.

### Completing

`POST /comeback/complete` finishes the restart through
`CommitmentActionsService`, so it earns the same `completed` evidence and audit
row any other completion does — a comeback is a real thing the user did, not a
special case in the history. One `recovery` row (`source: APP_FLOW`) is then
written on top of it.

**Idempotent by refusal**: a second call is a 409 `NO_COMEBACK_OFFER`, never a
second recovery row. `ComebackDonePage` treats that as "already done" and
renders the celebration from `sessionStorage`; a page that showed an error there
would tell somebody their recovery did not count.

---

## 6. The evidence timeline

`timeline/timeline-builder.ts`, pure. PRD §76 asks for **meaningful** events,
and the word does work: the evidence table also records `started`, `paused`,
`continued`, `fallback_selected` and `rescheduled`. A timeline showing them
would be a log rather than a story — "paused at 14:32, continued at 14:41" is
true and tells the user nothing they want to know about themselves.

**So the mapping is a whitelist, not a rename. A row with no rule below produces
no event.**

| Source row | `kind` | `significance` | Title |
|---|---|---|---|
| `completed` evidence | `completed` | ordinary | "Completed {title}" |
| …with `versionUsed` SHORT/MINIMUM | `completed_fallback` | ordinary | "Completed {title} — minimum version" |
| …in FAMILY | `family_kept` | notable | "Protected {title}" |
| `partially_completed` | `partially_completed` | ordinary | "Made progress on {title}" |
| `started`, `rescheduleCount ≥ 2` | `started_after_postpone` | notable | "Started {title} after {n} postponements" |
| a success ending a run of misses in its domain | `returned_after_miss` | notable | "Returned to {Domain} plan after {k} missed" |
| `plan:change_accepted` audit row | `plan_change_accepted` | notable | "Plan updated to v{n}", detail = the version's rationale |
| `recovery` evidence | `comeback_completed` | notable | "Back on Path" |
| a `milestones` row | `milestone` | milestone | the milestone's own copy |

A FAMILY completion is **protected**, never "completed": VISION §12 is clear the
family domain is not a scoreboard.

The plan-change rationale is **joined from `plan_versions`**, not copied into
the audit meta — PRD §80's reason belongs to the plan, and a second copy is the
one that goes stale after an edit.

`significance` is a property of the **payload**, so "significant" has one
definition instead of one per screen (PRD §77's "avoid constant confetti"): a
client shows a `milestone` once as a toast, highlights a `notable`, renders an
`ordinary` plainly.

Ordering is newest-first with ties broken by id — a stable total order, which is
what lets the `base64url` `at|id` cursor promise no duplicates and no gaps. A
range over `TIMELINE_MAX_RANGE_DAYS = 186` is a **400**, not a truncation: a
client asking for two years is asking the wrong question, and quietly answering
six months of it would look like the user's history had a hole in it.

## 7. Milestones

`milestones/milestone-detector.ts`, pure. `WEEKS_PER_MILESTONE = 4`,
`WORKOUTS_PER_MILESTONE = 10`, `REDUCED_REMINDERS_RATIO = 0.7`,
`REDUCED_REMINDERS_MIN_SAMPLE = 10`.

| Kind | Repeats | Awarded when |
|---|---|---|
| `FIRST_FULL_WEEK` | no | any week has ever succeeded |
| `FOUR_WEEKS` | yes, `sequence n` | the consistency run reaches `4n` weeks |
| `TEN_WORKOUTS` | yes, `sequence n` | `10n` HEALTH workout completions |
| `FIRST_COMEBACK` | no | the first `recovery` evidence row |
| `FIRST_START_AFTER_POSTPONE` | no | a start on something moved twice or more |
| `REDUCED_REMINDERS` | no | independence ≥ 0.7 over ≥ 10 samples |

**`sequence`, not a boolean.** The fourth four-week stretch is a genuinely
different fact from the first; "ten workouts" said twice is the confetti PRD §77
rules out. The detector awards *every* unearned step, so a user whose first
sweep runs at nine weeks gets both the fourth and the eighth rather than only
the latest.

**The unique `(user_id, kind, sequence)` index IS the idempotency.** The
detector runs after every start, every completion, every comeback and once a
day — four times more often than strictly needed, and deliberately: PRD §55's
"first successful comeback" has to be true the moment the user finishes, not
tomorrow morning. `createMany({ skipDuplicates: true })` turns a re-award into a
no-op at the database rather than in a code path somebody could forget.

**`REDUCED_REMINDERS` is dormant by construction, not by a feature flag.** No
ratio, no award — and `independence.ratio` is `null` until E12-06 supplies the
reader. The kind, its copy and its timeline rendering all ship now.

`ComebackService.complete` **awaits** the detector, unlike everywhere else it
runs, because the celebration screen shows "First comeback" in the same breath
as "Back on Path."; `ComebackDonePage` acknowledges it there so `/progress` does
not repeat it.

---

## 8. The screens

| Route | Shell | What it is |
|---|---|---|
| `/progress` | inside `Layout` | PRD §75's seven sections |
| `/progress/timeline` | inside `Layout` | the full evidence list, filterable |
| `/comeback` | **outside** `Layout` | PRD §57's three screens |
| `/comeback/done` | **outside** `Layout` | "Back on Path." |

The two comeback routes are full screen by **route placement and nothing else**,
exactly like `/start/:commitmentId` and `/workout/:sessionId`: they mount no
shell, so there is no navigation to hide and **none of the five coupled
breakpoint gates is touched**. Both are listed in `UNOWNED_ROUTES`.
`/progress/timeline` is owned by the existing `/progress` prefix and needed no
registry entry — only a `PRODUCT_DRILLDOWNS` row for its back arrow.

**Colour is never the only carrier** (PRD §122): the momentum state is a word
plus an icon plus an `aria-label`; the trend's two series are **dashed
(planned)** and **solid (completed)** with the encoding named in the legend
text; every chart ships a visually hidden `<table>` of the same numbers, and the
consistency table gives each week's result in words (Kept / Missed / Grace week
/ In progress). A chart that reads correctly in greyscale, in a printout and in
forced-colors mode is the test.

`StartFlowPage` gained exactly one generalisation for this epic: a finished
session navigates to `location.state.returnTo ?? '/'`. The comeback flow reuses
the ordinary execution screen unchanged; where it goes afterwards is the only
comeback-specific thing about it.

---

## 9. Driving the loop in a test

Two non-production helpers, both behind `TestEnvironmentGuard` in a module that
is not registered in production at all — two independent reasons they cannot
exist there.

- `POST /api/auth/test/simulate-idle { email, idleDays }`
- `POST /api/auth/test/run-job { job: 'comeback' | 'milestones', email }`

The comeback job is added to the **existing** `run-job` enum rather than a
second route, following that file's stated rule: one route, one enum, so a
harness learns one shape. It sweeps **one named user** rather than everybody, so
a case asserting on one offer cannot race the same job writing offers for every
other seeded account.

**Why `simulate-idle` shifts data rather than travelling in time.** Every rule
this loop enforces is about elapsed time — three days of silence, four misses in
a week, scheduled before the start of local today. A global clock seam would
have to reach every service the sweep touches, and a test that moved it would be
exercising a code path production never runs. Moving the user's own rows
backwards instead — `last_active_at`, every commitment timestamp and every
evidence timestamp, all by the same interval, so relative distances survive —
keeps the sweep, the detector and the momentum engine running against the real
`new Date()`, which is what the suite is meant to prove works.

One consequence worth knowing when seeding: `seedHistory` completes a past
commitment at the real `now`, so a **single** shift leaves every completion at
the same recent instant with the misses before it — a history running backwards.
`comeback.spec.ts`'s RECOVERING case therefore shifts twice: push the
completions away, seed the misses, shift again.

Verified by `tests/e2e/specs/progress.spec.ts` (6 cases) and
`tests/e2e/specs/comeback.spec.ts` (8 cases), on both the `chromium` and
`mobile-chromium` projects.

---

## 10. Rejected alternatives

**A single quality-of-life score.** PRD P13 and §54 rule it out by name. A score
compresses three incomparable domains into one number, invites optimisation of
the number rather than the behaviour, and cannot answer "why". Six states with
evidence sentences can.

**Daily streaks.** PRD §55 allows them "only when daily repetition truly serves
the behaviour" — not in V1. A daily streak makes one bad Tuesday erase weeks of
effort, which is precisely what VISION §31 forbids, and teaches people that the
honest response to a lapse is to stop looking. Weeks with grace do the same job
without the cliff.

**Serialising the momentum ratios.** They exist inside the engine because trends
are comparisons. On the wire they would be a percentage badge within one pull
request. Counts go out; comparisons stay in.

**A `comebacks` table.** There is at most one open offer per user, and a table
would make two representable — the exact state the feature exists to avoid. The
open offer is four columns on `user_profiles`; the history is
`evidence_items` and `milestones`, which is where history belongs.

**AI-chosen momentum states.** PRD §53 requires the formula to be deterministic
and testable, and PRD §120 requires the screen to work with the provider down.
The model's only role in this epic is the wording of one restart action, and
even that is checked before it is shown.

**Closing `STARTED` rows in the sweep.** The transition matrix has no
`STARTED → MISSED`. Something begun and not finished is `PARTIALLY_COMPLETED` or
`SKIPPED`, and the product does not know which — the user does.

**A boolean per milestone kind.** `FOUR_WEEKS` and `TEN_WORKOUTS` genuinely
repeat, and the fourth four-week stretch is a different fact from the first.
`sequence` says that; a boolean would either lose it or celebrate it twice.

**Cutting the momentum window at `now`.** It looks obviously right and silently
drops every commitment completed ahead of its scheduled time — including every
comeback restart. `isDecided` is the authority on what counts.
