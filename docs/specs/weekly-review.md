# The weekly loop

> Status: **partial**. The section marked *(E10-04)* is filled in by that
> child; E10-05 (#89) completes the document.

PRD §135 states the loop this epic closes: *review plan → compare planned vs
done → identify friction → learn pattern → adjust plan → approve next week*.
VISION §29 states why it is a product ritual rather than a chat — "a failed plan
is information" is only true if something looks at the plan every week without
being asked.

## Week addressing

A week is the user's **local Monday**, held as a `'YYYY-MM-DD'` string.

Monday-start is fixed product-wide: E08's family summary and E12's weekly cap
already chose it, and a second week convention would make "this week" two
questions with two answers on two screens.

The string, rather than a `date` column, is the same decision
`daily_check_ins.date_local` made (E05-03): a date column round-trips through
Prisma as UTC midnight and reads back as the Sunday for every user west of
Greenwich.

`weekBounds` derives `[start, end)` from two calls to `localDayBounds`, never
from `start + 7 days`, so a week containing a DST switch is 167 or 169 hours.

**`defaultReviewWeek`**: Monday and Tuesday look back at the previous week;
Wednesday to Sunday review the week in progress. A Monday-morning review of
"this week" would be a review of nothing, and a Friday review of "last week"
would ignore the four days the user is actually asking about.

## Aggregation rules

Computed by `aggregateWeek` (`apps/api/src/weekly/aggregation.service.ts`), a
pure function. Its output satisfies `weekAggregatesSchema`, asserted in the
function itself — a malformed aggregate is a programming error and must fail
where the mistake is, not as `undefined / undefined` on a screen days later.

`coverage.to = min(weekEnd, now)`; `coverage.partial` is true while the week is
still running. Rows scheduled after `coverage.to` are excluded entirely.

Per domain and in `totals`:

| Field | Definition |
|---|---|
| `planned` | Rows whose status is **not** `CANCELLED` or `RESCHEDULED` |
| `completed` | `COMPLETED` |
| `partial` | `PARTIALLY_COMPLETED` |
| `missed` | `MISSED` |
| `unresolved` | `PLANNED` or `READY` with `scheduledStart < now` |
| `skipped` | `SKIPPED` |
| `rescheduled` | `RESCHEDULED` — the closed originals |
| `started` | `startedAt` is set |
| `fallbackUsed` | `versionUsed ∈ {SHORT, MINIMUM}` among completed and partial |
| `minutesPlanned` | Σ scheduled span, else `fullMinutes`, else the routine's estimate, else 0 |
| `minutesSpent` | Σ `minutesSpent ?? 0` |
| `completionRate` | `(completed + 0.5 × partial) / planned`, 0 when nothing was planned |

Three rules are easy to get wrong and each has its own spec case:

1. **A rescheduled intention is counted once.** E02-04's reschedule closes the
   original as `RESCHEDULED` and opens a new row carrying the count. Both are in
   the week, so a naive `planned` reports two workouts where the user intended
   one — and then a 50% completion rate for doing the only thing they meant to.
2. **A row still in the future is not a miss.** A Wednesday review reporting
   Friday's workout as unresolved is the product inventing a failure.
3. **`unresolved` is not `missed`.** Nothing marks a stale row `MISSED` until
   E11-02's comeback loop. Calling an untouched intention a miss is an
   accusation dressed as a measurement (VISION §30).

**Time windows** bucket by the local hour of `scheduledStart`: `early_morning`
< 07, `morning` 07–11, `midday` 12–13, `afternoon` 14–17, `evening` 18–21,
`night` ≥ 22. Coarse on purpose — PRD §29's example is "before 9 AM" versus
"after 4 PM", and a per-hour histogram of eleven commitments is noise a reader
would find patterns in that are not there.

**`weekdays`** is always seven entries, Sunday first; the index is the weekday.
**`rescheduleLeaders`** lists live rows with `rescheduleCount ≥ 1`, sorted by
count then title, top five — the closed originals are excluded so one move is
not reported as two.

## Reviewer contract

Persona `weekly_reviewer`, prompt version `weekly_reviewer.v1`, schema name
`weekly_review`. Six outputs, fixed by PRD §14.6: `whatWorked`, `whatDidNot`,
`patterns`, `proposedChanges`, `keepUnchanged`, `doNotAddYet`.

**A pattern is three separate claims** (PRD §14.4): `observation` is what the
numbers say, `inference` is a guess, `recommendation` is what to do, and
`confidence` says how sure. The screen labels each, which is what lets a user
disagree with the middle one.

**At most two proposed changes**, and reduce or move before adding (PRD §51,
VISION §26). A review that proposes six changes is a rewrite, and a rewrite is
not something a person accepts on a Sunday evening — they abandon it.

`guardReviewOutput` drops any proposal naming a plan, routine or commitment id
absent from the assembled context, and counts the drops into the audit row's
`droppedProposals`. The prompt asks and the guard enforces, and the two are not
redundant (PRD §90): a proposal to move a routine the user does not have is a
confident, specific, plausible sentence whose diff would be a diff of nothing.

Surviving proposals become `plan_change_proposals` rows through
`ProposalsService.createFromSource(userId, 'WEEKLY_REVIEW', …)`. **No code path
in this epic writes a `PlanVersion`** — `WeeklyModule` does not import
`PathModule`, and the integration spec counts `plan_versions` before and after.

## Template fallback

When the gateway answers `ok: false` for any reason — provider down, no user
key, invalid output — or the context cannot be assembled, `buildTemplateSummary`
produces the summary from the numbers alone, with `source: 'template'` and
`promptVersion: null`.

It says only what the numbers say. `proposedChanges` is **always** empty: a
template cannot judge whether a plan should change, and a change built by a
string builder would be indistinguishable inside the mutation protocol from one
a coach reasoned about. `inference` and `recommendation` stay null for the same
reason.

This copy ships during every outage, forever, so a shaming sentence here would
reach users silently and permanently. The spec asserts the absence of "only",
"failed", "disappoint", "should have", "streak", "score" and "grade".

## Scheduling

`WeeklyReviewTask` runs `@Cron(EVERY_HOUR)` and asks each onboarded profile
whether it is that user's hour, comparing `localTimeParts(now, tz)` against
`weeklyReviewWeekday` and the hour of `weeklyReviewTime`.

**Hourly, not per minute**, and the API documents it: a review set for 17:30 is
prepared in the 17:00 pass. Minute precision would mean sixty times the queries
to move a background job by half an hour, on a screen nobody is watching at the
moment it runs.

Idempotency is by query — a user who already has a non-`GENERATING` review for
the week is skipped — with the unique `(user_id, week_start)` index as the
backstop. `WEEKLY_REVIEW_CRON_DISABLED=true` stops the sweep entirely.

## Notification hand-off

PRD §60's N8 ("your week is ready to review") is raised by E12's candidate
scanner reading `weekly_reviews`, not by generation. A `notify()` call at the
end of a generation would reach the user at whatever hour their sweep ran,
straight past quiet hours, the daily cap and the fatigue reduction — the three
things routing coaching messages through `decide()` exists to apply.

The candidate window is 24 hours from `generatedAt`, with a dedupe key of
`<reviewId>:<dateLocal>`: a review prepared on Sunday evening can be mentioned
once that evening and once the next day, and then never again.

## Materialisation rules and load check

`materializeWeek` and `checkLoad` (`apps/api/src/weekly/`) are pure — no Prisma,
no Nest, no clock — because three things read them: the approve path, the wizard
(which renders the summary the API computed rather than recomputing it), and
their own table-driven specs.

**Occurrence days**: `DAILY` all seven; `WEEKDAYS` Mon–Fri; `WEEKENDS` Sat–Sun;
`WEEKLY` the earliest day in `daysOfWeek`, else Monday; `CUSTOM` exactly
`daysOfWeek`. The time is `preferredTime`, else the domain default (`WORK`
09:00, `FAMILY` 18:30, `HEALTH` 07:00). `minimumVersion` is the routine's
`fallbackBehavior`, else "N-minute version"; `shortVersion` stays null, because
a routine has two sizes and inventing a middle one would put a version on the
Start screen the plan never described.

**Exclusions** set `include: false` with a reason rather than dropping the row:
`paused_domain` (the domain's mode is `PAUSE`), `travel_day`, `fixed_event` (an
event overlapping `[startTime, startTime + estimatedMinutes)`, or one with no
times at all, which blocks the whole day). PRD §50 step 5 shows the user what
their week *would* be, and a silently missing Wednesday is indistinguishable
from one the product forgot about.

An occurrence that already exists — matched on `(routineId, date)` — is not
returned at all. It is not a proposal any more, and that is the idempotency
that makes a retried approve safe. Cancelled rows do not count as existing: a
slot the user emptied on purpose must stay recoverable.

Extras are appended with `extra:<index>` keys and are never excluded: the user
typed them while looking at the same week and can see the travel day on it.

Output is sorted by date, then time, then domain, then title, and the same input
produces the same list — the wizard re-proposes on every edit, and a list that
reordered itself would move the checkbox the user was reaching for.

**Load check.** `recurringCount` is distinct included routine ids plus included
extras flagged `recurring` — per routine, not per occurrence, because five
morning focus blocks are one habit and counting occurrences would put every
weekday routine over an eight-commitment cap on its own.

| Warning | Raised when |
|---|---|
| `RECURRING_OVER_CAP` | `recurringCount > WEEKLY_LOAD_SOFT_CAP` (default 8) |
| `MINUTES_OVER_CAPACITY` | Total minutes exceed `5 × weekdayMinutes` |
| `DAY_OVER_CAPACITY` | The single heaviest day exceeds `weekdayMinutes` — one warning, not one per day |

A null `weekdayMinutes` produces no capacity warning at all, rather than one
about a fabricated budget.

**Warnings are data, never exceptions.** PRD §48 asks the product to
*recommend* replacing something; VISION §26 is about preventing overload, and a
product that refuses to let a person plan the week they want is a different kind
of overload. `approve` answers 422 `LOAD_WARNINGS_UNACKNOWLEDGED` until
`acknowledgeWarnings: true` — which means the user has read them, not that the
software agreed.

## Approve

One `$transaction`: a `PLANNED` commitment per included item through
`CommitmentsService.create` (so ownership checks, the family behaviour lint and
the `commitment:create` audit row all apply), the domain modes that actually
changed through `DomainModesService.set` (so `domain_mode:set` carries its
reason), and `WeeklyReviewService.markApproved` on the previous week. A
half-approved week is worse than an unapproved one.

`userConfirmed` is `true` on every created commitment, and only because the user
pressed approve. Nothing else in this epic sets it.

The transaction re-reads the existing occurrences before writing, so an approve
retried after a partial failure — or one racing a quick add on the Today screen
— completes the week rather than duplicating it.

## Screens

*(E10-04)*

## Observability

- Span `weekly.review.generate` with `weekly.week_start`, `weekly.trigger`,
  `weekly.source`, `weekly.proposals`. No text, ever.
- One Pino line per generation and one per sweep.
- Span `weekly.plan.approve`, and one Pino line per approve.
- Audit actions: `weekly_review:generate` (meta: `weekStart`, `trigger`,
  `source`, `proposalCount`, `droppedProposals`, `invocationId`,
  `coveragePartial`), `weekly_review:skip`, `weekly_settings:update`,
  `weekly_plan:create`, `weekly_plan:update`, `weekly_plan:propose`,
  `weekly_plan:approve`.
- `invocationId` is written to the review row and the audit meta and is
  **never** on the wire.

## Rejected alternatives

- **`@db.Date` for `weekStart`.** Round-trips as UTC midnight; every user west
  of Greenwich reads back the Sunday.
- **Letting the reviewer mutate plans.** PRD §15 exists because a plan the user
  did not agree to is a plan they will not follow. The reviewer proposes.
- **A separate `/review` destination.** The review is the weekly view of
  progress; a sixth tab for a screen opened once a week is a worse trade than
  one route under `/progress`.
- **Per-minute cron.** Sixty times the queries to honour minutes nobody is
  watching.
- **Recomputing the numbers in the browser.** Two implementations of a count is
  two answers to "how many did I do", and the wrong one is on the screen.
- **A single "summary" string from the model.** Cannot be rendered as What
  worked / What got in the way / Pattern / Recommendation, which is the layout
  PRD §51 fixes.
- **Blocking approve on a load warning.** PRD §48 recommends; a product that
  refuses to let a person plan the week they want is a different kind of
  overload.
- **Omitting excluded occurrences from the proposal.** A missing Wednesday is
  indistinguishable from one the product forgot about.
- **AI-worded commitment titles in V1.** A `?wording=ai` flag on `/propose`
  that called the `planner` persona for titles only is a reasonable P1;
  deterministic materialisation stays the source of ids and times either way.

## Extension points

- **E11** reads `aggregateWeek` for its momentum inputs rather than
  re-deriving weekly counts.
- **E12** already carries N8 end to end: the registry entry, the payload schema,
  the deep link, the deterministic copy and the email template. E10 supplied the
  source row.
