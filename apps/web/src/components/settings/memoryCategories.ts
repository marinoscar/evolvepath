import type { MemoryInsightCategory } from '../../types';

/**
 * Group headings, in the order the page renders them.
 *
 * IDENTITY first and PATTERN last: the list runs from who the user says they
 * are to what the app has noticed about them, which is also the order of how
 * much the user authored each group.
 */
export const CATEGORY_ORDER: MemoryInsightCategory[] = [
  'IDENTITY',
  'WORK',
  'FAMILY',
  'HEALTH',
  'COACHING_PREFERENCE',
  'NOTIFICATION_PREFERENCE',
  'PATTERN',
];

export const CATEGORY_LABELS: Record<MemoryInsightCategory, string> = {
  IDENTITY: 'Identity',
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
  COACHING_PREFERENCE: 'Coaching preferences',
  NOTIFICATION_PREFERENCE: 'Notification preferences',
  PATTERN: 'Patterns the coach noticed',
};
