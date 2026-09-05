# Today and the next best action

**Status:** implemented (epic E05 — issues #38, #40, #43, #46, #48, #52, #55)
**Audience:** anyone changing `apps/api/src/today/`, `apps/api/src/commitments/`,
`apps/web/src/components/today/`, `apps/web/src/components/start/`, or building
E07, E10, E11 or E12 on top of them.

This document is the written contract for the product's primary surface. Like
[`domain-model.md`](./domain-model.md), it exists because a later epic will read
these rules, believe them, and ship against them — so a stale one is worse than
none. Where a constant is named below, it is named exactly as the code names it.

---

## 1. What Today is for

VISION §27 and PRD §12: one screen that answers **what matters, what is next,
and why**. Not a task list — a task list is what the user already had, and it is
what stopped working.

Three consequences run through everything below:

- **One recommendation, not a ranked queue.** PRD §13 makes the ranking
  deterministic and the engine, not the model, the thing that produces it.
- **A reason, always.** A card that says "Draft the storyline · 25 min" and
  nothing else *is* the task list. The rationale is what makes it advice.
- **The screen works with the provider down** (PRD §120). Structurally, not by
  timeout — see §7.

---

## 2. The endpoints

| Method | Path | What it is |
|---|---|---|
| GET | `/api/today` | The board. Never calls AI. |
| GET | `/api/today/insight` | The coach's sentence. Always 200. |
| POST · GET | `/api/today/check-in` | "How does today feel?" |
| POST · GET | `/api/today/reflection` | "Anything to learn from today?" |
| GET | `/api/commitments/{id}/actions` | The card an execution screen reads. |
| POST | `/api/commitments/{id}/actions/{verb}` | The nine verbs, plus `decompose/apply`. |

Full request and response shapes are in [`docs/API.md`](../API.md) — "Today" and
"Commitment actions". This document covers the rules behind them.

---

## 3. `GET /today`

```ts
{
  greeting: 'morning' | 'afternoon' | 'evening',
  stateLine: string,
  dateLocal: string,          // YYYY-MM-DD in the user's zone
  timeZone: string,
  checkIn: { feel: CheckInFeel } | null,
  nextBestAction: NextBestAction | null,
  domains: [WorkSection, FamilySection, HealthSection],   // always three
  momentum: null,             // E11 replaces
  coachInsight: null,         // always null; see §7
}
```

Three invariants a later epic must not quietly relax:

- **`domains` always has three entries, in canonical order,** including the empty
  and the paused. A section that disappeared because nothing was scheduled reads
  as data loss; one that disappeared because the user paused it hides a decision
  they made.
- **`nextBestAction` is null on an empty day.** An empty day is not a failure
  state and does not get an error or a placeholder.
- **`coachInsight` is always null here.** It exists on the type so E05's callers
  and E11 have one place to change.

### The local day

`dateLocal`, the candidate window and the greeting all resolve through
`user_profiles.timezone` (E04, #100), via `apps/api/src/today/local-date.ts`:

- `localDate(now, zone)` → `YYYY-MM-DD` using `Intl.DateTimeFormat('en-CA')`.
- `localDayBounds(dateLocal, zone)` → the UTC instants `[start, end)`, derived by
  sampling the zone's offset **at that date** (twice, so a DST transition inside
  the day cannot leave the boundary an hour out). A US spring-forward day is 23
  hours long here and a fall-back day is 25.
- `greetingFor` — 05–11 morning, 12–17 afternoon, else evening. Late night is
  "evening" rather than a fourth band: someone awake at 02:00 is finishing a day.

An unresolvable stored zone **degrades to UTC with a warn log**, never a 500. A
stored timezone is user input that survived a migration and a client library.

**Yesterday's still-planned commitments are never candidates.** VISION §33
refuses catch-up debt; E11's comeback loop is what closes them.

---

## 4. The scorer

`apps/api/src/today/nba/nba-scorer.ts`. Pure — no Prisma, no `Date.now()`, no
I/O; `now` arrives on the context. Two calls with the same inputs return the same
ranking, which is what makes "why did it suggest that?" answerable.

Additive, with every term `weight × factor` where `factor ∈ [0,1]`, so the
breakdown sums to the score and no term can silently dominate.

| Constant | Value | Factor |
|---|---|---|
| `IMPORTANCE_WEIGHT` | 30 | `importance / 5` |
| `URGENCY_WEIGHT` | 25 | `max(scheduleUrgency, deadlineUrgency)` |
| `REPEATED_AVOIDANCE_WEIGHT` | 20 | `min(rescheduleCount, 3) / 3` |
| `PLAN_RELEVANCE_WEIGHT` | 10 | active plan 1, inactive 0.5, none 0 |
| `DOMAIN_BALANCE_WEIGHT` | 10 | `modeFactor × (untouched today ? 1 : 0.25)` |
| `CONTEXTUAL_FIT_WEIGHT` | 10 | 1 inside the hour either side of the window |
| `EFFORT_MISMATCH_PENALTY` | −25 | 1 when the chosen size exceeds the budget |
| `CONFLICT_PENALTY` | −40 | 1 when a *different* commitment is already running |
| `FATIGUE_PENALTY` | −15 | `feelFactor × clamp(minutes/60, 0, 1)` |

- `scheduleUrgency = clamp(1 − hoursUntil/12, 0, 1)`; overdue is 1.
- `deadlineUrgency = clamp(1 − daysUntil/7, 0, 1)` against the outcome's target
  date; 0 when there is none.
- `modeFactor`: GROW 1, RECOVER 0.75, MAINTAIN 0.5. **PAUSE never reaches the
  scorer** — the loader excludes it, and the scorer *throws* if it sees one. That
  is a programming error, not a data state: the two disagreeing would surface as
  a suggestion to do something the user explicitly put down.
- `feelFactor`: LOW_ENERGY 1, PACKED 0.5, UNEXPECTED_PROBLEM 0.5, NORMAL/none 0.
- Self-started is **not** a conflict — it is the thing in progress.

**The weights are code constants, not configuration.** A per-installation weight
would make every user's ranking a different product, and the one report we could
not then investigate is "the suggestions got worse".

### Ranking and confidence

`rankCandidates` sorts by score descending, then **`scheduledStart` ascending,
then `createdAt` ascending, then id**. Without that chain two equally good
commitments swap places between two identical requests and the user watches the
recommendation flicker.

`confidenceOf` is `(top − second) / max(top, 1)`, clamped to **0.2–0.95**, and
**0.9** for a single candidate. Never 1: a deterministic ranking over incomplete
information is not certain. Never 0: a close call is still a real recommendation.

### The STARTED pre-rule

**A commitment already `STARTED` today *is* the next best action**, with
`interventionMode: 'ACT'`, the rationale "You already started this — continue.",
and `durationMinutes` counting down its own timer. Ranking it against the rest
would let the engine tell someone to abandon what they are doing. The scorer
still runs over everything, so `confidence` means the same thing either way.

---

## 5. Sizing, and the fallback

`apps/api/src/today/nba/nba-sizing.ts`, pure, and run **before** the scorer — the
chosen size is an input to `effortMismatch` and `fatigue`.

| Check-in | Preference |
|---|---|
| `LOW_ENERGY` | minimum → short → full |
| `PACKED`, `UNEXPECTED_PROBLEM` | short → minimum → full |
| `NORMAL` or none | full, stepped down only when it does not fit the remaining budget, never below minimum |

**A size the user never declared is never offered.** Inventing a short version
would be the product proposing a smaller commitment nobody agreed to, which is
the opposite of what PRD §57's three sizes are for. When a preferred size is
missing the sizer falls through to one that exists.

`fallbackFor` offers the next smaller **declared** size, or
`DEFAULT_FALLBACK = { title: '5-minute start', durationMinutes: 5 }` — PRD §28:
a daily win must be possible in minutes.

A budget is an estimate, so it *shrinks* an offer and never vetoes one: a
commitment whose only declared size is 25 minutes is still offered on a day with
10 minutes left.

---

## 6. Intervention mode

`apps/api/src/today/nba/intervention-mode.ts`. VISION §21's eight modes, resolved
by the **first matching rule**.

| Mode | Rule | Constant |
|---|---|---|
| `RECOVER` | ≥ 3 days since any evidence, and the user has logged something before | `RECOVER_DAYS = 3` |
| `CHALLENGE_PLAN` | the top candidate's routine failed ≥ 4 times in 14 days | `CHALLENGE_PLAN_FAILURES = 4` |
| `DIAGNOSE` | the top candidate has `rescheduleCount ≥ 2` | `DIAGNOSE_RESCHEDULES = 2` |
| `REDUCE` | check-in `PACKED`/`UNEXPECTED_PROBLEM`, or the chosen size exceeds the budget | — |
| `RECONNECT` | check-in `LOW_ENERGY` | — |
| `CLARIFY` | the outcome states neither motivation nor a definition of done | — |
| `REINFORCE` | ≥ 3 completions in 7 days with nothing missed | `REINFORCE_COMPLETIONS = 3` |
| `ACT` | otherwise | — |

**Order is the design, not an implementation detail.** Every one of these can be
true at once for someone having a hard week, and the winner decides what the
product says to them. The principle is: address the biggest thing first, and
address a person before a plan.

**A brand-new account never gets `RECOVER`.** Never having logged anything is not
a lapse, and "welcome back" to someone who has not been anywhere is a bug the
user notices immediately. The rule requires `hasAnyEvidence`.

`rationale` is a deterministic template per mode
(`nba/rationale-templates.ts`), filled from the candidate. Every substitution is
a value read off the candidate; nothing is invented. It is **never AI** — see §7.

---

## 7. The coach insight

`GET /today/insight` is a **separate request**, and that split is the guarantee,
not a performance tweak: `GET /today` has no code path to the provider at all, so
"the screen works when AI is down" cannot be undone by someone raising a timeout.
A spy in `test/today/today.integration.spec.ts` asserts zero gateway calls.

- Persona `coach`, prompt version `today-insight.v1`, schema
  `{ text: string.max(280) }`, schema name `today_insight`.
- The model receives **the recommendation the engine already made**, not the
  candidate list. It does not get to re-decide priority (PRD §13).
- **Every** failure — no key, provider down, timeout, a response that fails the
  schema, an empty string — returns **200** with `source: 'template'` and the
  deterministic sentence for the resolved intervention mode. A coaching card is
  the wrong place to learn that an API key expired.
- Cached per user per local date in `TodayInsightCache`, a provider that depends
  on nothing. **Per-process, stated rather than hidden:** with several API
  instances a user can see one regeneration per instance per day. A shared cache
  is real infrastructure for a sentence whose only cost is one small model call,
  and it would need this same invalidation anyway.
- `POST /today/check-in` invalidates it. Someone who just said "low energy" and
  still reads this morning's chirpy sentence concludes nothing listened.
- The cache lives outside `TodayInsightService` specifically to break the cycle
  `CheckInService → TodayInsightService → TodayService → CandidateLoaderService →
  CHECK_IN_READER → CheckInService`.

---

## 8. The commitment actions

Ten intent-named routes over E02's transition matrix. The matrix answers *which
status may follow*; a screen asks *which button do I show*, and the intent is
what decides which evidence gets written. "I finished" and "I gave up on the full
version and did the minimum" are the same status and different facts.

| Action | Status | Evidence | Audit |
|---|---|---|---|
| `start` | → `STARTED` | `APP_FLOW started` (value = timerMinutes) | `commitment:start` |
| `pause` | stays `STARTED` | `APP_FLOW paused` (value = banked seconds) | `commitment:pause` |
| `continue` | stays `STARTED` | `APP_FLOW continued` | `commitment:continue` |
| `complete` | → `COMPLETED` | `USER_LOG completed` | `commitment:complete` |
| `partial` | → `PARTIALLY_COMPLETED` | `USER_LOG partially_completed` | `commitment:partial` |
| `fallback` | unchanged | `APP_FLOW fallback_selected` | `commitment:fallback` |
| `reschedule` | → `RESCHEDULED` (+ new row) | `APP_FLOW rescheduled` **on the new row** | `commitment:reschedule` |
| `skip` | → `SKIPPED` | **none** — a `Reflection` instead | `commitment:skip` |
| `decompose` | unchanged | none — **writes nothing at all** | — |
| `decompose/apply` | unchanged (+ new row) | none | `commitment:decompose_apply` |

Every route answers **404**, never 403, for an id that is not the caller's.

### Completion without a start

E05 widened the matrix so `PLANNED`/`READY` → `COMPLETED`/`PARTIALLY_COMPLETED`
is legal. Most of what a user does happens away from the app: they went for the
run and then opened their phone. The alternative is refusing an honest "I did it"
or *manufacturing* a start — a `startedAt` and an `APP_FLOW started` row for
something the product never observed, which the domain model's §7 forbids. So the
jump is legal, no start evidence is written, and `startedAt` stays null — that
null is itself the record that the timer was never used.

### One running timer per user

`start` pauses whatever else the user left running, writing its own `paused`
evidence. Two commitments claiming the same wall-clock minutes would make every
later "how long did this take?" answer a lie.

### Paused is `STARTED` with `activeSince: null`

There is no `PAUSED` status and there must not be one. PRD §10.7 owns the status
enum; a parallel notion of "running" living in it would give one fact two sources
of truth.

### `continue` while still running

The one place the endpoint is deliberately wider than `availableActions`. "Continue
another 15?" fires on a session that has passed its target but never paused, so
`activeSince` is still set. Refusing it would leave the user's only way forward a
pause followed by a continue — writing a `paused` evidence row for a pause that
never happened. When already running, `activeSince` is left alone (re-anchoring
would discard the accumulated seconds) and only `timerMinutes` moves.

### The reschedule model

E02-04 owns it and E05 delegates. `RESCHEDULED` is **terminal**: the original
closes as history, keeping the evidence of what happened before it moved, and a
fresh `PLANNED` row carries the intention forward with `rescheduleCount + 1`.

**The count travels with the intention, not the row.** "Moved twice" has to be
readable on the *live* commitment, because that is the one the scorer's
`repeatedAvoidance` term and E07's avoidance detection read.

The `rescheduled` evidence row is written **on the new row**. Consequences:
`RESCHEDULED` is never a candidate, never startable, never editable; the UI must
use the returned card's id from here on; and a `STARTED` commitment answers
**409 `ALREADY_STARTED`** rather than being moved, because its evidence belongs
to today.

### Skip writes a reflection, never evidence

A skip is not execution. Recording it as evidence would make "what did you do
this week" include the things you did not do. But PRD P5 says a failed plan is
information, so the reason becomes a `frictionTags` entry that E07 and E10 group
on. The audit row carries the enum and never the text.

### Decomposition

`decompose` asks the `coach` persona (prompt `decompose.v1`, schema
`decomposition_proposal`) for 3–5 steps whose first takes ≤ 10 minutes, and
**mutates nothing** — PRD §15: AI output is not persisted without the user's
approval, and approval that cannot change anything is a confirm button, so the
first step is editable in the UI. The **same schema validates both directions**,
so an edited proposal is held to exactly what the model was allowed to return.

Bounds are product decisions: at most **5 steps** (a sixth is a plan, and a plan
change goes through the plan editor), and a first step of at most **15 minutes**
(a longer one has reproduced the problem the user asked for help with).

On `{ok: false}` the endpoint answers **200** with the template proposal — a real
five-minute first move. `decompose/apply` creates a **new** commitment from
`firstStep`, linked by `decomposedFromId`, and leaves the original alone: it is
still in the plan, and the small one is today's move.

---

## 9. The timer

Two columns and one derived value:

```
activeSeconds   time banked at the last pause
activeSince     when the current run began, or null while paused
elapsed         activeSeconds + (activeSince ? now − activeSince : 0)
```

**Elapsed is never stored.** Storing it would mean writing on a schedule to keep
it true, and a client that never sends the last write leaves a number that is
quietly wrong forever. Deriving it from a server instant means a page reload, a
second device and a phone that slept through the session all agree — and a client
clock cannot inflate the record, which is what PRD §10.9 actually requires.

`apps/web/src/utils/commitmentTimer.ts` is a verbatim mirror of
`apps/api/src/commitments/actions/commitment-timer.ts`; the client interpolates
between responses and re-anchors on the server on mount, on reload and on window
focus. An `activeSince` more than **5 seconds** in the future is treated as clock
skew: the banked total is used and a warning is logged, because a countdown
running backwards is worse than one that is a second out.

`remainingSeconds` is **null** for an open-ended session. Reporting `0` would tell
the user they had run out of time they never asked for.

---

## 10. Check-in and reflection

`daily_check_ins` is **one row per user per local day, upserted**. The question is
asked once and the answer can change — a morning that started fine can become a
packed afternoon — so a history of taps would be noise. The unique index on
`(user_id, date_local)` is what makes that a property of the data.

`date_local` is **text**, not a date column: it is a label in the user's own
timezone, and a date mapping round-trips through UTC, which would file a 19:00
check-in in Costa Rica under the following day.

The request body has **exactly one field**. PRD §73 warns against "daily emotional
interrogation", and the guard is structural: there is nowhere to put a follow-up
question.

The end-of-day reflection reuses E02's `reflections` table with
`relatedType: 'day'` rather than adding a second one. `relatedId` stays **null**
(a day has no row to point at, and E02 typed the column as a uuid) and the day is
recovered from `createdAt` against the user's own day bounds — which is also the
honest answer, since for an end-of-day prompt "which day is this about" and "when
was it written" are the same question. `frictionTags` therefore carries the quick
option and **nothing else**: it is what E10's weekly review groups on.

`ReflectionQuickOption` is deliberately **not** `SkipReason`, even though five of
the seven overlap. `PLAN_WORKED` is a real answer about a day and is not a reason
to skip anything; merging them would either smuggle it into the skip menu or lose
it here.

---

## 11. The screens

### Today (`apps/web/src/pages/TodayPage.tsx`)

`TodayGreeting` · `CheckInChips` · `NextBestActionCard` · `CoachInsightCard` ·
`DomainCard` → `CommitmentRow` → `CommitmentActionsMenu` · `ReflectionPrompt` ·
`QuickAddFab` → `QuickAddSheet` → `CommitmentEditorForm`, plus
`dialogs/{Complete,Reschedule,Skip,MakeItSmaller}Dialog`.

Two rules:

- **The action menu renders exactly the API's `availableActions`** — no filtering,
  reordering or additions. The one documented exception is `edit`, which is a
  `PATCH` rather than an action endpoint and is appended by the row only for
  `PLANNED`/`READY`, which is what the API will accept.
- **`CoachInsightCard` renders nothing when there is nothing to say.** Its absence
  has to be invisible rather than an error box beside a usable recommendation.

The page's two-column split uses `md`. That is a **local layout choice** and
deliberately not a sixth entry in the settings shell's five coupled `sm` gates
(see [`settings-ui.md`](./settings-ui.md) §5). The quick-add sheet's `down('sm')`
and the FAB's `bottom: { xs: 80, sm: 24 }` are the same kind of thing: they
*read* the boundary that decides whether `BottomNav` is mounted, they do not
decide it.

### Start (`apps/web/src/pages/StartFlowPage.tsx`)

`/start/:commitmentId`, inside the AI-key gate but **outside `Layout`**, like
`/activate`. PRD §11 lets an execution screen replace the navigation, and this is
the one screen where every other affordance is a way out of the thing the user
just committed to. `'/start/:commitmentId'` is in `UNOWNED_ROUTES` accordingly.

Leaving does **not** stop the timer and there is **no** `beforeunload` prompt.
The server holds the session and Today shows the row with `Continue`; a dialog
asking "are you sure you want to leave?" would be the product arguing with
someone who has already decided.

`aria-live` sits on a separate, **minute-resolution** status element rather than
on the digits. A polite region changing every second would make a screen reader
read the clock aloud continuously — the thing a silent timer exists to avoid
(PRD §28). "Paused" is spelled out rather than signalled by colour alone.

---

## 12. The deep-link contract (for E12)

`/?commitment=<uuid>&action=<verb>`:

| `action` | Effect |
|---|---|
| `start` | navigates to `/start/<id>` |
| `complete`, `fallback`, `skip`, `reschedule` | opens that dialog on the matching row |
| anything else | ignored |
| an id not on today's board | a message: "That commitment is no longer on today's path" |

**The params are stripped with `replace: true` before the action runs**, so a back
navigation returns to a clean `/` rather than re-firing the same dialog.

---

## 13. What later epics read from here

| Epic | Reads |
|---|---|
| E07 Work/Focus | `rescheduleCount` on the live row; `activeSince`/`activeSeconds`; the `AVOIDED` skip reason; `steps` |
| E09 Health | the generic Start flow, until the workout runner replaces it for HEALTH |
| E10 Weekly review | `reflections` with `relatedType: 'day'` and their `frictionTags`; `minutesSpent` |
| E11 Momentum | `evidence_items`; `momentum: null` on `GET /today` is its slot |
| E12 Notifications | the deep-link contract in §12; `daily_check_ins` for quiet-hours decisions |

**Do not change** without updating this document and its tests: the weight
constants and their names, the intervention-mode order, the reschedule new-row
model, the absence of a `PAUSED` status, or the deep-link parameter names.

---

## 14. Rejected alternatives

- **Rescheduling in place** (moving `scheduledStart` on the same row). Rejected:
  the moved-from record disappears, so "you have moved this three times" becomes
  unanswerable — and that sentence is the single most useful thing the product
  says to someone who is avoiding something.
- **A `PAUSED` status.** Rejected: one fact would have two sources of truth, and
  every consumer would have to know that `PAUSED` also means "started".
- **An AI-ranked next best action.** Rejected by PRD §13, and independently by
  §7's requirement: a ranking that needs a provider is a screen that stops
  working when the provider does.
- **Storing elapsed time.** Rejected: see §9.
- **Per-installation scoring weights.** Rejected: every user's ranking becomes a
  different product, and "the suggestions got worse" becomes uninvestigable.
- **Deleting a commitment on Undo.** Rejected: the record of a day survives, and
  `CANCELLED` already removes it from the board.
- **One AI call inside `GET /today` with a short timeout.** Rejected: a timeout is
  a setting somebody can raise. A separate request is a structure they cannot.

---

## 15. Related documents

- [`domain-model.md`](./domain-model.md) — the tables, the enums, the transition matrix
- [`ai-gateway.md`](./ai-gateway.md) — `AiGatewayService.invoke` and its never-throws contract
- [`docs/API.md`](../API.md) — every route's request and response shapes
- `tests/e2e/specs/today.spec.ts` — the loop, proved against the running stack
