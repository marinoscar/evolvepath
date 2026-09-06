/**
 * Snake_case table names → readable English, for the consequence list on the
 * reset confirmation.
 *
 * Issue #224, epic #220. A sibling module rather than a constant inside
 * `ConfirmPhraseDialog` because the dialog is deliberately generic — it takes a
 * phrase and a list of sentences and knows nothing about this product's tables.
 * This lookup is the account-reset-specific half, and lives where the page that
 * needs it can import it without dragging the dialog into EvolvePath's schema.
 *
 * A KEY WITH NO LABEL IS STILL RENDERED, with its underscores turned into
 * spaces. The alternative — dropping it — would quietly under-report what a
 * reset erases every time the API grows a table, which is exactly the moment
 * the user most needs the list to be complete. A slightly awkward line is a far
 * better failure than a missing one.
 */

interface CountLabel {
  /** Shown for a count of one. */
  one: string;
  /** Shown for every other count. */
  other: string;
}

const COUNT_LABELS: Record<string, CountLabel> = {
  outcomes: { one: 'outcome', other: 'outcomes' },
  plans: { one: 'plan', other: 'plans' },
  plan_versions: { one: 'plan version', other: 'plan versions' },
  routines: { one: 'routine', other: 'routines' },
  commitments: { one: 'commitment', other: 'commitments' },
  evidence_items: { one: 'piece of evidence', other: 'pieces of evidence' },
  reflections: { one: 'reflection', other: 'reflections' },
  daily_check_ins: { one: 'daily check-in', other: 'daily check-ins' },
  domain_modes: { one: 'domain setting', other: 'domain settings' },
  best_self_profiles: { one: 'Best Self profile', other: 'Best Self profiles' },
  coach_conversations: { one: 'coach conversation', other: 'coach conversations' },
  coach_messages: { one: 'coach message', other: 'coach messages' },
  memory_insights: { one: 'thing the coach remembers', other: 'things the coach remembers' },
  plan_change_proposals: { one: 'plan proposal', other: 'plan proposals' },
  focus_sessions: { one: 'focus session', other: 'focus sessions' },
  work_milestones: { one: 'work milestone', other: 'work milestones' },
  work_session_plan_proposals: { one: 'work session plan', other: 'work session plans' },
  obstacles: { one: 'recorded obstacle', other: 'recorded obstacles' },
  family_members: { one: 'family member', other: 'family members' },
  rituals: { one: 'family ritual', other: 'family rituals' },
  workout_programs: { one: 'workout program', other: 'workout programs' },
  workout_sessions: { one: 'workout session', other: 'workout sessions' },
  set_logs: { one: 'logged set', other: 'logged sets' },
  body_weight_logs: { one: 'weight entry', other: 'weight entries' },
  weekly_reviews: { one: 'weekly review', other: 'weekly reviews' },
  weekly_plans: { one: 'weekly plan', other: 'weekly plans' },
  milestones: { one: 'milestone', other: 'milestones' },
  media_attachments: { one: 'photo or video', other: 'photos and videos' },
  storage_objects: { one: 'uploaded file', other: 'uploaded files' },
  exercises: { one: 'custom exercise', other: 'custom exercises' },
  user_profiles: { one: 'profile and its preferences', other: 'profile and its preferences' },
  notification_interactions: { one: 'notification record', other: 'notification records' },
};

/** `some_table_name` → `some table name`. The fallback, never a dropped row. */
function humanise(key: string): string {
  return key.replace(/_/g, ' ');
}

/**
 * One sentence fragment per non-zero count — `'4 commitments'`, `'1 photo or
 * video'` — in the order the API sent them.
 *
 * Zeroes are omitted: a list padded with "0 rituals" reads as a schema dump
 * rather than as what this particular person is about to lose.
 */
export function describeCounts(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const label = COUNT_LABELS[key];
      if (!label) return `${count} ${humanise(key)}`;
      return `${count} ${count === 1 ? label.one : label.other}`;
    });
}
