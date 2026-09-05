# The AI coach, its context, and what it may remember

Epic E06 (#57). This document is the written contract for everything under
`apps/api/src/coach/` and `apps/web/src/components/coach/`: what a persona is
allowed to know, what the safety layer decides before a model is called, how a
proposed plan change becomes a `PlanVersion`, and what the user can see and
delete of what the coach remembers.

It exists for the same reason `docs/specs/today-and-nba.md` and
`docs/specs/family-domain.md` do: the rules below are cheap to break by
accident and expensive to rediscover, and several of them are properties of
code that is *not* there — a query that does not select a column, a call that
is not made — which no diff review reliably catches.

**Contents**

1. [Context scopes and budgets](#1-context-scopes-and-budgets)
2. [Safety policy](#2-safety-policy)
3. [The mutation protocol](#3-the-mutation-protocol)
4. [The coaching contract and one turn](#4-the-coaching-contract-and-one-turn)
5. [Memory tiers and user control](#5-memory-tiers-and-user-control)
6. [The Coach screen](#6-the-coach-screen)
7. [The memory settings page](#7-the-memory-settings-page)
8. [Observability, verification and extension points](#8-observability-verification-and-extension-points)

Each section was written as its child landed, on purpose: a spec assembled at
the end of an epic documents what was built, not what was decided.

---

## 1. Context scopes and budgets

*(E06-02, issue #63 — `apps/api/src/coach/context/`)*

### The rule

**Every AI call in this product takes its input from
`ContextAssemblerService.assemble(userId, scope)` and
`renderForPrompt(context)`. No call site assembles its own context from
Prisma.**

PRD §14.1 asks for one component that "builds the minimum relevant context for
each AI call"; §87 says "every AI call should receive the smallest sufficient
context". Neither is enforceable as a convention. The reason it has to be one
component is PRD §85: a memory insight the user marked *don't use for coaching*
is only reliably unused if there is a **single query that could have included
it**. Spread that filter across four call sites and the promise is one
forgotten `where` clause from being broken — and the breakage is invisible,
because the only symptom is that a prompt is one sentence longer.

### The scope table

`CONTEXT_SCOPES` (`context-scopes.ts`) is the whole of it. Sections not listed
for a scope are **not queried**, not queried-and-filtered:

| scope | sections | limit |
|---|---|---|
| `coach` | now, coachingStyle, bestSelf, domainModes, activePlans, todayCommitments, recentEvidence, recentMisses, recentReflections, memoryInsights, obstacles, recentNotificationCount | 12 000 |
| `planner` | the `coach` sections + `outcomes` | 16 000 |
| `workout` | now, coachingStyle, domainModes, activePlans, todayCommitments, recentEvidence, memoryInsights, obstacles, workout — all filtered to HEALTH; evidence to `WORKOUT_LOG`; insights to HEALTH + PATTERN | 8 000 |
| `family` | now, coachingStyle, bestSelf, domainModes, activePlans, todayCommitments, recentEvidence, recentMisses, recentReflections, memoryInsights, obstacles — domain-filtered to FAMILY; evidence **excluding** `WORKOUT_LOG`; insights to FAMILY + IDENTITY + COACHING_PREFERENCE | 8 000 |

The filters are as much the point as the section list. `workout` seeing every
domain's plans would be a privacy-shaped bug as well as a cost one: the user
asked about squats and the model was told about their marriage.

### Characters, not tokens

The budget is measured in characters of the **rendered** string. There is no
tokenizer dependency: 12 000 characters is roughly 3 000 tokens, comfortably
inside the `coach` persona's fast-tier model, and a character count is exact,
free, and identical on every runtime. A token count would be none of those and
would tie the budget to a model the administrator can change.

### The memory query

Exactly one query in the product reads memory for an AI call, and its three
conditions are the user's three promises (PRD §85):

```ts
where: {
  userId,
  userConfirmed: true,                                   // no unconfirmed guesses
  doNotUse: false,                                       // "never bring this up" means never
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], // expired stops applying, without deleting
}
```

Ordered `confidence desc, updatedAt desc`, capped at 20, then filtered to the
scope's categories.

**The same three conditions are then re-checked in JavaScript, deliberately.**
The redundancy costs three booleans per row and makes the guarantee survive a
future refactor of the query; the spec asserts it by handing the service a row
the `where` clause would have excluded.

### Truncation order

When a rendered context exceeds its budget, whole items are dropped from the
END of these lists, one section exhausted before the next begins:

```
recentReflections → recentEvidence → recentMisses → obstacles → memoryInsights
```

Every one of those lists is sorted most-relevant-first (newest first for the
four time-ordered ones, highest confidence first for memory), so "drop from the
end" is "drop the oldest, or the least confident".

**Tier 1 is absent from that order on purpose.** `activePlans` and
`todayCommitments` are the current state the coach is reasoning *about*; a
reply built without them is not a shorter reply, it is a wrong one (PRD §17).

What was dropped is reported on `context.budget.truncated`, in truncation
order, so two runs over the same rows produce the same array.

### Determinism

`renderForPrompt` takes `now` off the context object and never calls
`Date.now()`. Same rows in, byte-identical string out — which is what lets a
test assert the exact prompt rather than a fuzzy shape of it, and what makes
"did the coach get worse after we changed the prompt?" a question with an
answer (PRD §117).

### All or nothing

A failing section query **rejects** `assemble`. Callers treat that as
AI-unavailable and fall back to the deterministic path (PRD §120). A partial
context would produce confident advice built on a hole, which is worse than no
advice.

### No PII

No section query selects an email address, a display name, or a family
member's real name. The persona is told "the user" and nothing else. The
assertion in the spec is on the `select` clauses, not on the rendered string:
what cannot be fetched cannot be rendered.

### Rejected alternatives

- **Caching stable summaries (PRD §118).** The assembler is a dozen indexed
  reads and is cheap enough for V1; a cache would add an invalidation question
  to every write in the product before anyone had measured a problem.
- **Token-based budgets.** See "Characters, not tokens" above.
- **Letting each persona pass its own section list.** That is the convention
  this component exists to replace.

---

## 2. Safety policy

*(E06-06, issue #82 — `apps/api/src/coach/safety/`)*

### The rule

**Any user free text about to become an AI prompt runs through
`SafetyPolicyService.evaluate({ userId, text, surface })` first**, and the
decision it returns is recorded on `ai_invocations.safety_decision` for the call
it governed.

### Two steps, in this order, on purpose

1. **`precheck` — a pure function over a rule table.** A `definite` match is
   decided here, with no model call, and the user gets the professional-care
   copy immediately.
2. **The `safety` persona — only for the ambiguous middle.**

The ordering is a safety property, not an optimisation:

- A user typing "I have sharp chest pain when I run" is answered when the
  provider is down, when they have no API key, and when their key has run out
  of credit. A model-first design has nothing to say in exactly those cases.
- The words they read are constants in `safety-copy.ts`, reviewed once, rather
  than whatever a model produced this time.
- Ordinary coaching traffic costs nothing. "Help me plan my week" never leaves
  the process.

### The rule table

| category | definite (redirect immediately) | ambiguous (ask the model) |
|---|---|---|
| `crisis` | kill myself, suicid, end my life, self-harm / hurt myself, don't want to be alive, *quitarme la vida / no quiero vivir* | hopeless, can't go on, worthless |
| `injury` | chest pain (*dolor de pecho*), numb(ness), can't put/bear weight, sharp pain, popped in/my, heard a crack | pain, hurts, injur, tweak, sore **only when qualified** by sharp/severe/worse |
| `disordered_eating` | purg, starv, fast for N days (*ayunar por N días*), under 500–800 calories, laxative, throw up after | skip meals/lunch/dinner, eat less, lose N lbs/kg |
| `medication` | stop taking (*dejar de tomar*), my/the dose, insulin / antidepressants / blood pressure meds | medication, pills |
| `pregnancy` | — | pregnan, *embaraz*, postpartum, trimester |
| `other_medical` | — | diagnos, doctor said, condition |

Two properties of the table, both test-enforced:

- **Table order is precedence.** Crisis rules come first, so a message about
  both self-harm and a sore knee is a crisis message.
- **Ids are stable.** They go into `ai_invocations.safety_decision`,
  `coach_messages.safety_decision` and the log line. Add ids; never rename one.

### Not catching too much is the hard part

PRD §82 explicitly allows ordinary behaviour-change language. A product that
answers "my legs are sore" with a professional-care redirect is one the user
stops telling things to — which costs more safety than it buys. `sore`,
`tired` and `stressed` are therefore not rules on their own, and `sore` becomes
ambiguous only next to `sharp`, `severe` or `worse`.

### Failure leans one way

An unreachable `safety` persona turns an ambiguous message into
`conservative` — never `allow`, and never an exception. `evaluate` has no
failure mode that reaches its caller. A safety layer that can take the product
down is one somebody is eventually tempted to remove.

### The persona cannot advise

`safetyModelSchema` has exactly three keys — `decision`, `category`,
`rationale` (≤200 chars, written for a log, never rendered). The prompt says
"classify only"; the schema is what makes it true. A classifier that can also
write a sentence is a second coach with none of the coach's copy rules applied
to it, speaking on exactly the inputs where the words matter most.

### Copy rules, enforced by test

No string in `safety-copy.ts` contains "diagnos", "prescrib" or "therapist"
(PRD §81, §82). Every redirect ends with "I'm a behaviour coach, not a
clinician, and I'm here when you want to plan the next small step". The crisis
copy names local emergency services and "a crisis line in your country" and
**contains no phone number**: a wrong number is worse than none, and this
product does not know where the user is.

### Nothing logs the text

The Pino line is `safety decision=… category=… source=… surface=… rule=…` and
a spec asserts the evaluated text is absent from it.

### Rejected alternatives

- **A "restrict" tier that silently blocks.** Everything blocked is redirected
  with copy. Silence on this path reads as a bug and teaches the user nothing.
- **Region-specific hotline numbers.** See the crisis copy above.
- **Admin-editable rules or copy.** Code-only in V1: these strings are the
  product's most consequential and belong in review, not in a settings form.
- **Model-first classification.** See "Two steps, in this order".

---

## 3. The mutation protocol

*(E06-04, issue #76 — `apps/api/src/coach/proposals/`)*

### The rule

**No code path except `POST /proposals/:id/accept` turns AI output into a
`PlanVersion`.**

VISION §19 — "EvolvePath owns the plan. AI owns the coaching." PRD §15 spells
the steps out; §89 and §107 add the constraint that makes them worth having.
Creating a proposal writes one row in `plan_change_proposals` and nothing else.
Reading one runs `applyChanges` in memory and writes nothing at all.

The integration spec asserts the `plan_versions` count after create, after read
and after edit — one, every time — because "we did not write anything" is
exactly the kind of claim that rots silently, and a mocked transaction cannot
see it rot.

### The preview *is* the application

`GET /proposals/:id` and `accept` call the **same pure `applyChanges`**. Two
implementations would mean the user approves one thing and gets another, which
is the specific failure the whole protocol exists to prevent. That is also why
`applyChanges` has no Prisma, no clock and no I/O, and why an added routine
gets a `tmp:<index>` placeholder instead of a generated uuid: a preview whose
ids change on refresh is a diff the reader cannot trust.

### Six ops, not a patch document

`move`, `reduce`, `replace`, `add`, `remove`, `pause`. A small closed
vocabulary rather than arbitrary JSON, because the user has to be shown what is
about to happen in a sentence they can refuse. "Move Wednesday 18:30 to
Saturday 09:00" is reviewable; a JSON Patch against a routine row is not — and
a proposal nobody can read is a proposal everybody accepts.

Each op's `superRefine` rule exists to reject a change set that would *look*
right in a diff and do the wrong thing. The sharpest is `reduce`: an `after`
duration greater than or equal to `before` is refused, because a "reduce" that
increases the load is the one wrong answer a user is most likely to accept
without reading — it is the op they asked for, so only the number contradicts
it.

`reason` is required on every change and bounded at 200 characters. PRD §80
wants version history to carry why the plan changed, and the only moment that
reason exists is when the change is proposed.

### What accept does, atomically

1. Conditionally claims the proposal (`status IN (PROPOSED, EDITED)`), so two
   tabs racing produce exactly one winner.
2. `PlanVersionsService.createAndActivateInTx` — supersede the current version,
   insert the next one already `ACTIVE` and `userApproved`, write its routines.
   It lives in `PlanVersionsService` so version numbering, lineage and
   supersede-before-activate stay in the one service that owns them; a second
   implementation of "what is the next version number" is how histories develop
   gaps. **It never passes through `DRAFT`**: this version was never a proposal
   the user might still edit — the accept call *is* the approval.
3. Applies the commitment effects.
4. Points the proposal at the version it produced.
5. Writes a `SYSTEM` coach message ("Plan updated to v2.") when the proposal
   came from a conversation, so re-reading the thread shows what it caused. The
   coach did not say this, and the role records that.

The audit row (`plan:change_accepted`) is written **after** the commit, per the
repo's side-effects-outside-transactions rule.

### `rescheduleCount` is not incremented

A future commitment whose routine moved is rescheduled in place — same id, so
any evidence or reflection already attached to it survives (PRD §103) — and
`rescheduleCount` stays where it was. That column counts how often the **user**
pushed something, and E07 reads it as a friction signal. A change the user
deliberately chose is not the same fact.

A commitment whose routine was removed or paused is `CANCELLED` with
`skipReason: 'plan_change'`. Past commitments and evidence are never touched:
evidence is a fact about what happened, and a plan change cannot unhappen it.

### Attribution follows who wrote the content

`createdBy: AI` for an accepted proposal, `createdBy: USER` for one the user
edited first — whatever suggested it originally. `originalChanges` is stored
once, on the first edit, so the record of the AI's suggestion never becomes a
record of the user's first draft.

### Expiry is lazy

`PROPOSAL_TTL_DAYS = 7`, a constant rather than an env var: how stale advice may
get is a product decision, not a deployment knob. A stale proposal becomes
`EXPIRED` the first time anyone reads it. There is no sweeper — a row nobody
reads costs nothing, and a cron that rewrites user data on a schedule is a much
larger thing to own than a `WHERE` clause.

### Rejected alternatives

- **`POST /proposals`.** A route that accepts a change set from a browser lets
  a client author a plan version and label it `AI`.
- **A JSON Patch / arbitrary diff format.** See "Six ops".
- **Threading `tx` through `createDraft` + `activate`.** Two status writes and a
  "one draft at a time" check that has nothing to say on this path, in exchange
  for reusing methods whose shape does not fit. One purpose-built method inside
  the same service keeps the invariants together without the ceremony.
- **403 for a foreign proposal.** The repo answers 404 everywhere
  (`path/owned-resource.ts`): a 403 confirms the id exists.

---

## 4. The coaching contract and one turn

*(E06-03, issue #70 — `apps/api/src/coach/`)*

### The reply is an object, not prose

PRD §16. `coachReplySchema` (`contracts/coach-reply.contract.ts`) is the whole
of what a coach reply may be. Two fields carry most of the weight:

- **`reasoning_summary`** is what "Why this?" shows: one or two sentences about
  *why this action, from the context*. It is bounded at 400 characters
  specifically so it cannot quietly become a transcript of the model's working
  — chain of thought is never stored and never shown (PRD §16, §88).
- **`intervention_type`** makes every reply classifiable against PRD §26's
  ladder and VISION §21's modes. E11 asks which kinds of coaching actually move
  behaviour, and that question is only answerable if each reply labels itself.

Everything optional is `.nullable()`, never `.optional()`: the gateway emits
`strict: true` schemas where every declared property is required, and
`toOpenAiStrictSchema` turns an optional property into a nullable required one.
`.nullable()` is the shape that round-trips losslessly.

### The order of a turn

1. Resolve the conversation (creating one titled from the first 60 characters
   of the message — asking a model to name the thread would put a second AI
   call on the critical path of a screen whose promise is that it works when
   the model does not).
2. Validate attachments against the caller's own ready `storage_objects`.
3. Persist the USER message.
4. **Safety** (`SafetyPolicyService.evaluate`). A `redirect` returns the
   professional-care copy and **never calls the coach persona**.
5. Assemble the context (§1) and the last 10 turns as plain text — never
   `structured`, never the whole thread (PRD §17 Tier 4).
6. Invoke the `coach` persona with `coach.v1` and the safety decision.
7. **Guard** (`coach-output-guard.ts`).
8. A `proposal` becomes a `PlanChangeProposal` row (§3), pointed at the coach
   message so accepting it can drop a SYSTEM notice back into the thread.

Steps 4, 7 and 8 exist to be hard to remove, and each is asserted by a test:

- **Safety runs before the model**, so the copy a user in trouble reads is a
  constant that still answers when the provider is down.
- **The guard runs before the user.**
- **A proposal is a row, not a change.**

### The guard

PRD §90 names the failures: a fabricated completion, an incorrect active plan,
an invented schedule conflict. `guardCoachOutput` checks that every id in the
reply — `recommended_action.commitmentId`, `proposal.planId`, every
`changes[].target.id` — belongs to this user and to that plan, and that a reply
does not carry both a `proposal` and a `friction_question` (two questions, one
place to answer).

**The prompt asks and the guard enforces, and that is not redundant.** A prompt
is a request a model may decline under pressure — an ambiguous question, an
unusual context, a new model version — and the failure it produces is the worst
one this product has: a confident, specific, plausible sentence about something
that did not happen. A reader cannot tell that apart from a true one.

The guard is id-only and never reads the message text. Judging prose is what
the model was for; a guard that tried would be a second unreliable classifier
in front of the first.

A guard failure updates the `ai_invocations` row to `invalid_output` with
`errorCode: 'hallucination_guard'`, so "how often does the coach invent things?"
is a question about the model answered where questions about the model live.

### Always 201

Every provider failure, schema violation and guard rejection is a readable
coach message plus `degraded: true`. PRD §120's promise is "the screen still
works", not "the API fails quickly".

`structured` is **null** on a degraded turn. A template fallback is
deliberately indistinguishable from "no model output", because that is what it
is — a client that could tell them apart would start rendering a fake
intervention type.

### What never reaches the client

- `invocationId`. It is a support handle; a client that had it would turn it
  into an API.
- The safety decision's `matchedRule` and `promptVersion`. Audit fields — a UI
  rendering them would be showing the user our regex names.
- Anything resembling chain of thought. See `reasoning_summary` above.

### Rejected alternatives

- **A model-written conversation title.** A second AI call on the critical path
  of the one screen that must survive an AI outage.
- **Synthesising a `structured` object for fallbacks.** See "Always 201".
- **A guard that reads the message text.** See "The guard".
- **403 for a foreign conversation.** The repo answers 404 everywhere.

---

## 5. Memory tiers and user control

*(E06-05, issue #78 — `apps/api/src/coach/memory/`)*

### Two booleans, two questions

`userConfirmed` is **"the user says this is true"**. `doNotUse` is **"the user
says never bring this up"**. Neither is the other's negation, and an insight can
be both true and forbidden — the obvious case being an accurate observation
about something the user does not want coached on. One flag would force the
product to guess which the user meant.

The assembler's query (§1) reads both: `userConfirmed: true, doNotUse: false`.
That is what makes "the coach uses only what I approved" and "never bring this
up" real rather than aspirational.

### Forget is a hard delete

PRD §85 and §127. Soft-hiding would leave a row saying something about a person
who asked for it to be gone. The audit row records **the category and nothing
else** (PRD §86): the user asked us to forget the sentence, and copying it into
an audit table is not forgetting it.

A *forgotten* insight may legitimately be proposed again later — it is gone, and
the evidence for it may still be there. A *do-not-use* insight is never
re-proposed: that one is an answer, and re-asking would be the product ignoring
it. That asymmetry is why the proposer's dedupe query reads **every** insight,
including excluded ones, while the assembler's reads only permitted ones.

### Editing is confirming

"This, but in my words" is agreement. An edit that left the insight unconfirmed
would mean the coach still ignored the sentence the user had just written.

### The proposer sends counts

`aggregateStats` (`pattern-stats.ts`) produces completion rates by domain,
weekday and time-of-day bucket, a reschedule histogram, fallback-size usage, the
mean planned-versus-logged gap, and a skip-reason histogram. **No titles, no
reflection text, no skip notes, no names.**

That is a privacy decision and a quality one. The `pattern_analyst` persona is
the one that writes durable sentences about a person, so it is the one that must
be given the least to work from; and free text would let it produce a statement
quoting something the user wrote once, which is both more intrusive and less
durable than "morning commitments are kept more often than evening ones".

Time-of-day buckets use the **user's** wall clock. A 23:30 UTC completion by
someone in `America/Costa_Rica` happened at 17:30, and filing it under "evening"
would produce a durable statement about that person which is simply false.

`pattern-stats.ts` has no Nest and no Prisma in it, because E11's momentum
engine replaces its implementation and keeps its shape.

### Observation and inference are two fields

`insightProposalSchema` requires both (PRD §14.4). The *observation* is the fact
— "12 of 15 kept commitments were before noon"; the *statement* is the durable
inference the coach would act on. Collapsing them would let an inference be
stored with nothing to check it against, and PRD §10.12 requires the user to be
able to approve or reject it knowing which is which.

At most five. A screen of twenty "insights" is not something anybody reviews; it
is something everybody dismisses.

### Nothing here is an error

Fewer than `MIN_SAMPLE` (10) decided commitments → `skipped: 'insufficient_data'`
with **no model call**: a week of history cannot support a statement about how
somebody works, and asking anyway would produce a confident one. A provider
outage → `skipped: 'ai_unavailable'`. A proposer that cannot run is not a broken
screen.

AI insights are created `userConfirmed: false` with a 90-day `expiresAt`
(`INSIGHT_TTL_DAYS`), so an unconfirmed guess about someone stops applying on
its own without being deleted behind their back.

### The notification

`memory.insight_proposed` is **browser only, deliberately not push**. It is an
invitation to sit down with a settings page and read several sentences about
yourself — the opposite of a moment-bound cue, and a phone buzz would ask for
attention it cannot use. Its body carries the **count and nothing else**:
putting the statement in the notification would show the user a durable claim
about themselves before they had any way to disagree with it.

### Throttling

One run per ten minutes per user, through `TestThrottle`'s `memory_propose`
bucket. Clicking it twice cannot produce a different answer, so the bound is
about the cost of the run, not the pace of the UI. `TestThrottle` gained
per-bucket windows for this rather than the four existing buckets being
rewritten around a fifth that wanted a different one.

### Rejected alternatives

- **A single "approved" flag.** See "Two booleans".
- **Soft-deleting on Forget.** See "Forget is a hard delete".
- **Sending the assembler's context to the pattern analyst.** It carries free
  text; this persona must not have any.
- **A cron proposer.** E10's weekly review calls `proposeInsights`; a schedule
  that generates claims about people unprompted is a larger thing to own.

---

## 6. The Coach screen

*(E06-07, issue #86 — `apps/web/src/pages/CoachPage.tsx`,
`apps/web/src/components/coach/`)*

### Layout at the `sm` boundary

`CoachPage` uses `useMediaQuery(theme.breakpoints.down('sm'))`. **This is a
page-local layout choice, NOT one of the five coupled breakpoint gates** listed
in `CLAUDE.md` (`Layout`'s `showRail`, `BottomNav`'s self-gate, `<main>`'s
padding, `SettingsHub`'s and `AppBar`'s compact checks). Nothing here mounts or
unmounts navigation, changes `<main>`'s padding, or touches the rail — it only
decides whether the list and the conversation are one screen or two. The same
is true of `ProposalCard`'s `dense` flag.

Below `sm` the two are separate **screens**, not a drawer: a 280 px panel over a
375 px window leaves less room for the thing the user came to read than the
panel takes. `/coach` is the list, `/coach/:conversationId` is one thread with a
back arrow. Above `sm` they sit side by side.

`DESTINATION_ROUTES.coach` already owns the `/coach` prefix, so the
per-conversation route needed no registry change — and that prefix ownership is
what stops the rail going blank the moment a user opens a conversation.

### The optimistic bubble

A coaching turn takes seconds, and a user who types a sentence into an empty
screen assumes it did not send. `useCoachChat` inserts the USER message
immediately with `status: 'pending'`, replaces it with the server's pair when
the reply arrives, and on failure leaves it `status: 'failed'` **with the text
intact** — a retry that lost what the user wrote is not a retry.

Temp ids are prefixed `tmp-` and are never sent to the API. They are a React key
and the row `send` replaces, and nothing else.

### The proposal card

PRD §15's three buttons, and nothing that could be mistaken for a fourth:
**Accept**, **Edit**, **Keep current plan**. The last is worded that way on
purpose — the user is choosing between two plans, one of which is already
theirs, and a dismissive verb would make declining feel like a failure to
comply.

After a decision the buttons are replaced by a chip carrying **text**, not
colour alone: "Plan updated (v2)" (linking to `/path`) or "Kept current plan".

`EditProposalDialog` edits time, day and duration — deliberately not a JSON
editor. The point of Edit is "yes, but at ten", not "let me author a change
set"; anything the dialog cannot express is a conversation with the coach.

`PlanChangeDiff` is exported because E10's Weekly Review renders the same
`DiffEntry[]` from the same protocol — one component, so a plan change looks
identical wherever the user is asked about it.

### "Why this?", safety and degradation

`WhyThisExpander` shows `reasoning_summary` and nothing else, and is **absent
when `structured` is null** — which is exactly when the reply was a template,
so there is no reasoning to explain. That is the client-side consequence of §4's
"a fallback is indistinguishable from no model output".

`SafetyNote` renders `userFacingNote` as `severity="info"`, not `warning`: the
message is "this belongs with someone qualified", and an alarming banner would
read as the app being broken rather than as the app being careful.

### Accessibility

- The message area is `role="log" aria-live="polite" aria-relevant="additions"`:
  a screen reader hears the reply arrive, not the whole conversation re-read.
- New messages **scroll, never focus**. Moving focus on every arriving message
  would yank a keyboard user out of whatever they were reading or typing.
- The conversation list is `ListItem` + `secondaryAction`, not a delete button
  inside the row button. The nested form traps keyboard users (tabbing to
  Delete also selects the conversation) and is what `axe`'s
  `nested-interactive` rule exists for.
- Status is never colour alone; every chip carries its own words.

### Not built here

- **Attachments.** The composer has no attach button, because
  `MediaAttachmentPicker` and the `MediaAttachment` model (E03) do not exist
  yet. `sendCoachMessage` already takes `attachmentIds` and the API validates
  them against the caller's own ready `storage_objects`, so the picker is the
  only missing piece.
- Editing or deleting individual messages, renaming a conversation, markdown in
  replies, conversation search.

---

## 7. The memory settings page

*(E06-08, issue #90 — `/settings/ai-memory`)*

### A registry card, not a tab

`USER_SETTINGS_SECTIONS`'s AI section gains an **AI Memory** card, per
CLAUDE.md's settings rules. "What does the coach remember about me?" is a
different question from "which key pays for it" — a destination gate is about
reachability, a tab gate is about content, and these are not two views of one
question. The card carries **no `permission`**: an insight is the caller's own
row and the controller answers 404 for anyone else's, so an invented permission
string here would be exactly the drift rule 3 warns about.

### Excluded insights are listed

This page is the one place a `doNotUse` insight must remain visible. "Don't use
this for coaching" hides a sentence from the coach, **not** from the person it
is about — so `useMemoryInsights` always asks with `includeDoNotUse: true`.

### Confidence is words

`likely` (≥ 0.7), `possible` (≥ 0.4), `tentative` below. **Never a number and
never a percentage.** "0.72" invites the reader to treat a heuristic as a
measurement and to argue with the second decimal place; "likely" says the only
thing the number actually supports. VISION §12's objection to scores applies
here as much as it does to the family summary.

### The switch carries the statement

`aria-label` is `Use "<statement>" for coaching`. A screen-reader user moving
through eight rows of identical "Use for coaching" toggles has no way to tell
which sentence each one governs.

### Forget asks first

The server delete is hard, so the dialog says "This can't be undone. The coach
keeps no copy." That sentence is the difference between an informed choice and
a surprise.

### Every proposer outcome is copy

`insufficient_data` → "Not enough history yet…", `ai_unavailable` → "The coach
is unavailable right now…", HTTP 429 → "Insights were proposed recently. Try
again in a few minutes." The throttle branch reads `ApiError.status`, not the
message text — a copy change on the server would otherwise silently turn it
into the generic line.

### Layout

`MemoryInsightRow` uses `useMediaQuery(down('sm'))` to move its actions into an
overflow menu on phones. Page-local, like `CoachPage`'s — the five coupled
breakpoint gates are untouched.

---

## 8. Observability, verification and extension points

*(E06-09, issue #93)*

### What is recorded, and where

| fact | home |
|---|---|
| every model call: persona, prompt version, model, tokens, latency, validity | `ai_invocations` |
| the safety decision that governed a call | `ai_invocations.safety_decision` (jsonb) |
| the decision the user was shown | `coach_messages.safety_decision` |
| a reply the guard refused | `ai_invocations.status = 'invalid_output'`, `errorCode = 'hallucination_guard'` |
| what the user decided about a plan change | `plan_change_proposals.status` + `audit_events` (`plan:change_accepted` / `plan:change_rejected`) |
| what the user did to memory | `audit_events` (`memory_insight:create|edit|confirm|do_not_use|forget|propose`) |

Spans: `coach.context.assemble` (scope, size, truncated sections — never
content), `safety.evaluate` (decision, category, source, rule), `coach.send_message`,
`proposals.accept`, `memory.propose`.

**Three things never reach a log, a span or a response body:** the evaluated
text on the safety path, anything resembling chain of thought, and
`invocationId` on the wire.

### The end-to-end proof

`tests/e2e/specs/coach.spec.ts` drives PRD §68's sentence through the browser,
the API and the database, on both Playwright projects. Its central assertion is
a **count taken three times** — `plan_versions` before the proposal, after the
proposal, and after the accept — because PRD §89/§107 is a claim about a write
that *doesn't* happen, and nothing but a count can see one of those.

The fake OpenAI stand-in answers in character
(`tools/fake-openai/scenarios/index.mjs`, documented in
[`docs/TESTING.md`](../TESTING.md#scenarios-epic-e06)) and reads the plan,
routine and commitment ids back out of the rendered context. A canned proposal
carrying invented ids would be rejected by the guard, and the suite would then
prove only that the guard works.

That is why `renderForPrompt` emits `planId=`, `routineId=` and `commitmentId=`
lines: not for the fake server's benefit, but because the guard forbids a reply
from naming an id the context did not contain — so a context without ids makes
a proposal and a "Start 10 min" action impossible to produce at all.

### Extension points

- **E09 (workout).** `CONTEXT_SCOPES.workout` and the `workout` section already
  exist; fill `context.workout` and add a `workout_programmer` scenario. Plan
  changes go through `ProposalsService.createFromSource(userId, 'WORKOUT', …)`
  — the protocol is unchanged.
- **E10 (weekly review).** Add a `weekly_review` scope to `CONTEXT_SCOPES`, and
  create proposals with `sourceKind: 'WEEKLY_REVIEW'`. The Weekly Review screen
  imports `PlanChangeDiff` from `components/coach/`, so a plan change looks
  identical wherever the user is asked about it. It also calls
  `PatternAnalysisService.proposeInsights`.
- **E11 (momentum).** Replace `pattern-stats.ts`'s implementation and keep its
  shape; it has no Nest and no Prisma in it for exactly that reason.
- **E07 (obstacles).** The `obstacles` table exists and the coach reads it;
  E07-03 is what writes to it and appends `interventionHistory` entries.

### Rejected alternatives (the whole epic)

- **Streaming the reply first.** The contract is one validated JSON object, and
  streaming can be layered on later without changing it. Streaming *first*
  would have meant shipping a coach whose output nothing validated.
- **Letting the model call a "mutate plan" tool.** The single most consequential
  decision in this epic. VISION §19 — EvolvePath owns the plan — is only true
  if there is no code path from model output to a `PlanVersion` that does not
  pass through a human's HTTP call.
- **Storing memory as free text on the user row.** It could not be listed,
  confirmed, excluded or forgotten one sentence at a time, which is the whole of
  PRD §85.
- **Soft-deleting a forgotten insight.** A row that says something about a
  person who asked for it to be gone.
- **A shared breakpoint constant for the coach layout.** `CoachPage` and
  `MemoryInsightRow` choose a layout; the five gates in
  `Layout`/`BottomNav`/`SettingsHub`/`AppBar` mount and unmount navigation.
  Binding them to one constant would make an unrelated page's layout tweak able
  to move the bottom bar.
- **Model-first safety classification.** See §2.
- **A cron memory proposer.** See §5.
