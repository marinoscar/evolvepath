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

> Sections are added by the E06 children as they land. This file is written
> incrementally on purpose: a spec assembled at the end of an epic documents
> what was built, not what was decided.

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
