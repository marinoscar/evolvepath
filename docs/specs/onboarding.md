# Onboarding: Best Self → first Path

**Epic E04 (#99).** Issues #100 (schema), #101 (API), #102 (wizard), #104
(proposal review), #106 (route gate), #107 (this document and the e2e).

Sources: VISION Part XIV (§43 "Start With the Person, Not the Habits", §44
"Progressive Profiling", §50); PRD §19–§21 (the nine screens), §70–§72 (the
three-behaviour cap and the confidence check), §101–§102 (Day 0 and the
acceptance list), §15 (the mutation protocol), §120 (works with the provider
down), §123 (mobile first).

This file records decisions and what was rejected. `docs/API.md` → Onboarding is
the reference; `CLAUDE.md` is the index.

---

## 1. What this epic promises

A brand-new user goes from "Become who you want to be." to an **approved,
persisted first Path** in five to eight minutes: a Best Self statement, one
outcome per selected domain, at most three behaviours for the first week, a
coaching style, a notification decision, and a first next action on Today.

Two sentences carry the whole design:

> **Answers are saved per step. The plan is not saved at all until it is
> approved.**

- **Per step**, because PRD §19 gives this five to eight minutes on a phone and
  a phone locks. A wizard holding its answers in React state loses them to a
  notification, and the user starts again — once.
- **Not at all**, because PRD §15 says AI output becomes a plan only through a
  human approval. Everything before `POST /onboarding/approve` lives in one JSON
  column.

---

## 2. The nine screens

`user_profiles.onboarding_step` is the enum; the client sends the step it is
moving **to**, so a refresh reopens where the user actually is.

| # | Step | Screen | Saved by |
|---|---|---|---|
| 1 | `PROMISE` | "Become who you want to be." + `Build my Path` | `POST /onboarding/start` with the browser's timezone and `navigator.language` |
| 2 | `VISION` | "If the next six months went well, what would be different?" (≥ 20 chars) | `{ step: 'DOMAINS', sixMonthVision }` |
| 3 | `DOMAINS` | Work / Family / Health cards; selecting one expands its reflection field | `{ step: 'REALITY', domains, domainReflections }` |
| 4 | `REALITY` | "What usually gets in the way?" — eight chips | `{ step: 'TIME', obstacles }` |
| 5 | `TIME` | Minutes on a normal weekday, 10–120 | `{ step: <6 or 7>, weekdayMinutes }` |
| 6 | `HEALTH_BASELINE` | **Only when Health was selected** | `{ step: 'COACHING_STYLE', healthBaseline }` |
| 7 | `COACHING_STYLE` | Gentle / Balanced / Direct | `{ step: 'PROPOSAL', coachingStyle }` |
| 8 | `PROPOSAL` | "Your first Path" — review, adjust, confidence, `Start this Path` | `propose` / `confidence` / `approve` |
| 9 | `NOTIFICATIONS` | The value exchange, then the browser permission | nothing (client-only) |

`DONE` is set by `approve` and by nothing else. `PATCH /onboarding/answers`
**rejects `step: 'DONE'`**: a client that could patch its way there would have a
completed account with no Path in it.

The stepper counts the steps **this** user sees — eight without Health, nine
with — because announcing "step 5 of 9" to somebody who will only ever see eight
is a lie the flow tells about itself.

### Two things the screens deliberately do not do

- **No voice input** (PRD §125 is P1). The vision field leaves room for a mic
  button and ships none; half a feature here is worse than none.
- **`OTHER` on step 4 is a chip with no text field.** `user_profiles.obstacles`
  is `String[]` of stable keys on purpose — E07 groups avoidance patterns on
  them and free text would split every cohort — and no other column means "the
  obstacle they described". A field whose contents are dropped on the next
  request is worse than not asking: the user believes they have told us
  something. The sentence belongs to E06's memory, once there is a coach to say
  it to.

---

## 3. The proposal contract

`apps/api/src/onboarding/onboarding-proposal.schema.ts`. **One shape, three
producers**: the planner persona fills it in, the deterministic template fills
the same thing in, and the user's edited copy comes back through it at approve.
Everything downstream reads exactly one type, so "the coach is down" changes
where a proposal came from and never what a proposal is.

```
bestSelf            identityStatement, work/family/healthIdentity, sixMonthVision
outcomes[]          domain, title, whyItMatters, successDefinition       (max 3)
routines[]          domain, title, triggerType, triggerValue, frequency,
                    idealMinutes, minimumMinutes, fallbackBehavior       (max 3)
firstWeekCommitments[]  domain, title, scheduledStart, durationMinutes,
                        full/short/minimumVersion                    (1 … 12)
rationale
reducedFromRequest
```

It is also the gateway's `schema` (`schemaName: 'onboarding_proposal'`,
`promptVersion: 'onboarding-proposal.v1'`), so the model is asked for these keys
through structured output rather than through a sentence in a prompt asking
nicely. Plain keys, no unions, no records — `toOpenAiStrictSchema` cannot express
either — and `.nullable()` over `.optional()`, because the converter turns an
optional property into a nullable required one anyway.

`triggerType` is a **proposal-level** vocabulary (`AFTER` / `AT_TIME` /
`WEEKDAYS`), not the database's `TIME | EVENT`. It is the three-way distinction
a person recognises when they read their own plan; the approve path is the one
place the two vocabularies meet.

### The guardrails

`onboarding.guardrails.ts`, pure, applied to **all three sources**:

| Rule | Why |
|---|---|
| At most one outcome per selected domain, and only selected domains | A first Path is what the user asked for, not what the model found interesting |
| `routines.length <= 3` | PRD §70. A first plan with five habits is a plan abandoned in week two |
| `minimumMinutes <= idealMinutes` | A minimum longer than the full version is not a fallback |
| Every `scheduledStart` in `[today − 1 day, today + 8 days]` **in the user's timezone** | "The first week" means the first week |
| Commitment domains ⊆ selected domains | As above |
| No single local day above `weekdayMinutes`, when answered | Step 5 asked; ignoring the answer makes asking dishonest |

A day behind and eight days ahead rather than a clean seven: a user onboarding
at 23:50 should still be offered this morning's routine, and "the next 7 days"
counted from a local date needs a day of slack for the zone the instant lands in.

**A violation is never corrected.** Model output that breaks a rule is discarded
whole and answered as a schema failure; an edited proposal that breaks one is a
400 with `details.rules[]` the review screen renders under the offending section.
A plan the server quietly fixed is a plan the user approves believing the coach
wrote it.

---

## 4. The template (PRD §120)

`onboarding-templates.ts`, pure, and **never reaches the gateway**. PRD §120's
"works with the provider down" means an approved Path, not an apology with a
retry button — so this produces the same `OnboardingProposal` the planner does,
from the only things the server knows without a model: which domains the user
picked, how many minutes they said they have, and what day it is where they are.

Per selected domain: Work — "Start the most important task before email"
(Mon/Wed/Fri, 25 / 10 min, fallback "Open the task and write the first
sentence"); Family — "Phone-free dinner" (Tue/Thu/Sun, 30 / 10, "Ten minutes of
undivided attention"); Health — "Three 30-minute strength sessions"
(Mon/Wed/Sat, 30 / 10, "A 10-minute walk"), with the user's `healthBaseline`
days capped at three.

**Domains landing on the same day share that day's minutes.** A per-routine
clamp cannot see that Work and Health both want Monday, and a three-domain user
with 45 minutes a day would get a plan the guardrails then reject — a fallback
that cannot be approved is an outage with extra steps.

It is **honest about being a template** in its own `rationale`, and the review
screen shows a chip saying so. A generic plan presented as a bespoke one is
worse than an outage: the user follows it believing a coach wrote it.

---

## 5. The confidence loop (PRD §72)

*"How confident are you that you can do this in a difficult week?"*, 1–5, asked
before the plan is activated and **required** before `Start this Path` enables.

- **1 or 2** replaces the pending proposal with a smaller one, by the route it
  came from: an AI proposal is re-proposed with the reduce instruction and the
  previous plan in the input; a template is reduced arithmetically — drop the
  routine costing the most minutes a week, halve the rest with a ten-minute
  floor.
- **3 and above** stores the score and changes nothing.

Two decisions inside that:

- **Drop the heaviest, not the last.** The user said the week is hard; the
  honest answer is one fewer thing, not the same three things rushed.
- **Outcomes survive a reduce.** The user still wants to be present at dinner;
  what shrank is what they committed to doing about it this week. Dropping the
  outcome as well would read as "we decided that area does not matter".

The client discards its local edits on a re-proposal and says so in a snackbar
("I made it smaller — take another look"). Merging them into a plan the coach
deliberately made smaller would undo the reduction the user just asked for. A
second low answer reduces again but the UI proceeds rather than looping.

---

## 6. Approve

`POST /onboarding/approve` is **the only path in this flow that turns the
proposal into rows**, and it is one `prisma.$transaction`:

1. `best_self_profiles` — upserted from `proposal.bestSelf`
2. per outcome: `outcomes`, its `plans` row, `plan_versions` v1 `{ status:
   ACTIVE, userApproved: true, createdBy, rationale, expectedWeeklyLoad,
   fallbackStrategy }`
3. per routine: `routines` under that domain's version
4. per commitment: `commitments` `{ status: PLANNED }` with all three versions
5. `domain_modes` `GROW` for every selected domain
6. the profile: `onboardingStep = DONE`, `onboardingCompletedAt`,
   `pendingProposal` cleared

Then, **after** the transaction, one `onboarding:approved` audit row carrying
`{ source, outcomes, routines, commitments, edited, confidenceScore }` — counts,
never content. Inside the transaction it would be rolled back with the thing it
is evidence of; before it, it would describe a Path that does not exist.

Three rules that are easy to break:

- **`source` is read off the stored row, never the request body.** It is what
  `plan_versions.created_by` is set from, and a client claiming `'ai'` would put
  the coach's name on a plan it never wrote.
- **A commitment is linked to its routine by TITLE.** The contract has no ids in
  it, because a model inventing one would point a commitment at another user's
  routine.
- **The second approve is a 409, not a silent no-op.** A client that raced two
  submits needs to be able to tell which one built the Path; a silent success
  would return a second set of ids for rows that were never created. The UI
  treats 409 as "already done" and navigates to `/`.

A guard worth keeping: the audit row's keys are asserted against
`Prisma.AuditEventScalarFieldEnum` in `onboarding.service.spec.ts`. A mocked
Prisma accepts any key, which is exactly how `userId` — a column
`audit_events` does not have — once reached a live database and 500ed **after**
the whole Path had already been written.

---

## 7. Gating

Three questions, three layout routes, one order. The table and the exemptions
live in [`settings-ui.md` §5b](./settings-ui.md); from the onboarding side:

- `/onboarding` sits **inside** `RequireAiKey` and **outside**
  `RequireOnboarding`. Step 8 asks the coach for a plan, so a user without a key
  must fix that first; and a gate that redirected its own destination would loop
  forever.
- `OnboardingPage` sends a **completed** user to `/`, so the exemption cannot be
  used to re-run onboarding. (A deliberate "Reset my Path" belongs to E10
  planning.)
- A `/auth/me` that does not report `onboarding` is treated as **onboarded**,
  with one `console.warn`. The alternative is a redirect loop for every user of
  a newly-deployed web app against an older API.
- Gating is **UX, not authorization**. Every route stays independently
  authorised; deleting the component would make the app confusing, not insecure.

---

## 8. Testing

- **API**: `src/onboarding/*.spec.ts` (contract + guardrails, templates across
  every domain subset and four timezones, the planner call, the service) and
  `test/onboarding/onboarding.integration.spec.ts`. The two assertions no other
  kind of test can make: `propose` calls no `outcome.create` /
  `commitment.create` / `planVersion.create`, and the second `approve` creates
  nothing.
- **Web**: `__tests__/pages/OnboardingPage.test.tsx`,
  `__tests__/hooks/useOnboarding.test.ts`,
  `__tests__/components/onboarding/ProposalStep.test.tsx`,
  `__tests__/components/common/RequireOnboarding.test.tsx`, and the route-order
  block in `__tests__/App.test.tsx`. All driven through the real hook against
  the **stateful** MSW store in `__tests__/mocks/onboardingHandlers.ts`, which
  enforces what the API enforces — merge-patch semantics, `step: 'DONE'` → 400,
  `propose` writing nothing but a proposal, a second `approve` → 409.
- **E2E**: `tests/e2e/specs/onboarding.spec.ts`, seven cases on both projects.
  See `docs/TESTING.md` for how to run it.

The **test-login switch**: `withOnboarding` on `TestLoginDto` defaults to
**true**, so every pre-existing spec keeps landing on `/`. An unchecked HTML
checkbox sends nothing, so "absent" cannot mean both "the default" and "the user
unticked it" — `TestLoginPage` therefore pairs the checkbox with a hidden
`withOnboarding=false` **before** it, the standard HTML idiom, and the DTO takes
the **last** value.

---

## 9. Rejected alternatives

**The proposal as `outcomes` / `commitments` rows with a `draft` flag.**
Rejected: every list query in the product would become responsible for
remembering to filter it out, and the one that forgot would show a user a plan
they never approved. One JSON column on the profile has exactly one reader.

**Onboarding state in `user_settings` JSONB.** Rejected: E05 needs `timezone`
typed (every "today" in the product resolves through it) and E12 needs quiet
hours as columns. A settings blob would make both a parse at every read site.

**A `useAi: false` flag on `POST /onboarding/propose` instead of a separate
`skip-ai` route.** Rejected for the reason E07's planner splits the same way: it
puts "should the coach have been asked?" into a request body, where a client bug
turns "the provider is down" into "the coach silently got worse".

**Correcting a proposal that breaks a guardrail.** Rejected: the user would be
approving our edit. Model output is discarded whole; an edited proposal comes
back as a 400 naming the rule.

**A silent no-op on the second approve.** Rejected: see §6.

**Editing outcomes and routines on the review screen.** Rejected for this epic:
the user is agreeing to a direction, and the thing they realistically need to
change before pressing the button is *when* it happens. Editing an outcome
belongs on the Path screen (#56), where there is room to think about it.

**A shared inline error on the proposal screen.** Rejected: it would flatten
"the coach is unavailable, continue without it" into the same sentence as "that
did not save". 412, 503, 400 and 409 each have their own state.

**`@mui/x-date-pickers` for the commitment time.** Rejected: the dependency is
not in this app, the `[today − 1, today + 8]` bounds are the whole validation,
and on a phone the native `datetime-local` picker is the one the user already
knows.
