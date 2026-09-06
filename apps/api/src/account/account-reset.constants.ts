// =============================================================================
// Self-service account data reset — shared constants (issue #221, epic #220)
// =============================================================================
//
// Two things live here, and both are shared between `AccountResetService` and
// its spec for the same reason `notification-events.ts` is a single array that
// both the dispatcher and the preferences page read: a list duplicated between
// an implementation and its test is a list that can drift, and a test asserting
// "the service deletes these tables" against a SECOND, independently typed copy
// of the same thirty-one strings would only ever catch itself disagreeing with
// itself, never a real omission.
// =============================================================================

/**
 * The two destructive scopes this feature offers, and the exact phrase a caller
 * must type back to invoke each one.
 *
 * ---------------------------------------------------------------------------
 * WHY A TYPED PHRASE, NOT A CHECKBOX
 * ---------------------------------------------------------------------------
 *
 * A checkbox ("I understand this cannot be undone") records that a click
 * happened, not that the person read what they were clicking. Both scopes here
 * are irreversible and total — there is no restore button anywhere in this
 * codebase for a user's own history — so the confirmation step is the ONLY
 * thing standing between an idle click and every outcome, plan, commitment,
 * evidence row and coach conversation the person has built. Typing
 * `DELETE MY DATA` verbatim is friction with a purpose: it forces the caller to
 * actually read the word "DELETE" immediately before it happens.
 *
 * `data_and_key` gets its OWN, more severe phrase rather than reusing `data`'s
 * with a second checkbox, because the two scopes are not "the same action plus
 * an extra". Losing a stored OpenAI key is a different KIND of loss (a
 * credential the user will re-enter from OpenAI, not history that no longer
 * exists to lose) and deserves its own explicit acknowledgement rather than
 * riding along on the data phrase.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PHRASE IS VERIFIED SERVER-SIDE, NOT ONLY BY A DISABLED BUTTON
 * ---------------------------------------------------------------------------
 *
 * A web form that merely disables its submit button until the typed text
 * matches is a UI convenience, not a control — nothing stops a direct
 * `POST /api/account/reset` with a guessed or empty `confirmationPhrase` from a
 * script, a replayed request, or a client this team never wrote.
 * `AccountResetService.reset` re-checks the phrase itself, case-sensitively,
 * against THIS constant, before a single row is touched. The web's disabled
 * button and the server's check enforce the same rule for two different
 * reasons — one is UX, the other is the actual gate — and only one of them is
 * optional.
 *
 * It is also SERVED to the client (`GET /api/account/data-summary` echoes this
 * object back) rather than duplicated as a web constant, for the reason
 * `notification-events.ts` gives for its own registry: a value that a security
 * check compares against must have exactly one declaration. A hardcoded
 * `'DELETE MY DATA'` in the browser would silently disable the dialog's only
 * real gate the day either phrase changed here.
 */
export const ACCOUNT_RESET_PHRASES = {
  /** Erase everything the user has built. The stored OpenAI key is kept. */
  data: 'DELETE MY DATA',
  /** Everything `data` erases, plus the caller's own stored OpenAI key. */
  data_and_key: 'DELETE EVERYTHING',
} as const;

/** Which of the two destructive scopes a reset request names. */
export type AccountResetScope = keyof typeof ACCOUNT_RESET_PHRASES;

/** Every scope, as an array — the one source the DTO's enum is built from. */
export const ACCOUNT_RESET_SCOPES = Object.keys(
  ACCOUNT_RESET_PHRASES,
) as [AccountResetScope, ...AccountResetScope[]];

/**
 * One table this feature deletes the caller's rows from.
 *
 * `model` is the Prisma Client accessor (`prisma.<model>`), used to drive the
 * delete generically rather than as thirty-one hand-written `deleteMany` calls
 * that could silently fall out of order. `table` is the snake_case name the
 * DATABASE uses, which is what a human reads in an audit row's `meta` and in
 * `AccountDataSummaryDto` — a caller of `GET /api/account/data-summary` has no
 * reason to know Prisma's camelCase accessor names, and freezing the two apart
 * means renaming a Prisma model later does not silently rename what an old
 * audit row's `meta` keys mean.
 */
export interface AccountResetTableEntry {
  /** The Prisma Client model accessor, e.g. `'commitment'`. */
  readonly model: string;
  /** The underlying Postgres table, e.g. `'commitments'`. */
  readonly table: string;
}

/**
 * Every table `AccountResetService` deletes the caller's rows from, IN THE
 * ORDER IT DELETES THEM.
 *
 * ===========================================================================
 * THE ORDER IS NOT COSMETIC
 * ===========================================================================
 *
 * Two independent forces fix it, and they fail differently — which is why they
 * are stated separately rather than as one rule about "children first".
 *
 * ---------------------------------------------------------------------------
 * 1. `SetNull` — the silent failure
 * ---------------------------------------------------------------------------
 *
 * `Commitment` reaches EIGHT parents by `onDelete: SetNull` (`outcomeId`,
 * `planVersionId`, `routineId`, `ritualId`, `familyMemberId`,
 * `workoutTemplateId`, `workMilestoneId`, plus the self-references
 * `rescheduledFromId` and `decomposedFromId`), and `evidence_items` and
 * `reflections` reach `commitments` the same way. Every one of those exists so
 * that deleting the PARENT never deletes the EVIDENCE — PRD §109's "prior
 * misses remain evidence", stated at length in `docs/specs/domain-model.md`.
 *
 * That guarantee is exactly BACKWARDS for this feature. A reset is supposed to
 * erase the evidence, not leave orphaned, nulled-out rows behind once their
 * parents are gone. Deleting children BEFORE parents means those `SetNull`
 * triggers have nothing left to null out by the time the parent row is
 * removed: the parent-delete path they exist to protect is never exercised at
 * all on this user's data.
 *
 * Getting this wrong produces no error. It produces a user who "reset their
 * data" and still has a hundred commitments pointing at nothing.
 *
 * The specific pairs this order is holding:
 *   - `reflections` and `evidence_items` before `commitments`.
 *   - `focus_sessions` before `evidence_items` (its `evidenceId` is a `@unique`
 *     SetNull). Note `focus_sessions.commitmentId` is the one CASCADE link
 *     upward from a commitment, so this also has to precede `commitments`.
 *   - `workout_sessions` before `commitments` (`commitmentId`, `@unique`
 *     SetNull) and before `workout_programs` (its `templateId` cascades from
 *     templates, which cascade from programs).
 *   - `notification_interactions` before `commitments` and `notifications`.
 *   - `commitments` before all eight of its parents.
 *   - `weekly_plans` before `weekly_reviews` (`reviewId` SetNull).
 *   - `plan_change_proposals` before `coach_conversations` (`sourceMessageId`
 *     SetNull to `coach_messages`, which cascade from conversations) and
 *     before `plans` (`planId` Cascade).
 *   - `rituals` before `family_members` and `routines` (both SetNull).
 *   - `workout_programs` before `plans` (`planId` SetNull) and before
 *     `routines` (`workout_templates.routineId` is a `@unique` SetNull and
 *     templates cascade from programs).
 *
 * ---------------------------------------------------------------------------
 * 2. `Restrict` — the loud failure
 * ---------------------------------------------------------------------------
 *
 * The caller's custom `exercises` rows are `Restrict`-referenced by
 * `workout_template_exercises.exerciseId` and `set_logs.exerciseId`, so they
 * can only be deleted AFTER `workout_programs` (which cascades templates and
 * their exercises) and `workout_sessions` (which cascades set logs). Deleting
 * them earlier raises a foreign-key error and rolls the whole transaction
 * back.
 *
 * `exercises` is deliberately NOT in the list below — it is the one table whose
 * ownership column is `createdByUserId` rather than `userId`, and whose catalog
 * rows belong to nobody, so it cannot ride the generic delegate loop. See
 * `AccountResetService.reset`, which runs it as its own statement in the
 * position marked below.
 *
 * ---------------------------------------------------------------------------
 * `user_profiles` and `user_settings` are last, deliberately
 * ---------------------------------------------------------------------------
 *
 * Both are lazily recreated at their defaults the next time they are read
 * (`UserProfileService.getOrCreate`; the user-settings service's own read
 * path), so deleting the row IS the reset for each — nothing here writes a
 * fresh default row back, and nothing else in the transaction depends on
 * either existing mid-transaction. `user_profiles.comebackCommitmentId` is a
 * SetNull to `commitments`, so this row takes one harmless nulling update
 * earlier in the transaction before being deleted here.
 *
 * ---------------------------------------------------------------------------
 * Tables that CASCADE, and therefore get no entry
 * ---------------------------------------------------------------------------
 *
 * Their absence is not an omission — each dies with a parent already listed:
 * `coach_messages` from `coach_conversations`; `workout_templates` and
 * `workout_template_exercises` from `workout_programs`; `set_logs` from
 * `workout_sessions`; `storage_object_chunks` and `media_attachments` from
 * `storage_objects` (which is swept OUTSIDE the transaction entirely — see
 * `AccountResetService.reset` step 2).
 */
export const ACCOUNT_RESET_TABLES: readonly AccountResetTableEntry[] = [
  // --- Children that point at commitments, and at each other ---------------
  { model: 'notificationInteraction', table: 'notification_interactions' },
  { model: 'focusSession', table: 'focus_sessions' },
  { model: 'workoutSession', table: 'workout_sessions' },
  { model: 'reflection', table: 'reflections' },
  { model: 'evidence', table: 'evidence_items' },
  { model: 'commitment', table: 'commitments' },

  // --- Standalone per-user records, in no particular order ------------------
  { model: 'dailyCheckIn', table: 'daily_check_ins' },
  { model: 'bodyWeightLog', table: 'body_weight_logs' },
  { model: 'milestone', table: 'milestones' },

  // --- The weekly loop: plans reference reviews ----------------------------
  { model: 'weeklyPlan', table: 'weekly_plans' },
  { model: 'weeklyReview', table: 'weekly_reviews' },

  // --- Programs before plans and routines ----------------------------------
  { model: 'workoutProgram', table: 'workout_programs' },

  // --- Family: rituals reference members and routines -----------------------
  { model: 'ritual', table: 'rituals' },
  { model: 'familyMember', table: 'family_members' },

  // --- Coach: proposals reference messages and plan versions ----------------
  { model: 'planChangeProposal', table: 'plan_change_proposals' },
  { model: 'coachConversation', table: 'coach_conversations' },
  { model: 'memoryInsight', table: 'memory_insights' },
  { model: 'obstacle', table: 'obstacles' },

  // --- Work: both cascade from outcomes, listed for their own counts --------
  { model: 'workSessionPlanProposal', table: 'work_session_plan_proposals' },
  { model: 'workMilestone', table: 'work_milestones' },

  // --- The PRD §9 hierarchy, bottom up -------------------------------------
  { model: 'routine', table: 'routines' },
  { model: 'planVersion', table: 'plan_versions' },
  { model: 'plan', table: 'plans' },
  { model: 'outcome', table: 'outcomes' },

  // >>> Custom `exercises` are deleted HERE, by `AccountResetService.reset`'s
  // >>> own statement rather than an entry in this list. See the `Restrict`
  // >>> section above for why it cannot move earlier, and that method for why
  // >>> it cannot ride the generic loop.

  { model: 'domainMode', table: 'domain_modes' },
  { model: 'bestSelfProfile', table: 'best_self_profiles' },
  { model: 'notification', table: 'notifications' },

  // --- Credentials the user minted, which a reset must not leave live ------
  { model: 'personalAccessToken', table: 'personal_access_tokens' },
  { model: 'deviceCode', table: 'device_codes' },

  // --- Lazily recreated at their defaults on the next read ------------------
  { model: 'userProfile', table: 'user_profiles' },
  { model: 'userSettings', table: 'user_settings' },
];

/**
 * The `exercises` key both the summary and the result carry, alongside — but
 * never inside — `ACCOUNT_RESET_TABLES`. See that constant's `Restrict`
 * section.
 */
export const CUSTOM_EXERCISES_TABLE = 'exercises';

/**
 * The two storage keys both the summary and the result carry, counted and
 * deleted through `ObjectsService` rather than a Prisma delegate. See
 * `AccountResetService.reset` step 2.
 */
export const STORAGE_OBJECTS_TABLE = 'storage_objects';
export const MEDIA_ATTACHMENTS_TABLE = 'media_attachments';
