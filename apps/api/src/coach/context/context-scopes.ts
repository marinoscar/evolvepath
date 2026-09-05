import type { Domain, EvidenceSource, MemoryInsightCategory } from '@prisma/client';

import type { PersonaScope, SectionKey } from './context.types';

// =============================================================================
// The scope table (issue #63, epic E06)
// =============================================================================
//
// ONE TABLE, READ BY ONE SERVICE. PRD §87's "smallest sufficient context" is
// only a real constraint if there is a single place that says what each persona
// gets — otherwise every call site grows its own idea of "relevant" and they
// all drift toward "send everything".
//
// The filters are as much the point as the section list. `workout` seeing every
// domain's plans would be a privacy-shaped bug as well as a cost one: the user
// asked about squats, and the model was told about their marriage.
//
// CHARACTERS, NOT TOKENS. No tokenizer dependency: 12 000 characters is roughly
// 3 000 tokens, comfortably inside the `coach` persona's fast-tier model, and a
// character count is exact, free and identical on every runtime.
// =============================================================================

export interface ScopeDefinition {
  sections: SectionKey[];
  limitChars: number;
  /** When present, only these domains' plans/commitments/misses/obstacles. */
  domains?: Domain[];
  /** When present, only these evidence sources. */
  evidenceSources?: EvidenceSource[];
  /** When present, evidence from these sources is excluded. */
  excludeEvidenceSources?: EvidenceSource[];
  /** When present, only insights in these categories survive the query. */
  insightCategories?: MemoryInsightCategory[];
}

const COACH_SECTIONS: SectionKey[] = [
  'now',
  'coachingStyle',
  'bestSelf',
  'domainModes',
  'activePlans',
  'todayCommitments',
  'recentEvidence',
  'recentMisses',
  'recentReflections',
  'memoryInsights',
  'obstacles',
  'recentNotificationCount',
];

export const CONTEXT_SCOPES: Record<PersonaScope, ScopeDefinition> = {
  coach: {
    sections: COACH_SECTIONS,
    limitChars: 12_000,
  },

  // The planner is the one persona that reasons about outcomes it has not been
  // handed, so it is the one scope that gets them — and the extra budget the
  // list costs.
  planner: {
    sections: [...COACH_SECTIONS, 'outcomes'],
    limitChars: 16_000,
  },

  workout: {
    sections: [
      'now',
      'coachingStyle',
      'domainModes',
      'activePlans',
      'todayCommitments',
      'recentEvidence',
      'memoryInsights',
      'obstacles',
      'workout',
    ],
    limitChars: 8_000,
    domains: ['HEALTH'],
    evidenceSources: ['WORKOUT_LOG'],
    insightCategories: ['HEALTH', 'PATTERN'],
  },

  family: {
    sections: [
      'now',
      'coachingStyle',
      'bestSelf',
      'domainModes',
      'activePlans',
      'todayCommitments',
      'recentEvidence',
      'recentMisses',
      'recentReflections',
      'memoryInsights',
      'obstacles',
    ],
    limitChars: 8_000,
    domains: ['FAMILY'],
    excludeEvidenceSources: ['WORKOUT_LOG'],
    insightCategories: ['FAMILY', 'IDENTITY', 'COACHING_PREFERENCE'],
  },
};

/**
 * The order sections are sacrificed in when a context is over budget.
 *
 * TIER 1 IS ABSENT FROM THIS LIST ON PURPOSE (PRD §17). `activePlans` and
 * `todayCommitments` are the current state the coach is reasoning about; a
 * reply built without them is not a shorter reply, it is a wrong one. What
 * gets dropped is episodic history, oldest first, because the oldest thing is
 * the least likely to explain today.
 */
export const TRUNCATION_ORDER = [
  'recentReflections',
  'recentEvidence',
  'recentMisses',
  'obstacles',
  'memoryInsights',
] as const satisfies readonly SectionKey[];

/** How far back the episodic sections look (PRD §17 Tier 2). */
export const EPISODIC_WINDOW_DAYS = 14;

/** How far back `recentNotificationCount` counts. */
export const NOTIFICATION_WINDOW_DAYS = 7;

/** Hard cap on the memory query before scope filtering. */
export const MEMORY_INSIGHT_LIMIT = 20;
