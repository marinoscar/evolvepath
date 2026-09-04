# E06 — AI Coach: Context Assembler, Coaching Reasoner, Mutation Protocol & Memory

<!-- epic-meta: slug=ai-coach-memory phase=2 -->

## Epic

### Goal

Give EvolvePath its coach: a Coach screen where the user talks to a context-aware Coaching Reasoner that answers with a validated structured contract (intervention type, rationale, next action, optional plan-change proposal), never mutates a plan on its own, and only changes state through the accept/edit/reject mutation protocol that produces a new `PlanVersion` (PRD §15, VISION §19). The same epic adds the three things the coach needs to be trustworthy: a persona-scoped context assembler that sends the smallest sufficient context (PRD §14.1, §87), a deterministic safety layer that redirects injury, disordered-eating and crisis content to professional care before any model is called (PRD §14.8, §81–§82), and inspectable, removable memory insights the user controls (PRD §17 Tier 3, §85, VISION §23). After E06 the product loop "I can't work out Wednesday anymore" → proposal → diff → Accept → Plan v2 on `/path` works end to end.

### Background

- **Gateway.** Every model call goes through `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, attachments?, schema, schemaName})` from E01-06 (`apps/api/src/ai/gateway/ai-gateway.service.ts`). It returns `{ok:true, invocationId, output}` or `{ok:false, invocationId, error:{code,message}}` and never throws for provider problems. Personas `coach`, `safety`, `pattern_analyst`, `media_analyst` are already registered in `apps/api/src/ai/ai-personas.ts` (E01-02). Every call writes one `ai_invocations` row; that table already carries a nullable `safetyDecision` column (E01-01) that nothing writes yet — E06-06 is what fills it.
- **Domain state** comes from E02: `Outcome`, `Plan` + `PlanVersion` (`DRAFT|ACTIVE|SUPERSEDED|REJECTED`, `createdBy USER|AI`, `previousVersionId`, `rationale`), `Routine`, `Commitment` (status lifecycle, `rescheduleCount`, `skipReason`), `Evidence`, `Reflection`, `DomainMode`, and the `PlansService` version helpers from E02-03 (`createVersion`, `activateVersion`). The Path screen (E02-06) already renders version history with "why it changed"; E06 only has to produce versions with a rationale.
- **Media**: `MediaAttachment` rows (E03-02), `MediaAttachmentPicker` (E03-06) and the `media_analyst` summary flow (E03-07) exist. The `coach` persona is not a `vision` persona, so the coach receives attachments as text summaries (`MediaAttachment.aiSummary`), not pixels.
- **Coaching style** lives on `user_profiles.coachingStyle` (`GENTLE|BALANCED|DIRECT`, E04-01). Today's commitments and the Start flow route come from E05.
- **Patterns to copy.** Ownership-checked per-user resources: `apps/api/src/pat/` (plain `@Auth()`, own rows only). Audit: direct `prisma.auditEvent.create` as in `apps/api/src/email/email-settings.service.ts`. Zod DTOs via `createZodDto` (`apps/api/src/email/dto/update-email-settings.dto.ts`). Registry-driven lists: `apps/api/src/notifications/notification-events.ts`. Settings pages: `apps/web/src/config/userSettingsSections.tsx` + `SettingsHub`. Integration harness: `apps/api/test/helpers/test-app.helper.ts` (`createTestApp({ overrideProviders })`). Fake OpenAI server: `tools/fake-openai/server.mjs` + `infra/compose/fake-openai.compose.yml` (E01-10).
- **Non-negotiables** carried from CLAUDE.md and the PRD: deterministic product logic must work with AI unavailable (PRD §120); the model is never the source of truth (VISION §20); chain of thought is never stored or shown (PRD §16, §88); prompts are versioned (PRD §117).
- Design rationale and rejected alternatives are written up by E06-09 in `docs/specs/coach-and-memory.md` (new).

### Scope

- [ ] E06-01 Add coach conversations, plan-change proposals, memory insights and obstacles
- [ ] E06-02 Add persona-scoped context assembler with a deterministic character budget
- [ ] E06-03 Add coach chat endpoints with the structured coaching contract
- [ ] E06-04 Add plan-change proposal accept, edit and reject mutation protocol
- [ ] E06-05 Add memory insight endpoints and the pattern-analysis proposer
- [ ] E06-06 Add deterministic safety pre-check and safety-persona policy
- [ ] E06-07 Add Coach screen with proposal cards, diff view and attachments
- [ ] E06-08 Add AI memory settings page with confirm, forget and do-not-use
- [ ] E06-09 E06 end-to-end verification

### Out of scope

- Streaming responses (the contract is a single validated JSON object; streaming can be layered later without changing it).
- The full Pattern Analysis Service (time-of-day reliability, recovery latency, notification responsiveness — PRD §14.4) and momentum states: E11. E06-05 ships a proposer stub over 28-day aggregates only.
- Weekly Review and Weekly Planning proposals (E10) — they reuse `PlanChangeProposal` with `sourceKind: WEEKLY_REVIEW` and the E06-04 protocol unchanged.
- Workout-specific proposals (`sourceKind: WORKOUT`, E09-05) and the anti-procrastination ladder triggers that create `Obstacle` rows (E07-03). E06 creates the tables and the coach may *read* obstacles; it does not detect them.
- Coaching notifications (N1–N9, E12). E06-05 registers exactly one notification event (`memory.insight_proposed`).
- Conversation search (PRD §79), voice (PRD §125), locale-specific crisis hotlines, multi-language copy.
- Pre-authorised automatic adaptations (PRD §15 "small ephemeral adaptations") — every change in E06 requires an explicit accept.

### Sequencing

- **E06-01** first (every other child needs the tables).
- **E06-02** (context assembler) and **E06-06** (safety) are independent of each other and can run in parallel after E06-01.
- **E06-04** (mutation protocol) needs only E06-01 + E02-03; it can run in parallel with E06-02/E06-06.
- **E06-03** (chat) is the integration point: blocked by E06-02, E06-04 (it creates proposals) and E06-06 (pre-check).
- **E06-05** (memory) is blocked by E06-01 and E06-02 (it modifies the assembler's insight query); it can run in parallel with E06-03.
- **E06-07** is blocked by E06-03 and E06-04; **E06-08** by E06-05. The two web children can run in parallel.
- **E06-09** last. Critical path: E06-01 → E06-02 → E06-03 → E06-07 → E06-09.

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up --build`.
3. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed`. Confirm the migration list ends with `add_coach_and_memory`.
4. Open http://localhost:3535/testing/login, sign in as `coach-user@test.local` (role `contributor`, tick "Seed an OpenAI key" — the `withAiKey` option from E01-10). Complete onboarding (E04) choosing Health with a "Strength workout" routine on Wednesday 18:30, coaching style **Direct**. You land on `/today`.
5. Go to http://localhost:3535/coach. Observe the conversation list (empty state on a phone-width window, side panel + empty conversation at ≥600px) and the seven suggested-prompt chips from PRD §66.
6. Type `My schedule changed. I can't work out Wednesday anymore.` and send. Observe: your message appears immediately (optimistic), a "Thinking…" placeholder, then the coach reply with a **proposal card**: "Wednesday 18:30 → Saturday 09:00", the reason line, and buttons **Accept / Edit / Keep current plan**. Expand **Why this?** — the `reasoning_summary` is shown; nothing resembling model scratch work.
7. Click **Accept**. Snackbar "Plan updated (v2)". Open http://localhost:3535/path → the Health plan shows **v2 · Active** with the rationale, and v1 in history as **Superseded**.
8. Back on `/coach`, send `I have sharp chest pain when I run`. Observe: the reply is the professional-care copy with a safety note, **no** proposal, and no "Why this?" (no model was called).
9. Send `I'm procrastinating` via the chip. Observe a `NORMAL_REMINDER`/`ACTIVATION_REDUCTION`-style reply with a **Start 10 min** action that deep-links to the Start flow.
10. Open http://localhost:3535/settings → **AI** section → **AI Memory** card → `/settings/ai-memory`. Click **Propose insights** (fake server returns two). Confirm one, mark the other **Don't use for coaching**, add your own ("Morning workouts are more reliable"), reload — all three states persist.
11. DB checks (`psql "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:$POSTGRES_PORT/$POSTGRES_DB"`):
    - `select version, status, "createdBy", rationale from plan_versions order by version;` → v1 `SUPERSEDED`, v2 `ACTIVE` `AI`.
    - `select status, "sourceKind", "appliedPlanVersionId" is not null as applied from plan_change_proposals;` → one `ACCEPTED`, applied.
    - `select role, "safetyDecision"->>'decision' from coach_messages order by "createdAt";` → the chest-pain reply row has `redirect`.
    - `select persona, status, "safetyDecision"->>'decision' from ai_invocations order by "createdAt";` → `coach` rows `succeeded`, no coach row for the chest-pain turn.
    - `select action from audit_events where action like 'plan:%' or action like 'memory_insight:%';` → `plan:change_accepted`, `memory_insight:confirm`, `memory_insight:do_not_use`, `memory_insight:create`.
12. `cd tests/e2e && npx playwright test coach.spec.ts` passes against the same stack.

## Child issues

### E06-01 `feat(db): add coach conversations, plan-change proposals, memory insights and obstacles`

**Part of epic:** E06 · **Blocked by:** none (needs E02-01 merged) · **Component:** database · **Priority:** P0 · **Agents:** database-dev → testing-dev → docs-dev

#### Problem statement

The coach needs durable, product-owned state that is not a chat transcript: conversations and messages (PRD §17 Tier 4), plan-change proposals with a structured diff and a decision (PRD §15 steps 1–7), memory insights the user can inspect and remove (PRD §10.12, §17 Tier 3, §85), and recurring obstacles (PRD §10.11). None of these tables exist; `ai_invocations` (E01-01) is telemetry, not product state.

#### Proposed solution

Add four models and the supporting enums in `apps/api/prisma/schema.prisma`, one migration, no seed changes.

**Data (database-dev)**

Enums:
- `CoachMessageRole { USER COACH SYSTEM }`
- `ProposalSourceKind { COACH WEEKLY_REVIEW WORKOUT PATTERN }`
- `ProposalStatus { PROPOSED ACCEPTED EDITED REJECTED EXPIRED }`
- `MemoryInsightCategory { IDENTITY WORK FAMILY HEALTH COACHING_PREFERENCE NOTIFICATION_PREFERENCE PATTERN }`
- `MemoryInsightSource { AI USER }`
- `ObstacleType { EVENING_WORKOUT_UNRELIABLE AMBIGUOUS_WORK_TASK FAMILY_PLAN_COLLIDES_WITH_WORK OVERCOMMITMENT PERFECTIONISM LOW_ENERGY_WINDOW OTHER }` (PRD §10.11 examples + `OTHER`)

Models (all ids `String @id @default(uuid())`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` where listed):

- `CoachConversation` → `@@map("coach_conversations")`: `userId` (FK `User`, `onDelete: Cascade`), `title String?` (≤120), `createdAt`, `lastMessageAt DateTime @default(now())`, relation `messages CoachMessage[]`. Index `@@index([userId, lastMessageAt(sort: Desc)])`.
- `CoachMessage` → `@@map("coach_messages")`: `conversationId` (FK `CoachConversation`, `onDelete: Cascade`), `role CoachMessageRole`, `content String @db.Text`, `structured Json?` (the validated `coach_reply` contract from E06-03, plus `proposal.proposalId` when one was created; `null` for USER/SYSTEM rows and for fallback replies), `attachmentIds String[] @default([])` (ids of `MediaAttachment` rows — no FK, a deleted attachment must not delete the message), `invocationId String?` (id of the `ai_invocations` row; no FK, telemetry rows may be pruned), `safetyDecision Json?` (E06-06 `SafetyDecision`), `createdAt`. Index `@@index([conversationId, createdAt])`.
- `PlanChangeProposal` → `@@map("plan_change_proposals")`: `userId` (FK `User`, Cascade), `planId` (FK `Plan`, Cascade), `sourceKind ProposalSourceKind`, `sourceMessageId String?` (FK `CoachMessage`, `onDelete: SetNull`), `summary String` (≤300), `changes Json` (array of `PlanChange`, schema in E06-04), `originalChanges Json?` (set the first time `/edit` rewrites `changes`), `status ProposalStatus @default(PROPOSED)`, `appliedPlanVersionId String?` (FK `PlanVersion`, `onDelete: SetNull`), `invocationId String?`, `expiresAt DateTime` (creator sets `now + 7 days`), `editedAt DateTime?`, `decidedAt DateTime?`, `decisionReason String?` (≤300, from `/reject`), `createdAt`, `updatedAt`. Indexes `@@index([userId, status, createdAt(sort: Desc)])`, `@@index([planId])`.
- `MemoryInsight` → `@@map("memory_insights")`: `userId` (FK `User`, Cascade), `category MemoryInsightCategory`, `statement String` (≤280), `evidenceCount Int @default(0)`, `confidence Float` (0–1, enforced by Zod at the boundary), `userConfirmed Boolean @default(false)`, `doNotUse Boolean @default(false)`, `expiresAt DateTime?`, `source MemoryInsightSource`, `invocationId String?`, `createdAt`, `updatedAt`. Indexes `@@index([userId, category])`, `@@index([userId, doNotUse, userConfirmed])`.
- `Obstacle` → `@@map("obstacles")`: `userId` (FK `User`, Cascade), `type ObstacleType`, `description String` (≤280), `domain` (the `Domain` enum E02-01 introduced for `Outcome.domain`), `observedCount Int @default(1)`, `confidence Float`, `lastObservedAt DateTime @default(now())`, `interventionHistory Json @default("[]")` (PRD §10.11 `intervention_history`; E07-03 appends `{level, at}` entries), `createdAt`, `updatedAt`. Index `@@index([userId, domain, lastObservedAt(sort: Desc)])`.

Add the back-relations on `User`, `Plan`, `PlanVersion` (named relations, e.g. `"UserCoachConversations"`, `"ProposalAppliedVersion"`, following the `"UserPersonalAccessTokens"` naming already in the schema). Migration: `npm run prisma:migrate:dev -- --name add_coach_and_memory`. Seed: n/a.

**API (backend-dev)** — n/a in this child (models only). Run `npm run prisma:generate` and `npm run typecheck` so the generated client compiles.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**
- `apps/api/test/prisma/coach-and-memory-schema.integration.spec.ts` (new): creates a user → conversation → message → proposal → memory insight → obstacle; asserts defaults (`status PROPOSED`, `userConfirmed false`, `doNotUse false`, `observedCount 1`); deleting the user cascades all five; deleting a `CoachMessage` sets `PlanChangeProposal.sourceMessageId` to null; deleting a `PlanVersion` sets `appliedPlanVersionId` to null.
- Existing `apps/api/test/openapi/openapi-document.spec.ts` must still pass (no controllers added here).

**Docs (docs-dev)** — `CLAUDE.md` "Database Tables" list: add `coach_conversations`, `coach_messages`, `plan_change_proposals`, `memory_insights`, `obstacles` with one-line descriptions.

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on a clean database applies `add_coach_and_memory` without manual steps.
- [ ] All six enums and four models exist with the fields, defaults and indexes listed above.
- [ ] Deleting a user removes their conversations, messages, proposals, insights and obstacles.
- [ ] `PlanChangeProposal.appliedPlanVersionId` and `sourceMessageId` survive deletion of their targets as `null` (SetNull), never as a failed delete.
- [ ] `coach_messages.structured` and `plan_change_proposals.changes` are `jsonb`.
- [ ] `npm run typecheck` and `npm test` pass in `apps/api`.
- [ ] `CLAUDE.md` table list updated.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: n/a (schema only); migration is forward-only and idempotent under `prisma migrate deploy`
- [ ] Observability: n/a
- [ ] Security: every product table carries `userId` with `onDelete: Cascade` so account deletion leaves no coaching data behind
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. `cd apps/api && npm run prisma:migrate:dev -- --name add_coach_and_memory` → migration folder created; `npm run prisma:generate` succeeds.
2. `psql ... -c '\d coach_messages'` → shows `structured jsonb`, `attachmentIds text[]`, `safetyDecision jsonb`, index on `(conversationId, createdAt)`.
3. `psql ... -c '\d plan_change_proposals'` → FK to `plan_versions` with `ON DELETE SET NULL`.

#### Out of scope

- Any controller/service; conversation title generation; proposal expiry sweeps (E06-04 expires lazily on read).
- `CoachPreference` as its own table (PRD §10.13): `coachingStyle` already lives on `user_profiles` (E04-01); the remaining preference fields are P1.

#### Notes for the implementing agent

- Copy relation naming and `@@map` conventions from `PersonalAccessToken` / `Notification` in `apps/api/prisma/schema.prisma`; read the long comments above `Credential` and `NotificationDelivery` about *why* SetNull vs Cascade is chosen per relation and write a short comment of the same kind above `PlanChangeProposal`.
- Use `Float` for `confidence`, not `Decimal` — nothing sums it, and Zod clamps it to `[0,1]`.
- `invocationId` columns are deliberately plain strings: `ai_invocations` is telemetry (SetNull semantics, prunable) and a FK would couple product rows to log retention.
- Use `npm run prisma:*` scripts, never bare `npx prisma`.

---

### E06-02 `feat(api): add persona-scoped context assembler with a deterministic character budget`

**Part of epic:** E06 · **Blocked by:** E06-01 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §14.1 requires a Context Assembler that "builds the minimum relevant context for each AI call", §87 that "every AI call should receive the smallest sufficient context" (workout coaching does not need family reflections; family planning does not need exercise logs), §116 that history is retrieved by relevance rather than dumped, and §17 defines the tiers (current state, last 14 days, confirmed durable preferences). E04's planner and E03's media flow each hand-built their input; without one assembler every persona will drift toward "send everything", context will be non-deterministic, and `doNotUse` memory (PRD §85) cannot be enforced in one place.

#### Proposed solution

A pure-ish service that reads product state through Prisma, returns a typed `CoachContext` scoped per persona, and renders it to a deterministic string within a character budget.

**Data (database-dev)** — n/a.

**API (backend-dev)**

New module `apps/api/src/coach/coach.module.ts` (new) — `imports: [PrismaModule]` for now (E06-03 adds `AiModule`, `SafetyModule`, `NotificationsModule`); exports `ContextAssemblerService`. Register in `app.module.ts`.

Files (all new):
- `apps/api/src/coach/context/context.types.ts` —
  ```ts
  export type PersonaScope = 'coach' | 'planner' | 'workout' | 'family';
  export interface CoachContext {
    scope: PersonaScope;
    now: { iso: string; timezone: string; weekday: string };   // from user_profiles.timezone
    coachingStyle: 'GENTLE' | 'BALANCED' | 'DIRECT';
    bestSelf: { statements: string[] } | null;
    domainModes: Array<{ domain: 'WORK' | 'FAMILY' | 'HEALTH'; mode: string }>;
    outcomes?: OutcomeSummary[];                // planner only
    activePlans: ActivePlanSummary[];           // {planId, outcomeTitle, domain, versionNumber, versionId, rationale, routines: RoutineSummary[]}
    todayCommitments: CommitmentSummary[];      // {commitmentId, title, domain, status, scheduledAt, fullMinutes, minimumMinutes, rescheduleCount}
    recentEvidence: EvidenceSummary[];          // last 14 days, newest first
    recentMisses: CommitmentSummary[];          // MISSED/SKIPPED last 14 days, with skipReason
    recentReflections: ReflectionSummary[];     // last 14 days
    memoryInsights: MemoryInsightSummary[];     // {category, statement, evidenceCount, confidence}
    obstacles: ObstacleSummary[];
    recentNotificationCount: number;            // rows in `notifications` for the user in the last 7 days
    workout?: { program: unknown | null; recentSessions: unknown[] }; // workout only; null until E09 fills it
    budget: { limitChars: number; usedChars: number; truncated: Array<{ section: string; dropped: number }> };
  }
  ```
- `apps/api/src/coach/context/context-scopes.ts` — `CONTEXT_SCOPES: Record<PersonaScope, { sections: SectionKey[]; limitChars: number }>`:

  | scope | sections | limit |
  |---|---|---|
  | `coach` | now, coachingStyle, bestSelf, domainModes, activePlans, todayCommitments, recentEvidence, recentMisses, recentReflections, memoryInsights, obstacles, recentNotificationCount | 12 000 |
  | `planner` | coach sections + `outcomes` | 16 000 |
  | `workout` | now, coachingStyle, domainModes (HEALTH only), activePlans (HEALTH only), todayCommitments (HEALTH only), recentEvidence (source `WORKOUT_LOG` only), memoryInsights (HEALTH + PATTERN), obstacles (HEALTH), workout | 8 000 |
  | `family` | now, coachingStyle, bestSelf, domainModes, activePlans (FAMILY), todayCommitments (FAMILY), recentEvidence (**excluding** `WORKOUT_LOG`), recentMisses (FAMILY), recentReflections, memoryInsights (FAMILY, IDENTITY, COACHING_PREFERENCE), obstacles (FAMILY) | 8 000 |

- `apps/api/src/coach/context/context-assembler.service.ts` — `ContextAssemblerService`:
  - `assemble(userId: string, scope: PersonaScope): Promise<CoachContext>` — one Prisma round-trip per section (`Promise.all`), then `applyBudget`. Memory query is **exactly** `{ userId, userConfirmed: true, doNotUse: false, OR: [{expiresAt: null}, {expiresAt: {gt: now}}] }`, ordered `confidence desc, updatedAt desc`, capped at 20, then filtered to the scope's categories.
  - `renderForPrompt(context: CoachContext): string` — deterministic serializer: fixed section order, stable key order, ISO dates, no user email/name (the persona is told "the user" only), bullet lists; this string is what callers pass as `input.context`.
  - `applyBudget(context, limitChars)` — private, pure: measures `renderForPrompt`; while over budget, drops the **oldest** item from the episodic lists in the order `recentReflections` → `recentEvidence` → `recentMisses` → `obstacles` → `memoryInsights` (lowest confidence first), never touching Tier 1 sections (`activePlans`, `todayCommitments`); records `{section, dropped}` in `budget.truncated`. Same input ⇒ same output.
  - Decorate `assemble` with `@Trace('coach.context.assemble')` (`apps/api/src/common/decorators/trace.decorator.ts`) and set span attributes `context.scope`, `context.used_chars`, `context.truncated_sections` — never content.
- Timezone/coaching style come from `user_profiles` (E04-01); when absent default `BALANCED` and `UTC`.

No endpoints, no audit.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)** — `apps/api/src/coach/context/context-assembler.service.spec.ts` (new, Jest, mocked `PrismaService` via `apps/api/test/fixtures/mock-setup.helper.ts` style):
- "doNotUse insights are never included" — insight with `doNotUse: true` and `userConfirmed: true` is absent for every scope.
- "unconfirmed insights are excluded"; "expired insights are excluded"; "future `expiresAt` included".
- "family scope contains no `WORKOUT_LOG` evidence and no HEALTH commitments".
- "workout scope contains no reflections and only HEALTH plans".
- "planner scope includes outcomes; coach scope does not".
- "budget truncation drops oldest evidence first and is deterministic" — 200 evidence rows, 12 000 limit: result identical across two calls, `budget.truncated[0].section === 'recentReflections'` when reflections exist, Tier 1 sections intact.
- "renderForPrompt never includes the user's email or display name".
- "defaults to BALANCED/UTC when no profile row".

**Docs (docs-dev)** — `docs/specs/coach-and-memory.md` §"Context scopes and budgets" (file created by E06-09; write the section now in the spec's skeleton if it does not yet exist), one paragraph in `CLAUDE.md` "Common Patterns" → "Calling an AI persona" stating that inputs come from `ContextAssemblerService.assemble` + `renderForPrompt`, never ad-hoc Prisma dumps.

#### Acceptance criteria

- [ ] `assemble(userId, 'coach')` returns every section in the table above and nothing else; `'workout'` and `'family'` omit the sections the table omits.
- [ ] Memory insights with `doNotUse=true`, `userConfirmed=false`, or a past `expiresAt` never appear in any scope.
- [ ] `renderForPrompt` output for a fixed fixture is byte-identical across runs.
- [ ] Over-budget contexts are truncated oldest-first and report what was dropped; Tier 1 sections are never dropped.
- [ ] No PII beyond product content (no email, display name, family member surnames) reaches the rendered string.
- [ ] The E04-02 planner call site is switched to `assemble(userId, 'planner')` in this child (small refactor, behaviour-preserving, its tests still pass).
- [ ] Unit tests above pass.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: a failing section query rejects `assemble` (callers treat it as AI-unavailable and fall back); no partial contexts
- [ ] Observability: `coach.context.assemble` span with scope/size attributes only
- [ ] Security: reads only rows where `userId` matches; no cross-user joins
- [ ] Config & secrets: budgets are constants in `context-scopes.ts` (no env vars)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. With the epic stack up and a user who completed onboarding, run in `apps/api`: `npx ts-node -r tsconfig-paths/register -e "..."` is not needed — instead add a temporary `console.log(renderForPrompt(await assembler.assemble(userId,'coach')))` behind a Jest test in the spec and run `npm test -- context-assembler` to eyeball the rendered context; remove before commit.
2. Confirm the printed context lists today's commitments and the active plan and contains no email address.

#### Out of scope

- Caching stable summaries (PRD §118) — later; the assembler is cheap enough for V1.
- A `weekly_review` scope (E10 adds it to `CONTEXT_SCOPES`).

#### Notes for the implementing agent

- Model the section-query fan-out on how `NotificationStoreService` (`apps/api/src/notifications/notification-store.service.ts`) shapes list queries; keep each section a private method so scopes can compose them.
- Field names of E02 models: read `apps/api/prisma/schema.prisma` after E02-01 rather than trusting this spec's summaries; the `*Summary` types here list intent, not column names.
- Character budget, not tokens: no tokenizer dependency; 12 000 chars ≈ 3 000 tokens, comfortably inside the `coach` persona's fast-tier model.
- Keep `renderForPrompt` free of `Date.now()` — take `now` from the context object so tests are deterministic.

---

### E06-03 `feat(api): add coach chat endpoints with the structured coaching contract`

**Part of epic:** E06 · **Blocked by:** E06-02, E06-04, E06-06 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

The Coaching Reasoner (PRD §14.3) must "explain next action, diagnose friction, respond to avoidance… help user recover" through a validated structured contract (PRD §16), reference correct active state and never invent completions or plans (PRD §18, §90, §107), propose plan changes rather than executing them (PRD §15), honour the coaching style (PRD §10.13, §67) and stay inside the anti-manipulation rules (PRD §129). The Coach screen (PRD §66) needs conversations, suggested prompts, and a message endpoint that survives AI outages (PRD §120).

#### Proposed solution

**Data (database-dev)** — n/a (E06-01).

**API (backend-dev)**

Extend `apps/api/src/coach/coach.module.ts`: `imports: [PrismaModule, AiModule, SafetyModule (E06-06), MediaModule (E03-04), NotificationsModule]`; controllers `CoachController`; providers `CoachService`, `CoachConversationsService`, `CoachOutputGuard`, `ProposalsService` (E06-04).

Files (new):
- `apps/api/src/coach/contracts/coach-reply.contract.ts` — the Zod contract, **exactly**:
  ```ts
  export const INTERVENTION_TYPES = ['NORMAL_REMINDER','ACTIVATION_REDUCTION','DECOMPOSITION','FRICTION_DIAGNOSIS','ENVIRONMENT_CHANGE','PLAN_CHALLENGE','GOAL_CHALLENGE','REINFORCE','CLARIFY','REDUCE_SCOPE','RECONNECT_REASON','RECOVER'] as const;
  export const coachReplySchema = z.object({
    intervention_type: z.enum(INTERVENTION_TYPES),
    reasoning_summary: z.string().min(1).max(400),
    user_message: z.string().min(1).max(600),
    recommended_action: z.object({ title: z.string().min(1).max(120), duration_minutes: z.number().int().min(1).max(180), commitmentId: z.string().uuid().nullable() }).nullable(),
    fallback_action: z.object({ title: z.string().min(1).max(120), duration_minutes: z.number().int().min(1).max(180) }).nullable(),
    proposal: z.object({ kind: z.literal('plan_change'), planId: z.string().uuid(), summary: z.string().min(1).max(300), changes: z.array(planChangeSchema).min(1).max(10) }).nullable(),
    friction_question: z.object({ prompt: z.string().min(1).max(200), options: z.array(z.string().min(1).max(80)).min(2).max(5) }).nullable(),
  });
  export type CoachReply = z.infer<typeof coachReplySchema>;
  ```
  (`nullable()` rather than `optional()` because E01-06's `strict-json-schema.ts` emits `strict: true` schemas, where every property is required; the service maps `null` → omitted in responses.) `planChangeSchema` is imported from `apps/api/src/coach/proposals/plan-change.schema.ts` (E06-04).
- `apps/api/src/coach/prompts/coach.prompt.ts` — `export const COACH_PROMPT_VERSION = 'coach.v1'`; `buildCoachInstructions({ style, safety }): string` composed of: role + objective; "authoritative data" block (the context is the only truth; ids in the output must come from it); prohibited assumptions (never claim completion, never invent plans/family members/workout history, never diagnose, never present yourself as a therapist — PRD §18); the PRD §67 shape (acknowledge → observation → action → CTA, no motivational speeches); the intervention ladder mapping (PRD §26 levels 0–6 ↔ `NORMAL_REMINDER…GOAL_CHALLENGE`, plus `REINFORCE/CLARIFY/REDUCE_SCOPE/RECONNECT_REASON/RECOVER` from VISION §21 modes); the "protect the goal from the mood / the user from the plan" rule (VISION §22); anti-manipulation list (PRD §129); tone block per style — `GENTLE`: offer choices, soften observations, no callouts; `BALANCED`: default; `DIRECT`: short sentences, name avoidance plainly, no cheerleading, still never guilt or disappointment; length limits (user_message ≤ 600 chars, ≤ 4 sentences); when `safety.decision === 'conservative'` append `SAFETY_CONSERVATIVE_INSTRUCTIONS` from E06-06.
- `apps/api/src/coach/suggested-prompts.ts` — `SUGGESTED_PROMPTS` in PRD §66 order: `plan_week` "Help me plan my week", `procrastinating` "I'm procrastinating", `shorter_workout` "Make today's workout shorter", `fell_off` "I fell off", `review_progress` "Review my progress", `decide_what_matters` "Help me decide what matters", `change_plan` "Change my plan" — `{key, label, text}`.
- `apps/api/src/coach/coach-output-guard.ts` — `guardCoachOutput(reply: CoachReply, ctx: CoachContext): { ok: true } | { ok: false; reason: string }`: `recommended_action.commitmentId` must be in `ctx.todayCommitments` or an active PLANNED commitment of the user (guard receives the id set); `proposal.planId` must be in `ctx.activePlans`; every `changes[].target.id` must belong to that plan's active version (routine ids) or the user's PLANNED commitments; `proposal` and `friction_question` never both non-null.
- `apps/api/src/coach/coach-fallbacks.ts` — `fallbackReply(code: AiErrorCode | 'invalid_output' | 'safety_redirect'): { content: string }` — safe templates: e.g. `invalid_output` → "I couldn't produce a reliable answer just now. Your plan is unchanged. Try again, or pick a suggested prompt."; `no_user_key` → "Add your OpenAI key in Settings → AI to chat with the coach."; `ai_disabled` → "The coach is turned off by your administrator."; generic → "The coach is unavailable right now. Your plan and today's actions still work without it."
- `apps/api/src/coach/coach-conversations.service.ts`, `coach.service.ts`, `coach.controller.ts`, `dto/create-conversation.dto.ts` (`{title?: string ≤120}`), `dto/send-coach-message.dto.ts` (`{conversationId?: uuid, text: string min1 max4000 trimmed, attachmentIds?: uuid[] max4}`), `dto/coach-message-response.dto.ts`, `dto/conversation-response.dto.ts`.

Endpoints (OpenAPI tag `Coach`, new group `Coaching` in `apps/api/src/openapi/tags.ts`; every route `@Auth()`; every row filtered by `userId`):

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/coach/conversations` | `@Auth()` | `{title?}` | 201 `Conversation {id,title,createdAt,lastMessageAt}` |
| GET | `/coach/conversations` | `@Auth()` | `?limit=20&cursor=` | 200 `{items: Conversation[], nextCursor}` ordered `lastMessageAt desc` |
| GET | `/coach/conversations/:id/messages` | `@Auth()` own → else 403 | `?limit=50&before=<messageId>` | 200 `{items: CoachMessage[]}` ascending by `createdAt` |
| DELETE | `/coach/conversations/:id` | `@Auth()` own | — | 204 (PRD §84 "allow deletion"; audit `coach:conversation_deleted`) |
| POST | `/coach/messages` | `@Auth()` | `SendCoachMessageDto` | 201 `{conversationId, userMessage, coachMessage, proposal?: ProposalSummary, degraded: boolean}` |
| GET | `/coach/suggested-prompts` | `@Auth()` | — | 200 `{prompts: [{key,label,text}]}` |

`CoachMessage` response DTO: `{id, role, content, structured: CoachReply & {proposal?: {…, proposalId}} | null, attachmentIds, safety: {decision, category, userFacingNote?} | null, createdAt}` — `invocationId` is **not** exposed.

`CoachService.sendMessage(userId, dto)` — the orchestration (PRD §115 steps):
1. Resolve conversation (create when `conversationId` absent; title = first 60 chars of `text`); 403 if another user's.
2. Validate `attachmentIds` are the caller's `MediaAttachment` rows with `processingStatus === 'ready'` → else 400 `attachment_not_found`.
3. Persist the USER `CoachMessage` and bump `lastMessageAt`.
4. `SafetyPolicyService.evaluate({ userId, text, surface: 'coach' })` (E06-06). On `redirect`: persist a COACH message with `content = safety copy`, `structured: null`, `safetyDecision`, no gateway call; return `degraded: false`.
5. `ContextAssemblerService.assemble(userId, 'coach')` (E06-02). Build `recentTurns`: the last 10 messages of this conversation as `{role, content}` (Tier 4 — never the full history, never `structured`).
6. For each attachment lacking `aiSummary`, call `AiGatewayService.invoke({ persona: 'media_analyst', schema: mediaSummarySchema (E03-07), attachments: [{storageObjectId}] })` once and store the summary; then pass `attachments: [{id, kind, purpose, aiSummary}]` as **text** in the input.
7. `AiGatewayService.invoke<CoachReply>({ persona: 'coach', userId, promptVersion: COACH_PROMPT_VERSION, instructions: buildCoachInstructions({style, safety}), input: { context: renderForPrompt(ctx), recentTurns, attachments, userText: text }, schema: coachReplySchema, schemaName: 'coach_reply', safetyDecision })`.
8. `{ok:false}` → persist COACH message with `content = fallbackReply(error.code)`, `structured: null`, `invocationId`; return `degraded: true`; HTTP 201, never 5xx.
9. `guardCoachOutput` fails → `prisma.aiInvocation.update({ where: {id: invocationId}, data: { status: 'invalid_output', outputValid: false, errorCode: 'hallucination_guard', errorMessage: reason } })`, persist `fallbackReply('invalid_output')`, `degraded: true`.
10. `reply.proposal` non-null → `ProposalsService.createFromCoach(userId, { planId, summary, changes, sourceMessageId, invocationId })` (E06-04) → `proposalId` stored inside `structured.proposal`.
11. Persist COACH message (`content = user_message`, `structured`, `invocationId`, `safetyDecision`), bump `lastMessageAt`, return.

Log line (Pino, no content): `coach message conversation=<id> invocation=<id> intervention=<type> proposal=<bool> safety=<decision> degraded=<bool>`. Span `coach.send_message`. Audit only for `coach:conversation_deleted`.

Error codes: 400 `attachment_not_found`, 400 validation (Zod), 403 `forbidden` (foreign conversation), 404 `conversation_not_found`.

**UI (frontend-dev)** — n/a (E06-07).

**Tests (testing-dev)**
- Unit `apps/api/src/coach/contracts/coach-reply.contract.spec.ts`: accepts the PRD §16 example; rejects unknown `intervention_type`, `user_message` > 600, `proposal.changes` empty, both `proposal` and `friction_question` set (guard test).
- Unit `coach-output-guard.spec.ts`: invented `commitmentId` → fail; invented `planId` → fail; routine id from another plan → fail; valid ids → ok (PRD §90 cases "fabricated completion", "incorrect active plan", "invented schedule conflict").
- Unit `prompts/coach.prompt.spec.ts`: each style yields its tone block; `DIRECT` output never contains "disappoint"; version constant present; conservative block appended only when asked.
- Integration `apps/api/test/coach/coach-messages.integration.spec.ts` (`createTestApp({ overrideProviders: [{ provide: AiGatewayService, useValue: fakeGateway }, { provide: SafetyPolicyService, useValue: allowAll }] })`): happy path stores USER+COACH rows and returns `structured`; gateway `{ok:false, error:{code:'timeout'}}` → 201 with fallback content and `degraded:true`, no throw; hallucinated `commitmentId` → fallback reply and the `ai_invocations` row updated to `invalid_output`; `proposal` in output → `plan_change_proposals` row created and `structured.proposal.proposalId` returned, **`plan_versions` count unchanged**; redirect from safety stub → no gateway call (spy count 0) and `safetyDecision.decision === 'redirect'` on the message; cross-user conversation → 403; suggested prompts endpoint returns the 7 PRD §66 items in order; `fakeGateway` asserts `invoke` was called with `persona: 'coach'`, `promptVersion: 'coach.v1'`, `schemaName: 'coach_reply'`.
- `apps/api/test/openapi/openapi-document.spec.ts` passes with the new `Coach` tag.

**Docs (docs-dev)** — `docs/API.md` new section "Coach" (all six endpoints with request/response examples); `CLAUDE.md` "API Endpoints" → add "Coach" block; `docs/specs/coach-and-memory.md` §"Coaching contract".

#### Acceptance criteria

- [ ] `POST /coach/messages` with a valid text returns 201 with a COACH message whose `structured` validates against `coachReplySchema`.
- [ ] A reply containing an unknown `commitmentId` or `planId` is never returned to the client; the user gets the `invalid_output` template and the invocation row reads `invalid_output`.
- [ ] A reply with `proposal` creates exactly one `PlanChangeProposal` and **zero** `PlanVersion` rows.
- [ ] Provider errors (`timeout`, `rate_limit`, `no_user_key`, `ai_disabled`) produce 201 + template copy + `degraded:true`; the API never returns 5xx for them.
- [ ] Safety `redirect` produces the professional-care copy without a `coach` invocation.
- [ ] `GET /coach/suggested-prompts` returns the seven PRD §66 prompts in order.
- [ ] Coaching style changes the instructions (`DIRECT` vs `GENTLE` blocks) and `promptVersion` is `coach.v1` on every `ai_invocations` row.
- [ ] Conversations and messages are only readable by their owner (403 otherwise).
- [ ] `invocationId` and chain-of-thought never appear in any response body.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: provider/validation failures degrade to template replies with `degraded:true`; only ownership/validation errors are HTTP errors
- [ ] Observability: `coach.send_message` span; Pino line per message (ids, type, decision — never text); `ai_invocations` row per call with `promptVersion`; guard failures recorded as `invalid_output`
- [ ] Security: `@Auth()` on every route; ownership on conversation, attachments, and every id in the model output (guard); attachments only via the user's own `MediaAttachment`s
- [ ] Config & secrets: none new (uses the user's key through the gateway)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–4, then obtain a bearer via `POST /api/testing/login` (or use the browser cookie with `curl -b`).
2. `curl -X POST localhost:3535/api/coach/messages -H 'Content-Type: application/json' -d '{"text":"I am procrastinating"}'` → 201; `coachMessage.structured.intervention_type` present; `degraded:false`.
3. Stop the fake server (`docker compose stop fake-openai`), repeat → 201, `degraded:true`, content is the unavailability template; `psql` shows an `ai_invocations` row with `status='failed'`.
4. Restart fake server; send `My schedule changed. I can't work out Wednesday anymore.` → response has `proposal.id`; `select count(*) from plan_versions` unchanged.
5. `GET /api/coach/suggested-prompts` → 7 prompts.

#### Out of scope

- Streaming, message editing, regenerate, conversation search.
- Persisting `Obstacle` rows from friction answers (E07-03).

#### Notes for the implementing agent

- Controller/DTO shape: copy `apps/api/src/pat/pat.controller.ts` (own-resource `@Auth()`, `@ApiDataResponse` from `common/decorators/api-data-response.decorator.ts`, `createZodDto`).
- Use `@CurrentUser()` (`apps/api/src/auth/decorators/current-user.decorator.ts`) for `userId`; never trust ids in the body for ownership.
- The gateway already writes the `ai_invocations` row; do **not** write a second one. The `safetyDecision` argument on `invoke` is added by E06-06 — if that child hasn't merged yet, land the coach without it and add the argument in a follow-up commit.
- Register `Coach` under a new `Coaching` group in `apps/api/src/openapi/tags.ts`; the OpenAPI spec test fails on orphaned/undeclared tags.
- Fastify: there is no `req.user` magic beyond the guards; JSON bodies only.
- Do not add a `SYSTEM` message per turn; the enum value exists for future system notices (e.g. "Plan updated to v2"), which E06-04 writes when a proposal created from this conversation is accepted.

---

### E06-04 `feat(api): add plan-change proposal accept, edit and reject mutation protocol`

**Part of epic:** E06 · **Blocked by:** E06-01 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §15 fixes the mutation protocol: AI produces a proposal → product displays a diff → user approves or edits → plan service validates → a new plan version becomes active → the previous version stays in history → a change event is recorded. VISION §19: "EvolvePath owns the plan. AI owns the coaching." PRD §80 requires version history with a reason; §89 "Mutation safety" and §107 require that the AI never changes plans without approval. The coach (E06-03), weekly review (E10) and workout adaptation (E09-05) all need one implementation of that protocol.

#### Proposed solution

**Data (database-dev)** — n/a (E06-01).

**API (backend-dev)**

Files (new) under `apps/api/src/coach/proposals/`:
- `plan-change.schema.ts` —
  ```ts
  export const PLAN_CHANGE_OPS = ['move','reduce','replace','add','remove','pause'] as const;
  export const routineSnapshotSchema = z.object({ title, triggerType, triggerValue, frequency, preferredTime, estimatedDurationMinutes, minimumDurationMinutes, fallbackBehavior }).partial(); // field names = Routine (E02-01)
  export const planChangeSchema = z.object({
    op: z.enum(PLAN_CHANGE_OPS),
    target: z.object({ type: z.enum(['routine','commitment']), id: z.string().uuid().nullable() }),
    before: routineSnapshotSchema.nullable(),
    after: routineSnapshotSchema.nullable(),
    reason: z.string().min(1).max(200),
  });
  export type PlanChange = z.infer<typeof planChangeSchema>;
  ```
  Rules: `add` ⇒ `target.id === null` and `after` non-null; `remove`/`pause` ⇒ `target.id` non-null; `move` ⇒ `after.preferredTime` or `after.triggerValue` set; `reduce` ⇒ `after.estimatedDurationMinutes < before.estimatedDurationMinutes`; `replace` ⇒ both snapshots non-null. Encoded in `superRefine`.
- `apply-changes.ts` — **pure**, no Prisma:
  ```ts
  export interface PlanVersionSnapshot { routines: RoutineSnapshotWithId[]; futureCommitments: CommitmentSnapshotWithId[]; expectedWeeklyLoad: number | null; fallbackStrategy: string | null }
  export type ApplyResult = { ok: true; next: PlanVersionSnapshot; diff: DiffEntry[]; commitmentEffects: CommitmentEffect[] } | { ok: false; errors: Array<{ index: number; code: 'target_not_found'|'invalid_after'|'duplicate_target'|'nothing_changes'; message: string }> };
  export function applyChanges(snapshot: PlanVersionSnapshot, changes: PlanChange[]): ApplyResult;
  ```
  `DiffEntry = { op, target: {type,id,title}, fields: Array<{ field, before, after }> }` (what the UI renders). `CommitmentEffect = { commitmentId, effect: 'cancel' | 'reschedule', to?: { preferredTime, triggerValue } }` for future `PLANNED` commitments of removed/paused (cancel) or moved (reschedule) routines. `add` creates a routine with a fresh `tmp:<index>` id that the service replaces with a real uuid. Same input ⇒ same output; array order preserved.
- `proposals.service.ts` — `ProposalsService`:
  - `createFromCoach(userId, {planId, summary, changes, sourceMessageId, invocationId})` → validates `planChangeSchema[]`, verifies the plan is the user's and has an ACTIVE version, sets `expiresAt = now + 7d`, `sourceKind: COACH`. `createFromSource(userId, sourceKind, …)` for E09/E10.
  - `list(userId, {status?, planId?})`, `get(userId, id)` → attaches `preview: applyChanges(snapshot, changes).diff` (or `errors`) and `plan: {id, outcomeTitle, domain, activeVersion}`; marks `PROPOSED|EDITED` rows with `expiresAt < now` as `EXPIRED` on read (lazy expiry, no cron).
  - `edit(userId, id, changes)` → status must be `PROPOSED|EDITED` and unexpired; stores `originalChanges` if null; replaces `changes`; `status = EDITED`, `editedAt`; validates via `applyChanges` first (422 `invalid_changes` with the error list).
  - `accept(userId, id)` → in one `prisma.$transaction`: lock proposal (`PROPOSED|EDITED`, unexpired → else 409 `proposal_not_actionable` / `proposal_expired`); load the plan's ACTIVE `PlanVersion` + routines + future `PLANNED` commitments (`scheduledAt >= startOfToday` in the user's timezone) into a snapshot; `applyChanges`; on error 422; `PlansService.createVersion(planId, { status: 'DRAFT', createdBy: proposal.status === 'EDITED' ? 'USER' : 'AI', previousVersionId: active.id, rationale: summary + '\n' + changes.map(c => c.reason).join('\n'), routines: next.routines, expectedWeeklyLoad, fallbackStrategy })` → `PlansService.activateVersion(newId)` (previous → `SUPERSEDED`, new → `ACTIVE`, `userApproved: true`); apply `commitmentEffects` (cancel → status `CANCELLED`, `skipReason: 'plan_change'`; reschedule → new `scheduledAt`, `rescheduleCount` **not** incremented — this is a plan change, not a user reschedule); proposal → `ACCEPTED`, `appliedPlanVersionId`, `decidedAt`; if `sourceMessageId` set, insert a `SYSTEM` `CoachMessage` "Plan updated to v<N>." in that conversation. After commit: audit `plan:change_accepted` meta `{proposalId, planId, fromVersion, toVersion, opCount, edited, invocationId}`.
  - `reject(userId, id, reason?)` → `REJECTED`, `decidedAt`, `decisionReason`; audit `plan:change_rejected` meta `{proposalId, planId, invocationId, hasReason}`.
- `proposals.controller.ts`, `dto/edit-proposal.dto.ts` (`{changes: PlanChange[] min1 max10}`), `dto/reject-proposal.dto.ts` (`{reason?: ≤300}`), `dto/proposal-response.dto.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/proposals` | `@Auth()` own | `?status=PROPOSED&planId=` | 200 `{items: ProposalSummary[]}` newest first |
| GET | `/proposals/:id` | `@Auth()` own → 403 | — | 200 `ProposalDetail` (+`preview`, `plan`) |
| POST | `/proposals/:id/accept` | `@Auth()` own | — | 200 `{proposal, planVersion: {id, version, status}}` |
| POST | `/proposals/:id/edit` | `@Auth()` own | `{changes}` | 200 `ProposalDetail` (status `EDITED`) |
| POST | `/proposals/:id/reject` | `@Auth()` own | `{reason?}` | 200 `ProposalSummary` (status `REJECTED`) |

OpenAPI tag `Plan Proposals` in the `Coaching` group. Error codes: 403 `forbidden`, 404 `proposal_not_found`, 409 `proposal_not_actionable`, 409 `proposal_expired`, 422 `invalid_changes`.

**UI (frontend-dev)** — n/a (E06-07).

**Tests (testing-dev)**
- Unit `apply-changes.spec.ts` (table-driven): move Wednesday 18:30 → Saturday 09:00 yields one `DiffEntry` with `preferredTime`/`triggerValue` fields and a `reschedule` effect per future commitment; `reduce` 40 → 15 min; `remove` yields `cancel` effects; `add` yields `tmp:` id; `pause`; unknown target → `target_not_found` with index; `reduce` with larger `after` → `invalid_after`; two changes on the same target → `duplicate_target`; determinism (deep-equal across two calls); original snapshot not mutated.
- Unit `plan-change.schema.spec.ts`: each op's `superRefine` rule.
- Integration `apps/api/test/coach/proposals.integration.spec.ts`: seed outcome → plan → v1 ACTIVE → routine → 3 future commitments (through E02 services); create proposal via `ProposalsService.createFromCoach`; **`plan_versions` count is 1 after create, after `GET`, and after `/edit`**; after `/accept` count is 2, v1 `SUPERSEDED`, v2 `ACTIVE`, `createdBy AI`, `rationale` contains the summary, proposal `ACCEPTED` with `appliedPlanVersionId`; future commitments rescheduled/cancelled per effects, past ones untouched, `evidence` untouched; edited-then-accepted → `createdBy USER`; second `/accept` → 409; `/reject` leaves count at 1 and writes `plan:change_rejected`; expired proposal → 409 and status reads `EXPIRED`; cross-user → 403; audit row `plan:change_accepted` with `fromVersion:1,toVersion:2`.
- `openapi-document.spec.ts` passes with the `Plan Proposals` tag.

**Docs (docs-dev)** — `docs/API.md` "Plan Proposals" section; `CLAUDE.md` endpoints block + a "Proposing a plan change" recipe under Common Patterns (call `ProposalsService.createFromSource`, never `PlansService.createVersion` directly from AI code); `docs/specs/coach-and-memory.md` §"Mutation protocol".

#### Acceptance criteria

- [ ] No code path other than `POST /proposals/:id/accept` creates a `PlanVersion` from AI output (integration test asserts counts at every step).
- [ ] Accept creates v(N+1) `ACTIVE`, marks vN `SUPERSEDED`, keeps vN readable via E02-03's version endpoints, and records `plan:change_accepted`.
- [ ] Edit stores the user's changes, keeps `originalChanges`, sets `EDITED`, and an accept after edit is attributed `createdBy: USER`.
- [ ] Reject never touches plans and records `plan:change_rejected`.
- [ ] Invalid change sets (unknown target, non-reducing reduce, duplicates) are rejected with 422 and a per-index error list, before any write.
- [ ] Proposals older than 7 days read as `EXPIRED` and cannot be accepted (409).
- [ ] Future PLANNED commitments of moved routines are rescheduled without incrementing `rescheduleCount`; past commitments and evidence are never modified.
- [ ] Only the owner can read or decide a proposal.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: accept is atomic (`$transaction`); 409/422 with named codes; no partial versions on failure
- [ ] Observability: audit `plan:change_accepted` / `plan:change_rejected`; span `proposals.accept`; Pino line with proposalId/planId/versions
- [ ] Security: ownership on proposal, plan and every target id; AI output never applied without the user's HTTP call
- [ ] Config & secrets: `PROPOSAL_TTL_DAYS` constant (7) in `proposals.service.ts`, no env var
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script through step 6 (a proposal exists). `GET /api/proposals?status=PROPOSED` → one item with `preview.diff`.
2. `POST /api/proposals/<id>/edit` with the same change but `after.preferredTime: "10:00"` → `status: EDITED`, `originalChanges` populated.
3. `POST /api/proposals/<id>/accept` → `planVersion.version === 2`; `GET /api/plans/<planId>/versions` → v1 `SUPERSEDED`, v2 `ACTIVE`, `createdBy USER`.
4. Repeat accept → 409 `proposal_not_actionable`. `psql`: `select action, meta from audit_events where action='plan:change_accepted'`.

#### Out of scope

- Proposal expiry sweeps/cron; notifications on new proposals (E12 N9 "Plan issue").
- Cross-domain load checks on accept (E10-03).

#### Notes for the implementing agent

- Use `PlansService.createVersion`/`activateVersion` from E02-03; if their signatures differ from the sketch here, adapt the call, not the protocol. Never bypass them with raw `planVersion.create`.
- `applyChanges` must stay pure and side-effect free — it is reused by `GET /proposals/:id` for the preview and by the web diff (same `DiffEntry` shape, serialized).
- Transactions: Prisma interactive `$transaction(async (tx) => …)`; pass `tx` into the E02 services (they must accept an optional client — add that overload in this child if E02-03 didn't).
- Audit pattern: `apps/api/src/email/email-settings.service.ts` `auditEvent.create`; `targetType: 'plan'`, `targetId: planId`.
- Timezone for "future" comes from `user_profiles.timezone` (E04-01), default UTC.

---

### E06-05 `feat(api): add memory insight endpoints and the pattern-analysis proposer`

**Part of epic:** E06 · **Blocked by:** E06-01, E06-02 · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §17 Tier 3 requires durable preferences that are "inspectable and removable"; §10.12 says durable inferences "should usually require explicit user approval before becoming strong planning assumptions"; §85 gives the controls (Edit / Forget / Do not use for coaching); §127 lists "delete memory"; VISION §23 describes the loop ("I've noticed you complete morning workouts much more consistently… Save that as a planning preference? Yes / No"). PRD §14.4 defines the Pattern Analysis Service that produces candidate insights. The tables exist (E06-01); no endpoints, no proposer, and the context assembler (E06-02) must honour the flags end to end.

#### Proposed solution

**Data (database-dev)** — n/a (E06-01).

**API (backend-dev)**

Files (new) under `apps/api/src/coach/memory/`: `memory-insights.controller.ts`, `memory-insights.service.ts`, `pattern-analysis.service.ts`, `pattern-stats.ts` (pure aggregation), `dto/create-memory-insight.dto.ts` (`{category: MemoryInsightCategory, statement: string 1..280}`), `dto/update-memory-insight.dto.ts` (`{statement}`), `dto/set-do-not-use.dto.ts` (`{doNotUse: boolean}`), `dto/memory-insight-response.dto.ts`; `apps/api/src/coach/prompts/pattern-analyst.prompt.ts` (`PATTERN_ANALYST_PROMPT_VERSION = 'pattern_analyst.v1'`); `apps/api/src/coach/contracts/insight-proposal.contract.ts`:
```ts
export const insightProposalSchema = z.object({
  insights: z.array(z.object({
    category: z.enum(['WORK','FAMILY','HEALTH','COACHING_PREFERENCE','NOTIFICATION_PREFERENCE','PATTERN']),
    statement: z.string().min(1).max(200),      // the durable sentence, written for the user
    observation: z.string().min(1).max(200),    // the fact it rests on (PRD §14.4: observation vs inference)
    evidenceCount: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
  })).max(5),
});
```

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/memory-insights` | `@Auth()` | `?category=&includeDoNotUse=true` | 200 `{items: MemoryInsight[]}` ordered `category, userConfirmed desc, confidence desc` |
| POST | `/memory-insights` | `@Auth()` | `CreateMemoryInsightDto` | 201 (source `USER`, `userConfirmed true`, `confidence 1`, `evidenceCount 0`); audit `memory_insight:create` |
| PATCH | `/memory-insights/:id` | `@Auth()` own | `{statement}` | 200 (PRD §85 Edit; an edited AI insight becomes `userConfirmed true`); audit `memory_insight:edit` |
| POST | `/memory-insights/:id/confirm` | `@Auth()` own | — | 200 `userConfirmed true`; audit `memory_insight:confirm` |
| POST | `/memory-insights/:id/do-not-use` | `@Auth()` own | `{doNotUse: boolean}` | 200; audit `memory_insight:do_not_use` meta `{doNotUse}` |
| DELETE | `/memory-insights/:id` | `@Auth()` own | — | 204 hard delete (the UI's **Forget**); audit `memory_insight:forget` meta `{category}` only — never the statement |
| POST | `/memory-insights/propose` | `@Auth()` | — | 200 `{created: MemoryInsight[], skipped: 'insufficient_data' \| 'ai_unavailable' \| null}`; throttled 1 per 10 min per user (429) |

OpenAPI tag `Memory Insights` (group `Coaching`). Cross-user → 403; unknown → 404.

`PatternAnalysisService.proposeInsights(userId)`:
1. `aggregateStats(userId, 28 days)` (`pattern-stats.ts`, pure over fetched rows): completion rate per domain; per weekday; per time-of-day bucket (`morning` < 12:00, `afternoon`, `evening` ≥ 18:00, user timezone); reschedule counts per commitment title; fallback (short/minimum version) usage count; average planned-vs-logged duration gap; misses with `skipReason` histogram. Returns `{sampleSize, …}`.
2. `sampleSize < 10` decided commitments → return `{created: [], skipped: 'insufficient_data'}` without calling AI.
3. `AiGatewayService.invoke({ persona: 'pattern_analyst', promptVersion, instructions (role: produce at most 5 durable, user-facing statements; distinguish observation from inference; never diagnose; never mention family members by name; confidence reflects sample size), input: { stats, existingStatements }, schema: insightProposalSchema, schemaName: 'insight_proposal' })`.
4. `{ok:false}` → `{created: [], skipped: 'ai_unavailable'}`.
5. Dedupe: skip proposals whose `statement` matches an existing row case-insensitively in the same category (including `doNotUse` rows — "forgotten" rows are gone, "do not use" rows must not be re-proposed).
6. Create rows `{source: 'AI', userConfirmed: false, doNotUse: false, evidenceCount, confidence, expiresAt: now + 90d, invocationId}`; audit `memory_insight:propose` meta `{count}`.
7. If `created.length > 0`: `notifications.notify('memory.insight_proposed', userId, { count })`.

Notification (CLAUDE.md recipe): register `memory.insight_proposed` in `apps/api/src/notifications/notification-events.ts` (`label: 'New coaching insight to review'`, `channels: ['browser']`, `defaultEnabled: true`, not mandatory) and a browser template in `EVENT_BROWSER_TEMPLATES` (`apps/api/src/notifications/channels/browser-notification.channel.ts`) returning `{ title: 'The coach noticed a pattern', body: '<count> new insight(s) to confirm or dismiss.', link: '/settings/ai-memory' }`. `CoachModule` imports `NotificationsModule`.

E06-02 hook: no assembler change is needed for the coach scopes (the query already requires `userConfirmed && !doNotUse`); add `assembleForPatternAnalysis` **not** — the proposer uses `aggregateStats`, not the assembler, so per-user free text never reaches the `pattern_analyst` persona.

**UI (frontend-dev)** — n/a (E06-08).

**Tests (testing-dev)**
- Unit `pattern-stats.spec.ts`: fixture of 30 commitments → morning rate 0.8 / evening 0.3, weekday table, reschedule histogram; empty input → `sampleSize 0`; timezone bucketing (a 23:30 UTC completion in `America/Costa_Rica` is `afternoon`).
- Unit `pattern-analysis.service.spec.ts` (mock Prisma + gateway): below threshold → no invoke; dedupe against existing and `doNotUse` rows; `{ok:false}` → `ai_unavailable`; created rows are unconfirmed with 90-day expiry; `notify` called once with the count.
- Integration `apps/api/test/coach/memory-insights.integration.spec.ts`: CRUD; confirm flips flag; do-not-use round trip; delete → 204 and row gone; PATCH on AI insight sets `userConfirmed`; cross-user 403; `/propose` with stubbed gateway creates rows and second call within 10 min → 429; **assembler check**: after `do-not-use`, `ContextAssemblerService.assemble(userId,'coach').memoryInsights` no longer contains it (real service, real DB); audit rows exist for each action and never contain the statement for `forget`.
- `notification-events.spec.ts` (existing) still passes with the new event; add a case that `memory.insight_proposed` declares only `browser`.

**Docs (docs-dev)** — `docs/API.md` "Memory Insights"; `CLAUDE.md` endpoints block; `docs/specs/coach-and-memory.md` §"Memory tiers and user control".

#### Acceptance criteria

- [ ] A user can list, add, edit, confirm, exclude (`doNotUse`) and delete their own insights; every action writes the audit action named above.
- [ ] An insight marked `doNotUse` disappears from `assemble(userId, 'coach')` immediately and is never re-proposed by `/propose`.
- [ ] Deleted insights are gone (hard delete), not soft-hidden; the audit row for a delete carries the category only.
- [ ] `/propose` returns `insufficient_data` below 10 decided commitments without calling the model; with data it creates ≤ 5 unconfirmed, 90-day-expiring insights and raises one `memory.insight_proposed` notification.
- [ ] `/propose` is throttled to one call per 10 minutes per user (429 with `retryAfterSeconds`).
- [ ] AI-proposed insights are `userConfirmed=false` and therefore not used by the coach until confirmed.
- [ ] Cross-user access returns 403.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: AI failure → `skipped: 'ai_unavailable'`, never 5xx; 404/403/429 with named codes
- [ ] Observability: `ai_invocations` row per proposer run (`persona pattern_analyst`, `promptVersion pattern_analyst.v1`); audit for every mutation; span `memory.propose`
- [ ] Security: ownership on every route; the proposer input is aggregated counts only (no free text, no names)
- [ ] Config & secrets: constants `INSIGHT_TTL_DAYS = 90`, `MIN_SAMPLE = 10`, `PROPOSE_THROTTLE_MS` in the service
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic stack up, user with ≥ 10 decided commitments (seed via E05 endpoints or the e2e helper).
2. `POST /api/memory-insights/propose` → `created` has 2 items (fake server scenario `pattern-insights`), a browser notification appears in the inbox linking to `/settings/ai-memory`.
3. `POST /api/memory-insights/<id>/do-not-use {"doNotUse":true}` → send a coach message; `psql`: the coach `ai_invocations.input` (redacted JSON) does not contain the statement.
4. `DELETE /api/memory-insights/<id>` → 204; `select action, meta from audit_events where action='memory_insight:forget'` → meta has `category` only.
5. `POST /api/memory-insights/propose` again immediately → 429.

#### Out of scope

- Scheduled (cron) proposer runs — E10's weekly review calls `proposeInsights`; E11 replaces `aggregateStats` with the momentum engine's analytics.
- Obstacle creation (E07-03).

#### Notes for the implementing agent

- Throttle: reuse `apps/api/src/ai/gateway/test-throttle.ts` (E01-06 per-user sliding window) rather than adding `@nestjs/throttler`.
- Notification recipe is in `CLAUDE.md` → "Adding a Notification"; `notify()` after the insight rows are committed and outside any transaction.
- Keep `aggregateStats` in its own file with no Nest decorators so E11 can lift it.
- Audit metadata for `forget` must not include the statement (PRD §86 data minimization — the user asked to forget it).

---

### E06-06 `feat(api): add deterministic safety pre-check and safety-persona policy`

**Part of epic:** E06 · **Blocked by:** none (needs E01-06 merged) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §14.8 requires a Safety Layer that evaluates "health, eating, emotional distress, relationship, and professional-sensitivity requests" and may allow, allow with conservative framing, restrict, redirect, or escalate to professional-care guidance. §81 forbids diagnosis, medication changes, dangerous restriction and training through serious pain; §82 requires crisis content to trigger safety protocols and forbids therapist claims; §45 (pain) and §18 (trust) reinforce it. §88 requires the safety decision to be logged — `ai_invocations.safetyDecision` exists (E01-01) and is empty. E04's planner already accepts free text with no check; E06-03 and E09 will accept more.

#### Proposed solution

A small module with a deterministic pre-check that decides most inputs without a model call, a `safety` persona for the ambiguous middle, fixed professional-care copy, and one decision type every AI call site records.

**Data (database-dev)** — n/a (`ai_invocations.safetyDecision Json?` exists).

**API (backend-dev)**

Files (new) under `apps/api/src/coach/safety/`:
- `safety.module.ts` — `SafetyModule` (`imports: [AiModule]`, exports `SafetyPolicyService`). Separate from `CoachModule` so `OnboardingModule` (E04) and E09's workout module import it without pulling the coach in.
- `safety.types.ts` —
  ```ts
  export type SafetyDecisionKind = 'allow' | 'conservative' | 'redirect';
  export type SafetyCategory = 'none' | 'injury' | 'disordered_eating' | 'crisis' | 'medication' | 'pregnancy' | 'other_medical';
  export type SafetySurface = 'coach' | 'planner' | 'workout' | 'media';
  export interface SafetyDecision { decision: SafetyDecisionKind; category: SafetyCategory; userFacingNote?: string; source: 'precheck' | 'model' | 'model_unavailable'; matchedRule?: string; promptVersion?: string }
  ```
- `safety-patterns.ts` — `SAFETY_RULES: Array<{ id: string; category; strength: 'definite' | 'ambiguous'; pattern: RegExp }>`, case-insensitive, word-boundary regexes. Minimum set (extend freely, keep ids stable — they are logged):
  - `crisis`: definite — `kill myself`, `suicid`, `end my life`, `self-harm|self harm|hurt myself`, `don't want to be alive|dont want to live`; ambiguous — `hopeless`, `can't go on`, `worthless`.
  - `injury`: definite — `chest pain`, `numb(ness)?`, `can't (put )?weight`, `sharp pain`, `pop(ped)? (in|my)`, `heard a (crack|pop)`; ambiguous — `pain`, `hurts?`, `injur`, `tweak`, `sore` (sore alone → `allow` unless combined with `sharp|severe|worse`).
  - `disordered_eating`: definite — `purg`, `starv`, `fast(ing)? for \d+ days`, `under (5|6|7|8)00 calories`, `laxative`, `throw up after`; ambiguous — `skip (meals|lunch|dinner)`, `eat less`, `lose \d+ (lbs|pounds|kg) (in|by)`.
  - `medication`: definite — `stop taking`, `(my|the) (dose|dosage)`, `(insulin|antidepressant|blood pressure (meds|medication))`; ambiguous — `medication`, `pills`.
  - `pregnancy`: ambiguous — `pregnan`, `postpartum`, `trimester`.
  - `other_medical`: ambiguous — `diagnos`, `doctor said`, `condition`.
- `safety-copy.ts` — `SAFETY_REDIRECT_COPY: Record<Exclude<SafetyCategory,'none'>, string>` (professional-care copy, plain, no diagnosis, no therapist claim; `crisis` copy names local emergency services and a crisis line placeholder "or a crisis line in your country", ends with "I'm a behaviour coach, not a clinician, and I'm here when you want to plan the next small step"), `SAFETY_CONSERVATIVE_INSTRUCTIONS` (appended to the calling persona's instructions: no intensity increases, suggest professional check where relevant, keep actions minimal, never diagnose), `SAFETY_CONSERVATIVE_NOTE` (short user-facing line shown under the reply).
- `apps/api/src/coach/prompts/safety.prompt.ts` — `SAFETY_PROMPT_VERSION = 'safety.v1'`, instructions: classify only; never advise.
- `apps/api/src/coach/contracts/safety-decision.contract.ts` — `safetyModelSchema = z.object({ decision: z.enum(['allow','conservative','redirect']), category: z.enum([...]), rationale: z.string().max(200) })`.
- `safety-policy.service.ts` — `SafetyPolicyService.evaluate({ userId, text, surface }): Promise<SafetyDecision>`:
  1. `precheck(text)` (pure, exported for tests): run all rules; any `definite` match → `{decision:'redirect', category, source:'precheck', matchedRule, userFacingNote: SAFETY_REDIRECT_COPY[category]}`; no match → `{decision:'allow', category:'none', source:'precheck'}`; only `ambiguous` matches → continue.
  2. Ambiguous → `AiGatewayService.invoke({ persona: 'safety', userId, promptVersion, instructions, input: { text, surface, matchedRules }, schema: safetyModelSchema, schemaName: 'safety_decision', maxOutputTokens: 200 })`. `ok` → map to `SafetyDecision` with `source:'model'` (+ copy/note); `{ok:false}` → `{decision:'conservative', category: first ambiguous category, source:'model_unavailable', userFacingNote: SAFETY_CONSERVATIVE_NOTE}` (fail toward caution, never toward silence and never toward blocking the deterministic product).
  3. Log Pino `safety decision=<d> category=<c> source=<s> surface=<surface> rule=<id>` — never the text.
- Gateway change (E01-06 file `apps/api/src/ai/gateway/ai-gateway.types.ts`/`ai-gateway.service.ts`): add optional `safetyDecision?: SafetyDecision` to `invoke` options; when present it is written to `ai_invocations.safetyDecision` for that call. Additive, backward-compatible. The `safety` persona's own invocation row records its output as its `safetyDecision` too.
- Call-site retrofit in this child: `OnboardingService.propose` (E04-02) runs `evaluate({surface:'planner'})` over the concatenated free-text answers; `redirect` → the proposal step returns the copy and the deterministic templates (`/onboarding/skip-ai` path) instead of calling the planner; `conservative` → instructions appended. E06-03 (coach) and E09 (workout, media) call it themselves.

No endpoints. No audit (decisions live on `ai_invocations` and `coach_messages`).

**UI (frontend-dev)** — n/a (E06-07 renders `safety` on messages).

**Tests (testing-dev)**
- Fixture `apps/api/src/coach/safety/__fixtures__/safety-cases.json` — ≥ 40 entries `{ text, expected: { decision, category }, viaModel?: boolean, modelReply?: {...} }` covering: "I have sharp chest pain when I run" → redirect/injury (precheck); "my knee hurts a bit after squats" → viaModel, model says conservative; "legs are sore from yesterday" → allow (precheck, `sore` alone); "I want to fast for 5 days" → redirect/disordered_eating; "should I skip lunch to hit my goal" → viaModel; "I don't want to be alive" → redirect/crisis; "feeling hopeless about this project" → viaModel; "should I stop taking my blood pressure meds before workouts" → redirect/medication; "I'm 20 weeks pregnant, can I keep lifting" → viaModel → conservative; "help me plan my week" → allow; plus Spanish/mixed-case variants of the definite phrases.
- Unit `safety-policy.service.spec.ts`: iterates the fixture; asserts the gateway mock is called **only** for `viaModel` cases; `{ok:false}` on an ambiguous case → `conservative` + `model_unavailable`; `redirect` always carries `userFacingNote`; `precheck` is pure (no Date, no IO) and returns stable `matchedRule` ids.
- Unit `safety-patterns.spec.ts`: every rule has a unique id, every regex has the `i` flag, no rule matches the empty string.
- Integration `apps/api/test/coach/safety-invocation-log.integration.spec.ts`: with a stubbed provider, `invoke({ safetyDecision })` persists it on `ai_invocations.safetyDecision`.
- E04's onboarding integration spec gains a case: crisis text in answers → `propose` returns copy + templates, planner invocation count 0.

**Docs (docs-dev)** — `docs/specs/coach-and-memory.md` §"Safety policy" (rule table, decision flow, copy ownership); `docs/SECURITY-ARCHITECTURE.md` short "AI safety layer" subsection; `CLAUDE.md` Common Patterns → "Calling an AI persona" step "run `SafetyPolicyService.evaluate` on user free text first".

#### Acceptance criteria

- [ ] Every fixture case yields the expected `{decision, category}`; definite cases never invoke the model.
- [ ] `redirect` decisions return professional-care copy and the caller does not invoke its persona (verified in E06-03's spec and E04's spec).
- [ ] When the `safety` model is unavailable, ambiguous input degrades to `conservative`, never to `allow` and never to an HTTP error.
- [ ] Every `ai_invocations` row created by a call site that ran `evaluate` carries `safetyDecision`; the `safety` persona's own rows carry `promptVersion 'safety.v1'`.
- [ ] Copy never claims diagnosis, treatment or therapist status (assertion in the copy spec: strings do not contain "diagnos", "prescrib", "therapist").
- [ ] `SafetyModule` is importable by `OnboardingModule` without a circular import (E04 planner retrofit passes).
- [ ] Logs never contain the evaluated text.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: pre-check cannot throw; model failure → `conservative`; callers never see exceptions from `evaluate`
- [ ] Observability: Pino decision line; `ai_invocations.safetyDecision` populated; span `safety.evaluate` with `safety.decision`, `safety.source`, `safety.rule` attributes
- [ ] Security: text never logged; the `safety` persona classifies only (schema has no free-form advice field)
- [ ] Config & secrets: none; rules are code, versioned with `SAFETY_PROMPT_VERSION`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script step 8 (chest pain) → redirect copy, no coach invocation row.
2. Send `my knee hurts a bit after squats` → reply present with the conservative note; `psql`: `select persona, "safetyDecision" from ai_invocations order by "createdAt" desc limit 2` → a `safety` row and a `coach` row whose `safetyDecision->>'decision' = 'conservative'`.
3. `docker compose stop fake-openai`; send `should I skip lunch today` → conservative note shown, `source = model_unavailable`.

#### Out of scope

- Region-specific hotline numbers, localization, a "restrict" (silent block) tier — everything blocked is redirected with copy.
- Admin-editable rules or copy (code-only in V1).

#### Notes for the implementing agent

- Keep `precheck` and the rule table free of Nest so the fixture spec runs without a module.
- Word-boundary and Unicode: use `\b` carefully with accented text; test the Spanish variants in the fixture.
- Don't over-match: `sore`, `tired`, `stressed` alone are `allow` — the product must not redirect normal coaching language (PRD §82 "may use ordinary behavior-change language").
- The gateway option is the only change to E01 code; keep it additive and covered by the existing gateway spec.

---

### E06-07 `feat(web): add Coach screen with proposal cards, diff view and attachments`

**Part of epic:** E06 · **Blocked by:** E06-03, E06-04 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §66 defines the Coach screen: chat with suggested prompts, context-aware ("the user should not need to restate active goals"), never the only way to reach AI. §15 requires proposals to render as a diff with **Accept / Edit / Keep current plan**; §128 requires a "Why this?" on important recommendations; §67 fixes the response shape and CTA ("Start 10 minutes"); §123 requires mobile-first. The `/coach` destination exists as a placeholder since E02-05; the API surface arrives with E06-03/E06-04.

#### Proposed solution

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (uses E06-03, E06-04, E03-04 attachments).

**UI (frontend-dev)**

Route: replace the E02-05 placeholder at `/coach` in `apps/web/src/App.tsx` with `CoachPage`; add `/coach/:conversationId`. `DESTINATIONS` already has `coach` (E02-05) — no registry change. `resolveActiveDestination` must own `/coach/*` (check `apps/web/src/config/destinations.ts` `DESTINATION_ROUTES`).

`apps/web/src/types/index.ts`: `CoachConversation`, `CoachMessage`, `CoachReply` (mirror of the contract incl. `INTERVENTION_TYPES`), `PlanChange`, `DiffEntry`, `ProposalSummary`, `ProposalDetail`, `SafetyInfo`, `SuggestedPrompt`.

`apps/web/src/services/api.ts`: `getCoachConversations()`, `createCoachConversation(title?)`, `getCoachMessages(conversationId, params?)`, `deleteCoachConversation(id)`, `sendCoachMessage({conversationId?, text, attachmentIds?})`, `getSuggestedPrompts()`, `getProposals(params?)`, `getProposal(id)`, `acceptProposal(id)`, `editProposal(id, changes)`, `rejectProposal(id, reason?)`.

Hooks: `hooks/useCoachConversations.ts` (list + create + delete), `hooks/useCoachChat.ts(conversationId)` — messages, `send(text, attachmentIds)` with **optimistic** USER bubble (`status: 'pending' | 'sent' | 'failed'`, retry on failed), a `thinking` flag while awaiting the reply, replaces the temp id with the server row; `hooks/useProposals.ts` — `accept/edit/reject` that update the message's embedded proposal status in place.

Components under `apps/web/src/components/coach/` (all new):
- `CoachPage.tsx` (`pages/CoachPage.tsx`): layout gate `useMediaQuery(theme.breakpoints.down('sm'))` — **local** layout choice, documented in a comment as not one of the five coupled gates. `<sm`: conversation list screen; tapping opens the conversation full-screen with an AppBar back arrow (`navigate('/coach')`); `/coach` with no id shows the list. `≥sm`: 280 px `ConversationList` side panel + `ConversationView`; `/coach` with no id opens a new empty conversation with prompt chips.
- `ConversationList.tsx` — `{items, activeId, onSelect, onNew, onDelete}`; MUI `List`; delete via confirm dialog.
- `ConversationView.tsx` — `role="log" aria-live="polite" aria-relevant="additions"` scrollable message area (auto-scroll on new message; do not steal focus), `SuggestedPromptChips` when the conversation is empty, `CoachComposer` pinned at the bottom (on phones sits above `BottomNav`; do not alter `<main>`'s `pb`).
- `MessageBubble.tsx` — `{message}`; USER right-aligned; COACH left with: `content`, `RecommendedActionCard` (`Start <n> min` → `navigate('/today?commitment=<id>&action=start')`, or `/today` when no id — E05's Start flow route; verify the exact query params against E05-05), `fallback_action` as secondary text "Fallback: <title> (<n> min)", `FrictionQuestion` (`options` as toggle buttons that send the chosen option as the next user message), `ProposalCard` when `structured.proposal`, `WhyThisExpander` (MUI `Accordion`, summary "Why this?", body `reasoning_summary`; absent when `structured` is null), `SafetyNote` (`Alert severity="info"` with `userFacingNote` for `conservative`/`redirect`); SYSTEM messages centred, muted ("Plan updated to v2").
- `ProposalCard.tsx` — `{proposal, onAccept, onEdit, onReject}`: title "I recommend changing your <domain> plan", `summary`, `PlanChangeDiff`, buttons **Accept** (contained), **Edit** (outlined → `EditProposalDialog`), **Keep current plan** (text). After decision: status chip (Accepted → "Plan updated (v<N>)" with link to `/path`; Rejected → "Kept current plan"); buttons disabled; expired → "This proposal expired".
- `PlanChangeDiff.tsx` — `{entries: DiffEntry[], dense?: boolean}`; ≥sm: table (`<caption>` "Proposed changes", columns Change / Before / After / Why); <sm: stacked cards "Wednesday 18:30 → Saturday 09:00". Exported for E10's Weekly Review.
- `EditProposalDialog.tsx` — edits `after.preferredTime` / `triggerValue` / durations per entry (simple fields, no free-form JSON), submits `editProposal` then `acceptProposal`.
- `CoachComposer.tsx` — multiline `TextField` (Enter sends, Shift+Enter newline, `aria-label="Message the coach"`), attach button opening `MediaAttachmentPicker` (E03-06) limited to 4 with thumbnails and remove, send `IconButton` disabled while pending or empty; keeps focus after send.
- `SuggestedPromptChips.tsx` — `Chip` buttons from `getSuggestedPrompts()`, `aria-label` = label, click sends `text`.
- `RecommendedActionCard.tsx`, `FrictionQuestion.tsx`, `WhyThisExpander.tsx`, `SafetyNote.tsx`.

Degraded replies (`degraded:true`) render as a COACH bubble with an `Alert severity="warning"` line "The coach is unavailable; your plan still works."

A11y: all actions are `<button>`s with names; diff table has caption and `scope="col"` headers; live region for new messages; thinking placeholder has `aria-busy="true"` and text "Thinking…"; colour is never the only status signal (chips carry text); focus order list → composer → messages; `axe` clean.

**Tests (testing-dev)** (Vitest + RTL + MSW, `apps/web/src/__tests__/`)
- `mocks/handlers.ts`: handlers for all 11 endpoints with mutable in-memory state (conversations, messages, proposals); a `sendCoachMessage` handler that returns a proposal when text includes "Wednesday".
- `pages/CoachPage.test.tsx`: renders list and chips; sending shows an optimistic bubble immediately and the coach reply after the handler resolves; a failed send shows "Retry" and retry succeeds; proposal card renders diff rows; **Accept** calls `POST /proposals/:id/accept` and shows "Plan updated (v2)"; **Keep current plan** calls reject; **Why this?** reveals `reasoning_summary`; safety note renders for `conservative`; degraded reply renders the warning; `<sm` (mocked `matchMedia`) shows list-then-conversation navigation; `≥sm` shows side panel; axe has no violations.
- `components/coach/PlanChangeDiff.test.tsx`: move/reduce/remove/add entries render Before/After; table at ≥sm, cards at <sm.
- `components/coach/CoachComposer.test.tsx`: Enter sends, Shift+Enter does not, attachment count cap.
- `hooks/useCoachChat.test.ts`: optimistic insert, replacement by server row, failure state.
- `config/destinations.test.ts`: `/coach/abc` resolves to `coach`.
- Visual harness `apps/web/visual/main.tsx`: add a `coach` scenario; regenerate baselines in the pinned Playwright container.

**Docs (docs-dev)** — `docs/specs/coach-and-memory.md` §"Coach screen" (layout at the `sm` boundary, component map); `CLAUDE.md` no change beyond the E06-03 endpoint block.

#### Acceptance criteria

- [ ] `/coach` shows the conversation list and the seven suggested prompts; on a 375 px window the list and the conversation are separate screens; at ≥600 px they sit side by side.
- [ ] Sending a message shows it immediately; the reply appears without a page reload; a network failure marks the message failed with a working Retry.
- [ ] A reply with a proposal renders a diff and Accept / Edit / Keep current plan; Accept updates the card to "Plan updated (v2)" and `/path` shows v2 active.
- [ ] "Why this?" reveals the `reasoning_summary` and nothing else; it is absent on fallback replies.
- [ ] Safety `redirect`/`conservative` replies show the note; degraded replies show the unavailable warning.
- [ ] Attachments can be added through `MediaAttachmentPicker` (max 4) and are sent as `attachmentIds`.
- [ ] `Start <n> min` navigates to the E05 Start flow for the referenced commitment.
- [ ] axe reports no violations on the page in both layouts; keyboard-only use works end to end.
- [ ] The five coupled breakpoint gates are untouched (diff shows no change to `Layout.tsx`, `BottomNav`, `SettingsHub.tsx`, `AppBar.tsx` gates).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: failed send → retry; 403/404 → friendly empty state; never a blank screen
- [ ] Observability: n/a (client); console free of React warnings in tests
- [ ] Security: no ids trusted from URL beyond conversation id (server enforces ownership); attachments only from the picker
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 5–9 on a desktop window; repeat 5–7 with DevTools device toolbar at 375 × 812 (list → conversation → back arrow works; composer visible above the bottom nav).
2. Attach a photo via the paperclip, send "Is this setup ok for tonight?" → the message shows the thumbnail; reply arrives.
3. Tab through the page: chips, composer, send, proposal buttons all reachable and announced.

#### Out of scope

- Editing/deleting individual messages; conversation renaming; markdown rendering in replies (plain text only).
- The Weekly Review screen (E10-04) — it imports `PlanChangeDiff` from here.

#### Notes for the implementing agent

- Follow `apps/web/src/pages/UserNotificationsPage.tsx` + `hooks/useNotificationEvents.ts` for the hook/page split and `components/settings/PersonalAccessTokens.tsx` for confirm-dialog patterns.
- `useMediaQuery(down('sm'))` inside `CoachPage` is a page-local layout switch, like `PersonaModelTable` (E01-07) — say so in a comment; do not add a shared constant.
- Optimistic ids: prefix `tmp-`; never send them to the API.
- The Start flow route params must match E05-05's implementation — read `apps/web/src/App.tsx` for the actual path before wiring `RecommendedActionCard`.
- MSW handlers use `*/api/...` patterns (see `apps/web/src/__tests__/mocks/handlers.ts`).

---

### E06-08 `feat(web): add AI memory settings page with confirm, forget and do-not-use`

**Part of epic:** E06 · **Blocked by:** E06-05 · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §85 requires users to inspect durable memories and inferred preferences with the controls **Edit**, **Forget**, **Do not use for coaching**; §17 Tier 3 says durable inferences "should be inspectable and removable"; §127 lists "delete memory"; VISION §23 puts the user "in control of what becomes durable coaching memory". The API exists (E06-05); the settings hub has an "AI" section (E01-08) with only the key card.

#### Proposed solution

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a.

**UI (frontend-dev)**

- Registry first: in `apps/web/src/config/userSettingsSections.tsx`, section `AI` (created by E01-08) gains a card `{ title: 'AI Memory', description: 'See what the coach has learned about you. Confirm, edit, forget, or exclude anything from coaching.', Icon: PsychologyIcon, path: '/settings/ai-memory' }` — no `permission` (own resource).
- Route `/settings/ai-memory` → `pages/UserAiMemoryPage.tsx` in `App.tsx`, next to `/settings/tokens`; the page wraps `components/settings/AiMemorySettings.tsx` in the same shell `UserTokensPage.tsx` uses (`UserSettingsSection`).
- `hooks/useMemoryInsights.ts` — `{insights, loading, error, refresh, create, edit, confirm, setDoNotUse, forget, propose}` over `services/api.ts` functions `getMemoryInsights({includeDoNotUse: true})`, `createMemoryInsight`, `updateMemoryInsight`, `confirmMemoryInsight`, `setMemoryInsightDoNotUse`, `deleteMemoryInsight`, `proposeMemoryInsights`. Types `MemoryInsight`, `MemoryInsightCategory` in `types/index.ts`.
- `components/settings/AiMemorySettings.tsx` — intro copy: "The coach only plans with insights you've confirmed. Anything marked 'Don't use for coaching' stays here for you but is never sent to the AI. Forget removes it permanently." Toolbar: **Add insight** (opens `AddMemoryInsightDialog`: category select + statement ≤ 280), **Propose insights** (calls `propose`; shows "Not enough history yet" for `insufficient_data`, "Coach unavailable" for `ai_unavailable`, "Try again in a few minutes" on 429). Groups by category with headings in the order IDENTITY, WORK, FAMILY, HEALTH, COACHING_PREFERENCE, NOTIFICATION_PREFERENCE, PATTERN; empty state per page: "Nothing remembered yet. Confirmed insights appear here as the coach notices patterns, or add your own."
- `components/settings/MemoryInsightRow.tsx` — statement; chips: `Unconfirmed` / `Confirmed` / `Not used for coaching`, `Based on <n> observations` (hidden when 0), source `Suggested by the coach` / `Added by you`, `Expires <date>` when set; confidence shown as words (`likely` ≥ 0.7, `possible` ≥ 0.4, else `tentative`) — never a number. Actions: **Confirm** (unconfirmed only), **Edit** (inline `TextField`), **Don't use for coaching** (`Switch`, label flips to "Use for coaching"), **Forget** (confirm dialog: "Forget this insight? This can't be undone."). ≥sm: actions inline at the row end; <sm: statement + chips stacked, actions in an overflow `IconButton` menu (`aria-label="More actions"`). Layout choice via `useMediaQuery(down('sm'))`, page-local.
- Snackbars via the existing snackbar context for every mutation ("Insight confirmed", "Insight forgotten", …).

A11y: switch has an accessible name including the statement ("Use 'Morning workouts are more reliable' for coaching"); dialogs trap focus; group headings are `<h2>`/`<h3>` in order; all icon buttons labelled.

**Tests (testing-dev)**
- `__tests__/config/userSettingsSections.test.ts`: AI section contains the `AI Memory` card at `/settings/ai-memory` with no permission; `settingsRegistry.test.ts` route/registry parity still holds; `App.test.tsx` route renders the page.
- `__tests__/pages/UserAiMemoryPage.test.tsx` (MSW): lists grouped insights; Confirm → POST and chip flips; Switch → POST `do-not-use` with `{doNotUse:true}` and chip appears; Forget → confirm dialog → DELETE → row removed; Add → POST → appears under its category; Propose → rows appear / `insufficient_data` message / 429 message; edit inline → PATCH; `<sm` shows overflow menu; axe clean.
- `__tests__/hooks/useMemoryInsights.test.ts`: state transitions and error surfaces.
- Visual: `user-hub` baseline regenerated (one more card); add `ai-memory` scenario to `apps/web/visual/main.tsx`.

**Docs (docs-dev)** — `CLAUDE.md` "Settings" mention of `/settings/ai-memory` in the endpoints/pages summary; `docs/specs/coach-and-memory.md` §"Memory settings page".

#### Acceptance criteria

- [ ] `/settings` shows an **AI Memory** card in the AI section; clicking it opens `/settings/ai-memory`; the AppBar title resolves to "AI Memory".
- [ ] Insights are grouped by category with status chips; unconfirmed AI insights are visually distinct and offer **Confirm**.
- [ ] Confirm, Edit, Don't use for coaching, Forget and Add each call the matching endpoint and update the row without reload; reload shows the persisted state.
- [ ] Forget requires confirmation and removes the row.
- [ ] Propose shows the created insights or the correct reason message (`insufficient_data`, `ai_unavailable`, throttled).
- [ ] Confidence is shown as words, never as a number or a percentage.
- [ ] On phone widths actions move into an overflow menu; on ≥600 px they are inline; no horizontal page scroll.
- [ ] axe clean; keyboard reachable.
- [ ] No new tab was added to any existing settings page; no breakpoint gate touched.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 429/`skipped` reasons surfaced as copy; network errors as a dismissible alert; optimistic updates roll back on failure
- [ ] Observability: n/a (client)
- [ ] Security: own-resource page (no permission gate); no admin data
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Epic script step 10 on desktop; repeat at 375 px width (overflow menu).
2. Reload after each action; `psql`: `select statement, "userConfirmed", "doNotUse", source from memory_insights;` matches the UI.
3. Open `/coach`, ask "Plan my week" → the excluded insight is not reflected in the reply (fake server echoes the context length; check `ai_invocations.input` via `psql` for absence of the statement).

#### Out of scope

- Editing `evidenceCount`/`confidence` by hand; admin visibility into user memory (none, by design).
- Notification preference toggles (already on `/settings/notifications`).

#### Notes for the implementing agent

- Copy the page shell from `apps/web/src/pages/UserTokensPage.tsx` and the CRUD/dialog patterns from `components/settings/PersonalAccessTokens.tsx` + `CreatePatDialog.tsx`.
- Registry card first (CLAUDE.md Settings UI rule 1); reuse `SettingsHub` — never fork it; never add a tab.
- Icon: `@mui/icons-material/Psychology`.
- The `user-hub` visual baseline must be regenerated in the pinned Playwright container, not locally.

---

### E06-09 `test(tests): E06 end-to-end verification`

**Part of epic:** E06 · **Blocked by:** E06-03, E06-04, E06-05, E06-06, E06-07, E06-08 · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → ops-dev → docs-dev

#### Problem statement

The epic's promise (PRD §68: "My schedule changed. I can't work out Wednesday anymore." → plan queried → adjustment proposed → diff → approval; §15 mutation protocol; §14.8 safety; §85 memory control) must be demonstrated against the real stack (DB + API + UI) with the fake OpenAI server from E01-10, and the design must be written down so E09/E10 extend it instead of re-deriving it.

#### Proposed solution

**Data (database-dev)** — n/a. **API (backend-dev)** — n/a.

**Fake server (testing-dev)** — extend `tools/fake-openai/server.mjs` (E01-10) with **schema-driven scenarios** (the API, not the browser, calls the fake server, so headers cannot be set from Playwright):
- `tools/fake-openai/scenarios/index.mjs` exporting `matchScenario(body) → responseJson | null`, keyed on `body.text.format.name` (the gateway sends the strict JSON schema name) and, within a schema, on a keyword in the serialized `input`:
  - `coach_reply` + input contains `Wednesday` → `coach-proposal.json`: `intervention_type: 'PLAN_CHALLENGE'`, `reasoning_summary`, `user_message`, `proposal: { kind:'plan_change', planId: '<PLACEHOLDER:planId>', summary: 'Move Wednesday workout to Saturday morning', changes: [{ op:'move', target:{type:'routine', id:'<PLACEHOLDER:routineId>'}, before:{preferredTime:'18:30', triggerValue:'WED'}, after:{preferredTime:'09:00', triggerValue:'SAT'}, reason:'You said Wednesday no longer works.' }] }`. Placeholders are filled by scanning the serialized input for the first `planId`/`routineId` values the context assembler rendered (the renderer emits `planId: <uuid>` / `routineId: <uuid>` lines — E06-02 guarantees the format), which keeps the hallucination guard honest.
  - `coach_reply` + input contains `procrastinating` → `coach-activation.json` (`ACTIVATION_REDUCTION`, `recommended_action` with `commitmentId` from the first `commitmentId:` line, 10 min).
  - `coach_reply` otherwise → `coach-normal.json` (`NORMAL_REMINDER`, no proposal).
  - `safety_decision` → `safety-conservative.json` (`{decision:'conservative', category:'injury'}`) when input contains `hurts`, else `{decision:'allow', category:'none'}`.
  - `insight_proposal` → `pattern-insights.json` (two insights: HEALTH "Morning workouts are more reliable than evening ones", WORK "Large ambiguous tasks get postponed").
  - Unknown schema → existing E01-10 generic placeholder generator.
- Existing `x-fake-behaviour` header semantics unchanged.

**E2E (testing-dev)** — `tests/e2e/specs/coach.spec.ts` (new), using `loginAsTestUser(page, { email, role: 'contributor', withAiKey: true })` (E01-10 helper) and `page.request` (shares the browser cookies) to seed via the API:
- `beforeEach`: seed Best Self, a HEALTH outcome, a plan with v1 ACTIVE and a routine "Strength workout" (`triggerValue 'WED'`, `preferredTime '18:30'`, 40/15 min) plus next week's commitments — through `POST /api/outcomes`, `/api/outcomes/:id/plans`, `/api/routines`, `/api/commitments` (E02) — or through the onboarding endpoints (E04) if those are simpler; keep the helper in `tests/e2e/helpers/seed.helper.ts` (new).
- Test 1 "user-initiated plan change becomes plan v2 after accept" (PRD §68, §15): go to `/coach`; type the sentence; expect optimistic bubble; expect proposal card with text `Wednesday` and `Saturday`; expand **Why this?** and expect the reasoning text; `GET /api/plans/:id/versions` via `page.request` → still 1 version; click **Accept**; expect "Plan updated (v2)"; go to `/path`; expect `v2` with `Active` and the rationale "Move Wednesday workout to Saturday morning", `v1` `Superseded`; API → 2 versions.
- Test 2 "keep current plan leaves v1 active": same setup; click **Keep current plan**; API → 1 version; card shows "Kept current plan".
- Test 3 "safety redirect answers without calling the coach": send `I have sharp chest pain when I run`; expect the professional-care copy; expect no **Why this?**; `GET /api/coach/conversations/:id/messages` → last message `safety.decision === 'redirect'`.
- Test 4 "activation reduction offers a start action": send `I'm procrastinating` via the chip; expect `Start 10 min`; click → URL contains `/today` and the commitment id.
- Test 5 "memory page controls persist": `POST /api/memory-insights/propose` via `page.request`; go to `/settings/ai-memory`; confirm the first, switch **Don't use for coaching** on the second, add a custom one; reload; expect chips `Confirmed`, `Not used for coaching`, `Added by you`.
- Test 6 "phone layout": `test.use({ viewport: { width: 375, height: 812 } })`: `/coach` shows the list; open conversation; back arrow returns.
- `tests/e2e/playwright.config.ts`: no change beyond ensuring the fake server compose file is part of the documented run command.

**Docs (docs-dev)**
- `docs/specs/coach-and-memory.md` (new): purpose; the coaching contract (fields, intervention ladder mapping, size limits, `nullable` vs strict schema); orchestration sequence (PRD §115 mapped to `CoachService.sendMessage` steps); context scopes/budgets table; mutation protocol state machine (`PROPOSED → EDITED → ACCEPTED | REJECTED | EXPIRED`) and what accept touches (versions, future commitments) and never touches (past, evidence); safety policy (rules, decision flow, copy ownership, fail-to-conservative); memory tiers and user controls; hallucination guard; observability fields; **rejected alternatives** (streaming first; letting the model call a "mutate plan" tool; storing memory as free text; soft-deleting forgotten insights; a shared breakpoint constant for the coach layout); extension points for E09/E10.
- `docs/API.md`: verify the Coach, Plan Proposals and Memory Insights sections (E06-03/04/05) are complete and cross-linked; add the fake-server scenario table to `docs/TESTING.md` "E2E Testing with Playwright".
- `CLAUDE.md`: "Common Patterns" → "Calling an AI persona" (safety → assemble → invoke → validate → guard → proposal, never mutate) and "Proposing a plan change"; endpoint blocks for Coach / Proposals / Memory Insights; tables list.
- `docs/epics/README.md`: E06 row links to this file and to `docs/specs/coach-and-memory.md`; `ROADMAP.md` E06 checklist.

#### Acceptance criteria

- [ ] `cd tests/e2e && npx playwright test coach.spec.ts` passes against `base + dev + fake-openai` compose from a clean database in under 3 minutes.
- [ ] Test 1 proves v2 exists only after Accept (API version count asserted before and after).
- [ ] The fake server returns a proposal whose `planId`/`routineId` are the seeded ids (guard passes) and the scenario is selected by schema name, not by a browser-set header.
- [ ] Safety redirect, activation start action, memory controls and the phone layout each have a passing test.
- [ ] `docs/specs/coach-and-memory.md` exists with every section listed above; `docs/API.md`, `docs/TESTING.md`, `CLAUDE.md`, `docs/epics/README.md` and `ROADMAP.md` updated.
- [ ] `npm test` (api) and `npm run test:run` (web) still pass; visual baselines are current.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: e2e uses explicit waits on text/roles, no fixed sleeps; seed helper fails fast with the API error body
- [ ] Observability: the spec's final step asserts `GET /api/coach/conversations/:id/messages` exposes no `invocationId` (log ids stay internal)
- [ ] Security: e2e user is a `contributor`; nothing in the spec relies on admin permissions
- [ ] Config & secrets: `withAiKey` seeds `sk-test-…` only in non-production (E01-10)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script

1. Run the epic-level script (all 12 steps).
2. `cd tests/e2e && npx playwright test coach.spec.ts --headed` and watch the six tests.
3. Open `docs/specs/coach-and-memory.md` and confirm each section header from the list above is present and links resolve.

#### Out of scope

- CI workflow files (user declined CI); load or latency testing (PRD §119 targets are measured manually).
- E2E for weekly review or workout proposals (E10/E09 verification issues).

#### Notes for the implementing agent

- Seed via `page.request` rather than UI so the spec tests the coach, not onboarding; keep the seed helper reusable for E07–E10 verification specs.
- The context renderer's `planId:`/`routineId:`/`commitmentId:` line format is the contract the fake server relies on — if E06-02 renders differently, fix the scenario matcher, not the renderer.
- `ops-dev` may rebuild containers and regenerate visual baselines; it must not run any git operations.
- Spec authoring style: `tests/e2e/specs/auth.spec.ts`; helpers in `tests/e2e/helpers/`.
