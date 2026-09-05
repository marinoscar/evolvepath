# Coaching notifications

*Epic E12 (#44). The decision engine, the nine categories, the copywriter and
the interaction log.*

This document is the written contract for everything under
`apps/api/src/coaching-notifications/`, the `coach.*` entries in
`apps/api/src/notifications/notification-events.ts`, and the coaching parts of
`apps/api/src/notifications/`. Read it before changing any of them.

Related specs: [`today-and-nba.md`](today-and-nba.md) (the deep-link contract
these notifications land on), [`ai-gateway.md`](ai-gateway.md) (how the
copywriter is invoked), [`family-domain.md`](family-domain.md) (what a family
payload may contain), [`domain-model.md`](domain-model.md).

---

## 1. The one-sentence version

**A deterministic policy layer decides whether to interrupt. The AI may
personalise the wording, and can do nothing else.** (VISION §35, PRD §14.7.)

Everything below follows from taking that sentence literally.

---

## 2. Why there are two modules

`notifications/` is the **transport**, built by epic #109 with no product
knowledge at all: given a decision to tell somebody something, carry it over the
channels they have not switched off. `coaching-notifications/` is the
**decision**: read commitments, domain modes and history, and answer "is now a
useful moment?"

They are not merged, and the dependency points one way only — the coaching
module imports `NotificationsModule`, never the reverse. Putting product
reasoning inside the dispatcher would make the thing that has to keep working
when the product changes the thing that changes most.

---

## 3. The nine categories

PRD §60. They are **ordinary registry entries** in `notification-events.ts`, so
the preferences page grew nine rows with no code change on it.

| Key | Cat. | Fires | Buttons |
|---|---|---|---|
| `coach.commitment_upcoming` | N1 | 10–25 min before a WORK/HEALTH commitment | Start · Move · Skip today |
| `coach.start_cue` | N2 | ±5 min around the moment | Start · Use short version · Move |
| `coach.rescue` | N3 | same window as N1, for a commitment already moved | Start *n* min · Skip today |
| `coach.fallback_offer` | N4 | after the moment, while a smaller version still fits | Use short version · Start full · Skip today |
| `coach.family_presence` | N5 | 10–20 min before a FAMILY commitment | I'm in · Move it · Skip today |
| `coach.recovery` | N6 | after days away | — |
| `coach.evidence` | N7 | on a completion that is a milestone | — |
| `coach.weekly_review_ready` | N8 | when a review is generated | — |
| `coach.plan_issue` | N9 | when the coach proposes a plan change | — |

Three rules about that table:

- **None of them is `mandatory`.** PRD §59's first input is permission, and a
  coaching message a user cannot silence is the one that gets the whole app
  muted at the OS level.
- **Only N8 takes an email.** The other eight are moment-bound; an email that
  arrives twenty minutes after the moment is a message about a moment that has
  gone, and the reader cannot tell from their inbox whether it still applies.
  The weekly review is a thing that now exists and will still be there tomorrow,
  which is what makes email the right carrier rather than a second-best one.
- **N6 and N8 survive a paused domain** (`DOMAIN_EXEMPT` in
  `policy/notification-policy.ts`). Recovery *is* the path out of a pause;
  suppressing it would mean a user who paused everything can never be offered a
  way back. The weekly review has no domain to pause.

N6, N8 and N9 have no source table yet — they arrive with E11-02, E10 and
E06-01. Everything downstream of the source is finished: registry entries,
payload schemas, deep links, copy, the N8 email template and the decision rules.
Adding each source is one private method on `CandidateScannerService`.

---

## 4. Decision order

`decide()` in `policy/notification-policy.ts` is **pure**: no Nest, no Prisma, no
`Date.now()`. `now` is an argument. That is what makes every rule exhaustively
testable, reproducible after the fact, and — the important one — **unreachable by
the model**.

The **first failing check is the recorded reason**, so the order decides what the
metrics mean. It runs from "this user does not want this" through "this message
is pointless" to "this message is one too many":

| # | Reason | Fires when |
|---|---|---|
| 1 | `MUTED` | no reachable channel, or the event key is in `mutedCategories` |
| 2 | `DOMAIN_PAUSED` | the candidate has a commitment, its domain is `PAUSE`, and the event is not N6/N8 |
| 3 | `ALREADY_DONE` | status is `COMPLETED`, `PARTIALLY_COMPLETED`, `CANCELLED` or `MISSED` |
| 4 | `SKIPPED` | the commitment was skipped **today** |
| 5 | `PER_COMMITMENT_MAX` | `sentForCommitment >= perCommitmentMax` |
| 6 | `QUIET_HOURS` | `isQuietNow(now, timezone, quietHours)` |
| 7 | `WEEKLY_CAP` | `sentThisWeek >= weeklyCap` |
| 8 | `FATIGUE` / `DAILY_CAP` | `sentToday >= effectiveDailyCap` |

**Why one reason and not all of them.** A metric that says "we suppressed 400
messages for quiet hours" is only useful if those 400 would otherwise have been
sent — and a muted user's would not have been. One reason per decision keeps the
numbers meaningful.

**Why `FATIGUE` and `DAILY_CAP` are distinguished.** `FATIGUE` means *the user's
own cap would have allowed this; our automatic reduction did not*. That is the
number E12-06 needs to answer "is the reduction working, or is it just hiding the
coach?". A configured cap of `0` is always `DAILY_CAP` — the user asked for
silence, and attributing that to fatigue would be a lie.

### 4a. Quiet hours

`policy/quiet-hours.ts`. Two properties, both easy to get wrong:

- **Evaluated in the user's zone**, never the server's. A window stored as
  `22:00–07:00` is a claim about a wall clock, and the server's is not the one
  the user is asleep under.
- **The window usually crosses midnight.** `start <= t < end` is the obvious
  implementation and matches *nothing at all* for `22:00–07:00`, so quiet hours
  silently do not work while every test written against a `12:00–13:00` window
  passes. When `end < start` the window is the **union** of the two pieces it is
  cut into.

Half-open, `[start, end)`: a window ending at 07:00 stops suppressing **at**
07:00, so a 07:00 reminder goes out.

`hourCycle: 'h23'` is not decoration — without it midnight formats as `24:00` in
some zones, which sorts after every other time and puts the user outside a window
that should contain them.

### 4b. Fatigue

`policy/fatigue.ts`. PRD §61's "automatic reduction if ignored repeatedly".

| Constant | Value |
|---|---|
| `FATIGUE_THRESHOLD` | 5 consecutive ignored |
| reduction | `ceil(dailyCap / 2)` |

**Ignored** = a `SENT` row newer than the last `ACTIONED`, older than **two
hours**, with no `OPENED` or `ACTIONED` response
(`IGNORED_AFTER_MS`, `FATIGUE_WINDOW_DAYS` in
`interactions/notification-interactions.service.ts`). The two-hour grace is what
separates "ignored" from "hasn't looked yet": a reminder fired ten minutes ago is
pending, not ignored, and counting it would make fatigue trip on a burst rather
than on a pattern. A `DISMISSED` row counts as ignored — an explicit dismissal is
a *stronger* signal that the message was unwanted than silence is.

**Halving, not muting.** Going to zero would remove the only mechanism that could
earn the attention back, and the user has not asked to be left alone —
`mutedCategories` is where that is asked for. `ceil` means a cap of 1 halves to
1: the coach is quietened; only the user silences it.

**Recovery is one action, not a decay curve.** `history()` counts only since the
last `ACTIONED`, so acting on a single notification clears the streak outright. A
gradual restoration would punish exactly the behaviour being asked for.

The settings page and the engine call the **same function**, so
`GET /me/notification-policy`'s `fatigue.effectiveDailyCap` cannot disagree with
what the engine actually does.

### 4c. Caps are counted in the user's local day and Monday-start week

`localDayBounds` / `localWeekBounds` in `apps/api/src/today/local-date.ts`. A
daily cap computed in UTC would reset mid-evening for anyone west of Greenwich —
which is exactly when coaching messages cluster. The week is Monday-start,
agreeing with the family summary rather than inventing a second week.

---

## 5. Candidate rules

`candidates/candidate-scanner.service.ts`. The scanner makes **no decision** —
every candidate still goes through `decide()`. That split is what makes "we would
have told you, but you were asleep" a recordable fact rather than an absence.

### 5a. The window overlaps the cron interval on purpose

The cron runs every 5 minutes; the scan window is **45 minutes behind to 30
minutes ahead**. Each candidate is therefore seen by several consecutive runs, so
a failed run, a restart or a drifting clock cannot lose a moment permanently.

`hasDecision` is checked in the scanner as an **optimisation**. The correctness
mechanism is the unique index `(user_id, event_key, dedupe_key)`, which holds
even when two runs overlap.

### 5b. One moment, one message

N1, N3 and N5 all fire in roughly the same pre-commitment window. They are
mutually exclusive **at source**, not left for the per-commitment cap to trim —
the cap would let two through on a quiet day, and the second would be a
worse-worded duplicate of the first.

```
FAMILY domain        -> N5
moved at least once  -> N3
otherwise            -> N1
```

### 5c. Terminal rows are scanned too

The obvious scan is "rows that still need doing". It is wrong: the most valuable
thing this engine records is what it *didn't* say and why. A commitment skipped
this morning must reach `decide()` so the `SKIPPED` suppression is written, and a
completed one must reach it so the start cue is recorded as `ALREADY_DONE`.
Filtering them out would make the two commonest suppress reasons unreachable.

### 5d. The windows

| Cat. | Source | Window (Δ = `scheduledStart − now`) | `dedupeKey` |
|---|---|---|---|
| N1 | WORK/HEALTH, active | `10 min < Δ ≤ 25 min` | `<commitmentId>` |
| N2 | any, not `STARTED` | `−5 min < Δ ≤ 5 min` | `<commitmentId>` |
| N3 | as N1, `rescheduleCount ≥ 1` | as N1 | `<commitmentId>` |
| N4 | any, `Δ ≤ 0` | `short ≤ remaining < full` | `<commitmentId>` |
| N5 | FAMILY | `10 min < Δ ≤ 20 min` | `<commitmentId>` |
| N7 | `COMPLETED`, `completedAt` within 15 min | a milestone is reached | `<commitmentId>` |
| N6/N8/N9 | (source pending) | first run after the local morning | `<sourceId>:<dateLocal>` |

Moment-bound categories dedupe on the commitment id alone, so they get **exactly
one decision ever**. Daily-retried ones append the local date, so they get one
per day until their source row goes away.

**N4's "remaining"** is `scheduledEnd` when the commitment has one, otherwise the
end of the *usable* day — the start of the user's quiet hours if set, else 22:00
local. Using midnight would offer a 20-minute workout at 23:40, which is
technically true and obviously wrong. The offer is only made when the full
version no longer fits **and** the smaller one does: outside that band there is
nothing honest to say, and "you are running out of time" is not something this
product says.

**The Start button offers the smallest defined version**, not the full one. A
notification is read in a gap between other things, and the number in it is the
one being agreed to.

**N3's avoidance signal is `rescheduleCount`** until E07-03's `AvoidanceService`
lands. That is the observable the avoidance model is itself built on, and the
payload already carries a `level` field for it, so replacing it is one method.

### 5e. Milestones (N7)

`policy/evidence-milestones.ts`. A milestone is a fact about a **pattern**, never
about a single session: "third time in eight days" is information the user did
not have; "you completed a workout" is information they were present for. A
notification after every completion would train them to dismiss the channel
within a week, and the dismissals would then reduce the reminders that help.

`THIRD_IN_8_DAYS`, `FIFTH_IN_14_DAYS`, `TENTH_TOTAL`, `FIRST_FULL_WEEK`, checked
strongest-first. The counts use **exact equality, never `>=`** — a `>=` would
re-fire on the fourth, fifth and sixth session in eight days.

---

## 6. Copy rules

### 6a. The boundary

`copy/notification-copywriter.service.ts` is called **only** on a `send: true`
decision, receives **none** of the inputs that decision was made from, and has no
parameter through which it could express an opinion about sending. PRD §14.7 as
a signature rather than as a prompt instruction.

What it is actually for: the deterministic copy is already specific and useful,
but it cannot be *personal* — it does not know the user asked for a direct tone,
that the last two reminders for this commitment said the same thing, or that they
are three days into a comeback. Those are the inputs, and they are the whole
justification for spending a model call on two lines.

| Sent to the model | Never sent |
|---|---|
| the payload, the category, the default copy | caps, quiet hours, history counts |
| `coachingStyle`, `priorTitles`, `journeyState` | the decision, other users' anything |

### 6b. Three gates, all silent

1. `ok: false` from the gateway. The commonest by far is `no_user_key`, which is
   the **normal** state for a user who has not brought a key — logged at debug,
   not warn, or every BYOK-less user would produce a warning per notification.
2. Schema failure, including the length caps (the gateway validates).
3. A banned phrase.

Each failure yields the deterministic copy with `source: 'template'`. A
notification always goes out; the coach's words are the optional part.

### 6c. The length caps are not stylistic

`COPY_TITLE_MAX = 60`, `COPY_BODY_MAX = 140`, `COPY_ACTION_LABEL_MAX = 20`. An OS
notification elides a title and body at roughly those lengths, so copy over the
cap is copy the user never reads the end of. Rejecting it means the template is
used instead of a truncated sentence.

### 6d. Banned phrases

`copy/banned-phrases.ts`, enforced in **two** places: against the deterministic
templates at build time (they ship on every provider outage, so a shaming
template would reach users silently and forever) and against the model's output
at run time (prompting a model not to say something is a request; checking is the
guarantee).

They are **patterns, not substrings**, and the reason is PRD §60's own example
copy:

> "Two evening workouts failed. I think the schedule needs changing."

which the product *wants* to be able to say. "Failed" describes what happened to
a plan; "you failed" describes a person. A substring list containing `failed`
bans the sentence the PRD asks for.

The bar for adding one: it must assign **blame**, manufacture **urgency**, or
imply the app has **feelings** about being ignored. Anything that merely reports
a fact stays.

---

## 7. The run

`coaching-notifications.service.ts`. `candidates → decide → copy → notify →
record`, and the order of the last three is the part worth reading.

### 7a. The SENT row is written before the message is sent

Its id becomes `?n=` on every link in the notification, so it has to exist first.
That inversion also buys the idempotency: two overlapping runs both try to insert
the same `(user, event, dedupeKey)` and the unique index lets exactly one
through; the loser gets `duplicate: true` and stops, having sent nothing.

The alternative — send, then record — has a failure mode this does not: a crash
between the two produces a message the user received and the system has no memory
of, so the next run sends it again and the cap that should have stopped it cannot
see it.

### 7b. `notificationId` is back-filled

`NotificationsService.notify` is **detached** by design (epic #109) and cannot
return the inbox row's id. Rather than change that — the detachment is what stops
a slow SMTP server from delaying a product response — the run calls `flush()` and
matches the rows it just created on the `n=` in their link. The attribution chain
closing on itself.

### 7c. Reachable channels

`resolveChannels` is pure and knows only about preferences; it has no idea whether
push has a subscription or email has a transport. The orchestrator subtracts
those, so `MUTED` means "there is nowhere to send this" rather than the engine
cheerfully sending into a void.

### 7d. One process, no lock

There is an in-process `running` flag and **no distributed lock**, because this
deployment runs one API process. The unique index means a second process would be
correct anyway, merely wasteful. That is documented rather than solved: a real
lock is a dependency (Redis, or advisory locks and a connection to hold them)
that this epic does not need and should not smuggle in.

### 7e. The clock

`@Cron('*/5 * * * *')`, gated by `COACHING_NOTIFICATIONS_ENABLED` (default on).
Five minutes, not one: the candidate windows are 10–25 minutes wide precisely so
a five-minute tick cannot miss one, and a one-minute tick would do the same work
five times.

`POST /api/auth/test/run-job` (non-production, `@Auth()`) runs **the same
`runOnce`**, not a test double of it, with an optional `now`. Every rule here is
about time, and a test that can only run at the real `now` has to seed data
relative to the wall clock and then wait — which is how a suite ends up with a
`sleep` in it. It is deliberately **not** gated by the env flag: it is how a test
proves the pipeline still works while the cron is parked.

---

## 8. Rejected alternatives

**Report every applicable suppress reason.** Rejected: it makes the metrics
meaningless (see §4). One reason, first check wins.

**Let the copywriter see the caps so it can "use its judgement".** Rejected
outright — PRD §14.7. A model that can see a limit is a model that can argue with
one, and the argument would happen in a code path nobody reads.

**A payload column on `notifications` so the inbox can rebuild its buttons
exactly.** Rejected: the table stores what the user *was told*, frozen at write
time (see the header of `model Notification`). Actions are that same argument
applied to what they can still do about it, so they are re-derived from
`(eventKey, link)` through today's code. The cost is a generic "Start" where the
live SSE event says "Start workout" — a stored link does not record a domain.

**Let the per-commitment cap sort out N1/N3/N5 overlap.** Rejected: see §5b.

**A distributed lock.** Rejected: see §7d.

**Substring-matched banned words.** Rejected: see §6d.
