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
