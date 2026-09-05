import type {
  CommitmentActionName,
  Domain,
  DomainModeKind,
  ReflectionQuickOption,
  SkipReason,
} from '../../types';

// ===========================================================================
// The words the Today screen uses (epic E05, issue #46)
// ===========================================================================
//
// ONE PLACE, because these strings appear on a button, in a menu, in a dialog
// title and in an aria-label, and the same action reading "Skip" in one and
// "Skip it" in another is how a screen stops feeling like one screen.
// ===========================================================================

export const DOMAIN_LABELS: Record<Domain, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

/**
 * What an empty domain says.
 *
 * Not "No commitments" three times. An empty section is the most common thing a
 * new user sees, and it is the product's one chance to say what the section is
 * FOR.
 */
export const DOMAIN_EMPTY_COPY: Record<Domain, string> = {
  WORK: 'Nothing scheduled for work today.',
  FAMILY: 'Nothing scheduled with the people you care about today.',
  HEALTH: 'Nothing scheduled for your health today.',
};

/** Shown as a tag on the card header. GROW is the default and says nothing. */
export const DOMAIN_MODE_LABELS: Record<DomainModeKind, string | null> = {
  GROW: null,
  MAINTAIN: 'Maintaining',
  RECOVER: 'Recovering',
  PAUSE: 'Paused',
};

/**
 * `edit` is a CLIENT-SIDE row action, not one of the API's `availableActions`.
 * It maps to `PATCH /commitments/:id` rather than to an action endpoint, so it
 * is offered from this list and never expected back from the server.
 *
 * Offered only for `PLANNED` and `READY`: the API refuses a PATCH on a terminal
 * commitment with a 409, and a started one is mid-session.
 */
/**
 * `start_workout` is a CLIENT-SIDE action like `edit`, not a commitment action
 * endpoint: it opens a workout session and navigates to the runner (epic E09).
 * It is offered instead of `start` on a Health commitment that carries a
 * workout template — the generic timer would be the wrong screen for it.
 */
export type RowAction = CommitmentActionName | 'edit' | 'start_workout';

export const ACTION_LABELS: Record<RowAction, string> = {
  edit: 'Edit',
  start: 'Start',
  start_workout: 'Start workout',
  pause: 'Pause',
  continue: 'Continue',
  complete: 'Complete',
  partial: 'Partly done',
  fallback: 'Do less',
  reschedule: 'Reschedule',
  skip: 'Skip',
  decompose: 'Make it smaller',
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  TOO_MUCH: 'Too much today',
  BAD_TIMING: 'Bad timing',
  UNEXPECTED_CONFLICT: 'Unexpected conflict',
  LOW_ENERGY: 'Low energy',
  AVOIDED: 'I avoided it',
  OTHER: 'Something else',
};

export const SKIP_REASONS: SkipReason[] = [
  'TOO_MUCH',
  'BAD_TIMING',
  'UNEXPECTED_CONFLICT',
  'LOW_ENERGY',
  'AVOIDED',
  'OTHER',
];

export const REFLECTION_OPTION_LABELS: Record<ReflectionQuickOption, string> = {
  PLAN_WORKED: 'The plan worked',
  TOO_MUCH: 'Too much',
  BAD_TIMING: 'Bad timing',
  UNEXPECTED_CONFLICT: 'Unexpected conflict',
  LOW_ENERGY: 'Low energy',
  AVOIDED: 'I avoided things',
  OTHER: 'Something else',
};

export const REFLECTION_OPTIONS: ReflectionQuickOption[] = [
  'PLAN_WORKED',
  'TOO_MUCH',
  'BAD_TIMING',
  'UNEXPECTED_CONFLICT',
  'LOW_ENERGY',
  'AVOIDED',
  'OTHER',
];

/** The user's local time of day for a scheduled commitment. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
