# The weekly loop

> Status: **partial**. Sections marked *(E10-03)* and *(E10-04)* are filled in
> by those children; E10-05 (#89) completes the document.

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

*(E10-03)*

## Screens

*(E10-04)*

## Observability

- Span `weekly.review.generate` with `weekly.week_start`, `weekly.trigger`,
  `weekly.source`, `weekly.proposals`. No text, ever.
- One Pino line per generation and one per sweep.
- Audit actions: `weekly_review:generate` (meta: `weekStart`, `trigger`,
  `source`, `proposalCount`, `droppedProposals`, `invocationId`,
  `coveragePartial`), `weekly_review:skip`, `weekly_settings:update`.
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

## Extension points

- **E11** reads `aggregateWeek` for its momentum inputs rather than
  re-deriving weekly counts.
- **E12** already carries N8 end to end: the registry entry, the payload schema,
  the deep link, the deterministic copy and the email template. E10 supplied the
  source row.
