# E12 — Coaching Notifications

<!-- epic-meta: slug=coaching-notifications phase=4 -->
<!-- epic-issue: #44 -->

> GitHub epic: [#44](https://github.com/marinoscar/evolvepath/issues/44)

## Epic

### Goal

Turn the existing notification framework into part of the coach (VISION §34): a **deterministic decision engine** decides whether *now* is a useful moment to intervene (VISION §35, PRD §59, §61 — permission, quiet hours, daily/weekly caps, per-commitment max, no repeat after an explicit skip, domain PAUSE, fatigue auto-reduction), nine coaching categories N1–N9 (PRD §60) are registered as ordinary registry events with deterministic copy and **deep links that land on the action** (VISION §37, PRD §63), the `notification_copywriter` persona personalises wording only after the policy has said yes and never decides whether to send (PRD §14.7, §62, §129), web push reaches a phone with the app closed, and every send/open/action/dismiss/suppress is recorded so the product can prove the **independence metric** — commitments completed before any reminder was needed — and reduce reminders when it can (VISION §38, PRD §64–§65). PRD §108 is the acceptance list this epic must satisfy: quiet hours respected, deep links work, move/skip from the notification, ignored notifications tracked, no uncontrolled repeats per commitment, comeback copy without shame.

### Background

- **What exists.** The notification framework from epic #109 is complete and untouched by product code: the registry `apps/api/src/notifications/notification-events.ts` (`NOTIFICATION_EVENTS`, `NOTIFICATION_CHANNELS = ['email', 'browser']`, `findEvent`, `channelsFor`, `isMandatory`), the dispatcher `notifications.service.ts` (`notify(eventKey, userId, data)` — detached, never throws, one `notification_deliveries` row per channel; a sender whose `resolveTo` returns `null` is **skipped with a warn log, no delivery row**), preference resolution `notification-preferences.ts` (sparse absent-key contract, channel-outer `user_settings.notifications.<channel>.<eventKey>`), the channel contract `notification.types.ts` (`NotificationChannelSender { channel; resolveTo(recipient); deliver(context, to) }`, DI token `NOTIFICATION_CHANNEL_SENDERS` built by a factory in `notifications.module.ts`), `channels/email-notification.channel.ts` (`EVENT_EMAIL_TEMPLATES` → `apps/api/src/email/templates/*`), `channels/browser-notification.channel.ts` (`EVENT_BROWSER_TEMPLATES: Partial<Record<string, BrowserNotificationTemplate>>` returning `{ title, body, link? }`; writes a `notifications` row with `title ≤ 200`, `body ≤ 2000`, `link` passed through `sanitizeLink` — **root-relative only**; publishes over `NotificationStreamService` SSE), `notification-delivery.service.ts`, `notification-store.service.ts` (list / unread-count / mark-read), the controller `notifications.controller.ts` (`GET /notifications/events`, `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `@Sse('stream')`, all `@Auth()`), Prisma models `Notification` (`notifications`: `userId`, `eventKey`, `title`, `body`, `link?`, `readAt?`) and `NotificationDelivery` (`notification_deliveries`). The CLAUDE.md recipe "Adding a Notification" is the contract: one registry entry, a template per channel, `notify()` at the trigger, outside any transaction.
- **Web side.** `apps/web/src/contexts/NotificationContext.tsx` (`NotificationProvider`, `useNotifications()` → `{ notifications, unreadCount, refresh, markRead, markAllRead, streamState }`, raises a native toast per SSE event through `services/browserNotifications.ts` `showNativeNotification`), `components/navigation/NotificationBell.tsx` (popover list; row click → `markRead` + `navigate(link)` guarded by `utils/internalLink.ts` `isInternalLink`, which accepts any string starting with `/` and not `//` — query strings pass), `pages/UserNotificationsPage.tsx` (`/settings/notifications`, card in `config/userSettingsSections.tsx` under Account, renders `components/settings/NotificationSettings.tsx` inside `UserSettingsSection`'s `{ settings, isSaving, save }` render prop; columns are derived from each event's `channels` with `CHANNEL_LABELS: Record<NotificationChannel, string>`), `hooks/useNotificationEvents.ts`, `hooks/useBrowserNotificationPermission.ts`, `services/notificationStream.ts`, `types/index.ts` (`NotificationChannel = 'email' | 'browser'`, `NotificationEventDef`, `AppNotification`). The API-side `notificationsSchema` (`apps/api/src/common/schemas/user-settings-namespaces.schema.ts`) is a `z.partialRecord` over `NOTIFICATION_CHANNELS`, so widening the channel array widens the stored shape without a migration.
- **Scheduling.** `ScheduleModule.forRoot()` is registered in `apps/api/src/app.module.ts`; `apps/api/src/auth/tasks/token-cleanup.task.ts` is the `@Cron` pattern (a provider with a `Logger` and one `handleCron`). No job queue exists and none is added.
- **Test auth.** `apps/api/src/test-auth/test-auth.controller.ts` is `@Controller('auth/test')` guarded by `TestEnvironmentGuard` and registered only when `NODE_ENV !== 'production'`; the e2e helper is `tests/e2e/helpers/auth.helper.ts` (`loginAsTestUser`, `TestUserOptions` with E01-10 (#30)'s `withAiKey` and E04-06 (#107)'s `withOnboarding`). So the job trigger this epic adds is `POST /api/auth/test/run-job` — not `/api/test-auth/...`.
- **Contracts this epic reads.** E02-01 (#36): `Commitment` (`status CommitmentStatus { PLANNED READY STARTED COMPLETED PARTIALLY_COMPLETED RESCHEDULED SKIPPED MISSED CANCELLED }`, `domain Domain { WORK FAMILY HEALTH }`, `scheduledStart/End`, `fullVersion/shortVersion/minimumVersion {title, minutes}`, `rescheduleCount`, `skipReason`), `Evidence` (`source EvidenceSource`, `type`), `DomainMode` (`DomainModeKind { GROW MAINTAIN RECOVER PAUSE }`). E04-01 (#100): `user_profiles` (`timezone`, `quietHoursStart/End "HH:mm"` — declared there **so E12 does not migrate them twice**, `coachingStyle CoachingStyle { GENTLE BALANCED DIRECT }`), `UserProfileService.getOrCreate(userId)`. E05-01 (#38): `apps/api/src/today/local-date.ts` (`localDate(now, timeZone)`, `localDayBounds(dateLocal, timeZone)`), `GET /today`. E05-02 (#40): `POST /commitments/:id/actions/{start,fallback,reschedule,skip,...}` with `completedAt`, `versionUsed`. E05-04 (#46): `TodayPage` at `/` handles `?commitment=<id>&action=start|complete|fallback|skip|reschedule` and strips the params. E05-05 (#48): `/start/:commitmentId`. E07-03 (#116): `AvoidanceService.assessMany(userId, commitments)` → `{ level: AvoidanceLevel 0–6 }`. E08-01 (#37)/04: `Commitment.ritualId`, `familyMemberId`; "I'm in" = transition to `READY`. E06-01 (#61)/04: `PlanChangeProposal` (`status ProposalStatus`, `sourceKind ProposalSourceKind { COACH WEEKLY_REVIEW WORKOUT PATTERN }`), `GET /proposals?status=PROPOSED`. E10-01 (#65)/02: `WeeklyReview` row reaching a READY state when generation finishes. E11-01 (#98): `GET /progress` exposes `independence.ratio`; E11-02 (#112): the comeback record persisted when the inactivity detector offers a restart (status `OFFERED`), `/comeback` screen (E11-05 (#119)). E01-06 (#26): `AiGatewayService.invoke({ persona, userId, promptVersion, instructions, input, schema, schemaName, maxOutputTokens? })` → `{ ok: true, output } | { ok: false, error: { code, message } }`; persona `notification_copywriter` is registered in `apps/api/src/ai/ai-personas.ts` (E01-02 (#22), tier `fast`). E01-10 (#30)'s fake OpenAI server answers `/v1/responses` for the e2e.
- **No new permissions.** Every endpoint is a per-user resource: plain `@Auth()`, ownership by `userId`, foreign or missing ids are 404. The one deliberate exception is the public dismissal endpoint in E12-04 (#64), whose only capability is a UUID the sender minted.
- **Specs this epic produces:** `docs/specs/coaching-notifications.md` (E12-07 (#75)). **Specs it reads:** `docs/specs/today-and-nba.md` (E05-07 (#55), deep-link contract), `docs/specs/ai-gateway.md` (E01-12 (#32)), `docs/specs/family-domain.md` (E08-05 (#53)), `docs/specs/domain-model.md` (E02-08 (#62)).

### Scope

- [ ] #49 `feat(db): add notification policy, interaction log and push subscriptions` (E12-01)
- [ ] #54 `feat(api): register the nine coaching notification events with deep-link templates and actions` (E12-02)
- [ ] #59 `feat(api): add the deterministic notification decision engine, scheduler and AI copywriter` (E12-03)
- [ ] #64 `feat(api): add the web push channel with VAPID, subscriptions and service worker handlers` (E12-04)
- [ ] #68 `feat(web): add notification action buttons, deep-link actions and the coaching policy settings section` (E12-05)
- [ ] #69 `feat(api): add notification learning metrics and the independence metric` (E12-06)
- [ ] #75 `test(tests): E12 end-to-end verification` (E12-07)

### Out of scope

- Experiment-controlled caps (PRD §61 "exact caps should be experiment-controlled") — caps are per-user settings with fixed defaults; no experiment framework.
- Timing optimisation that *changes* lead times automatically (PRD §64 "should feed experimentation") — E12-06 (#69) reports the best lead time; nothing acts on it.
- Auto-muting a category when the independence ratio is high (VISION §38) — E12-06 (#69) exposes the numbers; the user (or a later epic) decides.
- Email delivery for N1–N7 and N9 — only N8 (weekly review) is worth an email; the rest are moment-bound.
- Native mobile apps, SMS, calendar integration, widgets (PRD §100, §112, §113).
- A job queue or multi-process scheduler lock — one API process runs the cron; documented in the spec.
- Changing the five coupled breakpoint gates (CLAUDE.md, Settings UI rule 5) — nothing here needs to.

### Sequencing

- E12-01 (#49) (models + policy endpoints) and E12-02 (#54) (registry entries, templates, actions) are independent of each other except that E12-02 (#54)'s deep links carry the `sentInteractionId` E12-01 (#49) defines — run E12-01 (#49) first, E12-02 (#54) immediately after.
- E12-03 (#59) (engine + scheduler + copywriter) depends on E12-01 (#49), E12-02 (#54), E05-01 (#38)/02, E07-03 (#116), E10-02 (#73), E11-02 (#112) and E01-06 (#26). E12-04 (#64) (push) depends on E12-02 (#54) and E02-07 (#58) and can run in parallel with E12-03 (#59). E12-05 (#68) (web) depends on E12-01 (#49), E12-02 (#54), E12-04 (#64), E05-04 (#46) and E08-04 (#50); E12-06 (#69) (metrics) depends on E12-01 (#49), E12-03 (#59) and E11-01 (#98).
- Critical path: E12-01 (#49) → E12-02 (#54) → E12-03 (#59) → E12-05 (#68) → E12-07 (#75). E12-07 (#75) is last.

### Manual end-to-end verification

1. Clean clone. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, `OPENAI_BASE_URL=http://fake-openai:8089/v1`; run `npx web-push generate-vapid-keys` and set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT=mailto:<you>`.
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`. In another shell: `cd apps/api && npm run prisma:migrate && npm run prisma:seed` (confirm `add_notification_policy` in the migrate output). `psql`: `\d notification_interactions`, `\d push_subscriptions`, `\d user_profiles` → `notification_policy jsonb`.
3. http://localhost:3535/testing/login → sign in as `notify@test.local`, role `admin`, tick "Seed an OpenAI key" and "Mark onboarding complete". Open http://localhost:3535/settings/notifications → the matrix now lists nine "Coaching" rows (Upcoming commitment … Plan issue) with **Browser** and **Push** columns, Weekly review also with **Email**; below the matrix a new section **Coaching reminders** shows Quiet hours (empty), Daily cap 4, Weekly cap 20, Per-commitment max 2.
4. Seed a commitment 20 minutes ahead through the API (E05-07 (#55)'s helper shape): `evopath login`; `evopath api POST /api/outcomes --data '{"domain":"HEALTH","title":"Train consistently","whyItMatters":"Energy","importance":4}'` → `outcomeId`; `evopath api POST /api/commitments --data '{"domain":"HEALTH","outcomeId":"<outcomeId>","title":"Upper A","scheduledStart":"<now + 20 min ISO>","fullVersion":{"title":"Upper A","minutes":38},"shortVersion":{"title":"Upper A short","minutes":20},"minimumVersion":{"title":"10-minute Upper A","minutes":10},"importance":4}'` → `commitmentId`.
5. Run the job by hand: `curl -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"job":"coaching-notifications"}' http://localhost:3535/api/auth/test/run-job` → `{ "scanned": 1, "sent": 1, "suppressed": 0 }`. The bell in the AppBar shows `1`; open it → **Upper A starts in 20 minutes** with buttons `Start workout`, `Move`, `Skip today`. (With the fake AI up the title may instead be the fake server's copy; the buttons are the same.) `psql`: `select kind, event_key, commitment_id, dedupe_key, meta from notification_interactions;` → one `SENT` row for `coach.commitment_upcoming`, `meta.leadMinutes = 20`, `meta.copySource` ∈ `{ai, template}`.
6. Click `Start workout` → URL `/start/<commitmentId>` (via `/today?commitment=…&action=start&n=…`, params stripped), the E05-05 (#48) timer runs. Complete it. `psql` → interaction rows now `SENT`, `OPENED`, `ACTIONED (action = start)` sharing `sent_interaction_id`.
7. Run the job again → `sent: 0`; the inbox has no second row (idempotent per commitment and event; `ALREADY_DONE` for a completed one — `select suppress_reason from notification_interactions where kind = 'SUPPRESSED';`).
8. Quiet hours: on `/settings/notifications` set Quiet hours `00:00`–`23:59` → Save. Seed another commitment 20 minutes ahead; run the job → `suppressed: 1`; `select suppress_reason from notification_interactions where kind = 'SUPPRESSED' order by created_at desc limit 1;` → `QUIET_HOURS`. Clear quiet hours.
9. Skip → no repeat: seed a commitment 20 minutes ahead; run the job (N1 sent); on Today open the row's ⋯ menu → Skip → reason "Bad timing". Run the job at start time (`-d '{"job":"coaching-notifications","now":"<scheduledStart ISO>"}'`) → `suppressed: 1` with reason `SKIPPED`; no N2 in the inbox.
10. Fallback offer: seed a commitment whose `scheduledStart` was 10 minutes ago with `scheduledEnd` 25 minutes from now (full 38, minimum 10); run the job → inbox shows **38 minutes won't fit today** with `Use short version` → click → `/start/<id>` with the short version (`select version_used from commitments where id = …` → `SHORT`).
11. Family presence: create a ritual on `/path/family` (E08-04 (#50)) for today 15 minutes from now; run the job → **Phone-free dinner starts in 15 minutes** with `I'm in` / `Move it` / `Skip today`; `I'm in` → the Today row shows `Ready` (`status = READY`).
12. Weekly review (E10) and comeback (E11): trigger a weekly review generation (`POST /api/weekly-reviews/generate`, E10-02 (#73)) → run the job → **Your week is ready to review** in the inbox linking to `/progress/week`; email delivery row in `notification_deliveries` for `coach.weekly_review_ready` when SMTP is configured. Simulate 4 idle days with E11-06 (#121)'s time helper → run the job → **No catching up.** linking to `/comeback`; confirm the body contains none of the banned phrases (`apps/api/src/coaching-notifications/copy/banned-phrases.ts`).
13. Metrics: `curl -H "Authorization: Bearer $T" 'http://localhost:3535/api/notifications/metrics?days=30' | jq` → `perEvent[]` with `sent/opened/actioned/dismissed/suppressed{QUIET_HOURS, SKIPPED, ALREADY_DONE}`, `independence: { completions, unprompted, ratio }`, `reminderTrend[]`. http://localhost:3535/progress → the "Coach dependency" card (E11-04 (#117)) shows the same ratio.
14. Push (production build only — the dev server registers no service worker): `docker compose -f base.compose.yml -f prod.compose.yml -f fake-openai.compose.yml up --build`; in Chrome open http://localhost:3535/settings/notifications → **Push on this device** switch → allow the permission → `select endpoint, user_agent from push_subscriptions;` → one row. Close the tab. Seed a commitment 20 minutes ahead and run the job from the CLI → an OS notification appears with two action buttons; click `Start workout` → the app opens on `/start/<id>`; `psql` → `OPENED` + `ACTIONED` rows. Dismiss a second one → a `DISMISSED` row (the service worker posts it without a session).
15. Fatigue: dismiss (or ignore for > 2 h) five consecutive coaching notifications → `GET /api/me/notification-policy` → `fatigue: { active: true, effectiveDailyCap: 2 }`; act on one → `active: false`.
16. Audit: `select action, meta from audit_events where action like 'notification_policy:%' order by created_at;` → `notification_policy:update` rows with `{ changed: [...] }`, never the values of other users.
17. Resize below 600px: the policy section stacks its fields, the inbox popover keeps action buttons on their own row; at ≥ 600px they sit inline. None of the five coupled breakpoint gates changed (`git diff` on `Layout.tsx`, `BottomNav.tsx`, `SettingsHub.tsx`, `AppBar.tsx` shows nothing in those gates).

## Child issues

### E12-01 `feat(db): add notification policy, interaction log and push subscriptions` — #49

**Part of epic:** E12 · **Blocked by:** E04-01 (#100), E02-01 (#36) · **Component:** database, api · **Priority:** P0 · **Agents:** database-dev → backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §59 lists the inputs of the decision engine — notification permission, quiet hours, daily and weekly caps, recent message count, dismissal history, user response history — and PRD §61 requires "automatic reduction if ignored repeatedly"; PRD §64 requires the system to learn which messages are acted on and PRD §65 an independence metric. None of that is representable today: `notification_deliveries` records that a channel was attempted, `notifications.readAt` records an inbox click, and nothing records *why* a message was **not** sent, what the user did with it, or which commitment it concerned. Quiet hours already live on `user_profiles` (E04-01 (#100)) but caps do not; web push (PRD §123 mobile-first) needs somewhere to keep subscriptions.

#### Proposed solution

One migration adding a `notificationPolicy` JSON column to `user_profiles`, a `notification_interactions` table that is the single source for caps, fatigue, idempotency and metrics, and a `push_subscriptions` table; plus the policy read/patch endpoints so the settings UI (E12-05 (#68)) has an API on day one.

**Data (database-dev)** — `apps/api/prisma/schema.prisma`:

```prisma
enum NotificationInteractionKind   { SENT OPENED ACTIONED DISMISSED SUPPRESSED }
enum NotificationActionKind        { START IN MOVE SHORT SKIP }
enum NotificationSuppressReason    { QUIET_HOURS DAILY_CAP WEEKLY_CAP PER_COMMITMENT_MAX SKIPPED MUTED DOMAIN_PAUSED FATIGUE ALREADY_DONE }

model NotificationInteraction {
  id                 String                       @id @default(uuid()) @db.Uuid
  userId             String                       @map("user_id") @db.Uuid
  eventKey           String                       @map("event_key")          // plain string, like notifications.event_key
  kind               NotificationInteractionKind
  commitmentId       String?                      @map("commitment_id") @db.Uuid
  notificationId     String?                      @map("notification_id") @db.Uuid   // the inbox row, once known
  deliveryId         String?                      @map("delivery_id") @db.Uuid       // notification_deliveries row, once known
  sentInteractionId  String?                      @map("sent_interaction_id") @db.Uuid // OPENED/ACTIONED/DISMISSED → their SENT row
  action             NotificationActionKind?
  suppressReason     NotificationSuppressReason?  @map("suppress_reason")
  dedupeKey          String?                      @map("dedupe_key")        // scheduler idempotency; null on OPENED/ACTIONED/DISMISSED
  meta               Json?                                                   // { leadMinutes?, copySource?: 'ai'|'template', category?: 'N1'…'N9', localDate? }
  createdAt          DateTime                     @default(now()) @map("created_at") @db.Timestamptz

  user            User                     @relation("UserNotificationInteractions", fields: [userId], references: [id], onDelete: Cascade)
  commitment      Commitment?              @relation(fields: [commitmentId], references: [id], onDelete: SetNull)
  notification    Notification?            @relation(fields: [notificationId], references: [id], onDelete: SetNull)
  delivery        NotificationDelivery?    @relation(fields: [deliveryId], references: [id], onDelete: SetNull)
  sentInteraction NotificationInteraction? @relation("SentInteraction", fields: [sentInteractionId], references: [id], onDelete: SetNull)
  responses       NotificationInteraction[] @relation("SentInteraction")

  @@unique([userId, eventKey, dedupeKey])          // one decision per candidate; NULL dedupe keys never conflict
  @@index([userId, kind, createdAt(sort: Desc)])   // caps and fatigue: SENT rows in a local day/week
  @@index([userId, commitmentId, kind])            // per-commitment max, independence metric
  @@index([sentInteractionId])
  @@map("notification_interactions")
}

model PushSubscription {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  endpoint   String   @unique                       // the push service URL; unique across users
  keys       Json                                   // { p256dh: string, auth: string } — validated by Zod at the boundary
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz
  lastSeenAt DateTime @default(now()) @map("last_seen_at") @db.Timestamptz

  user User @relation("UserPushSubscriptions", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("push_subscriptions")
}
```

`model UserProfile` (E04-01 (#100)) gains `notificationPolicy Json? @map("notification_policy")`. `model User` gains `notificationInteractions NotificationInteraction[] @relation("UserNotificationInteractions")` and `pushSubscriptions PushSubscription[] @relation("UserPushSubscriptions")`; `Notification`, `NotificationDelivery` and `Commitment` gain the back-relation `interactions NotificationInteraction[]`. Migration: `npm run prisma:migrate:dev -- --name add_notification_policy`. Seed: none.

Zod at the boundary, `apps/api/src/coaching-notifications/policy/notification-policy.schema.ts` (new):

```ts
export const NOTIFICATION_POLICY_DEFAULTS = { dailyCap: 4, weeklyCap: 20, perCommitmentMax: 2, mutedCategories: [] as string[] } as const;
export const notificationPolicySchema = z.object({
  dailyCap: z.number().int().min(0).max(20).default(4),
  weeklyCap: z.number().int().min(0).max(100).default(20),
  perCommitmentMax: z.number().int().min(0).max(5).default(2),
  mutedCategories: z.array(z.string().regex(/^coach\.[a-z_]+$/)).max(20).default([]),
});
export const quietHoursTime = /* re-export E04-01 (#100)'s */ z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export interface ResolvedNotificationPolicy { timezone: string; quietHours: { start: string; end: string } | null; dailyCap; weeklyCap; perCommitmentMax; mutedCategories: string[] }
export function resolvePolicy(profile: { timezone; quietHoursStart; quietHoursEnd; notificationPolicy: unknown }): ResolvedNotificationPolicy
```

`resolvePolicy` is total: an unparseable column yields the defaults (log at warn, never throw), `quietHours` is `null` unless both `HH:mm` values are present and differ. `pushSubscriptionKeysSchema = z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) })` lives in `apps/api/src/notifications/push/push-subscription.schema.ts` (new) for E12-04 (#64).

**API (backend-dev)**

New module `apps/api/src/coaching-notifications/` (new): `coaching-notifications.module.ts` (imports `PrismaModule`, `UserProfileModule` (E04-01 (#100)); registered in `app.module.ts`; exports `NotificationInteractionsService`, `NotificationPolicyService`), `policy/notification-policy.service.ts`, `policy/notification-policy.controller.ts`, `policy/dto/notification-policy.dto.ts` (`createZodDto`, as `apps/api/src/test-auth/dto/test-login.dto.ts`), `interactions/notification-interactions.service.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/me/notification-policy` | `@Auth()` | — | 200 `NotificationPolicyResponse { timezone, quietHours: {start,end} \| null, dailyCap, weeklyCap, perCommitmentMax, mutedCategories, fatigue: { active: false, effectiveDailyCap } }` (fatigue is a stub here; E12-03 (#59) fills it) |
| PATCH | `/api/me/notification-policy` | `@Auth()` | merge patch `{ quietHours?: {start,end} \| null, dailyCap?, weeklyCap?, perCommitmentMax?, mutedCategories?: string[] }` — `mutedCategories` entries must be registered event keys once E12-02 (#54) lands (400 `UNKNOWN_EVENT` otherwise; until then the regex is the only check) | 200 `NotificationPolicyResponse` |

`NotificationPolicyService`: `get(userId)` → `UserProfileService.getOrCreate` + `resolvePolicy`; `patch(userId, dto)` → writes `quietHoursStart/End` (both or neither; `null` clears) and `notificationPolicy` (merged, re-validated with `notificationPolicySchema`), then `prisma.auditEvent.create({ action: 'notification_policy:update', targetType: 'user_profile', targetId: userId, meta: { changed: Object.keys(dto) } })` (values are not sensitive but are not needed either). OpenAPI tag `Coaching Notifications` added to `apps/api/src/openapi/tags.ts` in the "Account & Settings" group (description: the coaching decision engine, its policy, interactions and metrics).

`NotificationInteractionsService` (the only writer of `notification_interactions`; E12-03 (#59)/04/05/06 call it, never Prisma directly):
- `recordSent({ userId, eventKey, commitmentId?, dedupeKey, meta }) → { id }` and `recordSuppressed({ …, suppressReason }) → { id }` — both `create`, catching `P2002` on the unique index and returning `{ id: existing.id, duplicate: true }`.
- `recordResponse({ userId, sentInteractionId?, notificationId?, kind: OPENED|ACTIONED|DISMISSED, action? })` → resolves `sentInteractionId` from `notificationId` when absent (see E12-02 (#54)'s `n=` link param and E12-05 (#68)'s parser: `parseSentInteractionId(link)`), copies `eventKey`/`commitmentId` from the SENT row, ignores an OPENED when one already exists for that SENT row, 404 when the SENT row belongs to another user.
- `linkNotification(sentInteractionId, notificationId, deliveryId?)` — used by E12-04 (#64)'s push channel and by E12-03 (#59) after the browser channel writes its row (see E12-03 (#59) Notes).
- `hasDecision(userId, eventKey, dedupeKey): boolean`.
- `history(userId, { now, timeZone, commitmentId? })` → `{ sentToday, sentThisWeek, sentForCommitment, consecutiveIgnored, lastActionedAt }` using `localDayBounds` (E05-01 (#38)) and a Monday-start `localWeekBounds` added to `apps/api/src/today/local-date.ts` under this issue (pure, tested). `consecutiveIgnored` = SENT rows newer than the last ACTIONED, older than 2 hours, with no OPENED/ACTIONED response, capped at 7 days.

**UI (frontend-dev)** — n/a (E12-05 (#68)).

**Tests (testing-dev)**

- `apps/api/src/coaching-notifications/policy/notification-policy.schema.spec.ts`: defaults; caps out of range rejected; `resolvePolicy` with `null` column, garbage column, quiet hours `"22:00"/"07:00"`, equal start/end → `null`, one side missing → `null`.
- `apps/api/src/today/local-date.spec.ts` (extend): `localWeekBounds` Monday-start in `America/Costa_Rica` across a DST-free week and in `Europe/Madrid` across the DST switch.
- `apps/api/src/coaching-notifications/interactions/notification-interactions.service.spec.ts` (mocked Prisma): duplicate `recordSent` returns the existing id; `recordResponse` copies `eventKey`/`commitmentId`; second OPENED ignored; foreign SENT row → 404; `history` counts only `SENT`, only inside the local day/week.
- `apps/api/test/coaching-notifications/notification-policy.integration.spec.ts` (`createTestApp`): GET returns defaults for a fresh user (creates the profile lazily, like E04-01 (#100)); PATCH quiet hours then GET reflects; PATCH `dailyCap: 99` → 400; PATCH `quietHours: null` clears; audit row `notification_policy:update`; cross-user isolation (two users, two policies).
- `apps/api/test/coaching-notifications/schema.integration.spec.ts`: boots with the new relations; with a real DB, two `recordSent` with the same `(userId, eventKey, dedupeKey)` → one row; `dedupeKey: null` twice → two rows; deleting a commitment sets `commitment_id` null; deleting a user cascades interactions and push subscriptions.

**Docs (docs-dev)** — `CLAUDE.md` "Database Tables" (`notification_interactions`, `push_subscriptions`, `user_profiles.notification_policy`), `docs/API.md` (two `/me/notification-policy` routes under Settings), `docs/ARCHITECTURE.md` data-model list.

#### Acceptance criteria

- [ ] `npm run prisma:migrate` on a clean database applies `add_notification_policy`, creating both tables, the three enums, the unique index `(user_id, event_key, dedupe_key)` and the `notification_policy` column.
- [ ] `GET /api/me/notification-policy` for a user who has never set anything returns `dailyCap 4`, `weeklyCap 20`, `perCommitmentMax 2`, `quietHours null`, `mutedCategories []`.
- [ ] `PATCH` persists quiet hours on `user_profiles.quiet_hours_start/end` (E04-01's columns) and caps on `notification_policy`; values outside the ranges are 400 with the field named.
- [ ] `NotificationInteractionsService.recordSent` is idempotent per `(userId, eventKey, dedupeKey)`.
- [ ] `history()` counts `SENT` rows in the user's local day and Monday-start local week, not in UTC.
- [ ] Deleting a user removes their interactions and push subscriptions; deleting a commitment keeps the interaction rows with `commitmentId = null`.
- [ ] An audit row `notification_policy:update` is written per PATCH.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: unparseable policy JSON degrades to defaults with a warn log; unique-violation on `recordSent` is caught, never surfaced
- [ ] Observability: audit `notification_policy:update`; no per-row logging in the interactions service
- [ ] Security: `@Auth()` + ownership on both routes; interactions of another user are unreachable (404)
- [ ] Config & secrets: none new
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–2; `psql`: `\d notification_interactions` shows the columns and indexes above; `\d user_profiles` shows `notification_policy`.
2. Log in at http://localhost:3535/testing/login; `curl -H "Authorization: Bearer $T" http://localhost:3535/api/me/notification-policy` → defaults.
3. `curl -X PATCH -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"quietHours":{"start":"22:00","end":"07:00"},"dailyCap":3}' …/api/me/notification-policy` → reflects; `select quiet_hours_start, quiet_hours_end, notification_policy from user_profiles;` → `22:00`, `07:00`, `{"dailyCap":3,…}`.
4. `-d '{"dailyCap":99}'` → 400 naming `dailyCap`.

#### Out of scope

- The decision itself, fatigue computation, scheduler (E12-03 (#59)); the endpoint recording responses (E12-05 (#68)); push endpoints (E12-04 (#64)).
- A UI for the policy (E12-05 (#68)).

#### Notes for the implementing agent

- `user_profiles` is owned by E04-01 (#100)'s `UserProfileService`; extend that service with `updateNotificationPolicy(userId, patch)` rather than writing the table from a second module — one writer per table.
- Copy E04-01 (#100)'s lazy-create behaviour: GET must not fail for a user without a profile row.
- `dedupeKey` is a plain string chosen by the caller (E12-03 (#59) documents the per-event keys); do not encode structure into the column.
- Prisma via `npm run prisma:*` scripts, never bare `npx prisma`. Zod through `nestjs-zod` `createZodDto`; no class-validator. Fastify — no `res.json`.
- Register the new module in `app.module.ts` and the OpenAPI tag in `tags.ts` (the docs page throws on an unregistered `@ApiTags` name).

---

### E12-02 `feat(api): register the nine coaching notification events with deep-link templates and actions` — #54

**Part of epic:** E12 · **Blocked by:** E12-01 (#49), E05-04 (#46), E05-05 (#48) · **Component:** api, web · **Priority:** P0 · **Agents:** backend-dev → frontend-dev → testing-dev → docs-dev

#### Problem statement

PRD §60 fixes nine notification categories N1–N9 and VISION §37 requires every notification to deep-link to the action ("Tap → start timer"; `I'm in` / `Move it` / `Skip today`), with PRD §63 listing the action labels. The registry in `apps/api/src/notifications/notification-events.ts` knows three foundation events, `EVENT_BROWSER_TEMPLATES` returns `{ title, body, link }` with no notion of actions, and nothing maps a category to the Today deep link E05-04 (#46) already honours. Without a single declaration of events, copy and actions, E12-03 (#59)'s engine, E12-04 (#64)'s push payloads and E12-05 (#68)'s inbox buttons would each invent their own.

#### Proposed solution

Nine registry entries following the CLAUDE.md "Adding a Notification" recipe, a deterministic browser template per event, a pure `actionsFor()` that turns an event into its deep-linked buttons, `actions[]` on the inbox DTO and SSE event so every consumer reads the same answer, one email template for N8, and the `/today` route alias the links point at.

**Data (database-dev)** — n/a.

**API (backend-dev)**

*Registry* — append to `NOTIFICATION_EVENTS` (order is the preferences-page order; keep the three foundation events first), each `defaultEnabled: true`, none `mandatory`:

| Key | Cat. | Label | Description (user-facing) | channels |
|---|---|---|---|---|
| `coach.commitment_upcoming` | N1 | Upcoming commitment | A commitment on your path starts in about 20 minutes. | `['browser']` (+ `'push'` once E12-04 (#64) widens the array) |
| `coach.start_cue` | N2 | Start cue | A commitment is due now and ready to start. | `['browser']` |
| `coach.rescue` | N3 | Start rescue | Something you have moved more than once is due today — a smaller start is offered. | `['browser']` |
| `coach.fallback_offer` | N4 | Fallback offer | The full version no longer fits the time left, but a shorter one does. | `['browser']` |
| `coach.family_presence` | N5 | Family presence cue | A family ritual starts soon. | `['browser']` |
| `coach.recovery` | N6 | Recovery | After a few days away, one small restart action is ready. | `['browser']` |
| `coach.evidence` | N7 | Evidence celebration | You reached a consistency milestone worth noticing. | `['browser']` |
| `coach.weekly_review_ready` | N8 | Weekly review ready | Your weekly review has been prepared. | `['email', 'browser']` |
| `coach.plan_issue` | N9 | Plan issue | The coach proposes a plan change because the current schedule keeps failing. | `['browser']` |

E12-04 (#64) adds `'push'` to every `coach.*` entry when it adds the channel; write the entries so that is a one-token edit per row.

*Categories and payloads* — `apps/api/src/coaching-notifications/coaching-events.ts` (new, pure): `COACHING_EVENT_KEYS` (the nine keys as a `const` tuple), `COACHING_CATEGORY: Record<CoachingEventKey, 'N1'|…|'N9'>`, `isCoachingEvent(key)`, and one Zod payload schema per event exported with its inferred type (`CoachingUpcomingPayload` …). Common fields on every payload: `sentInteractionId: z.string().uuid()` (E12-01 (#49)'s SENT row, minted before dispatch), `copy: z.object({ title: z.string().max(60), body: z.string().max(140), actionLabel: z.string().max(20) }).optional()` (AI copy from E12-03 (#59); absent → template copy). Event-specific fields:

| Event | Payload fields |
|---|---|
| N1 `coach.commitment_upcoming` | `commitmentId, domain, commitmentTitle, scheduledStart (ISO), minutesUntil, startMinutes` (minutes of the version the Start button offers) |
| N2 `coach.start_cue` | `commitmentId, domain, commitmentTitle, startMinutes, firstStep?` (from E05-02 (#40) `steps[0].title`) |
| N3 `coach.rescue` | `commitmentId, domain, commitmentTitle, rescheduleCount, level, minimumMinutes` |
| N4 `coach.fallback_offer` | `commitmentId, domain, commitmentTitle, fullMinutes, shortMinutes, remainingMinutes` |
| N5 `coach.family_presence` | `commitmentId, commitmentTitle, minutesUntil, purpose?` (E08-01 (#37) `Ritual.purpose`), `familyNickname?` |
| N6 `coach.recovery` | `comebackId, daysAway, restartCommitmentId?` |
| N7 `coach.evidence` | `commitmentId, domain, outcomeTitle, count, windowDays, milestone` (`'THIRD_IN_8_DAYS' \| 'FIFTH_IN_14_DAYS' \| 'TENTH_TOTAL' \| 'FIRST_FULL_WEEK'`) |
| N8 `coach.weekly_review_ready` | `reviewId, weekStart (YYYY-MM-DD)` |
| N9 `coach.plan_issue` | `proposalId, planId, summary, sourceKind` |

*Actions* — `apps/api/src/coaching-notifications/coaching-actions.ts` (new, pure):

```ts
export type NotificationActionKey = 'start' | 'in' | 'move' | 'short' | 'skip';
export interface NotificationActionDef { action: NotificationActionKey; label: string; link: string }
export function todayLink(commitmentId: string, action: NotificationActionKey, sentInteractionId: string): string
  // → `/today?commitment=<id>&action=<action>&n=<sentInteractionId>`
export function startLink(commitmentId: string, sentInteractionId: string): string  // → `/start/<id>?n=<sentInteractionId>`
export function startLabel(domain: Domain, minutes: number): string  // HEALTH → 'Start workout'; else `Start ${minutes} min`
export function actionsFor(eventKey: string, payload: unknown): NotificationActionDef[]
```

| Event | Actions (in order) | Primary `link` |
|---|---|---|
| N1 | `start` (`startLabel`), `move` "Move", `skip` "Skip today" | `todayLink(id, 'start')` |
| N2 | `start` (`startLabel`), `short` "Use short version", `move` "Move" | `startLink(id)` |
| N3 | `start` "Start 10 min" (label uses `minimumMinutes`), `skip` "Skip today" | `todayLink(id, 'start')` |
| N4 | `short` "Use short version", `start` "Start full", `skip` "Skip today" | `todayLink(id, 'short')` |
| N5 | `in` "I'm in", `move` "Move it", `skip` "Skip today" | `todayLink(id, 'in')` |
| N6 | — | `/comeback?n=<sentInteractionId>` |
| N7 | — | `/progress?n=<sentInteractionId>` |
| N8 | — | `/progress/week?n=<sentInteractionId>` |
| N9 | — | `/coach?proposal=<proposalId>&n=<sentInteractionId>` |

`actionsFor` returns `[]` for unknown keys and for non-coaching events. Labels are the PRD §63 vocabulary verbatim; the `n` parameter is how E12-05 (#68) attributes OPENED/ACTIONED to the SENT row.

*Browser templates* — entries in `EVENT_BROWSER_TEMPLATES` (`channels/browser-notification.channel.ts`), each `(data) => { const p = schema.parse(data); const c = p.copy ?? DEFAULT_COPY[key](p); return { title: c.title, body: c.body, link: primaryLink(key, p) } }`. `DEFAULT_COPY` lives in `apps/api/src/coaching-notifications/copy/copy-templates.ts` (new, pure) and returns `{ title, body, actionLabel }`:

| Event | Default title | Default body |
|---|---|---|
| N1 | `${commitmentTitle} starts in ${minutesUntil} minutes` | `${startMinutes} min · ${domainLabel}. Everything is ready when you are.` |
| N2 | `${commitmentTitle} is ready to start` | `firstStep ? \`First step: ${firstStep}\` : \`${startMinutes} minutes. Tap to begin.\`` |
| N3 | `This has moved ${rescheduleCount} times` | `Forget finishing it — give it ${minimumMinutes} minutes to start.` |
| N4 | `${fullMinutes} minutes won't fit today` | `The ${shortMinutes}-minute version will. Keep the promise?` |
| N5 | `${commitmentTitle} starts in ${minutesUntil} minutes` | `purpose ? \`You said this matters: ${purpose}\` : \`Phone down, people first.\`` |
| N6 | `No catching up` | `One useful action today is enough to restart.` |
| N7 | `${ordinal(count)} ${outcomeTitle} session in ${windowDays} days` | `This is becoming a pattern.` |
| N8 | `Your week is ready to review` | `Planned versus actual, and what to change next week.` |
| N9 | `${truncate(summary, 60)}` | `The current schedule keeps failing. Review the proposal.` |

Title ≤ 60 and body ≤ 140 characters after interpolation (truncate with `…`). A payload that fails its schema makes the template throw → the channel records a delivery failure, as the recipe says.

*Inbox actions* — `notificationSchema` (`dto/notification.dto.ts`) gains `actions: z.array(z.object({ action: z.enum([...]), label: z.string(), link: z.string() }))`; `NotificationStoreService.list` maps each row through `actionsFor(row.eventKey, payloadFromRow(row))`. Because the inbox row stores no payload, `actionsFor` must be computable from `(eventKey, link)`: `parseCoachingLink(link)` (in `coaching-actions.ts`) extracts `commitment`, `n` and, for HEALTH labelling, nothing more — so **`startLabel` for stored rows uses the generic `Start` label when `domain` is unknown**; the push channel (E12-04 (#64)), which has the payload, uses the precise label. `NotificationStreamEvent` (`notification-stream.service.ts`) and the browser channel's `publish` carry the same `actions` so a live SSE row renders buttons without a refetch.

*Email (N8 only)* — `apps/api/src/email/templates/weekly-review-ready.email.ts` (new, modelled on `role-changed.email.ts`; hand-written text part; CTA URL through `renderLayout`), registered in `templates/index.ts` (`EmailTemplateDataMap` + `EMAIL_TEMPLATES`) and mapped in `EVENT_EMAIL_TEMPLATES` (`coach.weekly_review_ready → 'weekly-review-ready'`).

*Sanitizer* — `sanitizeLink` must accept `?`, `&`, `=` and `/`-prefixed paths with a query; if its forbidden-character set rejects any of them, extend the allowlist here with a test proving `javascript:` and `//` are still rejected.

**UI (frontend-dev)** — the one web change: `apps/web/src/App.tsx` adds `<Route path="/today" element={<TodayPage />} />` beside `/` and `apps/web/src/config/destinations.ts` sets `DESTINATION_ROUTES.today = ['/', '/today']` so the links above resolve the moment the first row is written; `apps/web/src/__tests__/config/destinations.test.ts` is extended for the alias. `types/index.ts` `AppNotification` gains `actions: NotificationAction[]` (rendered by E12-05 (#68); typed now so the SSE parser in `services/notificationStream.ts` carries it through).

**Tests (testing-dev)**

- `apps/api/src/notifications/notification-events.spec.ts` (extend): nine `coach.*` keys present, unique, none mandatory, `coach.weekly_review_ready` is the only coaching event with `email`.
- `apps/api/src/coaching-notifications/coaching-events.spec.ts`: every payload schema rejects a missing `sentInteractionId`; `copy.title` > 60 rejected.
- `apps/api/src/coaching-notifications/coaching-actions.spec.ts`: table above, row by row; `todayLink` encodes ids; `actionsFor('user.welcome', …)` → `[]`; `parseCoachingLink` round-trips every link `actionsFor` emits.
- `apps/api/src/coaching-notifications/copy/copy-templates.spec.ts`: each default copy fits the caps for the longest realistic titles; **no default copy matches E12-03 (#59)'s banned-phrase list** (import the list once E12-03 (#59) lands; until then assert against a local copy of the PRD §129 words: disappoint, promised, let down, last chance, shame, guilt, miss you).
- `apps/api/src/notifications/channels/browser-notification.channel.spec.ts` (extend): N1 renders the default title, link `/today?commitment=…&action=start&n=…`; `copy` present → used verbatim; invalid payload → `success: false`; `sanitizeLink` keeps the query string.
- `apps/api/src/email/templates/weekly-review-ready.email.spec.ts`: subject, escaped HTML, text part contains the URL.
- `apps/api/test/notifications/notifications-list.integration.spec.ts` (extend or new): a stored `coach.family_presence` row lists `actions` with three entries; a `security.role_changed` row lists `[]`.
- Web: `apps/web/src/__tests__/config/destinations.test.ts` (`/today` owned by `today`); `services/notificationStream.test.ts` parses `actions`.

**Docs (docs-dev)** — `CLAUDE.md` "Adding a Notification" gains a sentence: coaching events additionally declare their payload schema in `coaching-events.ts` and their actions in `coaching-actions.ts`; `docs/API.md` `GET /notifications` example gains `actions`; the nine events listed in the notifications section of `docs/API.md`.

#### Acceptance criteria

- [ ] `GET /api/notifications/events` lists the nine `coach.*` events after the three foundation events, with the channels in the table.
- [ ] `/settings/notifications` shows nine new rows with no code change on that page (registry-driven).
- [ ] `notify('coach.commitment_upcoming', userId, payload)` writes an inbox row whose `link` is `/today?commitment=<id>&action=start&n=<sentInteractionId>` and whose `title` is the default copy when `payload.copy` is absent, the AI copy when present.
- [ ] `GET /api/notifications` returns `actions` for coaching rows and `[]` for others; the SSE event carries the same field.
- [ ] `coach.weekly_review_ready` renders an email with subject "Your week is ready to review" and a link to `/progress/week`.
- [ ] `http://localhost:3535/today?commitment=<id>&action=start` behaves exactly like `/?commitment=<id>&action=start` (E05-04).
- [ ] No default copy contains a PRD §129 phrase (test-enforced).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: template throws on a bad payload → recorded delivery failure, never a crash of the caller
- [ ] Observability: none new (channels already log per delivery)
- [ ] Security: links stay root-relative through `sanitizeLink`; `n` and `commitment` are UUIDs only
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 1–3; `curl -H "Authorization: Bearer $T" http://localhost:3535/api/notifications/events | jq '[.[] | select(.key | startswith("coach."))] | length'` → `9`.
2. From a Node REPL inside the API container (or a throwaway integration test) call `notificationsService.notify('coach.family_presence', '<userId>', { sentInteractionId: '<uuid>', commitmentId: '<uuid>', commitmentTitle: 'Phone-free dinner', minutesUntil: 15 })`; open the bell → the row reads "Phone-free dinner starts in 15 minutes"; `GET /api/notifications` → `actions: [in, move, skip]`.
3. Open http://localhost:3535/today?commitment=<realId>&action=start → lands on `/start/<realId>`.

#### Out of scope

- Deciding *when* to send (E12-03 (#59)); rendering the buttons (E12-05 (#68)); push (E12-04 (#64)).

#### Notes for the implementing agent

- One registry, one list: add the entries to `NOTIFICATION_EVENTS` in `notification-events.ts`; `coaching-events.ts` only *derives* (keys tuple, categories, payloads) and must not become a second event list — add a test asserting every key in `COACHING_EVENT_KEYS` exists in the registry and vice versa (`key.startsWith('coach.')`).
- `EVENT_BROWSER_TEMPLATES` is `Partial<Record<string, …>>`; keep templates tiny and push all wording into `copy-templates.ts` so E12-03 (#59)'s copywriter and the tests share it.
- The `notifications` table stores rendered text only (by design — read the header of `model Notification`). Do not add a payload column; derive actions from `(eventKey, link)`.
- Keep the web change to the alias + type; no behaviour.

---

### E12-03 `feat(api): add the deterministic notification decision engine, scheduler and AI copywriter` — #59

**Part of epic:** E12 · **Blocked by:** E12-01 (#49), E12-02 (#54), E05-01 (#38), E05-02 (#40), E07-03 (#116), E10-02 (#73), E11-02 (#112), E01-06 (#26) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

VISION §35: "A deterministic policy layer should determine whether sending is appropriate. The AI may personalize the wording." PRD §59 lists the inputs, PRD §61 the limits (daily cap, per-commitment max, no repeat after explicit skip, quiet hours, automatic reduction when ignored), PRD §14.7 the copy generator that "does not decide whether notification limits may be violated", PRD §62 and §129 the tone and anti-manipulation rules, and PRD §108 the acceptance list (quiet hours respected, ignored notifications tracked, no uncontrolled repeats, no shame in the comeback message). Nothing in the API emits a coaching notification; E12-02 (#54) gave the events a shape, this issue gives them a brain and a clock.

#### Proposed solution

A pure `decide()` with an exhaustive test per suppress reason, a candidate scanner that turns the domain state into `NotificationCandidate`s for the next 30 minutes, a `@Cron('*/5 * * * *')` task that runs the pipeline `candidates → decide → (AI copy | template) → notify → record`, and a non-production `run-job` endpoint so tests and the product owner can run it on demand with a simulated clock.

**Data (database-dev)** — n/a (writes through E12-01 (#49)'s `NotificationInteractionsService`).

**API (backend-dev)**

Files under `apps/api/src/coaching-notifications/` (all new unless noted): `policy/notification-policy.ts` (pure `decide`), `policy/quiet-hours.ts` (pure), `policy/fatigue.ts` (pure), `policy/evidence-milestones.ts` (pure), `candidates/notification-candidate.ts` (types), `candidates/candidate-scanner.service.ts`, `copy/notification-copy.schema.ts`, `copy/banned-phrases.ts` (pure), `copy/notification-copywriter.service.ts`, `coaching-notifications.service.ts` (orchestrator), `tasks/coaching-notification.task.ts`. Module additions: imports `NotificationsModule` (for `NotificationsService`), `AiModule` (E01-06 (#26)), `TodayModule` (E05-01 (#38), `local-date`), `WorkModule` (E07-03 (#116) `AvoidanceService` — export it there if E07-03 (#116) did not), `CommitmentsModule` (E02-04 (#47)). `TestAuthModule` imports `CoachingNotificationsModule` for the run-job route.

*Decision — `policy/notification-policy.ts`* (pure; no Nest, no Prisma, no `Date.now()`):

```ts
export interface PolicyInput {
  now: Date;
  candidate: { eventKey: CoachingEventKey; category: 'N1'|…|'N9'; dueAt: Date; commitment?: { id; domain; status; scheduledStart; skippedToday: boolean; completed: boolean } };
  policy: ResolvedNotificationPolicy;                 // E12-01 (#49) resolvePolicy()
  enabledChannels: NotificationChannel[];             // resolveChannels(event, prefs) ∩ transports with an address (push needs a subscription)
  domainMode: DomainModeKind | null;                  // for the candidate's domain
  history: { sentToday; sentThisWeek; sentForCommitment; consecutiveIgnored; lastActionedAt: Date | null };  // E12-01 (#49) history()
}
export type PolicyDecision =
  | { send: true;  category; scheduledFor: Date; effectiveDailyCap: number }
  | { send: false; category; scheduledFor: Date; reason: NotificationSuppressReason; effectiveDailyCap: number };
export function decide(input: PolicyInput): PolicyDecision
```

Checks, in this fixed order (the first failing check is the recorded reason):

1. `MUTED` — `enabledChannels` is empty **or** `policy.mutedCategories` includes the event key.
2. `DOMAIN_PAUSED` — candidate has a domain and its mode is `PAUSE` (N6 and N8 have no domain and skip this check; N6 also skips it because comeback *is* the recovery path).
3. `ALREADY_DONE` — `commitment.completed` (status `COMPLETED | PARTIALLY_COMPLETED`), or status `CANCELLED | MISSED`.
4. `SKIPPED` — `commitment.skippedToday` (status `SKIPPED` with `updatedAt` inside the local day) — PRD §61 "no repeated reminders after explicit skip"; also applies when the row was `RESCHEDULED` off today (it is not due today any more).
5. `PER_COMMITMENT_MAX` — `history.sentForCommitment ≥ policy.perCommitmentMax` (all coaching events for that commitment, today).
6. `QUIET_HOURS` — `isQuietNow(now, timezone, quietHours)` (`policy/quiet-hours.ts`: local `HH:mm` via `Intl.DateTimeFormat` with `hourCycle: 'h23'`; window `[start, end)`; when `end < start` the window crosses midnight: quiet if `t ≥ start || t < end`).
7. `WEEKLY_CAP` — `history.sentThisWeek ≥ policy.weeklyCap`.
8. `FATIGUE` / `DAILY_CAP` — `effectiveDailyCap = fatigueActive ? ceil(policy.dailyCap / 2) : policy.dailyCap` where `fatigueActive = history.consecutiveIgnored ≥ 5` (`policy/fatigue.ts`; an ACTIONED resets the run — E12-01 (#49)'s `history()` already counts only since the last ACTIONED). If `sentToday ≥ effectiveDailyCap`: reason is `FATIGUE` when `fatigueActive && sentToday < policy.dailyCap`, else `DAILY_CAP`.

A `dailyCap` of `0` means "never" (reason `DAILY_CAP`). `scheduledFor = candidate.dueAt` always. `GET /me/notification-policy` (E12-01 (#49)) now fills `fatigue: { active, effectiveDailyCap }` from the same function.

*Candidates — `candidates/candidate-scanner.service.ts`*: `scan(now): Promise<NotificationCandidate[]>` where `NotificationCandidate = { userId, eventKey, category, dueAt, dedupeKey, commitmentId?, payload (E12-02 (#54) schema minus sentInteractionId/copy), leadMinutes? }`. Users considered: those with a commitment `scheduledStart ∈ [now − 45 min, now + 30 min]` in status `PLANNED | READY | RESCHEDULED | STARTED`, plus users with an N6/N8/N9 source row. Per user, timezone from `user_profiles` (`UTC` when absent), `dateLocal = localDate(now, tz)`. Rules (a candidate is produced only when `!hasDecision(userId, eventKey, dedupeKey)`):

| Cat. | Source | When (`Δ = scheduledStart − now`) | `dedupeKey` | Notes |
|---|---|---|---|---|
| N1 | commitment `PLANNED\|READY\|RESCHEDULED`, domain WORK/HEALTH | `10 min < Δ ≤ 25 min` | `<commitmentId>` | skipped when N3 applies (one reminder per moment); `leadMinutes = round(Δ)`; `startMinutes` = minimum version minutes when present else short else full |
| N2 | same, not `STARTED` | `−5 min < Δ ≤ 5 min` | `<commitmentId>` | `firstStep` from `steps[0]` |
| N3 | WORK commitment due today with `AvoidanceService.assessMany` level ≥ 1 | same window as N1 | `<commitmentId>` | replaces N1 for that commitment |
| N4 | commitment `PLANNED\|READY\|RESCHEDULED`, `Δ ≤ 0`, `remaining = (scheduledEnd ?? localDayEnd(22:00 or quietHours.start)) − now` | `minimumMinutes ≤ remaining < fullMinutes` and `shortMinutes ≤ remaining` | `<commitmentId>` | once; `shortMinutes` = short version when it fits else minimum |
| N5 | FAMILY commitment (`domain = FAMILY`) | `10 min < Δ ≤ 20 min` | `<commitmentId>` | replaces N1 for FAMILY; `purpose` from `ritual.purpose` when `ritualId` set |
| N6 | E11-02 (#112) comeback record with status `OFFERED` and no SENT for it | first run after 09:00 local | `<comebackId>:<dateLocal>` | retried daily until sent or the record leaves `OFFERED`, max 7 days |
| N7 | commitments `COMPLETED` with `completedAt ∈ [now − 15 min, now]` | `evidenceMilestone(outcomeCompletions)` non-null | `<commitmentId>` | `policy/evidence-milestones.ts`: `THIRD_IN_8_DAYS` (3 completions of the same outcome within 8 days, the newest being this one), `FIFTH_IN_14_DAYS`, `TENTH_TOTAL`, `FIRST_FULL_WEEK` (every planned commitment of the outcome in the current Monday-start week completed); E11-03 (#115)'s milestone rows, when present, are an additional source with the same dedupe |
| N8 | E10 `WeeklyReview` in its READY state, `readyAt ∈ [now − 24 h, now]` | first run after 08:00 local | `<reviewId>:<dateLocal>` | retried daily, max 3 days |
| N9 | E06-01 (#61) `PlanChangeProposal` `status = PROPOSED`, `sourceKind ≠ COACH` (coach-chat proposals are already on screen), `createdAt ∈ [now − 24 h, now]` | first run after 08:00 local | `<proposalId>:<dateLocal>` | retried daily until decided/expired, max 3 days |

Idempotency: the SENT/SUPPRESSED row's `(userId, eventKey, dedupeKey)` unique index is the lock; a candidate whose decision exists is never re-evaluated (moment-bound N1–N5, N7 get exactly one decision; N6/N8/N9 get one per local day).

*Copy — `copy/notification-copywriter.service.ts`*: `write(candidate, ctx): Promise<{ copy, source: 'ai' | 'template' }>`. Called **only** for `send: true` decisions. `ctx = { coachingStyle (E04-01 (#100)), domainMode, priorTitles (last 3 SENT titles for this commitment, from `notifications` joined via `notificationId`), journeyState ('BUILDING' | 'STEADY' | 'SLIPPING' | 'RECOVERING' | null from E11-01 (#98)'s momentum when cheap to read, else null) }`. Gateway call:

```ts
this.ai.invoke({ persona: 'notification_copywriter', userId, promptVersion: 'notification-copy.v1',
  instructions: buildCopyInstructions(coachingStyle), input: { category, eventKey, domain, payload, priorTitles, journeyState, defaultCopy },
  schema: notificationCopySchema, schemaName: 'notification_copy', maxOutputTokens: 200 })
```

`notificationCopySchema = z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(140), actionLabel: z.string().min(1).max(20) })` (`copy/notification-copy.schema.ts`). `buildCopyInstructions` states: rewrite `defaultCopy` for this person; keep the same meaning and the same action; tone by style — GENTLE: warm, no imperatives; BALANCED: plain and friendly; DIRECT: short, imperative, no softeners; never imply disappointment, threaten, guilt the user about loved ones, frame opting out as failure, create fake urgency, or imply the coach is hurt when ignored (PRD §129); no emoji; no exclamation marks in DIRECT; do not mention notification limits or that this is a notification; do not invent facts not in the input. Post-check (`copy/banned-phrases.ts`, pure `findBannedPhrase(text): string | null`, regex list: `disappoint`, `let (me|us|them|.* ) down`, `you promised`, `last chance`, `don'?t miss`, `\bshame`, `guilt`, `hurry`, `running out of time`, `\bmiss(ed|ing)? you\b`, `what would .* think`, `if you really cared`, `no excuses`, `!{2,}`). AI copy is used only when `ok: true`, the schema passed (the gateway validates), and `findBannedPhrase` is null for title, body and actionLabel; otherwise `DEFAULT_COPY` (E12-02 (#54)) with `source: 'template'`. The copywriter never sees the decision inputs and cannot change `send`.

*Orchestrator — `coaching-notifications.service.ts`*: `runOnce(now = new Date()): Promise<{ scanned, sent, suppressed, skipped }>`; guarded by an in-process `running` flag (a second overlapping run returns `{ skipped: true }`). Per candidate: load `policy` (E12-01 (#49)), `preferences` (`readNotificationPreferences` on the user's settings row), `enabledChannels = resolveChannels(event, prefs)` minus `'push'` when the user has no `push_subscriptions` row and minus `'email'` when `EmailSettingsService` reports email disabled; `domainMode`; `history` → `decide`. `send: false` → `recordSuppressed` (with `meta { category, leadMinutes, localDate }`), log `coach-notify suppressed user=<id> event=<key> reason=<r>`. `send: true` → `recordSent` first (its id is the `sentInteractionId` in every link), then `write()` for copy (concurrency 4 across candidates via a small `pLimit`-style helper, no new dependency), then `await this.notifications.notify(eventKey, userId, { ...payload, sentInteractionId, copy })`, then `meta.copySource`. After the run, `await this.notifications.flush()` (existing method) and back-fill `notificationId`/`deliveryId` on the SENT rows by matching `notifications` rows created during the run with `link` containing `n=<sentInteractionId>` (`linkNotification`). Log summary `coach-notify run scanned=<n> sent=<n> suppressed=<n> ai=<n> template=<n> ms=<n>`. OTel span `coaching_notifications.run` with those counts as attributes; never copy text.

*Task — `tasks/coaching-notification.task.ts`*: `@Cron('*/5 * * * *')` `handleCron()` → `runOnce()`, errors caught and logged (a failed run must not throw out of the scheduler). Disabled when `COACHING_NOTIFICATIONS_ENABLED=false` (config `coachingNotifications.enabled`, default `true`; `.env.example` entry).

*Run-job route* — `apps/api/src/test-auth/test-auth.controller.ts`: `@Post('run-job') @Auth() @UseGuards(TestEnvironmentGuard)` with `RunJobDto { job: z.enum(['coaching-notifications']), now: z.string().datetime().optional() }` → `{ scanned, sent, suppressed, skipped }` from `runOnce(now ? new Date(now) : undefined)`. Non-production only, like the rest of the controller. If an earlier epic already added a `run-job` route (E08-02 (#41)'s materializer or E11-02 (#112)'s detector may have), extend its `job` enum instead of adding a second route.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**

- `policy/notification-policy.spec.ts` — one `describe` per reason with a table of inputs: MUTED (no channels; muted key), DOMAIN_PAUSED (WORK paused, N6 exempt, N8 exempt), ALREADY_DONE (COMPLETED, PARTIALLY_COMPLETED, CANCELLED), SKIPPED (skipped today; skipped yesterday does not suppress a new row), PER_COMMITMENT_MAX (2 sent → third suppressed; `perCommitmentMax 0`), QUIET_HOURS (`22:00–07:00` at 23:30 and 06:59 local suppress, 07:00 sends, in `America/Costa_Rica` and `Asia/Tokyo`; `null` never suppresses; same-day window `12:00–13:00`), WEEKLY_CAP, DAILY_CAP (`sentToday = cap`), FATIGUE (`consecutiveIgnored 5`, `dailyCap 4`, `sentToday 2` → FATIGUE with `effectiveDailyCap 2`; `sentToday 4` → DAILY_CAP; `consecutiveIgnored 4` → send), order of precedence (a muted + quiet-hours input reports MUTED), `send: true` returns `scheduledFor = dueAt`.
- `policy/quiet-hours.spec.ts`, `policy/fatigue.spec.ts`, `policy/evidence-milestones.spec.ts` (3rd in 8 days true/false at the boundary; 10th total; first full week with one planned commitment skipped → false).
- `copy/banned-phrases.spec.ts` — every PRD §129 example phrase is caught; "Two evening workouts failed. I think the schedule needs changing." is **not** caught (PRD §60 copy must pass).
- `copy/notification-copywriter.service.spec.ts` — gateway mocked: `ok: true` clean → `source 'ai'`; `ok: false` → template; banned phrase → template; title 61 chars (gateway returns schema error) → template; the gateway is **never called** when the service is invoked with a `send: false` decision (guard test on the orchestrator).
- `candidates/candidate-scanner.service.spec.ts` (mocked Prisma + `AvoidanceService`): each row of the candidate table, with `now` fixed; N3 replaces N1; N5 replaces N1 for FAMILY; N4 boundaries; existing decision → no candidate.
- `coaching-notifications.service.spec.ts` — `recordSent` precedes `notify`; `notify` receives `sentInteractionId` and `copy`; suppressed candidates never reach `notify`; overlapping run is skipped.
- `apps/api/test/coaching-notifications/coaching-notifications.integration.spec.ts` (`createTestApp`, `overrideProviders` for the AI gateway with a stub returning fixed copy): seed profile (tz UTC) + commitment at `now + 20 min` → `POST /api/auth/test/run-job` → `{ sent: 1 }`, `GET /api/notifications` has one `coach.commitment_upcoming` row with `n=` in its link and `actions[0].action === 'start'`; second run → `sent: 0`; quiet hours set → new commitment → `suppressed: 1` and `notification_interactions` has `QUIET_HOURS`; skip the commitment via `POST /commitments/:id/actions/skip` → run at `now = scheduledStart` → `SKIPPED`; AI stub returning "Don't let yourself down" → the inbox row carries the template title.
- `apps/api/src/test-auth/test-auth.service.spec.ts` (extend) / controller spec: `run-job` is absent in production config (module not registered).

**Docs (docs-dev)** — `docs/specs/coaching-notifications.md` sections "Decision order", "Candidate rules", "Copy rules" (file created by E12-07 (#75); write these sections now if the file does not exist), `.env.example` (`COACHING_NOTIFICATIONS_ENABLED`), `docs/API.md` test-auth section (`run-job`), `CLAUDE.md` env list.

#### Acceptance criteria

- [ ] `decide()` is pure and every `NotificationSuppressReason` has at least one passing unit case that produces it and one that does not.
- [ ] Quiet hours are evaluated in the user's timezone and a window crossing midnight suppresses on both sides of it.
- [ ] Daily and weekly caps count `SENT` rows in the user's local day and Monday-start week; after five consecutive ignored notifications the effective daily cap halves and a single ACTIONED restores it.
- [ ] A commitment skipped today never receives another coaching notification that day; a completed one is suppressed as `ALREADY_DONE`.
- [ ] The same commitment receives at most `perCommitmentMax` coaching notifications per day and at most one decision per event (idempotent across runs).
- [ ] The `notification_copywriter` persona is invoked only for `send: true` decisions; its output is rejected on schema, length or banned-phrase failure and the template copy is used; with the AI unreachable every notification still goes out with template copy.
- [ ] The cron runs every 5 minutes and an on-demand `POST /api/auth/test/run-job` (non-production) returns run counts and accepts a `now` override.
- [ ] Every send and suppression is a `notification_interactions` row with `meta.category`, `meta.leadMinutes` (where applicable) and `meta.copySource`.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: a failing candidate (bad row, template throw) is logged and skipped, the run continues; scheduler exceptions never escape `handleCron`
- [ ] Observability: run summary log line and `coaching_notifications.run` span with counts; per-suppression debug log with reason; no copy text in logs or spans
- [ ] Security: the LLM receives only the candidate payload, prior titles and style — no preferences, no caps, no other users' data; it cannot influence `send`
- [ ] Config & secrets: `COACHING_NOTIFICATIONS_ENABLED` (default `true`) documented; no new secrets
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 4–10 (N1 sent → start → ACTIONED; idempotent re-run; quiet hours → `QUIET_HOURS`; skip → `SKIPPED`; fallback offer).
2. Stop the `fake-openai` container; seed a commitment 20 min ahead; run the job → the inbox row shows the default copy and `meta.copySource = 'template'`.
3. `docker compose logs api | grep coach-notify` → one `run scanned=… sent=… suppressed=…` line per run, no message text.
4. Set `COACHING_NOTIFICATIONS_ENABLED=false`, restart the API → no `run` lines appear over 10 minutes; the on-demand route still works.

#### Out of scope

- Push transport (E12-04 (#64)); recording OPENED/ACTIONED from the web (E12-05 (#68)); metrics (E12-06 (#69)).
- A distributed lock — one API process is assumed (documented).

#### Notes for the implementing agent

- Reuse `apps/api/src/today/local-date.ts` for every local-time computation; do not add a date library.
- `AiGatewayService` returns `{ ok: false }` for `no_user_key` (a user without a BYOK key) — that is the normal case for many users; treat it exactly like any other failure: template copy, no log above debug.
- `NotificationsService.notify` is detached and returns before delivery; that is why the SENT row is created first and `notificationId` is back-filled after `flush()`. Do not try to make `notify` return an id.
- `resolveChannels` is pure and does not know which transports have an address; the orchestrator subtracts `push` without a subscription so that `MUTED` is accurate rather than "sent to nowhere".
- E07-03 (#116)'s `AvoidanceService.assessMany` may be expensive; call it once per user per run for the WORK commitments in the window only.
- Copy the `@Cron` shape from `apps/api/src/auth/tasks/token-cleanup.task.ts`; keep the task class free of logic.
- Fastify, Zod via `nestjs-zod`, `npm run prisma:*`. Register nothing new in `tags.ts` (the route lives under the existing `Test Authentication` tag).

---

### E12-04 `feat(api): add the web push channel with VAPID, subscriptions and service worker handlers` — #64

**Part of epic:** E12 · **Blocked by:** E12-02 (#54), E02-07 (#58), E12-01 (#49) · **Component:** api, web, infra · **Priority:** P0 · **Agents:** backend-dev → frontend-dev → ops-dev → testing-dev → docs-dev

#### Problem statement

PRD §123: "behaviour intervention often occurs near the moment of action" — that moment is rarely one with the app open. The browser channel reaches an open tab over SSE and leaves an inbox row for the next visit; a "starts in 20 minutes" cue that waits for the next visit is not a cue. The registry has reserved `'push'` since epic #109 ("adding `'push'` here … widens the type in the same edit") and E02-07 (#58) installed the service worker web push needs; nothing sends to it.

#### Proposed solution

Widen `NOTIFICATION_CHANNELS` to `['email', 'browser', 'push']`, add a `PushNotificationChannel` sender backed by the `web-push` package with VAPID keys from the environment, subscription endpoints, a custom service worker (`injectManifest`) with `push` and `notificationclick` handlers that open the deep link and expose action buttons, an SSE fallback that needs no code (an unsubscribed user simply has no push address), and a public dismissal endpoint the worker can call without a session.

**Data (database-dev)** — n/a (E12-01 (#49)'s `push_subscriptions`).

**API (backend-dev)**

- `apps/api/package.json`: dependency `web-push` (pin exact; add `@types/web-push` as a devDependency).
- `apps/api/src/config/configuration.ts`: `webPush: { publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? null, privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? null, subject: process.env.WEB_PUSH_SUBJECT ?? null }`. `infra/compose/.env.example`: the three variables with the comment "generate with `npx web-push generate-vapid-keys`; `WEB_PUSH_SUBJECT` is `mailto:` or an https URL; all three optional — without them the push channel is inactive and the Push column shows 'not configured'". `WEB_PUSH_PRIVATE_KEY` is a secret: never logged, never returned.
- `notification-events.ts`: `NOTIFICATION_CHANNELS = ['email', 'browser', 'push'] as const`; add `'push'` to the nine `coach.*` entries (and nowhere else — a role change stays email + browser). `notification-preferences.ts` and `user-settings-namespaces.schema.ts` widen automatically; fix every `switch`/`Record<NotificationChannel, …>` the compiler flags.
- `apps/api/src/notifications/push/web-push.provider.ts` (new): wraps `web-push` (`setVapidDetails` once at construction when all three values exist; `isConfigured()`; `send(subscription, payload: string, options)`), so the channel and tests never import the package directly.
- `apps/api/src/notifications/channels/push-notification.channel.ts` (new) `PushNotificationChannel implements NotificationChannelSender`: `channel = 'push'`; `resolveTo(recipient)` → `recipient.userId` when `webPush.isConfigured()` **and** the user has ≥ 1 `push_subscriptions` row (a cheap `count` per dispatch), else `null` (the dispatcher logs and skips — no delivery row, no error, exactly the SSE-inbox fallback the issue asks for: the browser channel still writes the inbox row). `deliver(context, to)`: render through the same template as the browser channel (`BrowserNotificationChannel.render` is extracted to an exported pure `renderBrowserContent(context)` under this issue), compute `actions = actionsFor(event.key, data).slice(0, 2)` (browsers cap visible actions at two), build the payload `{ title, body, link, actions, tag: sentInteractionId ?? event.key, sentInteractionId, eventKey }` (≤ 4 KB), and `send` to every subscription of the user with `{ TTL: 1800, urgency: category ∈ {N2, N5} ? 'high' : 'normal' }`. Per subscription: HTTP 404/410 → delete the row (log "push subscription gone"); other failures → collected. Result `{ success: delivered > 0, messageId: '<n>/<m>', error }`; `lastSeenAt` is bumped on success. Registered in `notifications.module.ts`'s `NOTIFICATION_CHANNEL_SENDERS` factory as the third sender.
- `apps/api/src/notifications/push/push-subscriptions.controller.ts` + `push-subscriptions.service.ts` + `dto/push-subscription.dto.ts` (new):

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/notifications/push/public-key` | `@Auth()` | — | 200 `{ publicKey: string \| null }` |
| GET | `/api/notifications/push-subscriptions` | `@Auth()` | — | 200 `{ items: [{ id, endpointHost, userAgent, createdAt, lastSeenAt }] }` (never the full endpoint or keys) |
| POST | `/api/notifications/push-subscriptions` | `@Auth()` | `{ endpoint: z.string().url().max(2048).startsWith('https://'), keys: pushSubscriptionKeysSchema, userAgent?: z.string().max(300) }` | 201 `{ id }` — upsert on `endpoint`: an endpoint already owned by another user is re-owned by the caller (a shared browser profile signed in as someone else) |
| DELETE | `/api/notifications/push-subscriptions` | `@Auth()` | `{ endpoint }` | 204, idempotent, own rows only |
| POST | `/api/notifications/interactions/dismissed` | `@Public()` | `{ sentInteractionId: uuid }` | 204 always (records `DISMISSED` via E12-01 (#49)'s `recordResponse` when the row exists and is `SENT`; unknown id → still 204). The UUID is the capability; the route accepts nothing else, writes nothing else, and is throttled to 30/min per IP with the same per-process window E01-06 (#26)'s `test-throttle.ts` uses |

Audit: none (device churn); log `push subscription added/removed user=<id> host=<endpointHost>`.

*Native-toast dedupe (web, `contexts/NotificationContext.tsx`)*: when this device holds a push subscription (`localStorage['push.subscribed'] === '1'`, maintained by the service below), the SSE handler does **not** call `showNativeNotification` — the push notification is the OS toast; the inbox and badge still update live.

**UI (frontend-dev)**

- `apps/web/package.json`: `workbox-precaching`, `workbox-routing` (exact versions matching the `vite-plugin-pwa` major from E02-07 (#58)).
- `apps/web/vite.config.ts`: `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'autoUpdate', manifest: false, injectRegister: null, injectManifest: { globPatterns: ['**/*.{js,css,html,woff2}'] }, devOptions: { enabled: false } })` — E02-07 (#58)'s `workbox` block moves into the worker source. **Decision: `injectManifest` with a custom `src/sw.ts`** (the alternative, keeping `generateSW` plus `importScripts` of a second file, splits the worker across two update mechanisms and is exactly what E02-07 (#58) flagged as the route to take when custom code is needed).
- `apps/web/src/sw.ts` (new, TypeScript, `/// <reference lib="webworker" />`): `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`, `registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))` (E02-07 (#58)'s semantics preserved, still no runtime caching of `/api`); `self.addEventListener('push', …)`: parse JSON (ignore on failure), `event.waitUntil(self.registration.showNotification(title, { body, tag, renotify: false, data: { link, actions, sentInteractionId }, actions: actions.map(a => ({ action: a.action, title: a.label })) }))`; `notificationclick`: `notification.close()`, `link = event.action ? data.actions.find(a => a.action === event.action)?.link ?? data.link : data.link`, if `link` is not root-relative do nothing, else `clients.matchAll({ type: 'window', includeUncontrolled: true })` → focus the first same-origin client and `client.navigate(link)`, or `clients.openWindow(link)`; `notificationclose`: `fetch('/api/notifications/interactions/dismissed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentInteractionId }) })` inside `waitUntil`, errors ignored. Add `WebWorker` to the `lib` of a dedicated `tsconfig.sw.json` (or an `include` carve-out) so the DOM `tsconfig` does not see it.
- `apps/web/src/services/pushSubscriptions.ts` (new): `getPushState(): Promise<PushState>` (`'unsupported' | 'unconfigured' | 'denied' | 'subscribed' | 'unsubscribed'` — `PushManager` in `window`, `getPushPublicKey()` null, `Notification.permission`, `registration.pushManager.getSubscription()`), `subscribeToPush()` (`navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })` → `createPushSubscription(sub.toJSON())` → `localStorage['push.subscribed'] = '1'`), `unsubscribeFromPush()` (`sub.unsubscribe()` + `deletePushSubscription(endpoint)` + clear the flag), `urlBase64ToUint8Array` (pure, tested). All wrapped in try/catch like `browserNotifications.ts`; every function is reachable only from a user gesture.
- `apps/web/src/services/api.ts`: `getPushPublicKey()`, `getPushSubscriptions()`, `createPushSubscription(body)`, `deletePushSubscription(endpoint)`. `types/index.ts`: `NotificationChannel = 'email' | 'browser' | 'push'`, `PushState`, `PushSubscriptionSummary`.
- `components/settings/NotificationSettings.tsx`: `CHANNEL_LABELS.push = 'Push'`; the browser-permission card gains a **Push on this device** `Switch` (props `pushState`, `onSubscribePush`, `onUnsubscribePush`, `isSubscribingPush`), disabled with helper text for `unsupported` ("This browser cannot receive push notifications"), `unconfigured` ("Push is not configured on this server"), `denied` ("Notifications are blocked for this site in your browser settings"), and — when `import.meta.env.DEV` — "Push needs the production build (no service worker in `npm run dev`)". The `push` column cells follow the same enabled/disabled rules as the browser cells (a toggle you cannot use is rendered disabled with the reason, per epic #109). `pages/UserNotificationsPage.tsx` wires the new props through `hooks/usePushSubscription.ts` (new: `{ state, subscribe, unsubscribe, isBusy, refresh }`).
- `apps/web/nginx.conf`: E02-07 (#58)'s `location = /sw.js { add_header Cache-Control "no-cache"; }` stays valid — the injected worker is still emitted as `dist/sw.js`; verify.

**Tests (testing-dev)**

- `apps/api/src/notifications/channels/push-notification.channel.spec.ts` (mocked `WebPushProvider` + Prisma): `resolveTo` null when unconfigured, null without subscriptions, userId otherwise; `deliver` sends to every subscription with `TTL 1800`, `urgency 'high'` for N2; 410 deletes the row and the result is still `success` when another subscription delivered; all failed → `success: false` with the joined error; payload has ≤ 2 actions and `tag = sentInteractionId`; payload JSON < 4096 bytes for the longest default copy.
- `apps/api/src/notifications/notification-events.spec.ts` (extend): `NOTIFICATION_CHANNELS` includes `push`; only `coach.*` events declare it.
- `apps/api/src/notifications/notification-preferences.spec.ts` (extend): a stored `push` map is read; `readNotificationPreferences` drops nothing for it.
- `apps/api/test/notifications/push-subscriptions.integration.spec.ts`: public-key null without env, string with env; POST creates, second POST same endpoint updates `lastSeenAt` and keeps one row; another user posting the same endpoint re-owns it; DELETE own → 204 and gone; DELETE foreign → 204 and untouched; body with `http://` endpoint → 400; `interactions/dismissed` with a real SENT id → `DISMISSED` row, with a random UUID → 204 and no row, without auth → 204.
- `apps/api/test/notifications/notifications-dispatch.integration.spec.ts` (extend): `notify('coach.start_cue', …)` for a user with a subscription and `WebPushProvider` overridden → one `notification_deliveries` row per channel (`browser`, `push`), the inbox row exists (fallback path proven together).
- Web: `services/pushSubscriptions.test.ts` (`urlBase64ToUint8Array` vectors; state machine with mocked `navigator.serviceWorker` / `PushManager`; subscribe posts the JSON shape); `components/settings/NotificationSettings.test.tsx` (extend: Push column rendered for coaching events, switch disabled with the right helper per state; `DEV` message); `contexts/NotificationContext.test.tsx` (extend: no native toast when `push.subscribed` flag is set); `__tests__/mocks/handlers.ts` handlers for the four routes. Build check (ops-dev): `cd apps/web && npm run build` emits `dist/sw.js` containing `showNotification` and no `/api/` precache entry (`grep -c '"/api/' dist/sw.js` → 0).

**Docs (docs-dev)** — `.env.example` (three vars), `CLAUDE.md` Environment Variables + "Adding a Notification" (channel `push` exists; a template is not needed — push reuses the browser template), `docs/API.md` (four routes + the public dismissal route with its rationale), `docs/SECURITY-ARCHITECTURE.md` (VAPID key handling; the capability-UUID dismissal route and its throttle), `docs/specs/coaching-notifications.md` "Push" section, `docs/deployment/vps.md` (generate VAPID keys once per deployment; rotating them invalidates all subscriptions).

#### Acceptance criteria

- [ ] With the three `WEB_PUSH_*` variables set, `GET /api/notifications/push/public-key` returns the public key; without them it returns `null` and the Push switch explains why.
- [ ] Subscribing from `/settings/notifications` in a production build creates one `push_subscriptions` row; toggling off deletes it.
- [ ] `notify('coach.commitment_upcoming', …)` for a subscribed user produces an OS notification with two action buttons whose clicks open the app on the deep link (`/start/<id>` for Start, `/today?…&action=move` for Move).
- [ ] A subscription the push service reports gone (410) is deleted on the next send and does not fail the delivery when another device received it.
- [ ] A user with no subscription still gets the inbox row and the SSE update (fallback), and no `push` delivery row is written.
- [ ] Dismissing an OS notification records a `DISMISSED` interaction without a session.
- [ ] `/settings/notifications` shows a **Push** column for the nine coaching events with no change to the matrix component's column logic.
- [ ] `npm run build` in `apps/web` emits the injected worker; Lighthouse "Installable" still passes (E02-07 regression).

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: push failures are delivery failures, never exceptions; the worker ignores malformed payloads; subscribe/unsubscribe surface errors as snackbars
- [ ] Observability: per-delivery log with counts only; "subscription gone" log; no endpoint URLs beyond host in logs
- [ ] Security: private key only in env; `endpoint` must be https; `keys` never returned; deep links validated as root-relative in the worker; public dismissal route accepts one UUID and is throttled
- [ ] Config & secrets: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` optional, documented
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script step 14 (production build, subscribe, close tab, run job, OS notification with actions, click → `/start/<id>`, dismiss → `DISMISSED`).
2. Unset the `WEB_PUSH_*` variables, restart → the switch reads "Push is not configured on this server"; run the job → inbox row present, `select channel from notification_deliveries order by created_at desc limit 2;` → `browser` only.
3. `curl -X POST -H 'content-type: application/json' -d '{"sentInteractionId":"00000000-0000-0000-0000-000000000000"}' http://localhost:3535/api/notifications/interactions/dismissed` → 204, no row.

#### Out of scope

- Push for non-coaching events; badge counts on the app icon; Safari-specific declarative push; a background sync of interactions.

#### Notes for the implementing agent

- `web-push` is server-side only; never import it in the web app. Pin the exact version and confirm it builds on the Node version in `apps/api/Dockerfile`.
- The dispatcher already handles a `null` from `resolveTo` by logging and skipping — that *is* the fallback; do not add a fallback branch inside the push channel.
- `vite-plugin-pwa` `injectManifest` needs `self.__WB_MANIFEST` referenced exactly once in `sw.ts`; keep E02-07 (#58)'s `registerServiceWorker.ts` unchanged (it registers whatever the plugin emits).
- Vitest runs in jsdom with no `PushManager`; the state helper must return `'unsupported'` there without throwing.
- The `Record<NotificationChannel, string>` in `NotificationSettings.tsx` is what makes the new column "automatic": the compiler forces the label, the matrix derives cells from each event's `channels`.
- Never touch the five coupled breakpoint gates; the new switch lives inside the existing permission card.

---

### E12-05 `feat(web): add notification action buttons, deep-link actions and the coaching policy settings section` — #68

**Part of epic:** E12 · **Blocked by:** E12-01 (#49), E12-02 (#54), E12-04 (#64), E05-04 (#46), E08-04 (#50) · **Component:** web, api · **Priority:** P0 · **Agents:** backend-dev → frontend-dev → testing-dev → docs-dev

#### Problem statement

VISION §37: "The app should minimize the number of steps between reminder and real-world behavior" with `I'm in` / `Move it` / `Skip today` on the notification itself; PRD §63 lists `Start 10 min`, `Start workout`, `Use short version`; PRD §108 requires "user can move/skip from appropriate surfaces" and "ignored notifications are tracked"; PRD §61 requires quiet hours and caps the user can see and set. The inbox popover (`NotificationBell.tsx`) renders a row as one click to one link, `TodayPage` understands only the E05-04 (#46) actions, nothing posts OPENED/ACTIONED, and `/settings/notifications` has no policy controls.

#### Proposed solution

Action buttons on inbox rows, the `in | move | short | skip` deep-link actions on `TodayPage` (aliases over E05-02 (#40)/E08-04 (#50) semantics), the response endpoint `POST /notifications/interactions`, an `n=` attribution parser, and a **Coaching reminders** section on the existing `/settings/notifications` page (same question — "how should I be notified" — so a section, not a tab and not a new card).

**Data (database-dev)** — n/a.

**API (backend-dev)**

`apps/api/src/coaching-notifications/interactions/notification-interactions.controller.ts` (new) + `dto/record-interaction.dto.ts`:

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/notifications/interactions` | `@Auth()` | `{ sentInteractionId?: uuid, notificationId?: uuid, kind: 'OPENED' \| 'ACTIONED' \| 'DISMISSED', action?: 'start' \| 'in' \| 'move' \| 'short' \| 'skip' }` — at least one id (400 `INTERACTION_TARGET_REQUIRED`); `action` required for `ACTIONED` (400) | 201 `{ id, sentInteractionId, kind }`; 404 when the referenced row belongs to another user; a duplicate `OPENED` returns the existing row with 200 |

Delegates to E12-01 (#49)'s `recordResponse`; `notificationId` → `sentInteractionId` via `parseSentInteractionId(notification.link)` (E12-02 (#54)'s `parseCoachingLink`). OpenAPI tag `Coaching Notifications`.

**UI (frontend-dev)**

- `apps/web/src/services/api.ts`: `recordNotificationInteraction(body)`, `getNotificationPolicy()`, `updateNotificationPolicy(patch)`. `types/index.ts`: `NotificationAction`, `NotificationInteractionKind`, `NotificationPolicy`.
- `apps/web/src/utils/notificationLinks.ts` (new, pure): `parseSentInteractionId(link)` (the `n` param), `stripAttributionParams(searchParams)`.
- `components/navigation/NotificationBell.tsx`: below the body of each row render `notification.actions` (E12-02 (#54)) as a `Stack` of small `Button`s (`variant="outlined"` for the first, `text` for the rest; `aria-label="<label> — <title>"`); a button click stops propagation, calls `markRead` (existing), posts `{ notificationId, kind: 'ACTIONED', action }`, closes the popover and `navigate(action.link)`; the row click itself posts `{ notificationId, kind: 'OPENED' }` in addition to its existing behaviour, only for rows whose `eventKey` starts with `coach.` (foundation events are not tracked). At `< sm` the buttons wrap onto their own row; at `≥ sm` they sit inline under the body — layout only, no gate.
- `pages/TodayPage.tsx` (E05-04 (#46)) deep-link handler: extend the `action` switch with
  - `in` → `transitionCommitment(id, { status: 'READY' })` (E08-04 (#50)'s function; E02-04 (#47) endpoint) → snackbar "You're in — Start when you're ready", row shows `Ready`;
  - `move` → alias of `reschedule` (opens `RescheduleDialog`);
  - `short` → `POST /commitments/:id/actions/fallback { version: 'short' }` (E05-02 (#40); `minimum` when no short version) then `navigate('/start/<id>')`;
  - `skip` → opens `SkipDialog`;
  - and, when `n` is present, post `{ sentInteractionId: n, kind: 'OPENED' }` on mount and `{ …, kind: 'ACTIONED', action }` once the action completes (dialog confirmed / navigation performed). `StartFlowPage` (E05-05 (#48)) reads `?n=` the same way (OPENED on mount, ACTIONED `start` when the timer begins). Params (`commitment`, `action`, `n`) are stripped after handling, as E05-04 (#46) already does. Also mount `TodayPage` at `/today` if E12-02 (#54) did not (check `App.tsx` first).
- `components/settings/CoachingPolicySection.tsx` (new): a `Card` titled **Coaching reminders** with `TextField type="time"` × 2 (Quiet hours start/end, with a "Clear" link), three `Slider`s with value labels (Daily cap 0–10, Weekly cap 0–50, Per-commitment max 0–5), a read-only line "Fatigue mode: on — daily cap temporarily 2" when `fatigue.active`, and helper copy "Quiet hours use your profile timezone (<tz>)". Saves through `updateNotificationPolicy` with a debounce of 600 ms for sliders and on blur for times; success/failure snackbars via the page's existing pattern. Props: `{ policy, onChange, isSaving }`. `mutedCategories` has **no control here** — muting is the matrix above (one control per question); the field stays API-only.
- `pages/UserNotificationsPage.tsx`: render `<CoachingPolicySection>` under `<NotificationSettings>` using a new `hooks/useNotificationPolicy.ts` (`{ policy, isLoading, error, update, isSaving }`). No registry change (`config/userSettingsSections.tsx` already has the card); no tab.
- `contexts/NotificationContext.tsx`: incoming SSE rows carry `actions`; nothing else changes.
- a11y: buttons have visible labels and `aria-label` with the title; the sliders have `aria-valuetext` ("4 per day"); the time fields have labels; the section is a `region` with `aria-labelledby`.

**Tests (testing-dev)**

- API: `notification-interactions.controller` integration in `apps/api/test/coaching-notifications/notification-interactions.integration.spec.ts`: OPENED by `notificationId` resolves the SENT row from the link; ACTIONED without `action` → 400; foreign id → 404; duplicate OPENED → 200 same id; `DISMISSED` by `sentInteractionId`.
- Web: `__tests__/components/navigation/NotificationBell.test.tsx` (extend): coaching row renders three buttons; clicking `Move` posts `{ notificationId, kind: 'ACTIONED', action: 'move' }` and navigates to `/today?commitment=…&action=move&n=…`; row click posts OPENED for `coach.*` only; `security.role_changed` row has no buttons. `__tests__/pages/TodayPage.test.tsx` (extend): `?commitment=<id>&action=in&n=<uuid>` → transition to READY, OPENED then ACTIONED posted, params stripped; `action=short` → fallback POST then `/start/<id>`; `action=move` opens the reschedule dialog; `action=skip` opens the skip dialog; unknown `action` → snackbar and no POST. `__tests__/pages/StartFlowPage.test.tsx` (extend): `?n=` → OPENED on mount, ACTIONED `start` on Begin. `__tests__/components/settings/CoachingPolicySection.test.tsx`: renders defaults; changing the daily slider debounces one PATCH `{ dailyCap: 3 }`; setting both times PATCHes `{ quietHours: {start, end} }`; Clear PATCHes `{ quietHours: null }`; fatigue line visible when active; axe. `__tests__/pages/UserNotificationsPage.test.tsx` (extend): section rendered under the matrix, page still one `UserSettingsSection` with no tabs. `__tests__/utils/notificationLinks.test.ts`. MSW handlers for the three routes.

**Docs (docs-dev)** — `docs/API.md` (`POST /notifications/interactions`), `CLAUDE.md` endpoints list, `docs/specs/coaching-notifications.md` "Actions and attribution" section (the `n` parameter contract, which surface posts which kind), `docs/specs/today-and-nba.md` deep-link table (add `in`, `move`, `short`, `skip`, `n`).

#### Acceptance criteria

- [ ] A coaching notification in the bell shows its action buttons; clicking `Start` records `OPENED` (row) and `ACTIONED start` and lands on `/start/<id>`; clicking `Move` opens the reschedule dialog on Today for that commitment.
- [ ] `/today?commitment=<id>&action=in&n=<sentId>` marks the commitment `READY`, records the interactions and strips the params; `action=short` selects the short version and opens the Start flow.
- [ ] Foundation notifications (`security.role_changed`) render no buttons and record no interactions.
- [ ] `/settings/notifications` shows the **Coaching reminders** section below the matrix; saving quiet hours `22:00–07:00` is reflected by `GET /api/me/notification-policy` and by the next job run (`QUIET_HOURS`).
- [ ] The page has no tabs; no new card was added to `USER_SETTINGS_SECTIONS`.
- [ ] Below 600px the buttons wrap and the sliders stack; above, inline — with no change to the five coupled gates.
- [ ] axe reports no violations on the bell popover and the settings page.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: a failed interaction POST never blocks navigation (fire-and-forget with a console warn); policy save failures show a snackbar and revert the control
- [ ] Observability: none new client-side; API logs nothing per interaction
- [ ] Security: interactions are attributed only to the caller's own SENT rows; deep-link ids are UUIDs; links validated by `isInternalLink` before navigation
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`)
- [ ] Docs updated

#### Manual test script

1. Epic script steps 5–6 (buttons in the bell; Start → `/start/<id>`; OPENED + ACTIONED rows), 8 (quiet hours from the UI), 11 (`I'm in` → `Ready`), 17 (responsive).
2. Open http://localhost:3535/today?commitment=<id>&action=short&n=<sentId> → `/start/<id>` shows the short version title; `select version_used from commitments where id = …` → `SHORT`.

#### Out of scope

- The push action handlers (E12-04 (#64)'s worker); metrics UI (E12-06 (#69) / E11-04 (#117)); auto-suggesting quiet hours.

#### Notes for the implementing agent

- Reuse E05-04 (#46)'s dialogs and E08-04 (#50)'s `transitionCommitment`; do not add new commitment endpoints.
- `NotificationBell` rows are `ListItemButton`s; nested buttons need `component="div"` on the row or `onMouseDown` propagation stopped so a11y trees stay valid — test with axe.
- `UserSettingsSection`'s render prop provides `save` for `user_settings`; the policy is **not** in `user_settings` (it lives on `user_profiles` via E12-01 (#49)'s endpoint), so the section has its own hook and snackbars.
- Settings UI rules: registry card exists, `SettingsHub` untouched, no tabs; the section is content inside one destination.
- Fastify, Zod DTOs, no class-validator on the API side.

---

### E12-06 `feat(api): add notification learning metrics and the independence metric` — #69

**Part of epic:** E12 · **Blocked by:** E12-01 (#49), E12-03 (#59), E11-01 (#98) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement

PRD §64: the system should learn which messages the user acts on, which timing works, which categories are ignored, and whether reminders are becoming unnecessary; PRD §65 defines the independence metric ("percentage of commitments completed before any reminder is required") and requires notification volume to decline as behaviour stabilises; VISION §38 wants the product to celebrate "You needed nine workout reminders in your first month. This month you needed two." E11-01 (#98)'s `GET /progress` reserves `independence.ratio` but has no source for it; `notification_interactions` (E12-01 (#49)) now holds every fact needed.

#### Proposed solution

A pure aggregator over interaction and completion rows, a `GET /notifications/metrics` endpoint, and an exported `independence()` E11-01 (#98)'s progress service calls.

**Data (database-dev)** — n/a (reads `notification_interactions`, `commitments`).

**API (backend-dev)**

Files under `apps/api/src/coaching-notifications/metrics/` (new): `notification-metrics.ts` (pure), `notification-metrics.service.ts`, `notification-metrics.controller.ts`, `dto/notification-metrics.dto.ts`. Module exports `NotificationMetricsService`; E11's progress module imports `CoachingNotificationsModule` and replaces its `independence` stub with `metrics.independence(userId, { days: 28 })`.

Pure contract:

```ts
export interface InteractionRow { id; eventKey; kind; commitmentId; sentInteractionId; action; suppressReason; createdAt; meta: { leadMinutes?; category? } | null }
export interface CompletionRow { commitmentId; domain; completedAt: Date }
export function aggregateNotificationMetrics(input: { interactions: InteractionRow[]; completions: CompletionRow[]; timeZone: string; window: { from: Date; to: Date } }): NotificationMetrics
```

`NotificationMetrics`:
- `window: { from, to, days }`
- `perEvent: [{ eventKey, category, sent, opened, actioned, dismissed, ignored, suppressed: Record<NotificationSuppressReason, number>, actionRate: number | null, bestLeadMinutes: number | null }]` — one entry per coaching event in registry order; `ignored = sent − opened − actioned − dismissed` (never negative); `actionRate = actioned / sent` (null when `sent = 0`); `bestLeadMinutes` = the `meta.leadMinutes` bucket (5, 10, 20, 30) with the highest action rate among buckets with ≥ 3 sends, else null (PRD §64's example insight).
- `independence: { completions, unprompted, ratio }` — `completions` = completion rows in the window; `unprompted` = those with no `SENT` interaction for the same `commitmentId` with `createdAt < completedAt`; `ratio = unprompted / completions` (null when 0 completions). This is the value E11-01 (#98) exposes as `independence.ratio`.
- `reminderTrend: [{ month: 'YYYY-MM', domain, sent, completions }]` — per calendar month in the user's timezone, over the window, for domains with any data; sorted by month.
- `insights: string[]` — deterministic sentences, at most three: reminder-count trend when two consecutive months exist and the newer has fewer sends for a domain with ≥ 1 completion each month ("You needed 9 Health reminders in August. In September you needed 2."); best lead time when `bestLeadMinutes` exists for N1 ("Reminders 20 minutes before a workout lead to the most starts."); a most-ignored category when any event has `sent ≥ 5` and `actionRate ≤ 0.1` ("Fallback offers are mostly ignored — you can mute them in Notifications."). Never a judgement of the person; template-only, tested against `banned-phrases.ts`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/notifications/metrics` | `@Auth()` | `?days=7..180` (default 30) | 200 `NotificationMetrics` |

`NotificationMetricsService.get(userId, { days, now })` loads the rows for `[now − days, now]` (interactions by `createdAt`, completions by `completedAt` with `status ∈ {COMPLETED, PARTIALLY_COMPLETED}`) and calls the pure function; `independence(userId, { days })` returns only that slice. No caching; both queries hit the E12-01 (#49) indexes.

**UI (frontend-dev)** — n/a here: E11-04 (#117)'s Progress "Coach dependency" card renders `GET /progress.independence`; a follow-up in E11-04 (#117)'s scope may render `insights[]` — noted there, not built here.

**Tests (testing-dev)**

- `metrics/notification-metrics.spec.ts` (pure, fixtures): `perEvent` counts from a mixed fixture; `ignored` floor at 0; `actionRate` null on zero sends; `bestLeadMinutes` picks the bucket with ≥ 3 sends only; independence — completion with an earlier SENT counts as prompted, with a later SENT as unprompted, with none as unprompted; ratio null at zero completions; `reminderTrend` months computed in `America/Costa_Rica` (a completion at 05:30Z on the 1st belongs to the previous month); insights: the three sentences appear under the right conditions and none contain a banned phrase; empty input → empty perEvent counts, `independence.ratio null`, `insights []`.
- `apps/api/test/coaching-notifications/notification-metrics.integration.spec.ts`: seed via E12-01 (#49)'s service (SENT/ACTIONED/SUPPRESSED rows) and two commitments (one completed after a SENT, one with none) → `GET /api/notifications/metrics?days=30` → `independence { completions: 2, unprompted: 1, ratio: 0.5 }`, `perEvent[N1].suppressed.QUIET_HOURS === 1`; `days=999` → 400; another user's rows never appear.
- E11's `progress.integration.spec.ts` (extend): `independence.ratio` equals the metrics endpoint's value for the same window.

**Docs (docs-dev)** — `docs/API.md` (route + example), `docs/specs/coaching-notifications.md` "Learning metrics" (definitions, buckets, the independence formula and its window), `CLAUDE.md` endpoints list; a line in `docs/specs/progress-and-momentum.md` (E11-06 (#121)'s spec) pointing at the formula's home.

#### Acceptance criteria

- [ ] `GET /api/notifications/metrics` returns per-event `sent/opened/actioned/dismissed/ignored/suppressed{reason}` for the nine events, in registry order, for the requested window.
- [ ] `independence.ratio` equals unprompted completions ÷ completions, where "unprompted" means no `SENT` interaction for that commitment before `completedAt`.
- [ ] `bestLeadMinutes` reports the lead bucket with the highest action rate and at least three sends, else `null`.
- [ ] `reminderTrend` groups by calendar month in the user's timezone and `insights` contains the VISION §38 sentence when a domain's reminders dropped month over month.
- [ ] `GET /api/progress` (E11-01) shows the same `independence.ratio` as the metrics endpoint.
- [ ] The aggregator is pure and every rule above has a unit case.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: `days` outside 7–180 → 400; empty data is a normal response, not an error
- [ ] Observability: none new (two indexed queries)
- [ ] Security: `@Auth()`, own rows only
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`)
- [ ] Docs updated

#### Manual test script

1. Epic script step 13 (`curl …/api/notifications/metrics?days=30 | jq`; Progress card shows the ratio).
2. Complete a commitment that never received a reminder; re-run → `unprompted` increments and `ratio` rises.

#### Out of scope

- Acting on the metrics (auto-adjusting lead times or caps); charts (E11-04 (#117) owns Progress visuals); export.

#### Notes for the implementing agent

- Keep the aggregator free of Prisma types: map rows to `InteractionRow`/`CompletionRow` in the service.
- Month bucketing: use `Intl.DateTimeFormat` with `timeZone` and `{ year: 'numeric', month: '2-digit' }`, as `local-date.ts` does; no date library.
- E11-01 (#98)'s progress service is the consumer of `independence()`; change its stub in the same PR and leave its response shape untouched.

---

### E12-07 `test(tests): E12 end-to-end verification` — #75

**Part of epic:** E12 · **Blocked by:** E12-01 (#49), E12-02 (#54), E12-03 (#59), E12-04 (#64), E12-05 (#68), E12-06 (#69), E01-10 (#30) · **Component:** tests, docs · **Priority:** P0 · **Agents:** testing-dev → docs-dev

#### Problem statement

PRD §108's acceptance list — quiet hours respected, action deep link works, move/skip from the notification, ignored notifications tracked, no uncontrolled repeats per commitment, comeback copy without shame — is only proven when a browser drives a seeded commitment through the scheduler, the inbox, the deep link and the Start flow against the real API and database with the fake OpenAI server (E01-10 (#30)) writing the copy. The epic also needs the spec document that fixes the decision order, candidate rules, link contract and metrics for anyone touching notifications later.

#### Proposed solution

A Playwright spec `tests/e2e/specs/notifications.spec.ts` driven by `POST /api/auth/test/run-job` with a simulated clock, the `docs/specs/coaching-notifications.md` document, and the API.md / CLAUDE.md / TESTING.md / epics README updates.

**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (gaps found while seeding are filed against the owning child, not patched here).

**UI (frontend-dev)** — stable `data-testid`s only where role/text selectors are ambiguous: `notification-bell`, `notification-row-<eventKey>`, `notification-action-<action>`, `policy-quiet-start`, `policy-quiet-end`, `policy-daily-cap`, `policy-save-state`.

**Tests (testing-dev)**

- `tests/e2e/helpers/notifications.helper.ts` (new): `runCoachingJob(ctx, now?)` → `POST /api/auth/test/run-job`, `listNotifications(ctx)`, `getMetrics(ctx, days)`, `setPolicy(ctx, patch)`; reuses E05-07 (#55)'s `tests/e2e/helpers/commitments.helper.ts` (`apiContext`, `createOutcome`, `createCommitment`, `getCommitment`, `todayAt`) and `auth.helper.ts` (`loginAsTestUser` with `withAiKey`, `withOnboarding`, unique email per test).
- `tests/e2e/specs/notifications.spec.ts` (stack: `docker compose -f base.compose.yml -f dev.compose.yml -f fake-openai.compose.yml up`):
  1. **N1 → Start → ACTIONED**: seed a HEALTH commitment at `now + 20 min`; `runCoachingJob` → `{ sent: 1 }`; open `/`; click `notification-bell`; expect a row `notification-row-coach.commitment_upcoming` whose title contains the commitment title or the fake server's copy, with buttons `Start workout`, `Move`, `Skip today`; click `Start workout` → URL matches `/start/<id>` and contains no `n=` after handling; `Begin` → `Done for now` → `Complete`; `GET /api/notifications/metrics?days=1` → `perEvent[N1].sent 1, opened ≥ 1, actioned 1`; `getCommitment(id).status === 'COMPLETED'`.
  2. **No repeat, ALREADY_DONE**: `runCoachingJob` again → `sent: 0`; metrics `suppressed.ALREADY_DONE ≥ 0` and inbox count unchanged (the N2 candidate for the completed row is suppressed as `ALREADY_DONE` when run with `now = scheduledStart`).
  3. **Quiet hours from the UI**: `/settings/notifications` → set `policy-quiet-start` `00:00`, `policy-quiet-end` `23:59` → `policy-save-state` reads "Saved"; seed a commitment at `now + 20 min`; `runCoachingJob` → `suppressed: 1`; `getMetrics(1).perEvent[N1].suppressed.QUIET_HOURS === 1`; clear quiet hours.
  4. **Skip → no repeat**: seed at `now + 20 min`; run → N1 sent; in the bell click `Skip today` → Today's skip dialog → reason "Bad timing" → confirm; run with `now = scheduledStart` → `sent: 0`, `suppressed.SKIPPED === 1`; the inbox has exactly one coaching row for the commitment.
  5. **Per-commitment max**: policy `perCommitmentMax: 1`; seed at `now + 20 min`; run (N1 sent); run at `now = scheduledStart` → N2 suppressed `PER_COMMITMENT_MAX`; restore the default.
  6. **Fallback offer → short version**: seed a commitment with `scheduledStart = now − 10 min`, `scheduledEnd = now + 25 min`, full 38 / short 20 / minimum 10; run → row `coach.fallback_offer` with `Use short version`; click → `/start/<id>`; `getCommitment(id).versionUsed === 'SHORT'`.
  7. **Family presence → I'm in**: create a ritual through E08-02 (#41)'s API for today at `now + 15 min`; run → row `coach.family_presence` with `I'm in`; click → Today shows the row as `Ready`; `getCommitment(id).status === 'READY'`.
  8. **Comeback copy without shame**: use E11-06 (#121)'s idle-days helper to make the detector offer a comeback; run → row `coach.recovery` linking to `/comeback`; assert the title and body match none of the regexes exported by `apps/api/src/coaching-notifications/copy/banned-phrases.ts` (import the list into the spec).
  9. **AI down keeps notifications working**: point the admin's platform `baseUrl` at `http://fake-openai:1/v1` (E05-07 (#55)'s pattern) → seed → run → row present with the default title "… starts in 20 minutes"; restore in `afterEach`.
  10. **Independence**: complete a commitment that never received a reminder (seed at `now + 3 h`, complete via API) → `getMetrics(1).independence` → `{ completions: ≥ 1, unprompted: ≥ 1 }` and `/progress` shows the Coach dependency card with a percentage.
  11. **Push subscription API** (no browser push in the dev stack — the Vite dev server registers no worker): `POST /api/notifications/push-subscriptions` with a fake https endpoint → 201; `GET` lists `endpointHost`; `DELETE` → 204. The worker itself is covered by Vitest and the manual production-build check (epic step 14).
- Timing: every assertion on the inbox uses `expect.poll`/`toPass`; the job is always invoked explicitly (never wait for the cron).
- `tests/e2e/package.json`: add `test:notifications` filter if useful.

**Docs (docs-dev)**

- `docs/specs/coaching-notifications.md` (new): purpose and VISION §34–§38 framing; data model (`notification_interactions`, `push_subscriptions`, `notificationPolicy`, defaults); the nine events table with category, channels, payload, default copy, primary link and actions; the **decision order** with each reason's definition, the quiet-hours algorithm, the local day/week windows, the fatigue rule; the **candidate rules** table with windows and dedupe keys; the copy pipeline (persona, prompt version, schema, banned phrases, fallback) and the rule that the LLM never decides sending (PRD §14.7); the **link and attribution contract** (`/today?commitment&action&n`, `/start/:id?n`, which surface records which kind); push (VAPID, payload shape, 410 handling, the public dismissal capability route and its throttle, the native-toast dedupe); metrics definitions and the independence formula; the `run-job` test hook; what E11 reads from here; rejected alternatives (a job queue, AI-decided sending, storing payloads on inbox rows, per-channel mute for coaching events, a `/notifications` page of its own); back-link to `docs/epics/E12-coaching-notifications.md`.
- `docs/API.md`: "Coaching Notifications" section — `/me/notification-policy` (2), `/notifications/interactions` (1) + `/dismissed` (1), `/notifications/push/public-key`, `/notifications/push-subscriptions` (3), `/notifications/metrics` (1), `run-job` under Test Authentication; `GET /notifications` example with `actions`.
- `CLAUDE.md`: endpoints list; "Adding a Notification" gains the coaching-event addendum (payload schema + actions + the rule that `coach.*` events are emitted only by the scheduler through `decide()`); Environment Variables (`WEB_PUSH_*`, `COACHING_NOTIFICATIONS_ENABLED`); Database Tables; a "Coaching notifications" pointer paragraph to the spec (no rules restated).
- `docs/TESTING.md`: E2E section lists `notifications.spec.ts`, the `run-job` hook and the `now` override; note that push is verified on the production build.
- `docs/epics/README.md`: E12 row links to this file and to `docs/specs/coaching-notifications.md`.

#### Acceptance criteria

- [ ] `tests/e2e/specs/notifications.spec.ts` passes against the compose stack with `fake-openai.compose.yml` on a clean database.
- [ ] Case 1 proves the reminder → deep link → Start → completion path records `SENT`, `OPENED`, `ACTIONED`.
- [ ] Cases 3, 4 and 5 prove `QUIET_HOURS`, `SKIPPED` and `PER_COMMITMENT_MAX` through the public API and the UI.
- [ ] Case 8 proves the comeback notification contains no banned phrase; case 9 proves notifications go out with the AI unreachable.
- [ ] Case 10 proves the independence metric counts an unprompted completion and Progress renders it.
- [ ] `docs/specs/coaching-notifications.md` exists and documents every decision reason, candidate rule, link parameter and metric named in E12-01…E12-06; `docs/API.md` covers all 11 routes; `docs/epics/README.md` links both.
- [ ] `npm test` (`apps/api`) and `npm run test:run` (`apps/web`) are green on the epic branch.

#### Definition of done

- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: `afterEach` restores AI settings and policy; unique users per test
- [ ] Observability: Playwright trace on first retry (existing config)
- [ ] Security: no real OpenAI key or VAPID private key in the repo; fake endpoints only
- [ ] Config & secrets: `WEB_PUSH_*` documented (E12-04); the e2e runs without them
- [ ] Tests listed above pass locally (e2e in `tests/e2e`)
- [ ] Docs updated (spec, API.md, CLAUDE.md, TESTING.md, epics README)

#### Manual test script

1. `cd tests/e2e && npx playwright test specs/notifications.spec.ts` with the stack from the epic script step 2 running → 11 passed.
2. Open `docs/specs/coaching-notifications.md` and cross-check the decision order against `apps/api/src/coaching-notifications/policy/notification-policy.ts` and the candidate windows against `candidates/candidate-scanner.service.ts` (names and numbers must match).
3. Run the epic-level manual verification steps 1–17 once end to end (step 14 on the production build).

#### Out of scope

- Browser-level push in CI (no worker in the dev stack; production-build check is manual).
- Visual-regression baselines for the bell popover (E12-05 (#68) owns them if any).
- CI workflow files (declined project-wide; local runs only).

#### Notes for the implementing agent

- Reuse `auth.helper.ts`, `commitments.helper.ts` (E05-07 (#55)) and E11-06 (#121)'s time helper; do not create parallel helpers.
- Seed through the API, never `psql`, so the spec also exercises the create contracts.
- The fake OpenAI server returns whatever its `/v1/responses` stub yields for the `notification_copy` schema — assert on buttons, links and interaction rows, not on exact AI wording; assert exact wording only in case 9 (template path).
- The spec is the last child: a failure caused by an earlier child is fixed under that child's issue and referenced in the commit.

---
