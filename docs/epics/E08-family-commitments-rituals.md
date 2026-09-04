# E08 — Family Domain: Commitments & Rituals

<!-- epic-meta: slug=family-commitments-rituals phase=3 -->
<!-- epic-issue: #35 -->

> GitHub epic: [#35](https://github.com/marinoscar/evolvepath/issues/35)

## Epic

### Goal

Turn family intentions into recurring, protected behaviour: the user defines rituals ("Phone-free dinner, Tue/Thu/Sun 18:30, ideal 45 min, minimum 10"), the system materializes them as real `Commitment` rows on the Path and on Today, and the user keeps, moves or skips each occurrence with the same lifecycle every other domain uses (VISION §11, PRD §30, §34, §105). Family member records stay minimal — nickname, relationship, optional birthday — and the review shows only planned-versus-kept counts per ritual; there is no relationship score anywhere, by test (VISION §12, §50; PRD §33, §35). Every commitment title describes the user's own behaviour, never another person's state (PRD §32, §83). All of it works with the AI provider down (PRD §120).

### Background

- E02-01 (#36) ships the domain model this epic extends: `Outcome` (domain enum `WORK|FAMILY|HEALTH`), `Plan`/`PlanVersion`, `Routine` (trigger, frequency, estimated/minimum minutes, `fallbackBehavior`), `Commitment` (status enum `PLANNED, READY, STARTED, COMPLETED, PARTIALLY_COMPLETED, RESCHEDULED, SKIPPED, MISSED, CANCELLED`; `fullVersion`/`shortVersion`/`minimumVersion`; `rescheduleCount`; `skipReason`), `Evidence`, `DomainMode`. E02-04 (#47) owns `POST /commitments/:id/transition` and the transition matrix; E02-03 (#42) owns `/routines` CRUD.
- E05-02 (#40) adds the intent-named actions this epic reuses verbatim: `POST /commitments/:id/actions/{start,pause,continue,complete,partial,fallback,reschedule,skip}` (`apps/api/src/commitments/actions/commitment-actions.controller.ts`). E05-04 (#46)'s Today screen renders a `DomainCard` per domain with `CommitmentRow` + `CommitmentActionsMenu` driven by `availableActions`; E05-04 (#46)'s `RescheduleDialog`/`SkipDialog` and E05-06 (#52)'s `QuickAddSheet` ("Family intention" kind) already exist. E08 adds family-specific labels and one Family-only affordance on top, not a second card.
- E04-01 (#100) adds `user_profiles.timezone`; every recurrence computation in this epic is in that timezone. E05-01 (#38)'s `apps/api/src/today/local-date.ts` (`localDate`, `localDayBounds`) is the date helper to reuse.
- E01 fixes the AI contract: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, schema, schemaName})` → `{ok:true, output}` | `{ok:false, error:{code,message}}`, never throws for provider problems. E08 uses the `coach` persona twice, both optional: a rewrite suggestion for a rejected commitment title (E08-02 (#41)) and the review sentence (E08-03 (#45)). Both have deterministic fallbacks. E01-10 (#30)'s fake OpenAI server (`tools/fake-openai/server.mjs`, `infra/compose/fake-openai.compose.yml`) is what the e2e runs against.
- Scheduling: `ScheduleModule.forRoot()` is already registered in `apps/api/src/app.module.ts`; `apps/api/src/auth/tasks/token-cleanup.task.ts` is the `@Cron(CronExpression.EVERY_DAY_AT_3AM)` pattern to copy (an `@Injectable()` task class registered as a provider of its feature module).
- Existing patterns to copy: `apps/api/src/pat/pat.controller.ts` (`@Auth()` + ownership-scoped service, `ParseUUIDPipe`, `nestjs-zod` DTOs); `apps/api/src/email/email-settings.service.ts` (direct `prisma.auditEvent.create` with `action '<domain>:<verb>'`); `apps/api/src/openapi/tags.ts` (every `@ApiTags` name declared in a group — `test/openapi/openapi-document.spec.ts` fails otherwise); `apps/api/test/helpers/test-app.helper.ts` (`createTestApp` + `overrideProviders`); `apps/web/src/__tests__/mocks/handlers.ts` (MSW); `tests/e2e/helpers/auth.helper.ts` (`loginAsTestUser` via `/testing/login`) extended by E01-10 (#30) (`withAiKey`) and E04-06 (#107) (onboarding flag).
- Navigation decision: the Family surface is a **route under Path**, `/path/family`, owned by E02-05 (#51)'s `path` destination through prefix ownership (`owns('/path', '/path/family')` in `apps/web/src/config/destinations.ts`) — no registry change, no new destination, no settings card (it is a product surface, not a settings page). Editors open as a bottom sheet below 600px and a dialog at ≥ 600px, the same local presentation choice E05-06 (#52) documents.
- No new permissions. Every endpoint here is a per-user resource: plain `@Auth()` with ownership resolved by `userId`; a foreign or missing id is a **404** (never 403).
- Specs this epic produces: `docs/specs/family-domain.md` (E08-05 (#53)). Specs it reads: `docs/specs/domain-model.md` (E02-08 (#62)), `docs/specs/today-and-nba.md` (E05-07 (#55)), `docs/specs/ai-gateway.md` (E01-12 (#32)).

### Scope

- [ ] #37 `feat(db): add family members, rituals and ritual links on commitments` (E08-01)
- [ ] #41 `feat(api): add family member and ritual endpoints with recurrence materialization and behaviour lint` (E08-02)
- [ ] #45 `feat(api): add family review summary with planned-versus-kept and no aggregate score` (E08-03)
- [ ] #50 `feat(web): add Family views under Path and family actions on Today` (E08-04)
- [ ] #53 `test(tests): E08 end-to-end verification` (E08-05)

### Out of scope

- Family presence notifications (PRD §60 N5 "Dinner starts soon…") and reminder deep links — E12 emits them; E08 only guarantees every materialized commitment is a normal `Commitment` row E12 can link to (`/today?commitment=<id>&action=start`, E05-04 (#46)).
- Shared or multi-user family accounts, inviting family members, any data entered by anyone other than the user (VISION §50: family members did not consent to be modeled).
- Calendar integration (PRD §69), "important events" beyond the optional birthday (PRD §33 lists them; a free-text events table is deferred to E10 planning).
- Weekly review generation and plan-version proposals from family data (E10 reads `GET /family/summary`; E08 only provides the data and the template sentence).
- Momentum for the Family domain (E11 computes it from the same commitments).
- Coach chat about family (E06 already handles it; E08 adds no conversation surface).
- Any per-member analytics, sentiment, mood, "quality", "score" or "rating" field — explicitly forbidden and tested (E08-03 (#45)).

### Sequencing

- E08-01 (#37) first (schema). E08-02 (#41) depends on E08-01 (#37), E02-03 (#42) (routines), E02-04 (#47) (transition matrix + `POST /commitments`), E05-02 (#40) (actions), E04-01 (#100) (timezone), E01-06 (#26) (gateway, optional path only).
- E08-03 (#45) depends on E08-01 (#37) and E05-02 (#40) (it reads statuses the actions write); it can run in parallel with E08-02 (#41) once the schema exists.
- E08-04 (#50) depends on E08-02 (#41) and E08-03 (#45) (data) and on E05-04 (#46)/E05-06 (#52) (Today components, sheet pattern); it can start against MSW as soon as E08-02 (#41)'s DTOs are fixed.
- Critical path: E08-01 (#37) → E08-02 (#41) → E08-04 (#50) → E08-05 (#53). E08-05 (#53) is last and needs E01-10 (#30)'s fake OpenAI server.

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed` (confirm `add_family` in the migrate output).
3. Open http://localhost:3535/testing/login, sign in as `family@test.local` role `viewer` with "Seed OpenAI key" (E01-10 (#30)) and "Mark onboarding complete" (E04-06 (#107)) ticked. Set the timezone: `evopath login`, then `evopath api PATCH /api/me/profile --data '{"timezone":"America/Costa_Rica"}'` (E04-01 (#100)).
4. http://localhost:3535/path/family — observe an empty state with two primary buttons: `Add a family member` and `Create a ritual`.
5. `Add a family member` → sheet (phone width) / dialog (≥ 600px): nickname `Mia`, relationship `Child`, birthday = a date 5 days from today (any year) → Save. A card `Mia · Child` appears with a cake icon and "Birthday in 5 days". `evopath api GET /api/family/members | jq '.data[0] | keys'` → exactly `["birthday","createdAt","id","nickname","relationship"]`.
6. `Create a ritual`: title `Phone-free dinner`, purpose `Be present at the table`, with `Mia`, weekdays Tue/Thu/Sun, time 18:30, every 1 week, ideal 45, minimum 10, fallback `Sit down phone-free for the first 10 minutes` → Save. The ritual card shows "Tue, Thu, Sun · 18:30 · 45 min (min 10)". Try title `Make Mia happier` → inline error "Describe what *you* will do, not how someone else should feel" with a `Suggest a rewrite` button that fills in the fake AI's suggestion; without the fake server the button is absent and only the error shows.
7. `evopath api GET /api/commitments?from=<today>&to=<today+7d>&domain=FAMILY | jq '.data | length'` → the number of Tue/Thu/Sun dates in the next 7 days (2 or 3); each row has `ritualId`, `familyMemberId`, `status: "PLANNED"`, `scheduledStart` at 18:30 Costa Rica time (`00:30Z` next day), `fullVersion.minutes 45`, `minimumVersion.minutes 10`, `minimumVersion.title` = the fallback text. `psql`: `SELECT last_materialized_through FROM rituals;` → today + 7 days.
8. Run the on-demand materializer again: `evopath api POST /api/family/rituals/<id>/materialize` → `{created: 0, skipped: N}`; row count unchanged (idempotent). `SELECT indexname FROM pg_indexes WHERE tablename='commitments' AND indexname LIKE '%ritual%';` → the `(ritual_id, scheduled_start)` unique index.
9. If today is Tue/Thu/Sun, http://localhost:3535/ shows **Phone-free dinner · 18:30 · 45 min** on the Family card with buttons `I'm in`, `Move it`, `Skip today` and the cue chip "Mia's birthday in 5 days". (Otherwise reschedule one occurrence to today via `Move it` from `/path/family` → Upcoming.) Tap `I'm in` → row shows `Ready` and the primary button becomes `Start` (E05); tap `Done` from the ⋯ menu → `Complete`. `SELECT status FROM commitments WHERE ritual_id='<id>' ORDER BY scheduled_start LIMIT 1;` → `COMPLETED`.
10. On the next occurrence tap `Move it` → tomorrow 19:00 → `reschedule_count = 1`, status `RESCHEDULED`; on another tap `Skip today` → reason "Unexpected conflict" → `SKIPPED`.
11. http://localhost:3535/path/family → **This week** panel: `Phone-free dinner · Planned 3 · Kept 1` (plus "1 moved · 1 skipped" as small text). `evopath api GET "/api/family/summary?weekStart=<this Monday>" | jq` → the same numbers; `jq -r 'tostring' | grep -icE 'score|quality|rating'` → `0`.
12. Edit the ritual: untick Sunday → Save. `SELECT status, scheduled_start FROM commitments WHERE ritual_id='<id>' ORDER BY scheduled_start;` → future Sunday rows are `CANCELLED`, past/handled rows untouched, Tue/Thu rows still `PLANNED`. Set `active` off → all future `PLANNED` rows `CANCELLED`. Delete the ritual → `ritual_id` is `NULL` on the remaining rows (history kept).
13. Audit: `SELECT action, target_type FROM audit_events WHERE action LIKE 'ritual:%' OR action LIKE 'family_member:%' ORDER BY created_at;` → `family_member:create`, `ritual:create`, `ritual:materialize`, `ritual:update`, `ritual:update`, `ritual:delete`. `meta` never contains a nickname or a birthday.
14. Resize below 600px: `/path/family` is a single column, editors open as bottom sheets, BottomNav visible; at ≥ 900px rituals on the left and members + this-week panel on the right.

## Child issues

### E08-01 `feat(db): add family members, rituals and ritual links on commitments` — #37

**Part of epic:** E08 · **Blocked by:** E02-01 (#36) · **Component:** database, api · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §33 (Family Privacy) fixes what a family member record may hold — nickname, relationship, optional birthday, optional recurring routines — and forbids anything that could become a hidden assessment; VISION §50 adds that family members did not consent to be modeled. PRD §34 defines a ritual (recurrence, ideal and minimum duration, purpose) and PRD §105 requires the user to create a family commitment with a recurrence and complete/move/skip it. E02-01 (#36)'s schema has `Commitment` and `Routine` but no ritual, no recurrence and no family member; every later child in this epic needs these three things as typed columns, with the privacy boundary enforced by the schema itself rather than by convention.

#### Proposed solution

Two new tables (`family_members`, `rituals`), two nullable foreign keys on `commitments`, a unique index that makes materialization idempotent, and a response DTO whose key set is asserted by a test so the member record can never quietly grow.

**Data (database-dev)** — in `apps/api/prisma/schema.prisma`:

```prisma
enum FamilyRelationship {
  PARTNER
  CHILD
  PARENT
  SIBLING
  FRIEND
  OTHER
}

model FamilyMember {
  id           String             @id @default(uuid()) @db.Uuid
  userId       String             @map("user_id") @db.Uuid
  nickname     String             @db.VarChar(40)
  relationship FamilyRelationship
  birthday     DateTime?          @db.Date            // date-only; year may be a placeholder (see Notes)
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz

  user        User         @relation("UserFamilyMembers", fields: [userId], references: [id], onDelete: Cascade)
  rituals     Ritual[]
  commitments Commitment[]

  @@index([userId])
  @@map("family_members")
}

model Ritual {
  id                      String        @id @default(uuid()) @db.Uuid
  userId                  String        @map("user_id") @db.Uuid
  title                   String        @db.VarChar(120)
  purpose                 String?       @db.VarChar(300)
  familyMemberId          String?       @map("family_member_id") @db.Uuid
  recurrence              Json                                   // ritualRecurrenceSchema (below)
  idealMinutes            Int           @map("ideal_minutes")
  minimumMinutes          Int           @map("minimum_minutes")
  fallbackBehavior        String?       @map("fallback_behavior") @db.VarChar(200)
  active                  Boolean       @default(true)
  lastMaterializedThrough DateTime?     @map("last_materialized_through") @db.Date
  routineId               String?       @map("routine_id") @db.Uuid   // E02-01 (#36) Routine; shows the ritual on the Path
  createdAt               DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime      @updatedAt @map("updated_at") @db.Timestamptz

  user         User          @relation("UserRituals", fields: [userId], references: [id], onDelete: Cascade)
  familyMember FamilyMember? @relation(fields: [familyMemberId], references: [id], onDelete: SetNull)
  routine      Routine?      @relation(fields: [routineId], references: [id], onDelete: SetNull)
  commitments  Commitment[]

  @@index([userId, active])
  @@map("rituals")
}
```

`Commitment` (E02-01 (#36)) gains:

```prisma
  ritualId       String?       @map("ritual_id") @db.Uuid
  familyMemberId String?       @map("family_member_id") @db.Uuid
  ritual         Ritual?       @relation(fields: [ritualId], references: [id], onDelete: SetNull)
  familyMember   FamilyMember? @relation(fields: [familyMemberId], references: [id], onDelete: SetNull)

  @@unique([ritualId, scheduledStart])   // materialization idempotency; NULL ritualId rows are never in conflict (Postgres NULLs are distinct)
  @@index([userId, ritualId])
```

Add `familyMembers FamilyMember[] @relation("UserFamilyMembers")` and `rituals Ritual[] @relation("UserRituals")` to `model User`; add `rituals Ritual[]` to `model Routine`. Migration: `npm run prisma:migrate:dev -- --name add_family`. Seed: none (`prisma/seed.ts` untouched).

Zod at the JSON boundary — `apps/api/src/family/family.schema.ts` (new):

```ts
export const ritualRecurrenceSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((d) => new Set(d).size === d.length, 'weekdays must be unique'),   // 0 = Sunday … 6 = Saturday
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),                          // 'HH:mm' local to user_profiles.timezone
  everyNWeeks: z.union([z.literal(1), z.literal(2), z.literal(4)]),
});
export type RitualRecurrence = z.infer<typeof ritualRecurrenceSchema>;

export const familyMemberResponseSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string().min(1).max(40),
  relationship: z.enum(['PARTNER','CHILD','PARENT','SIBLING','FRIEND','OTHER']),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  createdAt: z.string().datetime(),
}).strict();
export const FAMILY_MEMBER_RESPONSE_KEYS = ['id','nickname','relationship','birthday','createdAt'] as const;

export const ritualResponseSchema = z.object({
  id: z.string().uuid(), title: z.string(), purpose: z.string().nullable(),
  familyMemberId: z.string().uuid().nullable(), recurrence: ritualRecurrenceSchema,
  idealMinutes: z.number().int(), minimumMinutes: z.number().int(), fallbackBehavior: z.string().nullable(),
  active: z.boolean(), lastMaterializedThrough: z.string().nullable(), routineId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
```

`userId` is deliberately absent from both response schemas (own resource; the caller is the owner).

**API (backend-dev)** — `apps/api/src/family/family.module.ts` (new; imports `PrismaModule`; exports nothing yet; registered in `apps/api/src/app.module.ts`), `apps/api/src/family/family.schema.ts` (above), `apps/api/src/family/dto/family-member.dto.ts` and `dto/ritual.dto.ts` (new, `createZodDto` over the response schemas plus `createFamilyMemberSchema = familyMemberResponseSchema.pick({nickname, relationship, birthday}).partial({birthday})` and the ritual create/update bodies E08-02 (#41) consumes), and a mapper `apps/api/src/family/family.mapper.ts` (new): `toFamilyMemberDto(row)` (birthday `Date` → `YYYY-MM-DD` string via `toISOString().slice(0,10)`; it is `@db.Date`, so no timezone shift), `toRitualDto(row)`. No endpoints in this issue; no OpenAPI tag yet (E08-02 (#41) registers `Family`).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| — | none in this issue | — | — | — |

**UI (frontend-dev)** — n/a. Types land in E08-04 (#50).

**Tests (testing-dev)**

- `apps/api/src/family/family.schema.spec.ts` — `ritualRecurrenceSchema` accepts `{weekdays:[2,4,0], time:'18:30', everyNWeeks:1}`; rejects weekday 7, duplicate weekdays, `time:'6:30'`, `time:'24:00'`, `everyNWeeks: 3`, empty weekdays. `familyMemberResponseSchema` is `.strict()`: an object with an extra key (`notes`, `mood`, `score`) fails; `FAMILY_MEMBER_RESPONSE_KEYS` equals `Object.keys(familyMemberResponseSchema.shape)` (the "exactly these keys" assertion).
- `apps/api/src/family/family.mapper.spec.ts` — `toFamilyMemberDto` output has exactly `FAMILY_MEMBER_RESPONSE_KEYS` (sorted key equality, not subset); a Prisma row carrying `userId` never leaks it; `birthday` `Date` at `2018-05-09T00:00:00Z` → `'2018-05-09'`; null stays null. `toRitualDto` round-trips `recurrence` through `ritualRecurrenceSchema`.
- `apps/api/test/family/family-schema.integration.spec.ts` — boots `createTestApp` and asserts `FamilyModule` resolves (a broken relation graph fails at boot). With `useMockDatabase: false` behind the existing DB-available guard: inserting two commitments with the same `(ritualId, scheduledStart)` throws `P2002`; two rows with `ritualId: null` and equal `scheduledStart` both insert.

**Docs (docs-dev)** — `CLAUDE.md` "Database Tables": add `family_members`, `rituals`, and "(+ `ritual_id`, `family_member_id`, E08-01 (#37))" on `commitments`; `docs/specs/family-domain.md` is created by E08-05 (#53) (this issue leaves the model section in the PR description).

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on a clean database applies `add_family` and creates `family_members`, `rituals`, the two nullable FKs on `commitments`, and the unique index `(ritual_id, scheduled_start)`.
- [ ] `family_members` has exactly the columns `id, user_id, nickname, relationship, birthday, created_at` — no notes, tags, mood, sentiment, score or free-text column of any kind.
- [ ] `nickname` longer than 40 characters is rejected at the database (`VarChar(40)`) and by `createFamilyMemberSchema`.
- [ ] Deleting a user cascades to their family members and rituals; deleting a family member or ritual sets the FK on existing commitments to `NULL` and leaves the commitment rows intact.
- [ ] Two commitments with the same `ritualId` and `scheduledStart` cannot coexist; commitments without a ritual are unaffected by the index.
- [ ] `toFamilyMemberDto` returns an object whose key set is exactly `['id','nickname','relationship','birthday','createdAt']` (test asserts equality, not containment).
- [ ] `ritualRecurrenceSchema` rejects every malformed shape listed in the unit spec and accepts the three valid `everyNWeeks` values only.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (model names, column maps, enum values, schema export names)
- [ ] Error handling: n/a beyond Zod/Prisma validation; `P2002` on the unique index is documented as the idempotency signal E08-02 relies on
- [ ] Observability: none in this issue
- [ ] Security: `userId` FK with cascade on both tables; response schemas are `.strict()` and omit `userId`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated (CLAUDE.md tables)

#### Manual test script

1. Epic script steps 1–2. `psql`: `\d family_members` → six columns only; `\d rituals` → the columns above; `\d commitments` → `ritual_id`, `family_member_id`, and index `commitments_ritual_id_scheduled_start_key`.
2. `INSERT INTO family_members (id,user_id,nickname,relationship) VALUES (gen_random_uuid(),'<uid>',repeat('x',41),'CHILD');` → `value too long for type character varying(40)`.
3. Insert two commitments with the same `ritual_id` and `scheduled_start` → unique violation on the second; repeat with `ritual_id = NULL` → both succeed.

#### Out of scope

- Endpoints, materialization, lint (E08-02 (#41)); summary (E08-03 (#45)).
- Any "important events" table (PRD §33) beyond the birthday column.
- Backfilling `ritualId` on commitments created by E04 onboarding templates ("Phone-free dinner Tue/Thu/Sun") — those remain plain commitments; the user creates the ritual explicitly.

#### Notes for the implementing agent

- `birthday` is `@db.Date` on purpose: it is a calendar date, not an instant. Map it with `toISOString().slice(0, 10)`, never through the user's timezone. The year may be unknown; the UI (E08-04 (#50)) sends `1900` as the placeholder year and the cue logic ignores the year — document this in the column comment.
- The `@@unique([ritualId, scheduledStart])` composite relies on Postgres treating NULLs as distinct; do not add a partial index by hand — Prisma's generated migration is sufficient, and E02-01 (#36)'s `scheduledStart` must be `@db.Timestamptz` for the equality to be exact.
- Put the enum values in the order listed; `FamilyRelationship` order is what the UI select renders.
- Run `npm run prisma:migrate:dev -- --name add_family` then `npm run prisma:generate`; never bare `npx prisma`.
- Field names on `Commitment`/`Routine` are E02-01 (#36)'s; read `schema.prisma` before adding relations rather than trusting this text for the existing side.

---

### E08-02 `feat(api): add family member and ritual endpoints with recurrence materialization and behaviour lint` — #41

**Part of epic:** E08 · **Blocked by:** E08-01 (#37), E02-03 (#42), E02-04 (#47), E05-02 (#40), E04-01 (#100) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §34 lets users create recurring rituals; PRD §105 requires creating a family commitment with a recurrence and completing, moving or skipping it; VISION §11 frames the domain as translating family values into repeatable behaviours before the calendar takes the time. A ritual that lives only as a rule is invisible to Today (E05-01 (#38) ranks `Commitment` rows) and to the Path, so rituals must be materialized into real commitments ahead of time, idempotently, in the user's timezone, and cleaned up when the ritual changes. PRD §32 and §83 add the guardrail: a commitment must describe the user's own behaviour ("Put phone away during dinner"), never another person's state ("Make spouse happier"); the system cannot control another person's behaviour, so it must refuse to record a commitment that pretends to.

#### Proposed solution

A `family` module with CRUD for members and rituals, a pure recurrence engine with a DST-correct zoned-time resolver, a daily cron plus an on-demand materializer that create `PLANNED` FAMILY commitments for the next 7 days, a deterministic behaviour lint with an optional `coach` rewrite, and audit on every write. Completing, moving and skipping an occurrence are E05-02 (#40)'s actions — nothing is re-implemented here.

**Data (database-dev)** — n/a (E08-01 (#37)). No migration.

**API (backend-dev)**

Files (all new unless noted):

- `apps/api/src/family/family.module.ts` (E08-01 (#37); now imports `PrismaModule`, `AiModule`, `RoutinesModule` (E02-03 (#42)), `CommitmentsModule` (E02-04 (#47)); providers `FamilyMembersService`, `RitualsService`, `RitualMaterializerService`, `BehaviourLintService`, `RitualMaterializeTask`; exports `BehaviourLintService`, `RitualMaterializerService`).
- `apps/api/src/family/family-members.controller.ts` — `@ApiTags('Family')`, `@Controller('family/members')`.
- `apps/api/src/family/family-members.service.ts` — `list(userId)`, `create(userId, dto)`, `update(userId, id, dto)`, `remove(userId, id)`.
- `apps/api/src/family/rituals.controller.ts` — `@ApiTags('Family')`, `@Controller('family/rituals')`.
- `apps/api/src/family/rituals.service.ts` — `list(userId, {active?})`, `get(userId, id)`, `create(userId, dto)`, `update(userId, id, dto)`, `remove(userId, id)`.
- `apps/api/src/family/recurrence.ts` — pure, no Prisma, no `Date.now()`:

```ts
export interface Occurrence { scheduledStart: Date; dateLocal: string }   // dateLocal = 'YYYY-MM-DD' in `timezone`
export function nextOccurrences(
  recurrence: RitualRecurrence, from: Date, to: Date, timezone: string,
  anchor: Date,                       // ritual.createdAt; everyNWeeks counts from the Monday-start week containing it
): Occurrence[]                       // (from, to]; sorted asc; DST-safe
export function zonedTimeToUtc(dateLocal: string, time: string, timezone: string): Date
export function weekStartLocal(instant: Date, timezone: string): string   // Monday 'YYYY-MM-DD'
export function weeksBetween(weekStartA: string, weekStartB: string): number
```

  `zonedTimeToUtc` resolves the offset with `Intl.DateTimeFormat(..., {timeZone, hourCycle:'h23', ...}).formatToParts` iteratively (guess UTC, read the local wall time, correct, repeat once) — no date library (E05-01 (#38)'s `local-date.ts` sets the precedent). Rules: a wall time that does not exist (spring-forward gap) is shifted forward to the first valid instant; an ambiguous wall time (fall-back overlap) takes the **first** (DST) instant. A date is an occurrence when `weekdays` contains its local weekday and `weeksBetween(weekStartLocal(anchor), weekStartLocal(date)) % everyNWeeks === 0`.

- `apps/api/src/family/ritual-materializer.service.ts` — `materialize(userId, ritualId, now = new Date()): Promise<{created: number, skipped: number, through: string}>` and `materializeAllDue(now): Promise<{rituals: number, created: number}>`.
- `apps/api/src/family/tasks/ritual-materialize.task.ts` — `@Cron(CronExpression.EVERY_DAY_AT_1AM) handleCron()` → `materializeAllDue()`; logs `ritual.materialize rituals=<n> created=<n>`; copies `apps/api/src/auth/tasks/token-cleanup.task.ts`.
- `apps/api/src/family/behaviour-lint.ts` — pure `lintBehaviourTitle(title: string): LintResult`; `apps/api/src/family/behaviour-lint.service.ts` — `check(title)` + `suggestRewrite(userId, title)` (AI, optional).
- `apps/api/src/family/dto/*.ts` — Zod bodies (below).

Endpoints:

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/family/members` | `@Auth()` (own) | — | 200 `FamilyMemberDto[]` (by `createdAt` asc) |
| POST | `/api/family/members` | `@Auth()` | `{ nickname: string 1..40, relationship: FamilyRelationship, birthday?: 'YYYY-MM-DD' \| null }` | 201 `FamilyMemberDto` |
| PATCH | `/api/family/members/:id` | `@Auth()`, owner | partial of the above | 200 `FamilyMemberDto` |
| DELETE | `/api/family/members/:id` | `@Auth()`, owner | — | 204 |
| GET | `/api/family/rituals?active=` | `@Auth()` | — | 200 `RitualDto[]` (active first, then `title`) |
| GET | `/api/family/rituals/:id` | `@Auth()`, owner | — | 200 `RitualDto` + `upcoming: CommitmentCard[]` (next 7 days) |
| POST | `/api/family/rituals` | `@Auth()` | `{ title: 1..120, purpose?: ≤300, familyMemberId?: uuid, recurrence: RitualRecurrence, idealMinutes: int 5..240, minimumMinutes: int 1..idealMinutes, fallbackBehavior?: ≤200, outcomeId?: uuid }` | 201 `RitualDto` (materialized synchronously) |
| PATCH | `/api/family/rituals/:id` | `@Auth()`, owner | partial of the above + `active?: boolean` | 200 `RitualDto` |
| DELETE | `/api/family/rituals/:id` | `@Auth()`, owner | — | 204 |
| POST | `/api/family/rituals/:id/materialize` | `@Auth()`, owner | — | 200 `{ created, skipped, through }` |
| POST | `/api/family/lint` | `@Auth()` | `{ title: 1..120 }` | 200 `{ ok: boolean, code: 'TARGETS_OTHER_PERSON' \| null, match: string \| null, suggestion: string \| null, source: 'ai' \| 'none' }` |

Semantics:

- **Ownership** — every service method loads with `where: {id, userId}` and throws `NotFoundException` (404) when absent; `familyMemberId` and `outcomeId` in bodies are validated to belong to the caller (404 `FAMILY_MEMBER_NOT_FOUND` / `OUTCOME_NOT_FOUND`, never 403).
- **Ritual create** — `BehaviourLintService.check(title)` first (400 `BEHAVIOUR_TARGETS_OTHER_PERSON` with `{match}` in the error body); when `outcomeId` is given, create a `Routine` through E02-03 (#42)'s `RoutinesService.create` under that outcome's active `PlanVersion` `{domain: 'FAMILY', title, frequency: <summary string, e.g. 'Tue, Thu, Sun'>, preferredTime: recurrence.time, estimatedMinutes: idealMinutes, minimumMinutes, fallbackBehavior}` and store its id in `routineId` (adapt field names to E02-01 (#36)'s); then insert the ritual; then `materialize` (outside the transaction). Audit `ritual:create` `meta {recurrence, idealMinutes, minimumMinutes, hasMember: boolean, routineId}`.
- **Materialize** — `horizonEnd = localDate(now, tz) + 7 days` (end of that local day); `from = max(now, lastMaterializedThrough ?? now)`; `occurrences = nextOccurrences(recurrence, from, horizonEnd, tz, createdAt)`; for each, `prisma.commitment.create` with `{userId, domain: 'FAMILY', title, status: 'PLANNED', scheduledStart, scheduledEnd: +idealMinutes, importance: 4, ritualId, familyMemberId, routineId, outcomeId, planId (from the routine's plan when linked), fullVersion: {title, minutes: idealMinutes}, shortVersion: idealMinutes − minimumMinutes ≥ 10 ? {title, minutes: round((idealMinutes + minimumMinutes)/2)} : null, minimumVersion: {title: fallbackBehavior ?? title, minutes: minimumMinutes}}` — catching `P2002` from the `(ritualId, scheduledStart)` index as `skipped` (idempotency, E08-01 (#37)); rows already in any status are never touched. Then `lastMaterializedThrough = horizonEnd`. Inactive rituals return `{created: 0, skipped: 0}`. Audit `ritual:materialize` `meta {created, skipped, through}` only when `created > 0` (the cron must not write 365 empty audit rows per ritual a year). `materializeAllDue` iterates `rituals` where `active = true AND (lastMaterializedThrough IS NULL OR lastMaterializedThrough < today + 7d in the user's tz)` in pages of 200, each ritual in its own try/catch so one failure never stops the run; timezone from `user_profiles.timezone ?? 'UTC'`.
- **Ritual update** — lint on `title` when present; when `recurrence`, `time`, `idealMinutes`, `minimumMinutes` or `fallbackBehavior` change: transition every future (`scheduledStart > now`) `PLANNED`/`READY` commitment of the ritual to `CANCELLED` through E02-04 (#47)'s matrix (never delete; `RESCHEDULED`, `STARTED` and terminal rows are left alone — the user touched them), reset `lastMaterializedThrough = null`, re-materialize. `active: false` cancels future `PLANNED`/`READY` rows and stops the cron for that ritual; `active: true` re-materializes. Keeps `routineId`'s `Routine` in sync (`active`, minutes, title) through `RoutinesService.update`. Audit `ritual:update` `meta {changed: string[], cancelled: number, created: number}`.
- **Ritual delete** — cancel future `PLANNED`/`READY` rows; delete the ritual (FK `SetNull` keeps history); the linked `Routine` is left in place (the Path still shows what was planned). Audit `ritual:delete` `meta {cancelled}`.
- **Member create/update/delete** — validate; delete sets `familyMemberId` to `NULL` on rituals and commitments (schema). Audit `family_member:create|update|delete` with `meta {relationship}` only — **never** the nickname or birthday (PRD §33; audit rows outlive the record).
- **Behaviour lint** (`behaviour-lint.ts`) — deterministic, case-insensitive, runs on `title` after trimming. Rejects when any rule matches:

```ts
export const OTHER_PERSON_VERBS = ['make','get','force','convince','persuade','have','let','teach','train','fix','improve','change','correct','stop','keep'];
export const OTHER_PERSON_TARGETS = ['spouse','wife','husband','partner','kid','kids','child','children','son','daughter','mom','mum','dad','mother','father','parents','brother','sister','family','everyone'];
export const OTHER_STATE_WORDS = ['happier','happy','calmer','calm','nicer','behave','listen','obey','understand','appreciate','respect','attitude','mood','behaviou?r','habits','manners','grades'];
// Rule A: <verb> (my|the|our)? <target|Capitalised name> ... <state word>      → "make Mia happier", "get the kids to listen"
// Rule B: (fix|improve|change|correct) (my|the|our)? <target|Name>('s|s') <state word>   → "fix Dad's attitude", "improve daughter's grades"
// Rule C: <target|Name> (should|must|needs to|has to) ...                        → "Mia should read more"
export function lintBehaviourTitle(title: string): { ok: true } | { ok: false; code: 'TARGETS_OTHER_PERSON'; match: string; rule: 'A'|'B'|'C' }
```

  A capitalised token that is not the first word counts as a name for rules A–C (so `Make Mia happier` is caught while `Read with Mia` passes). Titles that pass: "Put phone away during dinner", "Read with Mia for 15 minutes", "Call Dad Sunday", "Plan Saturday outing by Thursday", "Help Leo with his project for 20 minutes". The lint is applied in `RitualsService.create/update` and — one-line change in E02-04 (#47)'s `CommitmentsService.create/update`, guarded by `domain === 'FAMILY'`, injected from the exported `BehaviourLintService` — to `POST /commitments` and `PATCH /commitments/:id` so quick-add (E05-06 (#52)) gets the same rule. Error body: `{ code: 'BEHAVIOUR_TARGETS_OTHER_PERSON', message: 'Describe what you will do, not how someone else should feel or behave.', match }`.
- **Rewrite suggestion** (`POST /family/lint`) — runs the lint; when `ok: false`, calls `AiGatewayService.invoke({persona:'coach', userId, promptVersion:'family-behaviour-rewrite.v1', instructions: 'Rewrite the title as one concrete action the user will personally do, ≤ 12 words, no judgement of the other person.', input: {title, match}, schema: z.object({suggestion: z.string().min(3).max(120)}), schemaName:'FamilyBehaviourRewrite'})`; the suggestion is itself re-linted and dropped (`suggestion: null, source: 'none'`) if it fails. On `{ok:false}` from the gateway (any code) → `suggestion: null, source: 'none'`, HTTP 200. Log `family.lint ok=<bool> source=<ai|none>` — never the title. Throttle: reuse E01-06 (#26)'s `test-throttle.ts` per-user window (10/min) — the endpoint is user-triggered only.

Error codes: 400 Zod; 400 `BEHAVIOUR_TARGETS_OTHER_PERSON`; 400 `MINIMUM_EXCEEDS_IDEAL`; 404 (own-resource misses, incl. `FAMILY_MEMBER_NOT_FOUND`, `OUTCOME_NOT_FOUND`); 409 `INVALID_TRANSITION` bubbled from the matrix only if a cancel is attempted on a non-cancellable row (should not happen — the service filters statuses first; a 409 here is a programming error and is logged at `warn`).

OpenAPI: add tag `Family` ("Family members (minimal records), rituals, recurrence materialization, the behaviour lint and the planned-versus-kept summary. Own data only.") to the `Product` group in `apps/api/src/openapi/tags.ts` (group created by E05-01 (#38); create it here if E05-01 (#38) has not merged).

**UI (frontend-dev)** — n/a (E08-04 (#50) consumes).

**Tests (testing-dev)**

- `apps/api/src/family/recurrence.spec.ts` — `zonedTimeToUtc('2026-03-08','02:30','America/New_York')` → `07:30Z` (gap shifted forward); `('2026-11-01','01:30','America/New_York')` → `05:30Z` (first, DST instant); `('2026-06-15','18:30','America/Costa_Rica')` → `2026-06-16T00:30:00Z`; `('2026-01-01','00:15','Pacific/Auckland')` → `2025-12-31T11:15:00Z` (local date ahead of UTC). `nextOccurrences` with Tue/Thu/Sun 18:30, `everyNWeeks: 1`, `from` = Monday 00:00 CR, `to` = next Monday 00:00 CR → exactly 3, sorted, `dateLocal` correct across the UTC midnight boundary; `from` exclusive / `to` inclusive; `everyNWeeks: 2` anchored to a `createdAt` on a Wednesday: the following week yields none, the week after yields the days; `everyNWeeks: 4` across a year boundary (ISO week wrap) keeps the 4-week cadence; a window spanning a spring-forward day still yields exactly one occurrence per matching day; `weekStartLocal` on a Sunday 23:30 in `Pacific/Auckland` returns that week's Monday, on Sunday 23:30 UTC in `America/Costa_Rica` returns the previous Monday (still Sunday locally).
- `apps/api/src/family/behaviour-lint.spec.ts` — table test: every "Avoid" example from PRD §32 plus `get the kids to listen`, `fix Dad's attitude`, `Mia should read more`, `Improve my daughter's grades`, `MAKE MY WIFE CALMER` → `ok: false` with `match`; every "Good" example from PRD §32 plus `Read with Mia for 15 minutes`, `Call Dad Sunday`, `Help Leo with his project`, `Keep Sunday morning free for the family`, `Make pancakes with the kids` → `ok: true` (verb + target without a state word passes); `match` is the offending substring.
- `apps/api/src/family/ritual-materializer.service.spec.ts` (prisma mock) — creates rows with `domain 'FAMILY'`, `status 'PLANNED'`, `ritualId`, `familyMemberId`, `full 45 / short 28 / minimum 10` with the fallback title on `minimumVersion`; `short` is `null` when `ideal − minimum < 10`; `P2002` counted as `skipped`; second run same horizon creates 0; inactive ritual creates 0; `lastMaterializedThrough` set to the horizon; audit only when `created > 0`; `materializeAllDue` continues after one ritual throws.
- `apps/api/src/family/rituals.service.spec.ts` — create runs the lint before any write; `outcomeId` → `RoutinesService.create` called with the mapped fields and `routineId` stored; `minimumMinutes > idealMinutes` → 400; update of `recurrence` cancels future `PLANNED`/`READY` rows via the matrix, leaves `RESCHEDULED`/`COMPLETED` untouched, resets and re-materializes; `active: false` cancels and does not re-materialize; delete cancels future rows then deletes; foreign id → 404 for every method.
- `apps/api/src/family/family-members.service.spec.ts` — audit `meta` never contains `nickname` or `birthday` (assert on the mock call); update partial; delete → 204.
- `apps/api/src/family/behaviour-lint.service.spec.ts` — gateway stub `{ok:false}` → `suggestion null, source 'none'`, HTTP-200 shape; stub returning a suggestion that itself fails lint → dropped; gateway never called when the lint passes.
- `apps/api/src/family/tasks/ritual-materialize.task.spec.ts` — `handleCron` calls `materializeAllDue` once and logs the counts.
- `apps/api/test/family/family.integration.spec.ts` (`createTestApp` + `overrideProviders: [{provide: AiGatewayService, useValue: stub}]`) — 401 without token; member create → response keys exactly `FAMILY_MEMBER_RESPONSE_KEYS`; ritual create with Tue/Thu/Sun → `GET /commitments?from&to&domain=FAMILY` (E02-04 (#47)) returns the expected count with `ritualId`; `POST …/materialize` twice → `created 0` on the second; `POST /family/rituals` with `title 'Make Mia happier'` → 400 `BEHAVIOUR_TARGETS_OTHER_PERSON`; `POST /commitments {domain:'FAMILY', title:'Fix Dad\'s attitude'}` → 400 (the E02-04 (#47) hook); `POST /commitments {domain:'WORK', title:'Fix Dad\'s attitude'}` → 201 (lint is FAMILY-only); user B gets 404 on every user-A id; audit rows `ritual:create`, `ritual:materialize`, `ritual:update`, `ritual:delete`, `family_member:create` exist with `targetType 'ritual' | 'family_member'`; `POST /family/lint` returns 200 with `source:'none'` when the stub rejects.
- `apps/api/test/openapi/openapi-document.spec.ts` — passes with the new `Family` tag (existing assertion).

**Docs (docs-dev)** — `docs/API.md` new section "Family" (11 routes, request/response examples, the lint error body, the materialization contract); `CLAUDE.md` "API Endpoints" adds the routes; `docs/specs/family-domain.md` is E08-05 (#53)'s (this issue documents the recurrence rules in the PR description).

#### Acceptance criteria

- [ ] `POST /api/family/rituals` with Tue/Thu/Sun 18:30 (45/10) creates the ritual and, synchronously, one `PLANNED` FAMILY commitment per matching local date in the next 7 days, each with `ritualId`, `fullVersion.minutes 45`, `minimumVersion.minutes 10`, `minimumVersion.title` = the fallback text, and `scheduledStart` equal to 18:30 in `user_profiles.timezone` expressed in UTC.
- [ ] Running `POST /api/family/rituals/:id/materialize` again (or the 01:00 cron) creates no duplicate rows: the unique `(ritualId, scheduledStart)` index turns repeats into `skipped`.
- [ ] `everyNWeeks: 2` yields occurrences only in weeks whose Monday-start distance from the ritual's creation week is even; the unit spec proves it across a year boundary.
- [ ] `zonedTimeToUtc` is DST-correct for the spring-forward and fall-back cases in the unit spec, and a materialization window spanning a DST change yields exactly one occurrence per matching day.
- [ ] Changing a ritual's weekdays cancels only its future `PLANNED`/`READY` occurrences (never `RESCHEDULED`, `STARTED` or terminal rows, never a delete) and creates the new ones; `active: false` cancels future occurrences and stops materialization; deleting the ritual leaves past commitments in place with `ritualId = NULL`.
- [ ] Completing, moving and skipping a ritual occurrence are E05-02's `complete`, `reschedule` and `skip` — no family-specific action endpoints exist.
- [ ] Every "Avoid" example in PRD §32 is rejected with 400 `BEHAVIOUR_TARGETS_OTHER_PERSON` on ritual create/update and on `POST /commitments` with `domain: 'FAMILY'`; every "Good" example is accepted; a WORK commitment with the same text is not linted.
- [ ] `POST /api/family/lint` returns a rewrite suggestion against the fake OpenAI server and `suggestion: null, source: 'none'` with HTTP 200 when the gateway fails — the lint verdict itself never depends on AI.
- [ ] `GET /api/family/members` items carry exactly `id, nickname, relationship, birthday, createdAt`; `audit_events.meta` for member writes never contains a nickname or a birthday.
- [ ] Every action on another user's member or ritual returns 404; every successful write produces an `audit_events` row with the actions listed above.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (paths, bodies, function signatures, error codes, audit actions)
- [ ] Error handling: 404 for ownership, 400 for lint and minimum/ideal, materialization swallows `P2002` per row and isolates per-ritual failures in the cron; gateway failures degrade to `source: 'none'`
- [ ] Observability: `ritual.materialize` log line per cron run; audit per write; `family.lint` log line without the title; the gateway's own span covers the AI call
- [ ] Security: `@Auth()` + `userId` in every `where`; lint runs before any write; no nickname/birthday/title in logs or audit meta
- [ ] Config & secrets: none new (horizon 7 days and cron time are code constants `MATERIALIZE_HORIZON_DAYS`, documented in the spec)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated (`docs/API.md`, CLAUDE.md endpoints)

#### Manual test script

1. Epic script steps 1–3, then `evopath api POST /api/family/members --data '{"nickname":"Mia","relationship":"CHILD","birthday":"1900-09-09"}' | jq '.data | keys'` → the five keys.
2. `evopath api POST /api/family/rituals --data '{"title":"Phone-free dinner","purpose":"Be present","familyMemberId":"<mid>","recurrence":{"weekdays":[2,4,0],"time":"18:30","everyNWeeks":1},"idealMinutes":45,"minimumMinutes":10,"fallbackBehavior":"Sit down phone-free for the first 10 minutes"}' | jq '.data | {id, lastMaterializedThrough, routineId}'` → today + 7 days, `routineId: null`.
3. `evopath api GET "/api/commitments?from=<today>&to=<today+7d>&domain=FAMILY" | jq '.data[] | {scheduledStart, status, ritualId, m: .versions.minimum}'` → 2–3 rows at `00:30Z` (CR 18:30), `PLANNED`, the fallback title on `minimum`.
4. `evopath api POST /api/family/rituals/<id>/materialize` → `{created: 0, skipped: 2}` (or 3).
5. `evopath api POST /api/family/rituals --data '{"title":"Make Mia happier", ...}'` → 400 `BEHAVIOUR_TARGETS_OTHER_PERSON`, `match: "Make Mia happier"`. `evopath api POST /api/family/lint --data '{"title":"Make Mia happier"}'` → `{ok:false, suggestion:"<fake AI text>", source:"ai"}`; `docker compose stop fake-openai` → `suggestion: null, source: "none"`.
6. `evopath api PATCH /api/family/rituals/<id> --data '{"recurrence":{"weekdays":[2,4],"time":"18:30","everyNWeeks":1}}'` → `psql`: Sunday rows `CANCELLED`, Tue/Thu rows still `PLANNED`, no rows deleted.
7. Using a second user's token: `GET /api/family/rituals/<id>` → 404.
8. `SELECT action, meta FROM audit_events WHERE action LIKE 'ritual:%' OR action LIKE 'family_member:%';` → rows as listed; `meta` of `family_member:create` is `{"relationship":"CHILD"}`.

#### Out of scope

- The summary/review data (E08-03 (#45)); UI (E08-04 (#50)).
- Reminders and deep links (E12); Routine/Plan versioning when a ritual changes (E10 — the linked `Routine` is updated in place, no `PlanVersion` is created).
- Rituals in WORK or HEALTH domains — the model is FAMILY-only in this epic.
- Materializing beyond 7 days or backfilling the past.

#### Notes for the implementing agent

- Copy `apps/api/src/auth/tasks/token-cleanup.task.ts` for the cron class; `ScheduleModule.forRoot()` already lives in `app.module.ts` — do not register it again.
- Keep `recurrence.ts` and `behaviour-lint.ts` free of Prisma, DI and `Date.now()`; the services pass `now`.
- Reuse `localDate`/`localDayBounds` from `apps/api/src/today/local-date.ts` (E05-01 (#38)); if that file is missing when you start, create it with the E05-01 (#38) signatures rather than a second helper.
- Cancel through E02-04 (#47)'s transition service (matrix), never with a raw `updateMany` to `CANCELLED`; filter statuses first so the matrix never throws.
- Call `AiGatewayService.invoke` outside any `$transaction`; it never throws for provider errors — check `ok` before reading `output`.
- Materialize **after** the ritual insert commits and outside the transaction (the unique index, not a transaction, is the idempotency guarantee).
- The `CommitmentsService` lint hook is a two-line change in E02-04 (#47)'s module (`imports: [FamilyModule]` and one call); guard against the circular import: `FamilyModule` imports `CommitmentsModule` for the transition service, so export `BehaviourLintService` from a small `apps/api/src/family/behaviour-lint.module.ts` that has no imports, and have both modules import that.
- Zod v4 + `nestjs-zod` DTOs; Fastify (no Express `res`); `@HttpCode(HttpStatus.OK)` on `materialize` and `lint`, `NO_CONTENT` on deletes.
- Register the `Family` tag in `apps/api/src/openapi/tags.ts` or `test/openapi/openapi-document.spec.ts` fails.

---

### E08-03 `feat(api): add family review summary with planned-versus-kept and no aggregate score` — #45

**Part of epic:** E08 · **Blocked by:** E08-01 (#37), E05-02 (#40) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §35 says the app may show "Planned family commitments: 4 / Kept: 3" but must avoid gamified judgement, and VISION §12 forbids any relationship or parenting score outright: the product measures whether the user behaved in line with their own stated intentions, never the quality of a relationship. PRD §105's last criterion — "Product never creates family-quality score" — is a hard acceptance rule. E10's weekly review and E11's momentum need family planned-versus-kept numbers per ritual and per week; without a single, tested endpoint each consumer would aggregate differently and one of them would eventually invent a percentage.

#### Proposed solution

One read endpoint returning per-ritual, per-week counts of statuses the E05-02 (#40) actions wrote, a deterministic "displacement" sentence built from PRD §35's coach copy with data placeholders (AI may rephrase, never compute), and a test that fails the build if the family DTOs or the `/family/*` part of the OpenAPI document ever contain `score`, `quality` or `rating`.

**Data (database-dev)** — n/a (reads `commitments`, `rituals`, `reflections`). No migration.

**API (backend-dev)** — files: `apps/api/src/family/family-summary.controller.ts` (new, `@ApiTags('Family')`, `@Controller('family/summary')`), `apps/api/src/family/family-summary.service.ts` (new), `apps/api/src/family/family-summary.schema.ts` (new), `apps/api/src/family/summary-copy.ts` (new, the template), `apps/api/src/family/no-score.guard.spec.ts` (test, below).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/family/summary?weekStart=YYYY-MM-DD&weeks=1..12` | `@Auth()` (own) | query: `weekStart` (a Monday in the user's timezone; default = current week), `weeks` (default 4, counting backwards from `weekStart` inclusive) | 200 `FamilySummary` |

```ts
export const ritualWeekCountsSchema = z.object({
  ritualId: z.string().uuid().nullable(),   // null = ad-hoc family commitments (quick add, onboarding) grouped as one line
  title: z.string(),
  planned: z.number().int(),                // rows whose scheduledStart falls in the week, any status except CANCELLED
  kept: z.number().int(),                   // COMPLETED
  partial: z.number().int(),                // PARTIALLY_COMPLETED
  moved: z.number().int(),                  // RESCHEDULED (still open) — counted where it was originally planned
  skipped: z.number().int(),                // SKIPPED
  missed: z.number().int(),                 // MISSED (E11 sets it) — 0 until E11 ships
  open: z.number().int(),                   // PLANNED | READY | STARTED (the week is not over yet)
}).strict();
export const familySummaryWeekSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rituals: z.array(ritualWeekCountsSchema),
  totals: ritualWeekCountsSchema.omit({ ritualId: true, title: true }),
}).strict();
export const familySummarySchema = z.object({
  timezone: z.string(),
  weeks: z.array(familySummaryWeekSchema),                       // newest first
  coachNote: z.object({ text: z.string().max(280), source: z.enum(['ai','template']) }).nullable(),
}).strict();
```

- `FamilySummaryService.getSummary(userId, {weekStart, weeks}, now = new Date())`: `tz = user_profiles.timezone ?? 'UTC'`; validate `weekStart` is a Monday in `tz` (400 `WEEK_START_NOT_MONDAY`); for each week compute `localDayBounds` (E05-01 (#38)) of Monday 00:00 → next Monday 00:00; one query per window: `commitments` where `userId`, `domain = 'FAMILY'`, `scheduledStart` in window, `status != 'CANCELLED'`; group in memory by `ritualId` (title from the ritual, or "Other family commitments" for `null`); rituals with zero rows in a week are still listed with zeros when they were `active` and created before the window end (the user planned nothing because nothing was due — still visible, no judgement). `moved` counts rows with status `RESCHEDULED`; because E02-04 (#47)'s transition closes the **original** row as `RESCHEDULED` and creates a **new** `PLANNED` row at the new time (`rescheduledFromId`, `rescheduleCount + 1`), the original week counts the move under `moved` and the new week sees the live row as `open`/`kept`/… — document this in the spec; a commitment moved twice therefore leaves two `RESCHEDULED` rows behind, each counted once in the week it was originally due. There is no derived ratio, percentage, streak or grade anywhere in the payload: consumers compute `kept/planned` for display if they want, and E08-04 (#50) displays the two integers side by side.
- `coachNote` — deterministic first: `displaced = count of FAMILY commitments in the requested window with status SKIPPED or RESCHEDULED whose skipReason ∈ {UNEXPECTED_CONFLICT, BAD_TIMING, TOO_MUCH}` (E05-02 (#40) writes the enum; `RESCHEDULED` rows have no reason and are counted only when a `Reflection` with `relatedType 'commitment'` and a matching tag exists) plus `evening = those with local hour ≥ 17`. When `displaced >= 2`, template (`summary-copy.ts`):

  ```ts
  export const DISPLACEMENT_TEMPLATE =
    'Work displaced {count} {evening}family commitment{s} {period}. Do you want to protect those times more aggressively, or is the current trade-off intentional?';
  export function renderDisplacementNote(input: {count: number; eveningCount: number; weeks: number}): string
  // {evening} = 'evening ' when eveningCount === count, else ''; {s} plural; {period} = 'this week' | 'over the last {weeks} weeks'
  ```

  Then, optionally, `AiGatewayService.invoke({persona:'coach', userId, promptVersion:'family-summary-note.v1', instructions: <coachingStyle-aware; 'Rephrase in ≤ 2 sentences; keep the numbers exactly; ask one question; never rate the relationship'>, input: {count, eveningCount, weeks, template}, schema: z.object({text: z.string().max(280)}), schemaName:'FamilySummaryNote'})`; on `{ok:false}` → the template with `source:'template'`. The AI text is re-checked: if it does not contain the digit string `{count}` or matches `/score|quality|rating|grade/i`, the template is used instead (a hallucinated number or a judgement never reaches the user). When `displaced < 2` → `coachNote: null`. Cache: in-memory `Map<`${userId}:${weekStart}:${weeks}`, note>` evicted after 6 h and on any `ritual:*` audit write — document as per-process. Log `family.summary user=<id> weeks=<n> source=<ai|template|none>`.
- **No-score rule** — enforced by `apps/api/src/family/no-score.guard.spec.ts`: (1) reads every `apps/api/src/family/**/*.schema.ts` and `dto/*.ts` file and fails on `/\b(score|quality|rating|grade|sentiment)\b/i` outside comments; (2) boots the app with `createTestApp` (mocked DB), builds the OpenAPI document exactly as `test/openapi/openapi-document.spec.ts` does, serialises every path starting with `/api/family` and its referenced schemas, and fails on the same regex; (3) `familySummarySchema` and `ritualWeekCountsSchema` are `.strict()`. The words appear nowhere in the family module except this spec and one comment naming the rule.

Error codes: 400 Zod / `WEEK_START_NOT_MONDAY`; 401.

OpenAPI: reuse tag `Family` (E08-02 (#41)).

**UI (frontend-dev)** — n/a (E08-04 (#50) renders the panel).

**Tests (testing-dev)**

- `apps/api/src/family/family-summary.service.spec.ts` (prisma mock) — seeded rows across two rituals and one ad-hoc commitment: `planned/kept/partial/moved/skipped/open` per ritual and `totals` sum correctly; `CANCELLED` rows excluded; a ritual active with zero rows still listed with zeros; a ritual created after the window end is not listed; `weekStart` on a Tuesday → 400; weeks ordered newest first; the window uses the user's timezone (a Sunday 23:30 CR occurrence lands in that week, not the next); no key in the output matches `/score|quality|rating/i` (walk the object).
- `apps/api/src/family/summary-copy.spec.ts` — `renderDisplacementNote({count:2, eveningCount:2, weeks:1})` → "Work displaced 2 evening family commitments this week. …"; `({count:3, eveningCount:1, weeks:4})` → "…3 family commitments over the last 4 weeks…"; singular with `count: 1` is never called (service threshold 2) but renders grammatically.
- `apps/api/src/family/family-summary.service.spec.ts` (AI part) — gateway `{ok:false}` → template; AI output missing the count digit → template; AI output containing "score" → template; `displaced < 2` → `coachNote null` and gateway not called; cache hit skips the gateway.
- `apps/api/src/family/no-score.guard.spec.ts` — as specified; also asserts the regex would catch a planted fixture string (so the test cannot pass vacuously).
- `apps/api/test/family/family-summary.integration.spec.ts` — full app with gateway stub: 401; default query returns 4 weeks with `weekStart` = this Monday in the profile timezone; after E05-02 (#40) `complete`/`skip` on materialized rows the counts change accordingly; user B's rows never appear; body validates against `familySummarySchema`; serialised body `!~ /score|quality|rating/i`.

**Docs (docs-dev)** — `docs/API.md` "Family" section gains the summary route and the payload; `CLAUDE.md` "API Endpoints" adds it; the no-score rule and the moved-row accounting decision go to `docs/specs/family-domain.md` (E08-05 (#53)).

#### Acceptance criteria

- [ ] `GET /api/family/summary` returns, per week and per ritual, the integer counts `planned, kept, partial, moved, skipped, missed, open` plus week totals, and nothing else — no ratio, percentage, streak, grade or score field.
- [ ] After completing one of three materialized occurrences and skipping another, the current week shows `planned 3, kept 1, skipped 1, open 1` for that ritual.
- [ ] `weekStart` that is not a Monday in the user's timezone returns 400 `WEEK_START_NOT_MONDAY`; the default is the current local week.
- [ ] Ad-hoc FAMILY commitments (no ritual) appear as one "Other family commitments" line; `CANCELLED` rows are never counted.
- [ ] `coachNote` is `null` below two displaced commitments; at two or more it is the PRD §35 sentence with the real count, `source: 'template'` when the gateway fails and `source: 'ai'` against the fake server; an AI rephrase that changes the number or rates the relationship is discarded for the template.
- [ ] `no-score.guard.spec.ts` fails when a `score`, `quality`, `rating`, `grade` or `sentiment` key is added to any family schema/DTO or appears under `/api/family` in the OpenAPI document (verified by temporarily planting one).
- [ ] Another user's commitments never affect the response.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (schema names, count semantics, template text, error code)
- [ ] Error handling: gateway failures never surface as non-200; invalid timezone falls back to `UTC` with a warn log (same rule as E05-01)
- [ ] Observability: `family.summary` log line with source; no note text in logs
- [ ] Security: `@Auth()`; `userId` in every `where`; the response carries no member nickname or birthday (rituals are named by their own title)
- [ ] Config & secrets: none; the displacement threshold `DISPLACEMENT_THRESHOLD = 2` is a code constant documented in the spec
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated (`docs/API.md`, CLAUDE.md)

#### Manual test script

1. Epic script steps 1–3 and E08-02 (#41) script steps 2–3 (ritual with 2–3 occurrences this week).
2. `evopath api POST /api/commitments/<occ1>/actions/complete --data '{}'`; `evopath api POST /api/commitments/<occ2>/actions/skip --data '{"reason":"UNEXPECTED_CONFLICT"}'`.
3. `evopath api GET "/api/family/summary?weekStart=<this Monday>&weeks=1" | jq '.data.weeks[0]'` → the ritual line with `kept 1, skipped 1`, `open` = remaining; `coachNote: null` (only one displaced).
4. Skip one more with `BAD_TIMING` → `coachNote.text` starts "Work displaced 2 evening family commitments this week." with `source: "ai"` (fake server) — stop `fake-openai` and re-request after 6 h or restart the API → `source: "template"`, identical numbers.
5. `evopath api GET "/api/family/summary?weekStart=<a Tuesday>"` → 400 `WEEK_START_NOT_MONDAY`.
6. `evopath api GET /api/family/summary | jq -r 'tostring' | grep -icE 'score|quality|rating'` → `0`.

#### Out of scope

- Weekly review generation, recommendations and plan-diff proposals (E10 consumes this endpoint).
- Family momentum state (E11), charts (E08-04 (#50) shows two integers, E11 owns visualisation).
- Any per-member breakdown (a member is optional context on a ritual, never an axis of measurement).

#### Notes for the implementing agent

- Keep the aggregation in memory over one Prisma query per week; there are at most a handful of family rows per week and the code stays readable for the no-score reviewer.
- The regex in `no-score.guard.spec.ts` must run over file **text**, not TypeScript types, so it also catches a stray `qualityScore` in a Zod description string.
- Reuse `localDayBounds`/`localDate` from E05-01 (#38); do not introduce a date library.
- The AI rephrase must keep the digits: assert `text.includes(String(count))` before accepting it.
- `RESCHEDULED` rows carry no `skipReason`; look up E05-02 (#40)'s `Reflection` (`relatedType 'commitment'`, `relatedId`) for a tag before counting them as displaced.

---

### E08-04 `feat(web): add Family views under Path and family actions on Today` — #50

**Part of epic:** E08 · **Blocked by:** E08-02 (#41), E08-03 (#45), E05-04 (#46), E05-06 (#52), E02-06 (#56) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement

VISION §11 asks Family to answer "What family rituals am I trying to protect?" and "What promises have I made?"; PRD §34 needs a way to create a ritual with recurrence and durations; PRD §33 limits the member record to nickname, relationship and birthday; PRD §35 wants planned-versus-kept shown without gamified judgement; PRD §105 requires complete/move/skip on family commitments. E05-04 (#46)'s Today card already renders FAMILY commitments with the generic action set, and E02-06 (#56)'s Path screen has no Family section. The user has nowhere to define a ritual, see who it is with, or answer "I'm in" to tonight's dinner in family language.

#### Proposed solution

A `/path/family` page (rituals, members, upcoming occurrences, this-week counts) with sheet/dialog editors and a recurrence picker; family-specific primary actions on Today's FAMILY card ("I'm in", "Move it", "Skip today") mapped onto E02-04 (#47)/E05-02 (#40) endpoints; and a birthday cue on Today computed client-side from the member's date-only birthday.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (consumes E08-02 (#41), E08-03 (#45), E02-04 (#47) `POST /commitments/:id/transition`, E05-02 (#40) actions).

**UI (frontend-dev)**

Routes (`apps/web/src/App.tsx`): `<Route path="/path/family" element={<FamilyPage />} />` inside `NotificationProvider` + `Layout`, ungated beyond `ProtectedRoute` (own data). Ownership: `DESTINATION_ROUTES.path = ['/path']` (E02-05 (#51)) already covers it via `owns()`; no change to `apps/web/src/config/destinations.ts` and no settings-registry card (this is a Path surface, not a settings page). E02-06 (#56)'s Path screen gets a **Family** section header with a `Manage rituals` link to `/path/family` and, when rituals exist, the next occurrence per ritual (`RitualUpcomingRow`) — a one-component addition to `apps/web/src/pages/PathPage.tsx` (E02-06 (#56)'s file name may differ; read it first).

Types (`apps/web/src/types/index.ts`): `FamilyRelationship`, `FamilyMember` (exactly `id, nickname, relationship, birthday, createdAt`), `RitualRecurrence`, `Ritual`, `RitualWithUpcoming`, `LintResult`, `FamilySummary`, `FamilySummaryWeek`, `RitualWeekCounts`, `MaterializeResult` — mirroring E08-01 (#37)/02/03 schemas field for field. `CommitmentCard` (E05-04 (#46)) gains `ritualId: string | null` and `familyMemberId: string | null` (E08-01 (#37) columns; E05-04 (#46)'s mapper must expose them — one-line change under this issue if missing).

`apps/web/src/services/api.ts`: `getFamilyMembers()`, `createFamilyMember(body)`, `updateFamilyMember(id, body)`, `deleteFamilyMember(id)`, `getRituals(params?)`, `getRitual(id)`, `createRitual(body)`, `updateRitual(id, body)`, `deleteRitual(id)`, `materializeRitual(id)`, `lintFamilyTitle(title)`, `getFamilySummary({weekStart?, weeks?})`, `transitionCommitment(id, body)` (E02-04 (#47)'s body shape; add only if E05 did not) — all through the `api` `ApiService`.

Hooks: `apps/web/src/hooks/useFamilyMembers.ts` (`{members, loading, error, create, update, remove, refresh}`), `useRituals.ts` (`{rituals, loading, error, create, update, remove, materialize, refresh}` — `create`/`update` surface a 400 `BEHAVIOUR_TARGETS_OTHER_PERSON` as a field error on `title` with `match`), `useFamilySummary.ts` (`{summary, loading, error, refresh}`; `weeks: 1` for the panel), `useBehaviourLint.ts` (debounced 500 ms `lintFamilyTitle` on the title field; exposes `{result, suggesting, suggest()}`).

Pure utils: `apps/web/src/utils/recurrence.ts` — `describeRecurrence(r: RitualRecurrence, locale): string` ("Tue, Thu, Sun · 18:30", "Every 2 weeks on Sat · 10:00", "Daily · 20:00" when all 7), `WEEKDAY_ORDER` starting on Monday for display while values stay 0 = Sunday; `apps/web/src/utils/birthday.ts` — `daysUntilBirthday(birthday: string, todayLocal: string): number | null` (ignores the year, handles 29 Feb by using 28 Feb in non-leap years, returns 0 on the day, 1..365 otherwise); `apps/web/src/utils/ritualForm.schema.ts` — Zod: title 1..120, `weekdays` ≥ 1, time `HH:mm`, `everyNWeeks ∈ {1,2,4}`, `idealMinutes` 5..240, `minimumMinutes` 1..`idealMinutes` (cross-field), `fallbackBehavior` ≤ 200, `purpose` ≤ 300.

Components (`apps/web/src/components/family/`):

- `FamilyPage` (`apps/web/src/pages/FamilyPage.tsx`) — `Container maxWidth="lg"`; `Grid` `size={{ xs: 12, md: 7 }}`: `RitualList` + `UpcomingFamilyCommitments`; `size={{ xs: 12, md: 5 }}`: `FamilyMemberCards` + `FamilyWeekPanel`. Empty state (no rituals, no members): illustration-free copy "Protect what matters before the calendar takes it" with `Add a family member` and `Create a ritual`. Page title via the AppBar title resolver the way E02-06 (#56)'s Path page does.
- `RitualList.tsx` (`{rituals, onEdit, onToggleActive, onDelete}`) — `RitualCard` per ritual: title, `describeRecurrence`, "45 min (min 10)", member chip when `familyMemberId` (nickname looked up from `useFamilyMembers`), `Paused` tag when `!active`, ⋯ menu: Edit / Pause–Resume / Delete (confirm dialog: "Future occurrences will be cancelled. Past ones stay on your record.").
- `RitualEditor.tsx` (`{open, initial?, members, onClose, onSaved}`) — `SwipeableDrawer anchor="bottom"` below 600px, `Dialog maxWidth="sm"` at ≥ 600px (`useMediaQuery(theme.breakpoints.down('sm'))`, a local presentation choice as in E05-06 (#52) — not one of the five coupled gates). Fields: title (with `useBehaviourLint`: on a failing lint show the error under the field, and `Suggest a rewrite` when `result.suggestion` exists — never auto-replace), purpose, member `Select` ("No one in particular"), `RecurrencePicker`, ideal/minimum minutes (chips 5/10/15/20/30/45/60 + custom), fallback text with helper "What is the smallest version that still counts?", optional `outcomeId` `Select` from `GET /outcomes?domain=FAMILY` (E02-02 (#39)) labelled "Link to a Path outcome (shows on Path)". Save → create/update → `onSaved`; server 400 lint → field error.
- `RecurrencePicker.tsx` (`{value, onChange}`) — seven `ToggleButton` weekday chips in Monday-first order (`aria-pressed`, labels `Mon … Sun`), MUI X `TimePicker` (24 h, minute step 5), `ToggleButtonGroup` "Every week / 2 weeks / 4 weeks"; live summary text below via `describeRecurrence`.
- `FamilyMemberCards.tsx` (`{members, onAdd, onEdit, onDelete}`) — small cards: nickname, relationship label, `Birthday in N days` / `Birthday today` when `daysUntilBirthday ≤ 7`, else the date without year when set. Nothing else is rendered or requested — the card is intentionally sparse (PRD §33).
- `FamilyMemberEditor.tsx` (`{open, initial?, onClose, onSaved}`) — sheet/dialog as above; nickname (40 max, counter), relationship `Select` in enum order, birthday `DatePicker` with a "Year unknown" checkbox that sends `1900-MM-DD`; delete requires confirm ("Rituals and past commitments keep their history; the name is removed.").
- `UpcomingFamilyCommitments.tsx` (`{commitments, onAction}`) — next 7 days of FAMILY `CommitmentCard`s from `GET /commitments?from&to&domain=FAMILY` (E02-04 (#47)), grouped by local day, each row reusing E05-04 (#46)'s `CommitmentRow` with the family action labels below.
- `FamilyWeekPanel.tsx` (`{summary}`) — "This week": one line per ritual `title · Planned N · Kept N` with small `moved/skipped` text; `coachNote.text` in a quiet `Alert severity="info"` when present, with a "template" caption when `source === 'template'`. **No progress bar, no percentage, no colour scale** — two integers, deliberately (VISION §12).
- `BirthdayCue.tsx` (`{members, todayLocal}`) — chip "🎂 Mia's birthday in 5 days" / "today"; rendered inside Today's FAMILY `DomainCard` header (E05-04 (#46) `DomainCard` gains an optional `headerExtra?: ReactNode` prop) and at the top of `FamilyPage`. Data: `useFamilyMembers` (one extra `GET /family/members` on Today, cached for the session in the hook).
- Family action labels on Today (`apps/web/src/components/today/familyActions.ts`, consumed by `CommitmentRow`/`CommitmentActionsMenu` when `commitment.domain === 'FAMILY'`): `PLANNED | RESCHEDULED` → primary **I'm in** (`transitionCommitment(id, → READY)` via E02-04 (#47); optimistic; the row then shows E05's `Start`), secondary **Move it** (opens E05-04 (#46) `RescheduleDialog` → `rescheduleCommitment`), **Skip today** (opens E05-04 (#46) `SkipDialog` → `skipCommitment`; reason list unchanged); `READY | STARTED` → E05's generic labels; `COMPLETED` → "Kept" instead of "Done" in the status text. Labels only — every request is an existing E02-04 (#47)/E05-02 (#40) endpoint.

Responsive: `FamilyPage` two columns at `md`, single column below; editors sheet/dialog at `sm` as a local choice; `BottomNav` and the rail untouched (five coupled gates). Visual harness: add `family` and `family-empty` scenes to `apps/web/visual/main.tsx` and regenerate baselines in the pinned Playwright container.

A11y: weekday chips are `ToggleButton`s with `aria-pressed` and full-name `aria-label`s ("Tuesday"); editors are labelled by their title (`aria-labelledby`) and trap focus; the birthday cue is text, not colour; lint errors use `helperText` + `aria-invalid` + `aria-describedby`; "I'm in" has `aria-label="I'm in: <title>"`; axe passes in the page tests.

**Tests (testing-dev)**

- MSW: extend `apps/web/src/__tests__/mocks/handlers.ts` with `/family/members`, `/family/rituals(/:id)(/materialize)`, `/family/lint`, `/family/summary`, `/commitments/:id/transition` with mutable in-memory state; fixtures `apps/web/src/__tests__/mocks/family.data.ts`.
- `apps/web/src/__tests__/utils/recurrence.test.ts` — `describeRecurrence` for 1/2/4 weeks, all-seven → "Daily", Monday-first ordering of a `[0,2,4]` value → "Tue, Thu, Sun".
- `apps/web/src/__tests__/utils/birthday.test.ts` — 5 days ahead, today, yesterday → 364/365, year ignored (`1900-…`), 29 Feb in a non-leap year, `null` for `null`.
- `apps/web/src/__tests__/utils/ritualForm.schema.test.ts` — minimum > ideal rejected; empty weekdays rejected; `everyNWeeks: 3` rejected.
- `apps/web/src/__tests__/pages/FamilyPage.test.tsx` — empty state CTAs; creating a member posts exactly `{nickname, relationship, birthday}` and the card appears; creating a ritual posts the exact E08-02 (#41) body (assert JSON) and the card shows "Tue, Thu, Sun · 18:30 · 45 min (min 10)"; lint 400 from MSW → field error with `match` text and `Suggest a rewrite` present only when the mock returns a suggestion; clicking it fills the field (does not submit); week panel shows `Planned 3 · Kept 1` and **no** `%` or progress bar (`queryByRole('progressbar')` is null); birthday cue at ≤ 7 days; below 600px the editor is a `SwipeableDrawer`, at ≥ 600px a `Dialog` (mock `matchMedia`); axe.
- `apps/web/src/__tests__/components/family/RecurrencePicker.test.tsx` — chips toggle values (Sunday → 0), keyboard toggling, summary text updates.
- `apps/web/src/__tests__/components/family/RitualEditor.test.tsx` — edit mode prefills; `Pause` sends `{active:false}`; delete confirm text; server 400 lint mapped to the title field.
- `apps/web/src/__tests__/pages/TodayPage.test.tsx` (extend) — a FAMILY row shows `I'm in` / `Move it` / `Skip today`; `I'm in` posts the transition and the row re-renders as READY with `Start`; WORK rows are unchanged; cue chip renders when a member's birthday is within 7 days.
- `apps/web/src/__tests__/config/destinations.test.ts` — `/path/family` is owned by `path` (prefix), and by nothing else.

**Docs (docs-dev)** — `docs/specs/family-domain.md` UI section (E08-05 (#53) owns the file; this issue adds the component map to the PR); `CLAUDE.md` unchanged (no settings page, no registry).

#### Acceptance criteria

- [ ] `/path/family` renders rituals, member cards, the next 7 days of family commitments and the this-week panel from `GET /family/rituals`, `GET /family/members`, `GET /commitments?domain=FAMILY` and `GET /family/summary`; the empty state shows the two CTAs.
- [ ] Creating a ritual from the editor (Tue/Thu/Sun, 18:30, every week, 45/10, fallback) posts the exact E08-02 body and, after save, its occurrences appear under Upcoming without a reload.
- [ ] A title such as "Make Mia happier" shows the lint error under the field before submit; when the API returns a suggestion the `Suggest a rewrite` button fills the field and never submits on its own; when AI is down the error shows without the button.
- [ ] Member cards show only nickname, relationship and (optional) birthday/cue; the editor has no other fields.
- [ ] The this-week panel shows `Planned N · Kept N` per ritual as integers with no percentage, bar, colour scale or score.
- [ ] On Today, a PLANNED/RESCHEDULED FAMILY row shows `I'm in`, `Move it`, `Skip today`; `I'm in` moves it to READY (E02-04 transition) and the row then shows E05's `Start`; `Move it`/`Skip today` reuse E05-04's dialogs and E05-02's endpoints.
- [ ] A member whose birthday is within 7 days produces a cue chip on Today's Family card and on `/path/family`; the year is ignored.
- [ ] Below 600px the page is single column and editors open as bottom sheets; at ≥ 600px editors are dialogs; the rail/BottomNav gates are untouched.
- [ ] The Path screen's Family section links to `/path/family` and lists the next occurrence per active ritual.
- [ ] axe reports no violations on `FamilyPage` and on Today with family rows.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified (routes, component names, hook shapes, util signatures)
- [ ] Error handling: 400 lint → field error; 404 on a deleted ritual → snackbar + refresh; network errors keep editors open with values intact; optimistic "I'm in" rolls back on 409 with the server message
- [ ] Observability: n/a client-side beyond existing `ApiError` logging
- [ ] Security: only `api` service calls; nicknames rendered as text (no HTML); nothing about members is stored in `localStorage`
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm run test:run` in `apps/web`); visual baselines regenerated
- [ ] Docs updated

#### Manual test script

1. Epic script steps 4–6, 9–11, 14.
2. At phone width, open `Create a ritual` → bottom sheet; swipe down closes; values survive a failed save (stop the API briefly).
3. In the editor type "Fix Dad's attitude" → error appears within ~1 s without submitting; `Suggest a rewrite` → field becomes the fake AI text; edit it to "Call Dad Sunday" → error clears → Save.
4. Set a member's birthday to today → Today's Family card header shows "🎂 Mia's birthday today".
5. Keyboard only: Tab to the weekday chips, Space toggles, screen reader announces "Tuesday, pressed".

#### Out of scope

- Notification settings for family cues (E12), calendar sync (PRD §69).
- Charts or momentum visuals for family (E11 owns Progress).
- Editing occurrences' text (E05-06 (#52)'s editor already does that for any commitment).
- A Family destination in the bottom bar or rail — Family lives under Path (PRD §11 fixes the five destinations).

#### Notes for the implementing agent

- Follow `apps/web/src/pages/Admin/EmailSettingsPage.tsx` + `hooks/useEmailSettings.ts` for the hook/page split and `ApiError` handling; E05-06 (#52)'s `QuickAddSheet` for the sheet/dialog switch.
- Do not touch `Layout.tsx`, `BottomNav.tsx`, `AppBar.tsx`, `SettingsHub.tsx` breakpoints (five coupled gates); `md` on `FamilyPage` and `sm` in the editors are local layout choices — say so in a comment.
- `DomainCard`'s `headerExtra` prop and `CommitmentRow`'s label map are small extensions of E05-04 (#46) components; keep them additive so E05 tests stay green.
- Weekday values are 0 = Sunday (JS `getDay()`, E08-02 (#41) contract); only the **display** order is Monday-first.
- The birthday placeholder year `1900` must never be shown; `daysUntilBirthday` ignores the year and the card prints `dd MMM` only.
- Do not add `/path/family` to `USER_SETTINGS_SECTIONS` or `ADMIN_SECTIONS`; it is not a settings page.

---

### E08-05 `test(tests): E08 end-to-end verification` — #53

**Part of epic:** E08 · **Blocked by:** E08-01 (#37), E08-02 (#41), E08-03 (#45), E08-04 (#50), E01-10 (#30), E05-07 (#55) · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → docs-dev

#### Problem statement

PRD §105's five family acceptance criteria — create a family commitment, create a recurrence, complete/move/skip, and never create a family-quality score — are only proven when a browser drives the ritual from creation to a kept occurrence against the real API, database and cron path, with the fake OpenAI server (E01-10 (#30)) answering the optional AI calls. The epic also has to leave the spec later epics (E10 planned-vs-actual, E11 momentum, E12 N5 cues) read for the contracts fixed here.

#### Proposed solution

A Playwright spec `tests/e2e/specs/family.spec.ts` with an API helper for family resources, an API-level no-score assertion, the `docs/specs/family-domain.md` document, API.md/CLAUDE.md/TESTING.md updates, and the `docs/epics` back-link.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (a seeding gap in E08-02 (#41)'s DTOs is filed against E08-02 (#41); do not patch here).

**UI (frontend-dev)** — add stable `data-testid`s only where role/text selectors are ambiguous: `family-add-member`, `family-create-ritual`, `ritual-title`, `recurrence-weekday-<0..6>`, `recurrence-time`, `ritual-ideal`, `ritual-minimum`, `ritual-fallback`, `ritual-save`, `ritual-card-<id>`, `family-week-panel`, `today-family-imin`, `today-family-move`, `today-family-skip`, `today-birthday-cue`.

**Tests (testing-dev)**

- `tests/e2e/helpers/family.helper.ts` (new): `apiContext(page)` (reuse E05-07 (#55)'s `commitments.helper.ts` implementation — import, do not copy), `createMember(ctx, body)`, `createRitual(ctx, body)`, `listFamilyCommitments(ctx, from, to)`, `materialize(ctx, ritualId)`, `getSummary(ctx, weekStart, weeks)`, `mondayOf(dateLocal)`, `setTimezone(ctx, tz)` (E04-01 (#100) `PATCH /me/profile`).
- `tests/e2e/specs/family.spec.ts` (run with `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`), fresh user per test via `loginAsTestUser` with a unique email, `withAiKey` (E01-10 (#30)) and onboarding marked complete (E04-06 (#107)); timezone set to `UTC` so "tonight" is computable:
  1. **Member → ritual → materialize → Today → I'm in → complete → summary 1/1**: UI: `/path/family` → `Add a family member` (`Mia`, `Child`, birthday = today + 5 days with the year checkbox unticked) → card visible with "Birthday in 5 days"; `Create a ritual` → title `Phone-free dinner`, weekdays chosen so that **today** is included plus two others (compute from `new Date().getUTCDay()`), time = current UTC time + 2 h rounded to 5 min (so tonight's occurrence is in the future), ideal 45, minimum 10, fallback text → Save; expect the ritual card text to include "45 min (min 10)". API: `listFamilyCommitments(today, today+7d)` → ≥ 1 row with `ritualId`, exactly one with today's date; `materialize(ritualId)` → `created 0`. UI: `/` → Family card shows `Phone-free dinner` and `today-birthday-cue` reads "Mia's birthday in 5 days"; click `today-family-imin` → row shows `Start`; ⋯ → `Done` → `Complete`; row shows kept. API: `getSummary(mondayOf(today), 1)` → the ritual line has `planned ≥ 1`, `kept 1`; `JSON.stringify(summary)` does not match `/score|quality|rating/i`.
  2. **Move and skip via Today**: seed a ritual with two occurrences this week through the API; on `/`, `today-family-move` → tomorrow → save → `GET /commitments/:id` `rescheduleCount 1`, `status RESCHEDULED`; on the second occurrence (reschedule it to today first via API) `today-family-skip` → `Unexpected conflict` → `SKIPPED`; summary shows `skipped 1`.
  3. **Behaviour lint in the editor with and without AI**: type `Make Mia happier` → error text visible, `Suggest a rewrite` visible (fake server) → click → field is non-empty and differs → Save disabled until the lint passes; then admin fixture points `baseUrl` at `http://fake-openai:1/v1` (E05-07 (#55) case 5 pattern) → reload → same title → error visible, no suggest button; `afterEach` restores `baseUrl`.
  4. **Recurrence edit cancels only future PLANNED rows**: API-seeded ritual with three weekdays; complete one occurrence via API; UI: edit → untick one weekday → Save; API: rows for the removed weekday in the future are `CANCELLED`, the completed row is still `COMPLETED`, no row was deleted (count unchanged).
  5. **No score fields anywhere**: for each of `GET /family/members`, `GET /family/rituals`, `GET /family/rituals/:id`, `GET /family/summary`, `GET /api/docs/openapi.json` (filtered to `/api/family` paths and their schemas): `expect(JSON.stringify(body)).not.toMatch(/score|quality|rating/i)`; and `GET /family/members` items have exactly the five keys (sorted equality).
  6. **Responsive**: `page.setViewportSize({width: 390, height: 844})` → `/path/family` shows a single column, `Create a ritual` opens a drawer (`role="presentation"` MUI drawer paper visible) and BottomNav is visible; at `{1280, 800}` the editor is a `role="dialog"`.
- Run with `npm test` in `tests/e2e` (`BASE_URL` default http://localhost:3535).

**Docs (docs-dev)**

- `docs/specs/family-domain.md` (new): purpose and the privacy boundary (PRD §33, VISION §50 — what the member record may hold and why nothing else); data model (`family_members`, `rituals`, commitment links, the unique index); recurrence contract (`RitualRecurrence`, weekday numbering, Monday-start weeks, `everyNWeeks` anchoring to `createdAt`, DST rules for gaps and overlaps, the 7-day horizon, cron at 01:00 + on-demand, idempotency via the index, cancel-not-delete on edit, `SetNull` on delete); version mapping ideal/short/minimum; behaviour lint rules A–C with the PRD §32 examples and the FAMILY-only hook in `CommitmentsService`; the optional AI rewrite and its re-lint; the summary contract (count semantics, moved-row accounting under E02-04 (#47)'s new-row reschedule, the displacement template and threshold, AI rephrase acceptance rules); the **no-score rule** and the test that enforces it; UI map (`/path/family`, family action labels on Today, birthday cue); what E10/E11/E12 read from here; rejected alternatives (RRULE strings, a Family destination in the nav, per-member metrics, a "kept %" bar, notification-driven materialization).
- `docs/API.md`: "Family" section — 12 routes with request/response examples and error codes.
- `CLAUDE.md`: endpoints list, `family_members`/`rituals` in Database Tables, a "Family domain" pointer paragraph to the spec (do not restate rules).
- `docs/TESTING.md`: E2E section mentions `family.spec.ts` and the fake-openai compose file.
- `docs/epics/README.md`: E08 row links to this file and to `docs/specs/family-domain.md`.

#### Acceptance criteria

- [ ] `tests/e2e/specs/family.spec.ts` passes against the compose stack with `fake-openai.compose.yml` on a clean database.
- [ ] Case 1 proves the full chain member → ritual → materialized occurrence on Today → `I'm in` → complete → summary `kept 1` through the UI and the public API.
- [ ] Case 2 proves move and skip on family occurrences reuse E05-02 (`rescheduleCount`, `SKIPPED`) and are reflected in the summary.
- [ ] Case 3 proves the lint blocks a person-targeting title with and without AI, and that the rewrite is a suggestion, never an auto-submit.
- [ ] Case 4 proves editing a recurrence cancels only future planned rows and preserves completed history.
- [ ] Case 5 proves no family response and no `/api/family` OpenAPI schema contains `score`, `quality` or `rating`, and that the member DTO has exactly five keys.
- [ ] `docs/specs/family-domain.md` exists and documents every rule, constant and decision listed above; `docs/API.md` covers all 12 routes; `docs/epics/README.md` links to both.
- [ ] `npm test` (`apps/api`) and `npm run test:run` (`apps/web`) are green on the epic branch.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: spec cleans up (`afterEach` restores AI settings; unique users per test avoid cross-talk; time-dependent cases compute weekdays from the clock rather than hard-coding)
- [ ] Observability: Playwright trace on first retry (existing config)
- [ ] Security: no real OpenAI key anywhere; `withAiKey` seeds the fake `sk-test-…` key only; no real names or birthdays in fixtures
- [ ] Config & secrets: none (`OPENAI_BASE_URL` documented by E01-12)
- [ ] Tests listed above pass locally (e2e in `tests/e2e`)
- [ ] Docs updated (spec, API.md, CLAUDE.md, TESTING.md, epics README)

#### Manual test script

1. `cd tests/e2e && npx playwright test specs/family.spec.ts` with the stack from the epic script step 2 running → 6 passed.
2. Open `docs/specs/family-domain.md` and cross-check the lint word lists against `apps/api/src/family/behaviour-lint.ts` and the template text against `apps/api/src/family/summary-copy.ts` (they must match verbatim).
3. Run the epic-level manual verification steps 1–14 once end to end.

#### Out of scope

- Visual-regression baselines for `/path/family` (E08-04 (#50) owns them).
- E10/E11/E12 flows that consume the family data.
- CI workflow files (declined project-wide; local runs only).

#### Notes for the implementing agent

- Reuse `tests/e2e/helpers/auth.helper.ts` (with E01-10 (#30)'s `withAiKey` and E04-06 (#107)'s onboarding option) and E05-07 (#55)'s `commitments.helper.ts`; do not create a second login or API-context helper.
- Seed through the API, never through `psql`, so the spec also exercises E08-02 (#41)'s create contracts.
- Case 1's "tonight" arithmetic must run in UTC with the profile timezone set to `UTC`; if the run starts after 21:55 UTC, roll the ritual time to tomorrow and assert on tomorrow's row instead of failing.
- The spec file is the last child: if a case fails because an earlier child deviated, fix the child under its own issue and reference it in the commit.

---
