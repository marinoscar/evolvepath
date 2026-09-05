# The Family domain

**Status:** implemented (epic E08 — issues #37, #41, #45, #50, #53)
**Audience:** anyone changing `apps/api/src/family/`,
`apps/web/src/components/family/`, or building E10 (weekly review), E11
(momentum) or E12 (notifications) on top of them.

This document is the written contract for the Family domain. Like
[`domain-model.md`](./domain-model.md) and [`today-and-nba.md`](./today-and-nba.md),
it exists because a later epic will read these rules, believe them, and ship
against them — so a stale one is worse than none. Where a constant is named
below, it is named exactly as the code names it.

---

## 1. What the Family domain is for

VISION §11 asks two questions: *what family rituals am I trying to protect?* and
*what promises have I made?* PRD §30 and §34 answer them the same way — by
turning an intention into a **recurring, protected behaviour** that becomes real
commitments on the Path and on Today, kept, moved or skipped through the same
lifecycle every other domain uses.

Nothing in this epic re-implements that lifecycle. Completing, moving and
skipping a ritual occurrence are E05-02's `complete`, `reschedule` and `skip`
actions, and there are deliberately **no family-specific lifecycle endpoints**.

---

## 2. The privacy boundary

**This is the most important section in the document.**

PRD §33 fixes what a family member record may hold: a nickname, a relationship,
an optional birthday. VISION §50 says why: *the people in it never consented to
being modeled.*

So `family_members` has exactly six columns —
`id, user_id, nickname, relationship, birthday, created_at` — and there is no
notes, tags, mood, sentiment, quality or score column. **None may be added.** A
free-text field about a person who did not ask to be recorded becomes a hidden
assessment the moment the coach reads it back, which is precisely what PRD §33's
"do not create hidden assessments of family members" forbids.

The boundary is enforced in four places, so that widening it is a decision
rather than an accident:

| Where | How |
|---|---|
| The schema | The columns simply are not there. |
| `familyMemberResponseSchema` | `.strict()` — an extra key is a parse error. |
| `toFamilyMemberDto` | An explicit projection, never a spread. |
| `family.mapper.spec.ts` | Compares the mapper's key set against `FAMILY_MEMBER_RESPONSE_KEYS` by **sorted equality, not containment**. |

`FAMILY_MEMBER_RESPONSE_KEYS` is a literal list rather than derived from the
schema: a derived list agrees by construction and proves nothing.

**Audit rows carry the relationship and nothing else.** `family_member:create`,
`:update` and `:delete` write `meta: { relationship }`. An audit row outlives
the record it describes — that is what an audit log is for — so putting the
nickname or the birthday in one would defeat the deletion the user just asked
for and rebuild the forbidden profile in a table nobody thinks to look at.

**The birthday is a calendar date, and its year is never read.** It is
`@db.Date`, mapped with `toISOString().slice(0, 10)` and never resolved through
a timezone — running a calendar date through a zone turns a birthday on the 9th
into the 8th for everyone west of Greenwich. The UI sends `1900` as the year
when the user does not know it, and nothing displays the year.

---

## 3. The data model

Two tables, and two nullable foreign keys on `commitments`.

```
family_members   id, user_id, nickname(40), relationship, birthday(date), created_at
rituals          id, user_id, title(120), purpose(300), family_member_id,
                 recurrence(jsonb), ideal_minutes, minimum_minutes,
                 fallback_behavior(200), active, last_materialized_through(date),
                 routine_id, created_at, updated_at
commitments      + ritual_id, + family_member_id          (both SET NULL)
```

`FamilyRelationship` is `PARTNER | CHILD | PARENT | SIBLING | FRIEND | OTHER`,
in that order — it is the order the UI select renders.

**Deletes never cascade downward into history.** Deleting a user cascades to
their members and rituals; deleting a member or a ritual sets the foreign key on
existing commitments to `NULL` and leaves the rows intact. The record of what
the user actually did survives every deletion in this domain.

### The unique index is the idempotency guarantee

```prisma
@@unique([ritualId, scheduledStart])
```

This, and not a transaction, is what makes materialization safe to repeat. It
works because Postgres treats NULLs as distinct, so the commitments with no
ritual are never in conflict with each other, while two rows for the same ritual
at the same instant raise `P2002` — which the materializer counts as `skipped`.

It also does something subtler and more valuable: it makes an occurrence the
user has already completed **untouchable**. A re-run collides on the index and
skips, rather than finding the row, inspecting it, and possibly overwriting it.

---

## 4. The recurrence contract

`recurrence` is JSON validated by `ritualRecurrenceSchema` at the boundary:

```ts
{ weekdays: number[], time: 'HH:mm', everyNWeeks: 1 | 2 | 4 }
```

- **`weekdays` is `0 = Sunday … 6 = Saturday`**, matching JavaScript's
  `Date#getDay()` and the API. A UI that renders Monday-first changes only the
  display order (`WEEKDAY_ORDER` in `apps/web/src/utils/recurrence.ts`); the
  stored values never change. Converting at the edges would be a conversion in
  every component that touches a recurrence, and one forgotten in the fourth.
- **`time` is local to `user_profiles.timezone`**, which defaults to `UTC`.
- **`everyNWeeks` is 1, 2 or 4.** 3 is deliberately not offered.

### Monday-start weeks, anchored to the creation week

`everyNWeeks` needs an origin, and the only one that survives editing is the
ritual's own `createdAt`. A date is an occurrence when `weekdays` contains its
local weekday **and**

```
weeksBetween(weekStartLocal(createdAt), weekStartOfDate(date)) % everyNWeeks === 0
```

ISO week *numbers* are not used: they wrap at the year boundary, so week 49 to
week 1 is "three weeks" by that arithmetic. Counting whole Monday-start weeks
between two dates has neither that problem nor the one "weeks since the epoch"
has, where two users who created the same ritual on the same day get different
fortnights.

### DST: the two ambiguous days

`zonedTimeToUtc(dateLocal, time, timezone)` resolves a wall time into an
instant. Two days a year that has two answers, and both rules are stated:

- **Spring forward (a gap).** 02:30 on 8 March 2026 does not exist in New York.
  The wall time is **shifted forward by the length of the gap** — 03:30 EDT,
  `2026-03-08T07:30:00Z`. Forward rather than back is what keeps a 07:00 workout
  in the morning instead of moving it to 06:00.
- **Fall back (an overlap).** 01:30 on 1 November 2026 happens twice. The
  **first**, still-DST instant wins — `2026-11-01T05:30:00Z` — so the reminder
  fires at the first 01:30 the user experiences.

These are `Temporal`'s `'compatible'` disambiguation rules, chosen deliberately
so that when that API is available everywhere the file can be deleted rather
than reinterpreted.

The implementation samples the zone's offset a day either side of the naive
instant and builds a candidate from each, keeping the one whose offset
round-trips. **A single-pass "guess the offset and subtract it" is wrong** for
every wall time within one offset's distance after a spring-forward transition —
a whole evening's worth of rituals in the Americas. `recurrence.spec.ts` covers
that case explicitly.

`nextOccurrences` returns `(from, to]` — `from` exclusive, `to` inclusive — so
that repeated calls using the previous horizon as the new `from` neither skip
nor repeat a boundary occurrence.

---

## 5. Materialization

A ritual is a **rule**; `GET /today`, the Path, the summary and E11's momentum
all read `Commitment` rows. A rule that stayed a rule would be invisible to all
four, so it is expanded ahead of time into ordinary commitments.

| Constant | Value | Why |
|---|---|---|
| `MATERIALIZE_HORIZON_DAYS` | `7` | Every extra week is another week of rows to withdraw when the user edits the rule, and seven days is exactly what `/path/family`'s Upcoming panel shows — so nothing is materialized that nobody can see. |
| Cron | `EVERY_DAY_AT_1AM` | Separated from the 03:00 token cleanup so the two do not contend for the connection pool. |
| Page size | `200` rituals | Each ritual runs in its own `try`/`catch`: one user's unusable timezone must not stop every other user's dinner from appearing. |

**When it runs:** synchronously on ritual create, on demand through
`POST /family/rituals/:id/materialize`, and nightly for every active ritual.

**What each occurrence carries:**

| Field | Value |
|---|---|
| `domain` | `FAMILY` |
| `status` | `PLANNED` |
| `importance` | `4` — family rituals are the thing PRD §30 says work displaces, so they must not lose every tie |
| `scheduledEnd` | `scheduledStart + idealMinutes` |
| `fullVersion` / `fullMinutes` | the ritual's title / `idealMinutes` |
| `shortVersion` / `shortMinutes` | the title / the midpoint — **only when `idealMinutes − minimumMinutes ≥ 10`** |
| `minimumVersion` / `minimumMinutes` | `fallbackBehavior ?? title` / `minimumMinutes` |
| `ritualId`, `familyMemberId`, `routineId` | from the ritual |

Below ten minutes of spread the "short" version is the same decision as the
minimum one wearing a different label, and a third identical choice makes the
card harder to read, not easier.

**Audit:** `ritual:materialize` is written **only when `created > 0`**. The cron
visits every ritual every night; auditing a no-op would add 365 rows a year per
ritual to a table whose whole value is that everything in it happened.

### Editing a ritual: cancel what the rule dropped, keep what it did not

Changing `title`, `recurrence`, `idealMinutes`, `minimumMinutes` or
`fallbackBehavior` rebuilds the future. `purpose` and `familyMemberId` do not:
they are context on the ritual, not part of what the user agreed to do at a
particular time, and cancelling tonight's dinner because somebody fixed a typo
in "Be present at the table" would be absurd.

The rebuild asks **which slots does the new rule still want?**
(`RitualMaterializerService.desiredOccurrences`) and then:

1. Withdraws every future `PLANNED`/`READY` occurrence **not** in that set —
   **through E02-04's transition matrix**, never with a raw `updateMany` to
   `CANCELLED`. The status filter comes first so the matrix is never asked for a
   move it would refuse; a `RESCHEDULED`, `STARTED` or terminal row is one the
   user touched, and editing the rule must not rewrite what they did.
2. Refreshes the occurrences that **are** in the set, in place, with the new
   title and durations (`contentFor`). The user changed the rule, not their mind
   about tonight.
3. Resets `lastMaterializedThrough` and materializes, which adds the genuinely
   new slots.

> **Do not "simplify" this to cancel-everything-then-re-materialize.** It looks
> right and fails silently: the unique index turns every re-created slot into a
> `skipped`, so unticking Sunday would leave Tuesday and Thursday cancelled and
> never rebuilt. E08's e2e (`family.spec.ts`, "editing a recurrence cancels only
> the future planned occurrences") caught exactly this, and
> `rituals.service.spec.ts` now pins it.

`active: false` withdraws every future occurrence and stops the nightly run;
`active: true` rebuilds them. Deleting a ritual withdraws the future ones and
sets `ritual_id` to `NULL` on the rest — **nothing is ever deleted**. A linked
`Routine` is left in place: it is what the plan used to say.

---

## 6. The behaviour lint

PRD §32: a family commitment describes the **user's own behaviour**.

> Good: "Put phone away during dinner." · "Spend 20 minutes helping child with
> project." · "Plan Saturday outing by Thursday."
>
> Avoid: "Make spouse happier." · "Improve daughter's attitude."
>
> *The system cannot control another person's behavior.*

Recording a commitment that pretends otherwise sets the user up to fail at
something that was never theirs to do. The refusal is the feature.

### Three rules, all three parts required

A **false positive is the expensive error**: being told a good intention is not
a real commitment is a reason to stop using the feature, while a missed "Make
spouse happier" is a title the user can still fix. So each rule needs a **verb,
a person and a state word** — the three parts of the sentence PRD §32 objects to
— rather than firing on any one of them. "Make pancakes with the kids" has a
verb and a person and passes.

The word lists live in `apps/api/src/family/behaviour-lint.ts` as
`OTHER_PERSON_VERBS`, `OTHER_PERSON_TARGETS` and `OTHER_STATE_WORDS`; this
document deliberately does not copy them, so the two cannot drift.

| Rule | Shape | Example |
|---|---|---|
| **B** | `(fix\|improve\|change\|correct) [my] <person>'s <state>` | "Improve daughter's attitude" |
| **A** | `<verb> [the] <person> … <state>` | "Make spouse happier", "get the kids to listen" |
| **C** | `<person> (should\|must\|needs to\|has to) …` | "Mia should read more" |

Evaluated **B, A, C** — most specific first, so a possessive over somebody
else's state is reported as B rather than as "a verb, a person and a state word
appeared near each other".

A capitalised token that is **not the first word** counts as a name, because a
title is normally an imperative whose verb is capitalised ("Make", "Read",
"Call"). Rule C is the exception: a word followed by a modal is the subject of a
demand, so a capitalised first word counts there. Weekday and month names are
never people, which is what lets "Plan Saturday outing by Thursday" pass.

### Where it runs

- `POST` and `PATCH /family/rituals`, **before any write** — a refused title
  leaves nothing behind, not a ritual, not a routine, not an audit row.
- `POST` and `PATCH /commitments` **when `domain === 'FAMILY'`**, so quick add
  is held to the same rule. FAMILY only: "Fix the deployment pipeline" is a
  perfectly good work commitment and the same sentence shape. The check lives in
  `CommitmentsService`, not in the DTO, because a PATCH's domain is the stored
  row's and Zod only sees the body.

```json
400 {
  "message": "Describe what you will do, not how someone else should feel or behave.",
  "details": { "reason": "BEHAVIOUR_TARGETS_OTHER_PERSON", "match": "…", "rule": "A" }
}
```

### The rewrite is optional, and re-linted

`POST /family/lint` is **always 200** — it is a check, not a refusal. The
verdict is deterministic and never depends on a provider (PRD §120); only
`suggestion` does, and it is `null` with `source: 'none'` whenever the coach is
unreachable, the per-user window (`family_lint`, 10/min) is spent, **or the
model's own rewrite fails the same lint**.

That last case is not hypothetical: asked to rewrite "Make Mia happier", a model
will sometimes answer "Help Mia feel happier" — the same commitment in politer
words — and offering it would make the product contradict the rule it had just
enforced.

`BehaviourLintService` lives in its own module (`behaviour-lint.module.ts`)
importing only `AiModule`, because `CommitmentsService` needs it while
`FamilyModule` imports `CommitmentsModule` for the transition matrix.
`forwardRef` would hide that coupling rather than remove it.

Prompt version: `family-behaviour-rewrite.v1`.

---

## 7. The review summary

`GET /family/summary?weekStart=&weeks=1..12`. `weekStart` is a Monday in the
caller's timezone (400 `WEEK_START_NOT_MONDAY` otherwise) and defaults to the
current local week; `weeks` counts **backwards from it, inclusive**, default 4.
Weeks come back newest first.

### The counts

| Field | Meaning |
|---|---|
| `planned` | every row scheduled in the week, in any status **except `CANCELLED`** |
| `kept` | `COMPLETED` |
| `partial` | `PARTIALLY_COMPLETED` |
| `moved` | `RESCHEDULED` |
| `skipped` | `SKIPPED` |
| `missed` | `MISSED` (E11 sets it; 0 until then) |
| `open` | `PLANNED`, `READY` or `STARTED` |

A ritual with no rows in a week is still listed at zero when it was `active` and
already existed — an every-other-week ritual must not look abandoned in its off
week. Ad-hoc family commitments (quick add, onboarding) are one line under
`ritualId: null`, titled "Other family commitments".

**Moved rows are counted where they were originally due.** E02-04's reschedule
closes the original as `RESCHEDULED` and opens a **new** `PLANNED` row at the
new time, so the original week records the move and the new week sees the live
row. A commitment moved twice leaves two `RESCHEDULED` rows behind, each counted
once in the week it was due.

### The no-score rule

VISION §12 forbids any relationship or parenting score outright; PRD §35 permits
`Planned family commitments: 4 / Kept: 3` and says to avoid gamified judgement;
PRD §105 makes *"Product never creates family-quality score"* a hard acceptance
criterion.

So the payload is **integers and nothing else**: no ratio, no percentage, no
streak, no grade. Adding one is not a small change — a "kept %" is a score with
a different name: it sorts, it can go down, and it invites a colour scale. A
consumer that wants the ratio can divide two integers; the API doing it for them
is what would make it *the product's opinion* rather than the reader's
arithmetic. On the web side the same rule is why `FamilyWeekPanel` has no
progress bar.

`apps/api/src/family/no-score.guard.spec.ts` enforces it in three directions,
because a rule living only in review comments lasts until somebody adds a
`keptRatio` for a progress bar:

1. The **source** of every family `*.schema.ts` and `dto/*.ts`. Comments are
   exempt — explaining the rule requires naming it — but strings are not: a
   stray `qualityScore` in a `.describe()` reaches the contract.
2. The **published contract** — every `/api/family` path in the OpenAPI document
   plus every schema it transitively references. This is the direction that
   catches a field added through a DTO class rather than a Zod schema.
3. The **schemas at runtime**, which are `.strict()`.

The pattern is `/(score|quality|rating|grade|sentiment)s?\b/i` — **no leading
word boundary**, because the realistic mistake is `keptQuality`, not a bare
`score`. Two meta-tests stop the guard passing vacuously. `family.spec.ts`
repeats the check end to end over every family response and the live OpenAPI
document.

### The coach's sentence

`coachNote` is PRD §35's sentence, rendered by `summary-copy.ts`:

> Work displaced {count} {evening}family commitment{s} {period}. Do you want to
> protect those times more aggressively, or is the current trade-off
> intentional?

It **asks** rather than tells — "is the current trade-off intentional?" leaves
room for the answer "yes", which a user who chose to work late deserves.

- `DISPLACEMENT_THRESHOLD = 2`. Below two the note is `null`: one displaced
  dinner in a week is a Tuesday, not a trend, and naming it would be the nagging
  PRD §35 rules out.
- **Displaced** means a `SKIPPED` row whose `skipReason` is
  `UNEXPECTED_CONFLICT`, `BAD_TIMING` or `TOO_MUCH`, plus a `RESCHEDULED` row
  carrying a `Reflection` with one of those friction tags. The asymmetry is
  deliberate — a reschedule asks for no reason, and a move with none stated is
  not evidence that work displaced anything.
- "evening" (local hour ≥ 17) is used only when **every** displaced commitment
  was one. Saying "two evening family commitments" when one was a Saturday lunch
  is a small lie, and the point of the sentence is that the user can check it.
- **AI may rephrase it; it may not compute it.** A rephrase is discarded for the
  template when it loses the count (`text.includes(String(count))`) or matches
  `/score|quality|rating|grade/i`. A coach that quietly says "three" when the
  answer is two is worse than no coach. `source` says which the caller got.
- The rephrase cache is keyed on the **counts**, not the request window, and is
  per process. Skipping a commitment changes the counts, changes the key, and
  the user never reads a sentence contradicting the integers beside it.

Prompt version: `family-summary-note.v1`.

---

## 8. The UI map

`/path/family` is a **route under Path, not a sixth destination.** PRD §11 fixes
the five destinations and `DESTINATION_ROUTES.path` already owns `/path/family`
by prefix, so the page needs no registry entry, no navigation change and no
settings card. It is a product surface, not a settings page — do **not** add it
to `USER_SETTINGS_SECTIONS` or `ADMIN_SECTIONS`.

| Component | What it is |
|---|---|
| `FamilyPage` | Two columns at `md`: rituals + Upcoming, then people + this week |
| `RitualList` / `RitualEditor` | Cards and the sheet/dialog editor |
| `RecurrencePicker` | Monday-first weekday chips over `0 = Sunday` values, a time, a cadence |
| `FamilyMemberCards` / `FamilyMemberEditor` | Three fields, and no fourth (§2) |
| `UpcomingFamilyCommitments` | Next seven days, grouped by day, reusing `CommitmentRow` |
| `FamilyWeekPanel` | `title · Planned N · Kept N`, plus small `moved`/`skipped` text |
| `BirthdayCue` | One chip for the soonest birthday within seven days |
| `PathFamilySection` | The Path screen's link and next-occurrence list |

**Family action labels are labels.** `familyActions.ts` maps `ready` → "I'm in",
`reschedule` → "Move it", `skip` → "Skip today", and `COMPLETED` reads "Kept".
Every one posts to the endpoint the generic row posts to, and the API's
`availableActions` still decides what is offered — nothing client-side computes
what is permitted. `ready` is the one action not in `availableActions`: it is the
ordinary `PLANNED → READY` transition, and is never expected back from the
server.

The words matter because the register does. "Reschedule" is what you do to a
meeting; "Move it" is what you do to dinner with your family.

**Breakpoints.** The `md` split on `FamilyPage` and the `sm` in `EditorShell`
are local layout choices. Neither is one of the five coupled gates in
[`settings-ui.md`](./settings-ui.md) §5, and none of those is touched.

**One trap worth knowing.** `useFamilyMembers` takes an `enabled` flag and Today
waits for `/today` before fetching. A request fired at mount races the boot token
refresh: it lands before `AuthContext` has an access token, gets a 401, and
starts a second refresh whose rotation the API correctly reads as refresh-token
reuse — so it revokes the session. A birthday cue was logging the user out.

---

## 9. What E10, E11 and E12 read from here

| Epic | Reads | Must not |
|---|---|---|
| **E10** Weekly review | `GET /family/summary` for planned-versus-kept | Aggregate the counts a second way, or derive a ratio the API declines to publish |
| **E11** Momentum | The `commitments` rows themselves, like every other domain | Introduce a family-specific score (VISION §12 applies to it too) |
| **E12** Notifications | Every materialized occurrence is an ordinary `Commitment`, deep-linkable as `/?commitment=<id>&action=start` | Materialize on notification delivery — the horizon and the cron own that |

---

## 10. Rejected alternatives

- **RRULE strings for the recurrence.** The product needs three fields, and a
  UI has to render them as chips and a time picker. Parsing RFC 5545 back into
  that shape to draw a form is strictly more code than storing the three fields.
- **A Family destination in the navigation.** PRD §11 fixes the five
  destinations. A sixth would mean six `aria-current` candidates and a bottom
  bar that no longer fits its own labels; prefix ownership makes it unnecessary.
- **Per-member metrics of any kind.** A member is optional context on a ritual,
  never an axis of measurement. This is the same rule as §2 and §7, stated for
  the case somebody reaches for "how are things with Mia?".
- **A "kept %" bar on the week panel.** §7. A bar is a score with a shape.
- **Materializing on notification delivery**, or on read. The horizon plus the
  index is what makes the occurrences visible to Today, the Path, the summary
  and momentum without any of them knowing a ritual exists.
- **A free-text "important events" table** (PRD §33 lists them). Deferred to
  E10 planning — the birthday column is the whole of it for now, and a
  free-text field about another person needs the §2 conversation first.
- **A date library.** `Intl` knows the IANA database the runtime ships,
  including the half-hour zones and the 23- and 25-hour days.

---

## 11. Related documents

- [`domain-model.md`](./domain-model.md) — the `Commitment` lifecycle every occurrence goes through
- [`today-and-nba.md`](./today-and-nba.md) — how an occurrence reaches Today and what the actions do
- [`ai-gateway.md`](./ai-gateway.md) — the contract both optional AI calls here use
- [`settings-ui.md`](./settings-ui.md) — the navigation rules `/path/family` lives inside
- [`../API.md`](../API.md) §Family — the twelve routes, with request and response shapes
