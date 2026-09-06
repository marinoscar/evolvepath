// =============================================================================
// OpenAPI tag taxonomy (issue #53)
// =============================================================================
//
// The single declaration of every `@ApiTags(...)` name used in this API, its
// human description, and which sidebar section it belongs to.
//
// The tag NAMES here were already consistent across the ten controllers, so
// unlike the rest of this pass nothing was renamed. What was missing is what
// this file adds: a description for each (an undescribed tag renders as a bare
// heading) and a grouping (an ungrouped tag renders outside every section).
//
// One rule this file exists to enforce: NO undeclared and NO orphaned tags. A
// tag used by a controller but not listed here would render with no description
// and land outside every group; a tag listed here but used by nobody would
// render an empty section. Both are failed assertions in
// `test/openapi/openapi-document.spec.ts` rather than something a reviewer has
// to notice.
//
// Ordering is deliberate: `TAG_GROUPS` is emitted as `x-tagGroups`, and the
// flattened tag order becomes the document's `tags` array, which is what a
// renderer falls back to when it has no group support.
// =============================================================================

export interface OpenApiTag {
  /** Must match the controller's `@ApiTags(...)` argument byte-for-byte. */
  name: string;
  /** One or two sentences. Rendered under the section heading in the sidebar. */
  description: string;
}

export interface OpenApiTagGroup {
  name: string;
  tags: OpenApiTag[];
}

/**
 * Sidebar sections, in render order.
 *
 * A group is a product area rather than a module boundary — `Allowlist` sits
 * with authentication because it gates sign-in, even though it is administered
 * from the same screen as `Users`.
 */
export const TAG_GROUPS: OpenApiTagGroup[] = [
  {
    name: 'Authentication & Access',
    tags: [
      {
        name: 'Authentication',
        description:
          'Google OAuth sign-in, access-token refresh, logout, and the current-user lookup. ' +
          'Start here: every other section assumes a bearer token obtained through one of these routes.',
      },
      {
        name: 'Device Authorization',
        description:
          'RFC 8628 device authorization grant — how a CLI or other browserless client obtains a ' +
          'token by showing the user a code to approve elsewhere, plus management of the resulting ' +
          'device sessions.',
      },
      {
        name: 'Personal Access Tokens',
        description:
          'Long-lived `pat_` bearer credentials for scripts and automation. A PAT carries the full ' +
          'permission set of the user that minted it and is accepted on every authenticated route.',
      },
      {
        name: 'Allowlist',
        description:
          'Pre-authorized email addresses. Access is allowlist-gated: an email absent from this list ' +
          'cannot complete OAuth sign-in at all. Admin only.',
      },
      {
        name: 'Test Authentication',
        description:
          'Token minting for automated tests. The module is registered only when ' +
          '`NODE_ENV !== "production"`, so these routes are absent from a production document entirely.',
      },
    ],
  },
  {
    name: 'Account & Settings',
    tags: [
      {
        name: 'Users',
        description:
          'User administration: listing, inspecting, activating and deactivating accounts, and ' +
          'assigning system roles. Admin only.',
      },
      {
        name: 'User Settings',
        description:
          'The calling user\'s own preferences, stored as a JSON document. Supports full replacement ' +
          '(`PUT`) and JSON Merge Patch (`PATCH`).',
      },
      {
        name: 'System Settings',
        description:
          'Deployment-wide configuration, stored as a JSON document. Readable by any signed-in user; ' +
          'writable only with `system_settings:write`.',
      },
      {
        name: 'Email Settings',
        description:
          'Mail transport configuration (SES or SMTP), the sender identity, and a test send that ' +
          'reports the provider\'s actual error so a misconfiguration can be diagnosed. Gated on ' +
          '`system_settings:read`/`:write`. The SMTP password is write-only: it is held in the ' +
          'encrypted credential store, is never returned, and submitting it empty preserves it.',
      },
      {
        name: 'AI Settings',
        description:
          'Which AI provider this deployment uses, the platform API key, and which model each ' +
          'coaching persona runs on. Gated on `system_settings:read`/`:write`. The platform key ' +
          'is write-only: it is held in the encrypted credential store, is never returned, and ' +
          'submitting it empty preserves it. The model catalog is fetched live from the provider ' +
          'and filtered to GPT 5.4 or newer; the test endpoint answers 200 with the provider\'s ' +
          'own error so a misconfiguration can be diagnosed.',
      },
      {
        name: 'AI Key',
        description:
          "The caller's own OpenAI API key — write-only, testable and removable. Every user " +
          'brings their own key; the gateway uses only the caller\'s. The key is never returned ' +
          'by any endpoint, and the test answers 200 with the provider\'s own error so a bad key ' +
          'can be diagnosed. Requires authentication only: it is an own-resource surface with no ' +
          'user id in the path.',
      },
      {
        name: 'Notifications',
        description:
          'The registry of events this application can raise, and which channels each supports. ' +
          'Readable by any signed-in user, because every user renders their own notification ' +
          'preferences against it.',
      },
      {
        name: 'Coaching Notifications',
        description:
          'The coaching decision engine: the per-user policy it obeys (quiet hours, caps, muted ' +
          'categories), the interactions it records, and the metrics derived from them. The engine ' +
          'decides *whether* to interrupt; the Notifications section above decides how a message ' +
          'is carried once that decision is yes.',
      },
    ],
  },
  {
    name: 'EvolvePath',
    tags: [
      {
        name: 'Today',
        description:
          "The signed-in user's day: the deterministic next best action with its rationale, " +
          'the three domain sections, the check-in, and the coach insight. `GET /today` makes ' +
          'no AI call — the screen renders with the provider down.',
      },
      {
        name: 'Progress',
        description:
          'Momentum per domain, the consistency run, recovery, coach dependency, milestones ' +
          'and the evidence timeline. Counts and states only — there is no score.',
      },
      {
        name: 'Comeback',
        description:
          'Return after inactivity: stale commitments are closed as history, one small restart ' +
          'action is offered, and completing it records recovery. No overdue list is ever ' +
          'produced — there is deliberately no route here that reports what was missed.',
      },
      {
        name: 'Best Self',
        description:
          "The calling user's Best Self profile — who they are trying to become (PRD §10.2). " +
          'One row per user, replaced whole.',
      },
      {
        name: 'Onboarding',
        description:
          'The first-Path flow (PRD §19–§20): saved answers, the AI plan proposal, the ' +
          'confidence check, and the one approval that turns a proposal into outcomes, plans, ' +
          'routines and commitments.',
      },
      {
        name: 'Outcomes',
        description:
          'Meaningful results per domain (Work, Family, Health). Every row is owned by the ' +
          "caller; another user's outcome is indistinguishable from a missing one.",
      },
      {
        name: 'Domain Modes',
        description:
          'Per-domain posture — GROW, MAINTAIN, RECOVER or PAUSE — that later epics use to ' +
          'size the week.',
      },
      {
        name: 'Plans',
        description:
          'Versioned strategies for an outcome. Versions are append-only: activating a draft ' +
          'supersedes the current version and both stay readable, with the rationale that ' +
          'explains the change (PRD §80).',
      },
      {
        name: 'Routines',
        description:
          'Repeatable behaviours belonging to one plan version — trigger, frequency, ideal and ' +
          'minimum duration, and a fallback.',
      },
      {
        name: 'Commitments',
        description:
          'Specific future intentions with full, short and minimum versions and a nine-state ' +
          'lifecycle. Transitions are validated by a fixed matrix; a reschedule closes the ' +
          'original and opens a new commitment that carries the reschedule count.',
      },
      {
        name: 'Evidence',
        description:
          'What actually happened. Written only by explicit user logs or server-side flows — ' +
          'never derived from a planned item (PRD §10.9).',
      },
      {
        name: 'Reflections',
        description:
          'Optional, lightweight notes and scores attached to a commitment, outcome, plan ' +
          'version or day.',
      },
      {
        name: 'Work',
        description:
          'Work-domain execution: session planning for an outcome, focus sessions with ' +
          'TIMER evidence, avoidance assessment and friction diagnosis, and the weekly ' +
          'summary.',
      },
      {
        name: 'Family',
        description:
          'Family members (minimal records), rituals, recurrence materialization, the ' +
          'behaviour lint and the planned-versus-kept summary. Own data only.',
      },
      {
        name: 'Weekly Review',
        description:
          'Planned-versus-actual aggregates for one Monday-start week, the coach\u2019s six-part ' +
          'summary, and the plan-change proposals it raised. Generated on the user\u2019s chosen ' +
          'day and time or on demand; the numbers never depend on the model.',
      },
      {
        name: 'Weekly Planning',
        description:
          'A draft for the coming week: fixed constraints, one primary focus, domain modes, ' +
          'the commitments EvolvePath proposes from active routines, the cross-domain load ' +
          'check, and the approve step that writes next week\u2019s commitments. Deterministic ' +
          '\u2014 no model call.',
      },
      {
        name: 'Plan Proposals',
        description:
          'PRD §15\u2019s mutation protocol: a proposed plan change waiting on a human. ' +
          'Accepting one is the only path in the product that turns AI output into a plan ' +
          'version; editing one re-attributes it to the user; rejecting one touches nothing.',
      },
      {
        name: 'Media',
        description:
          'User photos and videos attached to product objects for coaching. Private to the ' +
          'uploader; processing state is derived from storage rather than reported separately. ' +
          'A foreign or unknown id answers 404, never 403 \u2014 unlike the generic Storage API.',
      },
    ],
  },
  {
    name: 'Coaching',
    tags: [
      {
        name: 'Memory Insights',
        description:
          'What the coach remembers about the user, and the three controls PRD §85 gives ' +
          'them over it: Edit, Forget, and Don\u2019t use for coaching. Forget is a hard ' +
          'delete, and its audit row records the category only.',
      },
      {
        name: 'Coach',
        description:
          'Conversations and one coaching turn. POST /coach/messages is ALWAYS a 201: a ' +
          'provider failure, or output naming things the user does not have, produces a ' +
          'readable message plus `degraded: true` rather than an error (PRD §120).',
      },
    ],
  },
  {
    name: 'Health',
    tags: [
      {
        name: 'Health Domain',
        description:
          'Nutrition behaviours and optional body-weight tracking (PRD §46, §47). Behaviours, ' +
          'not calories: there is no macro, no food database and no goal weight here by design. ' +
          'The weight response carries a trend and deliberately no per-day judgment.',
      },
      {
        name: 'Workouts',
        description:
          'Structured training: the exercise catalog, the AI program builder and its ' +
          'deterministic starter fallback, and the approval that turns a draft program into a ' +
          'plan version, routines and scheduled sessions. Every route is per-user; a foreign id ' +
          'answers 404.',
      },
    ],
  },
  {
    name: 'Storage',
    tags: [
      {
        name: 'Storage',
        description:
          'File objects: simple upload, resumable multipart upload, signed download URLs, metadata, ' +
          'and deletion. A caller sees only the objects they uploaded, unless they hold ' +
          '`storage:read_any`, `storage:write_any` or `storage:delete_any`. Uploads are ' +
          'checked against an allowlist of content types and a size limit.',
      },
    ],
  },
  {
    name: 'Operations',
    tags: [
      {
        name: 'Health',
        description:
          'Liveness and readiness probes for orchestrators and load balancers. Public — a probe that ' +
          'needed a token could not report that authentication is down.',
      },
    ],
  },
];

/** Flattened, in group order. Emitted as the document's `tags` array. */
export const OPENAPI_TAGS: OpenApiTag[] = TAG_GROUPS.flatMap((group) => group.tags);

/** Emitted as `x-tagGroups`, the extension Scalar and Redoc read. */
export const OPENAPI_TAG_GROUPS = TAG_GROUPS.map((group) => ({
  name: group.name,
  tags: group.tags.map((tag) => tag.name),
}));
