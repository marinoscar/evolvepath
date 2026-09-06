# Account Data Reset — the "Danger zone"

**Epic E13 (#220)** · issues #221–#226 · PRD §84, §86, §127 · VISION §49

The written contract for everything under `apps/api/src/account/`, the
`account.data_reset` notification, and the `/settings/reset` destination
(`apps/web/src/pages/UserDataResetPage.tsx` and
`apps/web/src/components/settings/ConfirmPhraseDialog.tsx`). Read this before
changing the table list, its order, the retention boundary or the confirmation
phrases.

Related: [`domain-model.md`](domain-model.md) for the `SetNull` rules this
feature has to work against, [`media-attachments.md`](media-attachments.md) for
what deleting an upload actually removes, and
[`ai-configuration.md`](ai-configuration.md) §7 for the credential address the
key purge reaches.

---

## 0. The one promise this feature is built around

**This is a data reset, not an account deletion.** The `users` row survives, and
so do its OAuth identity, its role assignments, its allowlist entry, its
`refresh_tokens` and its `push_subscriptions`. A person who finishes a reset is
still signed in, on every device they were signed in on, and lands back in the
application rather than on a sign-in screen.

That is a deliberately narrower promise than "delete my account" would make, and
it is what makes every other decision in this document coherent. Two consequences
follow immediately and are stated wherever they apply:

1. **Deleting the account is out of scope**, not a bigger version of this. It has
   its own consent and allowlist implications and would be a different feature.
2. **A reset is strictly weaker than a deletion**, so any row whose schema says
   it must outlive a *deleted* account has an even stronger claim to outlive a
   reset. §5 applies that rule three times rather than re-deriving it.

## 1. The problem

Every per-user table in EvolvePath accumulates for the life of the account —
`outcomes`, `plans`, `plan_versions`, `routines`, `commitments`,
`evidence_items`, `reflections`, `focus_sessions`, `workout_sessions`,
`set_logs`, `coach_conversations`, `memory_insights`, `weekly_reviews`,
`milestones`, `media_attachments` and the object-store blobs behind them — and
until E13 nothing in `apps/api` erased any of it.

The only destructive control in the product was `DELETE /api/me/ai-key`, which
removes a credential rather than data, and the only full wipe was
`PrismaService.cleanDatabase()`, which throws outside `NODE_ENV=test`.

That is a real gap. A user who onboarded against a Best Self that no longer fits,
who wants a clean baseline before a serious attempt, or whose life has changed
under a Path built for the old one, cannot clear the history that the momentum
engine, the consistency run, the comeback loop and the weekly reviewer all keep
reading. The product keeps coaching them against a past they have disowned, and
their only recourse was asking an operator to run SQL by hand.

PRD §127 ("User Control") already lists **delete memory** and **delete data**
among the things a user can do, and PRD §84 asks the product to "allow
deletion". This is that.

There is also a latent gap this closes in passing: `UserAiKeyService
.deleteForUser` was written and commented as the hook a future account teardown
would need — "a future hard-delete of an account will not cascade to the key,
and must call this" — and had exactly one caller, the settings page. §7 is that
method's second, and first non-obvious, call site.

## 2. The two scopes

`ACCOUNT_RESET_PHRASES` (`account-reset.constants.ts`) declares exactly two
destructive scopes, each with its own typed confirmation phrase:

| Scope | Phrase | What it does |
|---|---|---|
| `data` | `DELETE MY DATA` | Erases every table in §3. The stored OpenAI key is kept. |
| `data_and_key` | `DELETE EVERYTHING` | Everything `data` does, plus the caller's own stored OpenAI key. |

Neither touches the `users` row, its identity, its roles, its `refresh_tokens`
or its `push_subscriptions` — see §5.

There is deliberately **no per-domain scope** (WORK / FAMILY / HEALTH only) and
**no memory-only scope**. Both are named in §10 with the reasons.

## 3. The table list, verbatim, in delete order

`ACCOUNT_RESET_TABLES`, reproduced exactly as declared (Prisma accessor →
underlying table), in the order `AccountResetService.reset` deletes them:

1. `notificationInteraction` → `notification_interactions`
2. `focusSession` → `focus_sessions`
3. `workoutSession` → `workout_sessions`
4. `reflection` → `reflections`
5. `evidence` → `evidence_items`
6. `commitment` → `commitments`
7. `dailyCheckIn` → `daily_check_ins`
8. `bodyWeightLog` → `body_weight_logs`
9. `milestone` → `milestones`
10. `weeklyPlan` → `weekly_plans`
11. `weeklyReview` → `weekly_reviews`
12. `workoutProgram` → `workout_programs`
13. `ritual` → `rituals`
14. `familyMember` → `family_members`
15. `planChangeProposal` → `plan_change_proposals`
16. `coachConversation` → `coach_conversations`
17. `memoryInsight` → `memory_insights`
18. `obstacle` → `obstacles`
19. `workSessionPlanProposal` → `work_session_plan_proposals`
20. `workMilestone` → `work_milestones`
21. `routine` → `routines`
22. `planVersion` → `plan_versions`
23. `plan` → `plans`
24. `outcome` → `outcomes`

**Then `exercises`**, as its own statement rather than a list entry — see §4.2.

25. `domainMode` → `domain_modes`
26. `bestSelfProfile` → `best_self_profiles`
27. `notification` → `notifications`
28. `personalAccessToken` → `personal_access_tokens`
29. `deviceCode` → `device_codes`
30. `userProfile` → `user_profiles`
31. `userSettings` → `user_settings`

Six more tables are deliberately **absent because they cascade**, not because
they survive a reset: `coach_messages` (from `coach_conversations`),
`workout_templates` and `workout_template_exercises` (from `workout_programs`),
`set_logs` (from `workout_sessions`), and `storage_object_chunks` and
`media_attachments` (from `storage_objects`, which is swept outside the
transaction entirely — §6).

`AccountDataSummaryDto.counts` and `AccountResetResultDto.deleted` key by the
`table` strings above, plus `exercises`, `storage_objects` and
`media_attachments`.

## 4. The delete order, and why it is load-bearing

Two independent forces fix the order, and **they fail differently**. That is why
they are stated separately rather than as one rule about children before parents:
one produces a loud error at runtime, the other produces nothing at all.

### 4.1 `SetNull` — the silent failure

`Commitment` reaches **eight** parents by `onDelete: SetNull` — `outcomeId`,
`planVersionId`, `routineId`, `ritualId`, `familyMemberId`, `workoutTemplateId`,
`workMilestoneId`, plus the self-references `rescheduledFromId` and
`decomposedFromId` — and `evidence_items` and `reflections` reach `commitments`
the same way.

Every one of those exists so that deleting the **parent** never deletes the
**evidence**: PRD §109's "prior misses remain evidence", stated at length in
[`domain-model.md`](domain-model.md). That guarantee is exactly backwards for
this feature. A reset is supposed to erase the evidence, not leave orphaned,
nulled-out rows behind once their parents are gone.

Deleting children **before** parents means those triggers have nothing left to
null out by the time the parent row is removed: the parent-delete path they exist
to protect is never exercised at all on this user's data.

Getting this wrong produces no error and no failing request. It produces a user
who reset their data and still has a hundred commitments pointing at nothing.

The pairs this order holds:

- `reflections` and `evidence_items` before `commitments`
- `focus_sessions` before `evidence_items` (`evidenceId`, `@unique` SetNull) and
  before `commitments` (`commitmentId` is the one **Cascade** link upward from a
  commitment)
- `workout_sessions` before `commitments` (`commitmentId`, `@unique` SetNull) and
  before `workout_programs`
- `notification_interactions` before `commitments` and `notifications`
- `commitments` before all eight of its parents
- `weekly_plans` before `weekly_reviews` (`reviewId` SetNull)
- `plan_change_proposals` before `coach_conversations` and `plans`
- `rituals` before `family_members` and `routines`
- `workout_programs` before `plans` (`planId` SetNull) and `routines`
  (`workout_templates.routineId`, `@unique` SetNull)

### 4.2 `Restrict` — the loud failure, and why `exercises` is not in the list

`workout_template_exercises.exerciseId` and `set_logs.exerciseId` are
`onDelete: Restrict`. The caller's custom `exercises` rows can therefore only be
deleted **after** `workout_programs` (which cascades templates and their
exercises) and `workout_sessions` (which cascades set logs). Deleting them
earlier raises a foreign-key error and rolls the whole transaction back.

`exercises` is also the one table whose ownership column is `createdByUserId`
rather than `userId`, and whose `scope = 'catalog'` rows belong to **nobody** —
shared content every user reads. It cannot ride the generic delegate loop for
either reason, so `reset` runs it as its own statement, filtered on
`{ createdByUserId, isCustom: true }`, in the position §3 marks.

### 4.3 `user_profiles` and `user_settings` are last

Both are lazily recreated at their defaults the next time they are read
(`UserProfileService.getOrCreate`; the user-settings read path), so deleting the
row **is** the reset for each. Nothing writes a fresh default row back, and
nothing else in the transaction depends on either existing mid-transaction.

`user_profiles.comebackCommitmentId` is a SetNull to `commitments`, so this row
takes one harmless nulling update earlier in the transaction before being deleted
here.

### 4.4 The 30-second transaction timeout

The default interactive-transaction timeout (5s) is sized for ordinary request
handlers, not for a caller with a year of history across thirty-one tables.
`reset` passes `{ timeout: 30_000 }` — generous headroom for the slowest
realistic account, without leaving a runaway transaction open indefinitely if
something is genuinely wrong.

## 5. What is deliberately retained, and why

Not an oversight list. This is the boundary that makes §0's promise true.

**`refresh_tokens` — session state, not data.** This feature is scoped to what a
user has *built*. Deleting these would silently sign the caller, and every other
device they are signed in on, out as a *side effect* of a data reset — a
materially different, separately named action this codebase already has
(`POST /api/auth/logout-all`), which nobody asked for by typing "DELETE MY DATA".

**`push_subscriptions` — a device registration, not data.** Re-granting a browser
notification permission is a prompt this application cannot re-issue if the user
refuses it, so dropping the registration risks costing them notifications
permanently in exchange for nothing.

**`audit_events` — the operator's record.** This very method writes an
`account:reset` row to that table as its own accountability record (§8), so a
reset able to prune it would let a caller destroy the evidence that a destructive
action ever happened. It would also erase every *other* admin action taken on
the account — role changes, deactivations — which belong to the administrators
who performed them.

**`ai_invocations` — the cost record.** Its own schema comment settles it:
*"SetNull, not Cascade. See the header: a deleted account must not erase the cost
record."* By §0's rule, a reset has less claim on those rows than the deletion
that comment already rules out.

**`notification_deliveries` — the delivery record.** Likewise, from its own
schema comment: a PII purge of these rows is *"a deliberate, targeted scrub … not
something an ON DELETE clause should do silently and irreversibly as a side
effect of an unrelated user-deletion path elsewhere in the app."* This method is
precisely the "elsewhere in the app" that comment warns off.

**`users`, `user_identities`, `user_roles`, `allowed_emails`** — the account and
its access.

**Catalog `exercises`** — shared content with no owner.

**`personal_access_tokens` and `device_codes` DO go**, and the distinction from
`refresh_tokens` is deliberate rather than inconsistent: a PAT is a long-lived
credential the user deliberately minted and would otherwise still be able to read
a freshly rebuilt account with, and a pending device code could mint a fresh one
moments after the wipe. Neither is the login the caller is currently holding.

## 6. Why storage deletion runs outside the transaction

Deleting a blob is a call to the object store — real network I/O with its own
latency and its own failure modes, and a Postgres transaction must not wrap
around either. Holding a transaction open across a round trip holds row locks for
as long as that call takes, which would turn "the reset is a little slow" into
"the reset is blocking every reader of thirty-one tables for however long the
provider takes to time out."

`reset` therefore sweeps storage **first**, as step 2, before the `$transaction`
in step 3 opens.

It calls `ObjectsService.delete(id, user)` per object — **never** a raw
`prisma.storageObject.deleteMany`. That method is what removes the bytes from the
provider, finds and deletes derived children (video frames, the normalised AI
variant, located by `metadata.derivedFrom`, which has no foreign key), and lets
`storage_object_chunks` and `media_attachments` cascade. A raw delete would drop
the metadata and leave every uploaded file behind forever: unreachable, still
stored, and still counted against `STORAGE_USER_QUOTA_BYTES`.

It is called with the caller's own `RequestUser`, so it takes the ordinary
self-delete path that method already serves rather than any cross-user override.
That is why `reset` takes a `RequestUser` and not a bare id.

## 7. Why the key purge reuses `deleteForUser`

The credential lives at `(purpose 'ai:openai:user', name <userId>)` in
`credentials`, a table with **no foreign key to `users` at all**. No cascade
anywhere reaches it, and step 3 cannot have touched it.

`UserAiKeyService.deleteForUser` is reused rather than a second `deleteSecret`
call from the account module: that address is the AI module's to know, not this
one's to duplicate. It is idempotent and already writes its own
`ai_user_key:delete` audit row. This is a small instance of a rule this codebase
states elsewhere — reuse the one door rather than opening a second that can drift
from it.

## 8. Audit after destruction, never before or during

`reset` writes its `account:reset` row **after** every deletion has actually run:
after the storage sweep, after the transaction commits, and after the conditional
key purge.

Writing it first would risk a row asserting that rows were deleted moments before
the transaction that deletes them runs, so a crash in between would leave a lie
in `audit_events`. Writing it last means the row is only ever written for
destruction that genuinely already happened. An unaudited deletion is a smaller
problem than an audit trail claiming a reset that only half-happened.

It is **not** inside the `$transaction`: that already committed, and
`audit_events` has no foreign key to any table the transaction touched, so there
is nothing for a shared transaction to buy. This matches what
`ObjectsService.delete` and `UsersService.updateUserRoles` already do.

The row: `actorUserId: userId`, `action: 'account:reset'`, `targetType: 'user'`,
`targetId: userId`, and a `meta` carrying `scope` plus `deleted` — the same
per-table counts (and `aiKeyRemoved`) the HTTP response returns. **Counts and
table names only, never a row's content.**

## 9. Why the phrase is server-issued and re-verified server-side

Two separable decisions.

**Why a typed phrase at all, not a checkbox.** A checkbox ("I understand this
cannot be undone") records that a click happened, not that the person read what
they were clicking. Both scopes are irreversible and total — there is no restore
button anywhere in this codebase — so the confirmation step is the only thing
between an idle click and everything the user has built. `data_and_key` gets its
**own**, more severe phrase rather than reusing `data`'s with a second checkbox,
because losing a stored key is a different *kind* of loss (a credential to
re-enter, not history that no longer exists) and deserves its own
acknowledgement.

**Why the phrase is served by the API rather than duplicated as a web constant.**
A value a security check compares against must have exactly one declaration. A
hardcoded `'DELETE MY DATA'` in the browser would silently disable the dialog's
only gate the day either phrase changed here. So
`GET /api/account/data-summary` echoes `ACCOUNT_RESET_PHRASES` back verbatim, and
`ConfirmPhraseDialog` renders exactly the string the server will check.

**Why the server re-checks at all.** A form that disables its submit button until
the typed text matches is a UI convenience, not a control — nothing stops a
direct `POST /api/account/reset` with a guessed or empty phrase from a script, a
replayed request, or a client this team never wrote. `reset` re-checks the phrase
itself, `.trim()`-only and case-sensitively, **before a single row is touched**,
unconditionally. Case sensitivity is deliberate: the point of a typed phrase is
that it proves the caller reproduced the exact word "DELETE", and a comparison
that forgave a wrong case would prove something weaker.

**And the client sends what the user typed, not the phrase it holds.**
`ConfirmPhraseDialog.onConfirm` hands the typed string back to the page, and the
page puts *that* on the wire. Sending the canonical phrase back would make the
server's check unfalsifiable from the web client — it could never reject a
request the browser sent — so a bug in the dialog's own comparison would become
the only gate operating for every real user, with the server's re-verification
quietly reduced to theatre for scripts alone.

Two layers enforce two different things on purpose: `resetAccountSchema` (Zod)
validates the **shape**, and `AccountResetService.reset` validates the
**content**. The content check is not folded into the DTO because it is a
security control and belongs next to the comparison it protects.

## 10. The `account.data_reset` notification

One registry entry: `channels: ['email']`, `defaultEnabled: true`,
`mandatory: true` — the second mandatory event in this application after
`security.role_changed`.

**Email only, and not because the other channels have not shipped.** `browser`
and `push` both exist and `security.role_changed` uses browser. They are still
wrong here for a reason specific to *when* this event fires: a browser
notification renders in the **same tab** that just watched the confirmation
screen report success. Its reader has no information they do not already have,
one second old. Email is the only channel that reaches this person somewhere
*other* than where the action happened, and the only one that can reach an
account holder who was not the person at the keyboard.

**`mandatory: true`, for two independent reasons.** First, irreversible
destruction of everything a person built is a fact they must not be able to
silence — the class `security.role_changed` carries the flag for, applied to data
loss instead of a privilege change. Second, it sidesteps an ordering hazard
unique to this event: step 3 deletes `user_settings`, where a non-mandatory
event's stored channel preference lives, *moments* before step 6 dispatches. A
resolver reading stored preferences would be reading a row the very call that
triggers it just deleted, and would fall back to the registry default anyway.
`mandatory` removes the question entirely.

The template (`account-data-reset.email.ts`) is modelled on
`role-changed.email.ts`, the only other mandatory one, with two differences the
content forces. There is **no before/after table** — the "after" is empty for
thirty-odd tables, and thirty rows of "0" communicate less than a sentence while
re-presenting the loss as an inventory at the moment the reader can do nothing
about it. And the **actor is not named**, for a stronger reason than the role
template has: the route is resolved entirely from `@CurrentUser()`, so "who did
this" is always the account holder. The one case this message exists for is the
case where that is wrong, and that reader needs an instruction, not their own
name.

## 11. The web surface

A registry card plus a route, never a tab — CLAUDE.md's Settings UI Pattern rule
2. A fourth `USER_SETTINGS_SECTIONS` group, `Danger zone`, with one card at
`/settings/reset`. Its own group rather than a third card under `Security`, which
is the group for long-lived *credentials*: what a reset erases is data, and
grouping the two would put "erase everything you have built" one row below
"create a bearer token".

The card declares **no `permission`**, like every card on that surface — a global
test asserts as much — because the API route is `@Auth()` with no permissions and
a gate here would invent an authorization rule the server does not enforce.
`destinations.ts` is untouched: `profile: ['/settings']` already owns the subtree
through `owns()`.

**`refreshUser()` completes before `navigate()`.** Both shell gates read their
answer off the single `AuthContext` user — `RequireAiKey` from
`user.aiKey.configured`, `RequireOnboarding` from `user.onboarding.completed` —
so one refresh re-evaluates both. Navigating first lands the user behind a gate
still holding the pre-reset answer, which reads as the reset not having worked at
all rather than as a stale cache. `data` goes to `/onboarding`, because deleting
`user_profiles` genuinely un-onboards them and the wizard is the honest
destination; `data_and_key` goes to `/setup/ai-key`, which is where the gate
chain would send them anyway.

**The dialog does not navigate; the page does.** `ConfirmPhraseDialog` is a
generic typed-confirmation primitive that knows a phrase and a list of
consequences. Which gates a scope invalidates, and where its post-reset screen
is, is knowledge the page has and the dialog has no business acquiring.

## 12. No route accepts a user id — the security boundary

Every method resolves the account from `@CurrentUser()` and from nowhere else.
There is no path parameter, no query parameter and no body field naming a user —
the same structural discipline `user-ai-key.controller.ts` states for the
caller's own key, applied here to the caller's own data.

An administrator cannot reset another user's data through this controller either,
and that is enforced **structurally** rather than by a check: there is no
permission to relax, because there is no parameter naming a target for a relaxed
check to admit. Widening this into a "reset any user's data" admin action would
be a signature change with a visible diff at every call site it touched, not a
query-string edit that slips through review.

`@Auth()` carries **no permissions**, for the same reason every other
caller-scoped module in this API is gated the same way: erasing your own data is
not a privilege, it is what owning the account already means. Gating it with an
invented permission string would leave Viewer — the default role in this product
— unable to make a choice that is structurally theirs alone.

## 13. Excluded scope

Named explicitly so a later reader does not treat an absence as an oversight.

- **Account deletion.** §0. A separate concern with its own consent and allowlist
  implications — a different feature, not a bigger version of this one.
- **Data export, undo, or a grace period.** The reset is immediate and
  irreversible by design. A "download your data first" flow is its own feature;
  the PRD has no export requirement today.
- **A per-domain reset** (WORK / FAMILY / HEALTH only). Coach memory, weekly
  reviews, milestones and the momentum engine all span domains, so a per-domain
  scope is a materially harder design question than a total one — and the
  motivating cases in §1 are all "start over", not "start over in one area".
- **A memory-only reset.** `/settings/ai-memory` already lets a user forget
  individual insights (PRD §85). A bulk "forget everything you know about me" is
  a different feature from a data reset, and would belong on that screen.
- **Admin-initiated reset of another user.** §12. An operator-facing teardown is a
  different surface with a different threat model, not this feature widened.
- **Revoking the session.** §5.
- **Pruning `audit_events`, `ai_invocations` or `notification_deliveries`.** §5.
- **A post-reset receipt screen.** The counts are in the HTTP response, the audit
  row and the email. The UI navigates to the re-armed gate rather than showing a
  summary of what was erased — which would be an inventory of the loss at the
  moment the reader can do nothing about it, the same reason §10 keeps it out of
  the email.

## 14. Rejected alternatives

**A checkbox instead of a typed phrase.** Rejected in §9: it records a click, not
a reading.

**One phrase for both scopes, with a second checkbox for the key.** Rejected in
§9: losing a credential and losing history are different kinds of loss, and the
second deserves its own deliberate act rather than riding along on the first.

**Hardcoding the phrases in the web app.** Rejected in §9: two declarations of a
value a security check compares against, and the failure mode is the gate
silently switching off rather than anything visible.

**Sending the canonical phrase from the client.** Rejected in §9: it makes the
server's check unfalsifiable from the browser, so the client's own comparison
becomes the only real gate for every actual user.

**Deleting rows with a single `deleteMany` per table in schema order.** Rejected
in §4: schema order is not FK order, and the two failures (silent orphans,
foreign-key error) are exactly what the ordering exists to prevent.

**`prisma.storageObject.deleteMany` instead of `ObjectsService.delete`.**
Rejected in §6: it deletes metadata and orphans the bytes, permanently and
invisibly, while still charging the user's quota.

**Holding the storage sweep inside the transaction, for atomicity.** Rejected in
§6: atomicity across a database and an object store is not available at this
price, and the price is row locks held across a network timeout. The failure it
would buy protection from — a blob deleted for a transaction that later rolled
back — is a leaked deletion of the user's own file during their own reset, which
is the direction they asked for anyway.

**Writing the audit row first, so a crash cannot lose it.** Rejected in §8: a
crash between the audit write and the deletion leaves a false record, which is
worse than a missing one for a table whose purpose is being trustworthy.

**A `browser` channel on the notification.** Rejected in §10: its reader is the
tab that just performed the action.

**Making the notification an ordinary preference.** Rejected in §10: twice over —
the fact must not be silenceable, and its preference row has just been deleted.

**Deleting `refresh_tokens` so the reset feels total.** Rejected in §5: it turns
a data reset into a logout-all the caller did not ask for.

**A `Security` card instead of a `Danger zone` group.** Rejected in §11: that
group is about credentials, and the adjacency would misdescribe both.

**A tab on `/settings/profile`.** Rejected in §11: a destination gate is about
reachability and a tab gate is about content — CLAUDE.md's Settings UI Pattern
rule 2, which exists because conflating the two is what epic #90 had to undo.
