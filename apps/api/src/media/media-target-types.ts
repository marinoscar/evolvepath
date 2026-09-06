/**
 * The product objects a piece of media may be attached to (issue #83).
 *
 * `media_attachments.target_type` is polymorphic and deliberately has NO
 * foreign key (#74): the four targets live in four tables and not all of them
 * exist yet. This list is where a bad value is refused instead — at the API
 * boundary, with a readable message, which is the only place a user can act on
 * it.
 *
 * Adding a value here is the whole of adding a target. Do NOT let clients send
 * free-form strings: the moment they do, `GET ?targetType=` becomes a filter
 * over typos.
 */
export const MEDIA_TARGET_TYPES = [
  'workout_session',
  'commitment',
  'outcome',
  'coach_message',
] as const;

export type MediaTargetType = (typeof MEDIA_TARGET_TYPES)[number];
