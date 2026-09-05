// =============================================================================
// What one AI persona is allowed to know (issue #63, epic E06)
// =============================================================================
//
// PRD §87: "every AI call should receive the smallest sufficient context".
// Workout coaching does not need family reflections; family planning does not
// need exercise logs. This file is the vocabulary that makes that sentence
// enforceable instead of aspirational — `CONTEXT_SCOPES` decides which of these
// sections a persona gets, and the assembler never queries the rest.
//
// Nothing here carries an email address, a display name or a family member's
// real name. The persona is told "the user" and nothing more (PRD §14.1).
// =============================================================================

import type {
  CoachingStyle,
  CommitmentStatus,
  Domain,
  DomainModeKind,
  MemoryInsightCategory,
  ObstacleType,
} from '@prisma/client';

/** Which persona's context is being built. */
export type PersonaScope = 'coach' | 'planner' | 'workout' | 'family';

/**
 * Every section a context can carry. The order of this tuple is the order
 * `renderForPrompt` writes them in, and it is therefore part of the
 * determinism guarantee — do not sort it, do not derive it.
 */
export const SECTION_KEYS = [
  'now',
  'coachingStyle',
  'bestSelf',
  'domainModes',
  'outcomes',
  'activePlans',
  'todayCommitments',
  'recentEvidence',
  'recentMisses',
  'recentReflections',
  'memoryInsights',
  'obstacles',
  'recentNotificationCount',
  'workout',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export interface OutcomeSummary {
  outcomeId: string;
  domain: Domain;
  title: string;
  importance: number;
  state: string;
  targetDate: string | null;
  successDefinition: string | null;
}

export interface RoutineSummary {
  routineId: string;
  title: string;
  frequency: string;
  daysOfWeek: number[];
  preferredTime: string | null;
  estimatedDurationMin: number;
  minimumDurationMin: number;
  fallbackBehavior: string | null;
  active: boolean;
}

export interface ActivePlanSummary {
  planId: string;
  outcomeTitle: string;
  domain: Domain;
  versionNumber: number;
  versionId: string;
  rationale: string | null;
  expectedWeeklyLoad: number | null;
  routines: RoutineSummary[];
}

export interface CommitmentSummary {
  commitmentId: string;
  title: string;
  domain: Domain;
  status: CommitmentStatus;
  scheduledAt: string;
  fullMinutes: number | null;
  minimumMinutes: number | null;
  rescheduleCount: number;
  skipReason: string | null;
}

export interface EvidenceSummary {
  evidenceType: string;
  source: string;
  occurredAt: string;
  quantitativeValue: number | null;
  quantitativeUnit: string | null;
  qualitativeValue: string | null;
}

export interface ReflectionSummary {
  relatedType: string;
  createdAt: string;
  userText: string | null;
  frictionTags: string[];
  mood: number | null;
  satisfaction: number | null;
}

export interface MemoryInsightSummary {
  category: MemoryInsightCategory;
  statement: string;
  evidenceCount: number;
  confidence: number;
}

export interface ObstacleSummary {
  type: ObstacleType;
  description: string;
  domain: Domain;
  observedCount: number;
  confidence: number;
  lastObservedAt: string;
}

/**
 * How much of the context had to be thrown away to fit the budget, and from
 * where. Reported rather than silently applied: a coach reply built on a
 * truncated context is a fact the telemetry should be able to see.
 */
export interface BudgetReport {
  limitChars: number;
  usedChars: number;
  truncated: Array<{ section: SectionKey; dropped: number }>;
}

export interface CoachContext {
  scope: PersonaScope;
  /** The sections this scope actually asked for. Everything else is empty. */
  sections: SectionKey[];

  now: { iso: string; timezone: string; weekday: string };
  coachingStyle: CoachingStyle;

  bestSelf: { statements: string[] } | null;
  domainModes: Array<{ domain: Domain; mode: DomainModeKind }>;

  /** Planner only. Absent — not empty — for every other scope. */
  outcomes?: OutcomeSummary[];

  activePlans: ActivePlanSummary[];
  todayCommitments: CommitmentSummary[];
  recentEvidence: EvidenceSummary[];
  recentMisses: CommitmentSummary[];
  recentReflections: ReflectionSummary[];
  memoryInsights: MemoryInsightSummary[];
  obstacles: ObstacleSummary[];
  recentNotificationCount: number;

  /** Workout only; `program` stays null until E09 fills it. */
  workout?: { program: unknown | null; recentSessions: unknown[] };

  budget: BudgetReport;
}
