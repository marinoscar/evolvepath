// =============================================================================
// Notification event registry (issue #121, epic #109)
// =============================================================================
//
// ONE declaration, three consumers — the same argument
// `apps/web/src/config/adminSections.tsx` and `apps/web/src/config/
// destinations.ts` each make on their own axis, applied to notifications.
//
// Epic #109's premise is that adding a notification later costs ONE registry
// entry, exactly as adding a settings page now costs one card (epic #90).
// That promise only holds while there is a single answer to "what events
// exist, which channels can carry them, and what happens when the user has
// said nothing". The consumers are:
//
//   1. the dispatcher (#125)            — what to send, over what, to whom
//   2. the preferences page (#126)      — the event x channel matrix
//   3. the docs / admin surfaces        — what this app can even tell you
//
// Without one list, the preferences page has its own and the dispatcher has
// its own, and they drift: a toggle for an event nothing dispatches, or an
// event that dispatches with no toggle. That is precisely the failure
// `destinations.ts` describes ("three gates, three answers") one axis over.
//
// -----------------------------------------------------------------------------
// WHERE THIS LIVES, AND WHY IT IS HERE RATHER THAN SHARED OR DUPLICATED
// -----------------------------------------------------------------------------
//
// The API dispatches and the web renders, so both need this. Three options
// were on the table; this file is option 1.
//
// 1. **CHOSEN — the API owns it; the web reads it over an endpoint.**
//    There is exactly one declaration in the repository, so there is nothing
//    to drift. The web does not get a copy to keep in sync; it gets the
//    server's answer. That matters more here than for `adminSections.tsx`,
//    which mirrors permission strings by convention (see CLAUDE.md's Settings
//    UI Pattern, rule 3) and accepts the mirroring cost: `mandatory` below is
//    a SECURITY gate, not a label, and a second copy of a security gate is a
//    second place for it to be wrong. The endpoint itself is deliberately NOT
//    in this issue — #125/#126 add it when they have a consumer for it, and
//    #121 ships the declaration those read.
//
// 2. **REJECTED — duplicate in `apps/web`, with a test asserting the two
//    agree.** A test converts silent drift into loud drift, which is better
//    than nothing, but it is detection rather than prevention: the copies can
//    still disagree in a working tree, in a branch, and in any build where the
//    test is not run. It also breaks the epic's headline promise directly —
//    adding a notification would cost TWO registry entries and a green test,
//    not one entry.
//
// 3. **REJECTED — a shared package both apps import.** The honest structural
//    answer, and the wrong trade today. This repo has no `packages/` workspace
//    (`package.json` declares `workspaces: ["apps/*"]`) and no cross-app import
//    anywhere. The two apps do not agree on module resolution — the API is
//    `NodeNext` compiled by Nest out of `src/`, the web is `bundler` under
//    Vite — so a shared location means a new workspace, a path alias in both
//    tsconfigs, a Vite alias, and a Nest `rootDir` change that moves `dist/`
//    and therefore edits `apps/api/Dockerfile`. That is a real and reviewable
//    architectural change, and it should be made when there is a body of
//    shared contract to justify it, not smuggled in under one 100-line file.
//    If that package ever lands, this file moves into it unchanged: nothing
//    below imports from Nest, Prisma, or anything Node-only, precisely so
//    that move stays a `git mv`.
//
//    UPDATE (epic #161): that package now exists — `packages/shared`,
//    published to the workspace as `@app/shared` — and it landed exactly as
//    the paragraph above asks: as its own filed, reviewed change rather than
//    as a side effect of a feature. Two things it says are now out of date:
//    `workspaces` reads `["apps/*", "packages/*"]`, and there IS a cross-app
//    import. The rest still holds, and **this registry deliberately did not
//    move**. `@app/shared` carries rebrandable CONSTANTS — today a single
//    display-name string that all three apps render — and it is plain
//    CommonJS with a hand-written `.d.ts` and no build step, which is what
//    lets it satisfy Nest's `rootDir`, ts-jest's transform rules and Vite at
//    once. A 100-line registry of security-relevant contract is a different
//    kind of thing on both counts, and option 1 above still beats a shared
//    copy for it: the web gets the server's answer, not a second declaration
//    that a build could skew. Moving it remains available, and remains a
//    call for whoever has a reason to make it.
//
// This file is intentionally NOT a Nest provider. It is pure data and pure
// functions, so tests, the future endpoint, and a shared package later can all
// consume it without standing up DI for a constant.
// =============================================================================

/**
 * Every channel the framework knows about, as a value.
 *
 * The type is DERIVED from this array rather than declared alongside it, so
 * the two cannot disagree — adding `'push'` here (which epic #109 explicitly
 * reserves, and #127 adds `'browser'` for) widens the type in the same edit,
 * and every `switch` over a channel that lacks the new arm fails typecheck
 * instead of silently dropping deliveries.
 *
 * CHANNEL IS AN ENUM FROM THE START, even though #122 delivers only email.
 * Preferences are persisted per event AND per channel from day one. Storing a
 * bare boolean now and growing a channel axis later is a data migration over
 * live user preferences, which is the one shape of change this registry
 * exists to avoid.
 */
export const NOTIFICATION_CHANNELS = ['email', 'browser', 'push'] as const;

/** A delivery channel. See {@link NOTIFICATION_CHANNELS}. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * One notification event, fully described for every surface that dispatches,
 * renders, or documents it.
 */
export interface NotificationEventDef {
  /**
   * Stable key, persisted in user preferences and in delivery records.
   *
   * RENAMING ONE IS A MIGRATION, not a refactor: a stored preference keyed by
   * the old string becomes unreachable, and — under the epic's sparse
   * absent-key contract, where absent means enabled — a user who deliberately
   * muted an event would silently start receiving it again under its new name.
   * Add a new key and migrate the rows; never edit a key in place.
   */
  key: string;

  /** Short human label, shown as the row heading on the preferences page. */
  label: string;

  /**
   * One sentence on what actually triggers this, in the user's terms. This is
   * the only place the answer to "why did I get this?" is written down.
   */
  description: string;

  /**
   * Channels this event CAN be delivered over — a capability of the event,
   * not a statement about which transports are implemented yet.
   *
   * Deliberately per-event and meaningful: `allowlist.invitation` lists email
   * only because its recipient has no account and no open tab by definition,
   * so a browser notification is not merely unimplemented, it is impossible.
   * The dispatcher intersects this with the user's preferences and with the
   * transports actually registered, so declaring a channel before its
   * implementation lands is safe — it simply has nowhere to go until then.
   *
   * Must be non-empty: an event with no channels can never be delivered, which
   * is a declaration bug rather than a configuration.
   */
  channels: NotificationChannel[];

  /**
   * Default when a user has expressed no preference.
   *
   * Reads together with the epic's sparse absent-key contract: no preference
   * row is materialised until a user deliberately changes something, so this
   * is what an untouched account gets.
   */
  defaultEnabled: boolean;

  /**
   * The user may NOT opt out — on ANY channel this event declares.
   *
   * For security-relevant events where silence is itself the risk: a role
   * change, a new sign-in from an unknown device. #125 enforces this
   * SERVER-SIDE, in preference resolution, and not only in the preferences UI
   * — otherwise a crafted PATCH silences the exact alert the UI refuses to
   * hide, which is the whole attack this flag exists to close.
   *
   * ALL-OR-NOTHING, BY DESIGN: mandatory is not "at least one channel must
   * stay on". Per-channel opt-out on a mandatory event reopens the hole it
   * closes — a user who drops email and keeps browser is unreachable the
   * moment no tab is open, and the alert is lost exactly when it matters. So
   * the resolver ignores stored preferences for a mandatory event entirely and
   * every declared channel stays enabled. The UI (#126) renders the controls
   * as disabled WITH the reason rather than hiding them, per epic #109's
   * success criterion 5 — a dead toggle teaches nothing.
   *
   * Absent is the normal case and means "the user is in charge".
   *
   * Invariant: a mandatory event must also be `defaultEnabled: true`.
   * `mandatory` with `defaultEnabled: false` is self-contradictory — it
   * asserts the user cannot turn off something that is off.
   */
  mandatory?: boolean;
}

/**
 * The events this application can raise.
 *
 * Seeded with the three #128 wires end to end, so the framework is exercised
 * by real triggers rather than staying theoretical (epic #109, scope item 8).
 *
 * KEYS ARE NAMESPACED `<area>.<event>` so the list stays readable as it grows
 * and so `security.*` is greppable — the class of event that tends to be
 * mandatory is the class most worth auditing as a group.
 */
export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  {
    key: 'user.welcome',
    label: 'Welcome',
    description: 'Sent once, the first time you sign in to this application.',
    // Email only. A browser notification here would fire while the user is
    // looking at the very page that welcomes them — it has no reader.
    channels: ['email'],
    defaultEnabled: true,
  },
  {
    key: 'allowlist.invitation',
    label: 'Invitation to join',
    description:
      'Sent when an administrator adds your email address to the allowlist, inviting you to sign in.',
    // Email only, and NOT because #127 has not landed. The recipient has no
    // account, no session and no open tab at the moment this fires — that is
    // what being newly allowlisted means — so no in-app channel can reach
    // them. This entry is the worked example of `channels` carrying real
    // per-event information rather than being copied between rows.
    channels: ['email'],
    defaultEnabled: true,
  },
  {
    key: 'security.role_changed',
    label: 'Your roles changed',
    description:
      'Sent when an administrator changes the roles assigned to your account, which changes what you can access.',
    // Both channels: a privilege change is worth surfacing immediately to an
    // open tab AND leaving a durable record in the user's inbox.
    channels: ['email', 'browser'],
    defaultEnabled: true,
    // A privilege change the user never hears about is the failure mode this
    // whole flag exists for: an account silently gains or loses access and
    // nobody outside the admin console can tell. Not silenceable.
    mandatory: true,
  },

  // ---------------------------------------------------------------------------
  // The coaching categories N1-N9 (issue #54, epic E12)
  // ---------------------------------------------------------------------------
  //
  // These are ORDINARY registry entries, and that is the whole point: the
  // preferences page grew nine rows without a line of code changing on it, and
  // the dispatcher carries them exactly as it carries `user.welcome`. What is
  // coaching-specific — payload shapes, deep links, action buttons, wording --
  // lives in `coaching-notifications/`, which DERIVES from this list rather
  // than repeating it (`coaching-events.spec.ts` asserts both directions).
  //
  // NONE OF THEM IS `mandatory`. A user must be able to silence every one: PRD
  // §59's first input is permission, and a coaching message a user cannot turn
  // off is exactly the kind that gets the whole app muted at the OS level.
  //
  // `channels` is `['browser']` for eight of the nine. Only the weekly review is
  // worth an email — the rest are moment-bound, and an email arriving twenty
  // minutes after the moment has passed is noise. E12-04 adds `'push'` to each
  // of these rows when it registers that channel.
  {
    key: 'coach.commitment_upcoming',
    label: 'Upcoming commitment',
    description: 'A commitment on your path starts in about 20 minutes.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.start_cue',
    label: 'Start cue',
    description: 'A commitment is due now and ready to start.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.rescue',
    label: 'Start rescue',
    description:
      'Something you have moved more than once is due today — a smaller start is offered.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.fallback_offer',
    label: 'Fallback offer',
    description: 'The full version no longer fits the time left, but a shorter one does.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.family_presence',
    label: 'Family presence cue',
    description: 'A family ritual starts soon.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.recovery',
    label: 'Recovery',
    description: 'After a few days away, one small restart action is ready.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.evidence',
    label: 'Evidence celebration',
    description: 'You reached a consistency milestone worth noticing.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.weekly_review_ready',
    label: 'Weekly review ready',
    description: 'Your weekly review has been prepared.',
    channels: ['email', 'browser', 'push'],
    defaultEnabled: true,
  },
  {
    key: 'coach.plan_issue',
    label: 'Plan issue',
    description:
      'The coach proposes a plan change because the current schedule keeps failing.',
    channels: ['browser', 'push'],
    defaultEnabled: true,
  },

  // ---------------------------------------------------------------------------
  // Memory (epic E06, issue #78)
  // ---------------------------------------------------------------------------
  {
    key: 'memory.insight_proposed',
    label: 'New coaching insight to review',
    description:
      'The coach noticed a pattern in how you work and wants you to confirm or dismiss it.',
    // Browser only, and not push. This is an invitation to sit down with a
    // settings page and read several sentences about yourself — the opposite
    // of a moment-bound cue, and a phone buzz for it would be an interruption
    // asking for attention it cannot use.
    channels: ['browser'],
    defaultEnabled: true,
  },

  // ---------------------------------------------------------------------------
  // The Health domain (epic E09, issue #77)
  // ---------------------------------------------------------------------------
  {
    key: 'plan.proposal_created',
    label: 'A suggested plan change',
    description: 'Your coach has proposed a change to a plan and is waiting on your answer.',
    // Browser only. A proposal is an invitation to read a diff and decide — the
    // opposite of a moment-bound cue, and a phone buzz would ask for attention
    // it cannot use.
    channels: ['browser'],
    defaultEnabled: true,
  },
  {
    key: 'health.program_activated',
    label: 'Workout program started',
    description: 'Your training program is live and the first sessions are on your schedule.',
    // Browser only. It confirms something the user just did, in the tab they
    // did it in; a phone buzz for a button they pressed a second ago is noise.
    channels: ['browser'],
    defaultEnabled: true,
  },
  {
    key: 'account.data_reset',
    label: 'Your data was reset',
    description:
      'Sent when everything you have built in this application is erased from your account. Your account itself is kept.',
    // ---------------------------------------------------------------------
    // EMAIL ONLY, and not because the other channels have not shipped
    // ---------------------------------------------------------------------
    //
    // `browser` and `push` both exist, and `security.role_changed` above uses
    // browser. They are still wrong here, for a reason specific to WHEN this
    // event fires: a browser notification renders in the SAME TAB that just
    // watched the confirmation screen report success. Its reader has no
    // information they do not already have, one second old.
    //
    // Email is the only channel that reaches this person somewhere OTHER than
    // where the action happened — which is exactly where a "did I really mean
    // that, and did it actually happen" record belongs, and the only place it
    // can reach an account holder who was NOT the person at the keyboard.
    channels: ['email'],
    defaultEnabled: true,
    // ---------------------------------------------------------------------
    // `mandatory: true`, for two independent reasons
    // ---------------------------------------------------------------------
    //
    // 1. Irreversible destruction of everything a person has built is a fact
    //    they must not be able to silence — the same class of "the user must
    //    always be told" event `security.role_changed` above carries the flag
    //    for, applied to data loss instead of a privilege change.
    //
    // 2. It sidesteps an ordering hazard unique to this one event.
    //    `AccountResetService.reset` deletes `user_settings` — which is where
    //    a non-mandatory event's stored channel preference lives — MOMENTS
    //    before this notification dispatches. A resolver reading stored
    //    preferences here would be reading a row the very call that triggers
    //    it just deleted, and would fall back to the registry default anyway.
    //    `mandatory` removes the question: resolution ignores stored
    //    preferences, so there is no preference row to race against its own
    //    deletion.
    mandatory: true,
  },
];

/**
 * Key -> definition, built once at module load.
 *
 * The list above is the source of truth and stays an array because its ORDER
 * is meaningful — #126 renders the preferences matrix in it. This index exists
 * so the dispatcher's per-delivery lookups are not a linear scan of the
 * registry on every event.
 */
const EVENTS_BY_KEY: ReadonlyMap<string, NotificationEventDef> = new Map(
  NOTIFICATION_EVENTS.map((event) => [event.key, event]),
);

/**
 * The definition for `key`, or `undefined` when nothing is registered under it.
 *
 * RETURNS `undefined` RATHER THAN THROWING because the caller is frequently
 * holding a string that came from persisted data — a preference row or a
 * delivery record written before an event was removed from this list. A
 * decommissioned event must not turn a preferences page render into a 500;
 * the caller decides whether an unknown key is "skip it" or "this is a bug".
 */
export function findEvent(key: string): NotificationEventDef | undefined {
  return EVENTS_BY_KEY.get(key);
}

/**
 * Channels `key` can be delivered over, or an empty array when the key is
 * unknown.
 *
 * Empty-for-unknown is the safe direction and is deliberately not an
 * exception: every caller is about to iterate the result, and "an event that
 * no longer exists is delivered nowhere" is the correct outcome of that loop.
 * Throwing would instead take down whatever action raised the stale event —
 * violating epic #109's rule that a notification failure never fails the
 * action that triggered it.
 *
 * Returns a defensive copy: the arrays in `NOTIFICATION_EVENTS` are the
 * registry's own state, and a caller that sorted or spliced the result in
 * place would silently reconfigure delivery for every later dispatch in the
 * process.
 */
export function channelsFor(key: string): NotificationChannel[] {
  return [...(EVENTS_BY_KEY.get(key)?.channels ?? [])];
}

/**
 * Can `key` be delivered over `channel`?
 *
 * The membership test the dispatcher (#125) needs on every delivery, kept here
 * so the answer is not re-derived — and re-derived subtly differently — at
 * each call site. Unknown key is `false`, consistent with `channelsFor`.
 */
export function supportsChannel(key: string, channel: NotificationChannel): boolean {
  return EVENTS_BY_KEY.get(key)?.channels.includes(channel) ?? false;
}

/**
 * Is `key` an event the user may not opt out of?
 *
 * THE SERVER-SIDE GATE, not a UI hint. #125 calls this during preference
 * resolution, so a stored preference disabling a mandatory event is ignored no
 * matter how it got written — including by a crafted PATCH that never went
 * near the UI.
 *
 * Unknown key is `false`: an event that is not registered cannot be dispatched
 * at all, so nothing is being weakened by the default.
 */
export function isMandatory(key: string): boolean {
  return EVENTS_BY_KEY.get(key)?.mandatory === true;
}
