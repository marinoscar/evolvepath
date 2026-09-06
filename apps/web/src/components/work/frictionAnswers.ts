import type { FrictionAnswer } from '../../types';

// =============================================================================
// The eight answers, in dialog order (epic E07, issue #118)
// =============================================================================
//
// COPIED FROM `apps/api/src/work/avoidance/friction-answers.ts`, deliberately,
// and a Vitest asserts the eight keys still match the `FrictionAnswer` union.
// The alternative — an endpoint the dialog fetches its own radio labels from —
// would put a network round trip in front of a question the user is being asked
// because they are already stuck.
//
// The LABELS live here; the ROUTING does not. Which intervention an answer
// produces is decided server-side and never inferred from this list.
// =============================================================================

export interface FrictionAnswerOption {
  key: FrictionAnswer;
  label: string;
}

export const FRICTION_ANSWERS: readonly FrictionAnswerOption[] = [
  { key: 'DONT_KNOW_WHERE_TO_BEGIN', label: "I don't know where to begin" },
  { key: 'TOO_BIG', label: 'It feels too big' },
  { key: 'TIRED', label: "I'm tired" },
  { key: 'DONT_WANT_TO', label: "I don't want to do it" },
  { key: 'SOMETHING_URGENT', label: 'Something more urgent came up' },
  { key: 'WORRIED_ABOUT_QUALITY', label: "I'm worried I won't do it well" },
  { key: 'NEED_MORE_INFO', label: 'I need more information' },
  { key: 'OTHER', label: 'Other' },
] as const;
