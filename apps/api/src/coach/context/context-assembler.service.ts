import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { PrismaService } from '../../prisma/prisma.service';
import {
  localDate,
  localDayBounds,
  safeTimeZone,
} from '../../today/local-date';
import {
  CONTEXT_SCOPES,
  EPISODIC_WINDOW_DAYS,
  MEMORY_INSIGHT_LIMIT,
  NOTIFICATION_WINDOW_DAYS,
  TRUNCATION_ORDER,
  type ScopeDefinition,
} from './context-scopes';
import {
  SECTION_KEYS,
  type ActivePlanSummary,
  type CoachContext,
  type CommitmentSummary,
  type EvidenceSummary,
  type MemoryInsightSummary,
  type ObstacleSummary,
  type OutcomeSummary,
  type PersonaScope,
  type ReflectionSummary,
  type SectionKey,
} from './context.types';

// =============================================================================
// The Context Assembler (issue #63, epic E06)
// =============================================================================
//
// EVERY AI CALL IN THIS PRODUCT GETS ITS INPUT FROM HERE. PRD §14.1 asks for
// one component that "builds the minimum relevant context for each AI call";
// the reason it has to be one component rather than a convention is §85: a
// memory insight the user marked "don't use for coaching" is only reliably
// unused if there is a single query that could have included it. Spread that
// filter across four call sites and it is one forgotten `where` clause from
// being a broken promise.
//
// THREE PROPERTIES THIS SERVICE OWES ITS CALLERS:
//
//   1. Determinism. Same rows in, byte-identical string out. `renderForPrompt`
//      takes `now` from the context object and never calls `Date.now()`, so a
//      test can assert the exact prompt rather than a fuzzy shape of it.
//   2. Scope. A section not in `CONTEXT_SCOPES[scope].sections` is not
//      queried at all — not queried and then filtered, not fetched "in case".
//      An empty array in an out-of-scope section means "never asked", and that
//      is the difference between a privacy guarantee and a code review.
//   3. All or nothing. A failing section query rejects `assemble`; callers
//      treat that as AI-unavailable and fall back to the deterministic path
//      (PRD §120). A partial context would produce confident advice built on
//      a hole, which is worse than no advice.
// =============================================================================

const tracer = trace.getTracer('evolvepath-api');

/** Weekday names, indexed 0 = Sunday, matching `Routine.daysOfWeek`. */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Statuses that count as "the user did not do it" for `recentMisses`. */
const MISS_STATUSES = ['MISSED', 'SKIPPED'] as const;

@Injectable()
export class ContextAssemblerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build one persona's context.
   *
   * `now` is injectable so the caller — and every test — decides what "today"
   * means rather than inheriting the wall clock.
   */
  async assemble(
    userId: string,
    scope: PersonaScope,
    now: Date = new Date(),
  ): Promise<CoachContext> {
    return tracer.startActiveSpan('coach.context.assemble', async (span) => {
      try {
        const context = await this.build(userId, scope, now);

        // Sizes and section names only. The content of a context is the most
        // sensitive thing this service touches and it never reaches a span.
        span.setAttribute('context.scope', scope);
        span.setAttribute('context.used_chars', context.budget.usedChars);
        span.setAttribute(
          'context.truncated_sections',
          context.budget.truncated.map((t) => t.section).join(','),
        );

        return context;
      } finally {
        span.end();
      }
    });
  }

  private async build(
    userId: string,
    scope: PersonaScope,
    now: Date,
  ): Promise<CoachContext> {
    const definition = CONTEXT_SCOPES[scope];
    const wants = (section: SectionKey) => definition.sections.includes(section);

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, coachingStyle: true },
    });

    // A user with no profile row is mid-onboarding, not broken: BALANCED and
    // UTC are the same defaults the column declares.
    const timezone = safeTimeZone(profile?.timezone);
    const coachingStyle = profile?.coachingStyle ?? 'BALANCED';

    const since = new Date(
      now.getTime() - EPISODIC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    // One round-trip per section, in parallel. A rejection here rejects
    // `assemble` — see property 3 in the header.
    const [
      bestSelf,
      domainModes,
      outcomes,
      activePlans,
      todayCommitments,
      recentEvidence,
      recentMisses,
      recentReflections,
      memoryInsights,
      obstacles,
      recentNotificationCount,
    ] = await Promise.all([
      wants('bestSelf') ? this.bestSelf(userId) : null,
      wants('domainModes') ? this.domainModes(userId, definition) : [],
      wants('outcomes') ? this.outcomes(userId) : undefined,
      wants('activePlans') ? this.activePlans(userId, definition) : [],
      wants('todayCommitments')
        ? this.todayCommitments(userId, definition, now, timezone)
        : [],
      wants('recentEvidence') ? this.recentEvidence(userId, definition, since) : [],
      wants('recentMisses') ? this.recentMisses(userId, definition, since) : [],
      wants('recentReflections') ? this.recentReflections(userId, since) : [],
      wants('memoryInsights') ? this.memoryInsights(userId, definition, now) : [],
      wants('obstacles') ? this.obstacles(userId, definition) : [],
      wants('recentNotificationCount')
        ? this.recentNotificationCount(userId, now)
        : 0,
    ]);

    const context: CoachContext = {
      scope,
      sections: definition.sections,
      now: {
        iso: now.toISOString(),
        timezone,
        weekday: weekdayIn(now, timezone),
      },
      coachingStyle,
      bestSelf,
      domainModes,
      activePlans,
      todayCommitments,
      recentEvidence,
      recentMisses,
      recentReflections,
      memoryInsights,
      obstacles,
      recentNotificationCount,
      budget: { limitChars: definition.limitChars, usedChars: 0, truncated: [] },
    };

    if (outcomes) context.outcomes = outcomes;
    if (wants('workout')) context.workout = { program: null, recentSessions: [] };

    return this.applyBudget(context, definition.limitChars);
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  private async bestSelf(userId: string) {
    const row = await this.prisma.bestSelfProfile.findUnique({
      where: { userId },
      select: {
        identityStatement: true,
        workIdentity: true,
        familyIdentity: true,
        healthIdentity: true,
        sixMonthVision: true,
        motivations: true,
      },
    });

    if (!row) return null;

    const statements = [
      row.identityStatement,
      row.workIdentity,
      row.familyIdentity,
      row.healthIdentity,
      row.sixMonthVision,
      ...row.motivations,
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

    return statements.length > 0 ? { statements } : null;
  }

  private async domainModes(userId: string, definition: ScopeDefinition) {
    const rows = await this.prisma.domainMode.findMany({
      where: {
        userId,
        ...(definition.domains ? { domain: { in: definition.domains } } : {}),
      },
      select: { domain: true, mode: true },
      orderBy: { domain: 'asc' },
    });

    return rows.map((r) => ({ domain: r.domain, mode: r.mode }));
  }

  private async outcomes(userId: string): Promise<OutcomeSummary[]> {
    const rows = await this.prisma.outcome.findMany({
      where: { userId, state: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: [{ importance: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        domain: true,
        title: true,
        importance: true,
        state: true,
        targetDate: true,
        successDefinition: true,
      },
    });

    return rows.map((r) => ({
      outcomeId: r.id,
      domain: r.domain,
      title: r.title,
      importance: r.importance,
      state: r.state,
      targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
      successDefinition: r.successDefinition,
    }));
  }

  private async activePlans(
    userId: string,
    definition: ScopeDefinition,
  ): Promise<ActivePlanSummary[]> {
    const rows = await this.prisma.planVersion.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        ...(definition.domains
          ? { plan: { outcome: { domain: { in: definition.domains } } } }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        version: true,
        rationale: true,
        expectedWeeklyLoad: true,
        planId: true,
        plan: { select: { outcome: { select: { title: true, domain: true } } } },
        routines: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            frequency: true,
            daysOfWeek: true,
            preferredTime: true,
            estimatedDurationMin: true,
            minimumDurationMin: true,
            fallbackBehavior: true,
            active: true,
          },
        },
      },
    });

    return rows.map((r) => ({
      planId: r.planId,
      outcomeTitle: r.plan.outcome.title,
      domain: r.plan.outcome.domain,
      versionNumber: r.version,
      versionId: r.id,
      rationale: r.rationale,
      expectedWeeklyLoad: r.expectedWeeklyLoad,
      routines: r.routines.map((routine) => ({
        routineId: routine.id,
        title: routine.title,
        frequency: routine.frequency,
        daysOfWeek: routine.daysOfWeek,
        preferredTime: routine.preferredTime,
        estimatedDurationMin: routine.estimatedDurationMin,
        minimumDurationMin: routine.minimumDurationMin,
        fallbackBehavior: routine.fallbackBehavior,
        active: routine.active,
      })),
    }));
  }

  private async todayCommitments(
    userId: string,
    definition: ScopeDefinition,
    now: Date,
    timezone: string,
  ): Promise<CommitmentSummary[]> {
    // The user's day, not the server's. `localDayBounds` is E05's, and using
    // anything else here would put tonight's workout on tomorrow's context for
    // everyone west of UTC.
    const { start, end } = localDayBounds(localDate(now, timezone), timezone);

    const rows = await this.prisma.commitment.findMany({
      where: {
        userId,
        scheduledStart: { gte: start, lt: end },
        ...(definition.domains ? { domain: { in: definition.domains } } : {}),
      },
      orderBy: { scheduledStart: 'asc' },
      select: COMMITMENT_SELECT,
    });

    return rows.map(toCommitmentSummary);
  }

  private async recentEvidence(
    userId: string,
    definition: ScopeDefinition,
    since: Date,
  ): Promise<EvidenceSummary[]> {
    const rows = await this.prisma.evidence.findMany({
      where: {
        userId,
        occurredAt: { gte: since },
        ...(definition.evidenceSources
          ? { source: { in: definition.evidenceSources } }
          : {}),
        ...(definition.excludeEvidenceSources
          ? { source: { notIn: definition.excludeEvidenceSources } }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      select: {
        evidenceType: true,
        source: true,
        occurredAt: true,
        quantitativeValue: true,
        quantitativeUnit: true,
        qualitativeValue: true,
      },
    });

    return rows.map((r) => ({
      evidenceType: r.evidenceType,
      source: r.source,
      occurredAt: r.occurredAt.toISOString(),
      quantitativeValue: r.quantitativeValue,
      quantitativeUnit: r.quantitativeUnit,
      qualitativeValue: r.qualitativeValue,
    }));
  }

  private async recentMisses(
    userId: string,
    definition: ScopeDefinition,
    since: Date,
  ): Promise<CommitmentSummary[]> {
    const rows = await this.prisma.commitment.findMany({
      where: {
        userId,
        status: { in: [...MISS_STATUSES] },
        scheduledStart: { gte: since },
        ...(definition.domains ? { domain: { in: definition.domains } } : {}),
      },
      orderBy: { scheduledStart: 'desc' },
      select: COMMITMENT_SELECT,
    });

    return rows.map(toCommitmentSummary);
  }

  private async recentReflections(
    userId: string,
    since: Date,
  ): Promise<ReflectionSummary[]> {
    const rows = await this.prisma.reflection.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: {
        relatedType: true,
        createdAt: true,
        userText: true,
        frictionTags: true,
        mood: true,
        satisfaction: true,
      },
    });

    return rows.map((r) => ({
      relatedType: r.relatedType,
      createdAt: r.createdAt.toISOString(),
      userText: r.userText,
      frictionTags: r.frictionTags,
      mood: r.mood,
      satisfaction: r.satisfaction,
    }));
  }

  private async memoryInsights(
    userId: string,
    definition: ScopeDefinition,
    now: Date,
  ): Promise<MemoryInsightSummary[]> {
    // THE ONLY QUERY IN THE PRODUCT THAT READS MEMORY FOR AN AI CALL, and the
    // three conditions are the user's three promises (PRD §85): unconfirmed
    // guesses are not used, "don't use this" means never, and an expired
    // insight stops applying without being deleted behind the user's back.
    const rows = await this.prisma.memoryInsight.findMany({
      where: {
        userId,
        userConfirmed: true,
        doNotUse: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
      take: MEMORY_INSIGHT_LIMIT,
      select: {
        category: true,
        statement: true,
        evidenceCount: true,
        confidence: true,
        // Selected only to be re-checked below. See the filter.
        userConfirmed: true,
        doNotUse: true,
        expiresAt: true,
      },
    });

    const categories = definition.insightCategories;

    return rows
      .filter(
        (r) =>
          // DELIBERATELY REDUNDANT with the `where` above. The promise this
          // enforces — "don't use this for coaching" means never — is one
          // edited `where` clause away from being quietly broken, and the
          // breakage would be invisible: the prompt would simply be one
          // sentence longer. A second check costs a boolean per row and makes
          // the guarantee survive a refactor of the query.
          r.userConfirmed &&
          !r.doNotUse &&
          (r.expiresAt === null || r.expiresAt > now),
      )
      .filter((r) => !categories || categories.includes(r.category))
      .map((r) => ({
        category: r.category,
        statement: r.statement,
        evidenceCount: r.evidenceCount,
        confidence: r.confidence,
      }));
  }

  private async obstacles(
    userId: string,
    definition: ScopeDefinition,
  ): Promise<ObstacleSummary[]> {
    const rows = await this.prisma.obstacle.findMany({
      where: {
        userId,
        ...(definition.domains ? { domain: { in: definition.domains } } : {}),
      },
      orderBy: { lastObservedAt: 'desc' },
      select: {
        type: true,
        description: true,
        domain: true,
        observedCount: true,
        confidence: true,
        lastObservedAt: true,
      },
    });

    return rows.map((r) => ({
      type: r.type,
      description: r.description,
      domain: r.domain,
      observedCount: r.observedCount,
      confidence: r.confidence,
      lastObservedAt: r.lastObservedAt.toISOString(),
    }));
  }

  private async recentNotificationCount(
    userId: string,
    now: Date,
  ): Promise<number> {
    const since = new Date(
      now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    return this.prisma.notification.count({
      where: { userId, createdAt: { gte: since } },
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering and budget
  // ---------------------------------------------------------------------------

  /**
   * The exact string a caller passes to the gateway as its input context.
   *
   * Deterministic by construction: fixed section order (`SECTION_KEYS`), fixed
   * key order inside every line, ISO instants, and no `Date.now()` — `now`
   * comes off the context. Nothing here reads a user's email or display name,
   * because no section query selects one.
   */
  renderForPrompt(context: CoachContext): string {
    const lines: string[] = [];
    const wanted = new Set(context.sections);

    for (const section of SECTION_KEYS) {
      if (!wanted.has(section)) continue;
      lines.push(...renderSection(section, context));
    }

    return lines.join('\n');
  }

  /**
   * Fit the context into `limitChars`, and say what that cost.
   *
   * Pure: takes a context, returns a new one. Drops whole items from the
   * episodic lists in `TRUNCATION_ORDER`, exhausting one section before
   * starting the next, and always from the END of the list — which is the
   * oldest entry for the four time-ordered sections and the least confident
   * one for `memoryInsights`, because each is sorted with the most relevant
   * item first. Tier 1 (`activePlans`, `todayCommitments`) is not in the
   * order and is therefore never touched.
   */
  private applyBudget(context: CoachContext, limitChars: number): CoachContext {
    const working: CoachContext = {
      ...context,
      recentReflections: [...context.recentReflections],
      recentEvidence: [...context.recentEvidence],
      recentMisses: [...context.recentMisses],
      obstacles: [...context.obstacles],
      memoryInsights: [...context.memoryInsights],
      budget: { limitChars, usedChars: 0, truncated: [] },
    };

    const dropped = new Map<SectionKey, number>();

    for (const section of TRUNCATION_ORDER) {
      const list = working[section] as unknown[];

      while (
        this.renderForPrompt(working).length > limitChars &&
        list.length > 0
      ) {
        list.pop();
        dropped.set(section, (dropped.get(section) ?? 0) + 1);
      }

      if (this.renderForPrompt(working).length <= limitChars) break;
    }

    // `truncated` follows TRUNCATION_ORDER, not insertion order, so two runs
    // over the same rows report the same array.
    working.budget.truncated = TRUNCATION_ORDER.filter((s) =>
      dropped.has(s),
    ).map((section) => ({ section, dropped: dropped.get(section)! }));
    working.budget.usedChars = this.renderForPrompt(working).length;

    return working;
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

const COMMITMENT_SELECT = {
  id: true,
  title: true,
  domain: true,
  status: true,
  scheduledStart: true,
  fullMinutes: true,
  minimumMinutes: true,
  rescheduleCount: true,
  skipReason: true,
} as const;

type CommitmentRow = {
  id: string;
  title: string;
  domain: CommitmentSummary['domain'];
  status: CommitmentSummary['status'];
  scheduledStart: Date;
  fullMinutes: number | null;
  minimumMinutes: number | null;
  rescheduleCount: number;
  skipReason: string | null;
};

function toCommitmentSummary(row: CommitmentRow): CommitmentSummary {
  return {
    commitmentId: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    scheduledAt: row.scheduledStart.toISOString(),
    fullMinutes: row.fullMinutes,
    minimumMinutes: row.minimumMinutes,
    rescheduleCount: row.rescheduleCount,
    skipReason: row.skipReason,
  };
}

/** The weekday name in the user's own zone. */
function weekdayIn(now: Date, timezone: string): string {
  const index = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone(timezone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now) + 'T00:00:00Z',
  ).getUTCDay();

  return WEEKDAYS[index];
}

/** `null` renders as an empty field rather than the string "null". */
function field(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('/');
  return String(value);
}

function renderSection(section: SectionKey, c: CoachContext): string[] {
  switch (section) {
    case 'now':
      return [`NOW: ${c.now.iso} (${c.now.weekday}, ${c.now.timezone})`];

    case 'coachingStyle':
      return [`COACHING STYLE: ${c.coachingStyle}`];

    case 'bestSelf':
      return c.bestSelf
        ? ['BEST SELF:', ...c.bestSelf.statements.map((s) => `- ${s}`)]
        : ['BEST SELF: not stated'];

    case 'domainModes':
      return [
        'DOMAIN MODES:',
        ...c.domainModes.map((m) => `- ${m.domain}: ${m.mode}`),
      ];

    case 'outcomes':
      return [
        'OUTCOMES:',
        ...(c.outcomes ?? []).map(
          (o) =>
            `- [${o.domain}] ${o.title} | importance=${o.importance} | state=${o.state} | target=${field(o.targetDate)} | success=${field(o.successDefinition)}`,
        ),
      ];

    case 'activePlans':
      return [
        'ACTIVE PLANS:',
        ...(c.activePlans ?? []).flatMap((p) => [
          `- [${p.domain}] ${p.outcomeTitle} | v${p.versionNumber} | weeklyLoadMin=${field(p.expectedWeeklyLoad)} | why=${field(p.rationale)}`,
          ...p.routines.map(
            (r) =>
              `  * ${r.title} | ${r.frequency} | days=${field(r.daysOfWeek)} | at=${field(r.preferredTime)} | ${r.estimatedDurationMin}min (min ${r.minimumDurationMin}) | fallback=${field(r.fallbackBehavior)} | active=${r.active}`,
          ),
        ]),
      ];

    case 'todayCommitments':
      return [
        "TODAY'S COMMITMENTS:",
        ...c.todayCommitments.map(
          (t) =>
            `- [${t.domain}] ${t.title} | ${t.status} | at=${t.scheduledAt} | full=${field(t.fullMinutes)} | min=${field(t.minimumMinutes)} | rescheduled=${t.rescheduleCount}`,
        ),
      ];

    case 'recentEvidence':
      return [
        'RECENT EVIDENCE:',
        ...c.recentEvidence.map(
          (e) =>
            `- ${e.occurredAt} | ${e.evidenceType} | ${e.source} | value=${field(e.quantitativeValue)}${field(e.quantitativeUnit)} | note=${field(e.qualitativeValue)}`,
        ),
      ];

    case 'recentMisses':
      return [
        'RECENT MISSES:',
        ...c.recentMisses.map(
          (m) =>
            `- [${m.domain}] ${m.title} | ${m.status} | at=${m.scheduledAt} | reason=${field(m.skipReason)} | rescheduled=${m.rescheduleCount}`,
        ),
      ];

    case 'recentReflections':
      return [
        'RECENT REFLECTIONS:',
        ...c.recentReflections.map(
          (r) =>
            `- ${r.createdAt} | on=${r.relatedType} | mood=${field(r.mood)} | satisfaction=${field(r.satisfaction)} | tags=${field(r.frictionTags)} | ${field(r.userText)}`,
        ),
      ];

    case 'memoryInsights':
      return [
        'CONFIRMED MEMORY:',
        ...c.memoryInsights.map(
          (i) =>
            `- [${i.category}] ${i.statement} | confidence=${i.confidence} | evidence=${i.evidenceCount}`,
        ),
      ];

    case 'obstacles':
      return [
        'KNOWN OBSTACLES:',
        ...c.obstacles.map(
          (o) =>
            `- [${o.domain}] ${o.type} | ${o.description} | seen=${o.observedCount} | confidence=${o.confidence} | last=${o.lastObservedAt}`,
        ),
      ];

    case 'recentNotificationCount':
      return [`NOTIFICATIONS LAST 7 DAYS: ${c.recentNotificationCount}`];

    case 'workout':
      return [
        `WORKOUT PROGRAM: ${c.workout?.program ? JSON.stringify(c.workout.program) : 'none'}`,
        `RECENT SESSIONS: ${c.workout?.recentSessions.length ?? 0}`,
      ];
  }
}
