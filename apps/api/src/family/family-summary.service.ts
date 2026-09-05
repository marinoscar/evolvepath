import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Commitment, Ritual } from '@prisma/client';

import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { localDate, localDayBounds, localHour, safeTimeZone } from '../today/local-date';
import { addDays, weekStartOfDate, weekdayOf } from './recurrence';
import {
  COUNT_KEYS,
  UNGROUPED_TITLE,
  type FamilySummary,
  type FamilySummaryWeek,
  type RitualWeekCounts,
} from './family-summary.schema';
import {
  DISPLACEMENT_THRESHOLD,
  renderDisplacementNote,
} from './summary-copy';

/** Bumped whenever the instructions below change meaningfully (PRD §117). */
export const SUMMARY_NOTE_PROMPT_VERSION = 'family-summary-note.v1';
export const SUMMARY_NOTE_SCHEMA_NAME = 'FamilySummaryNote';

/** How long a rephrased sentence is reused. Per process — see the cache note. */
const NOTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Skip reasons that mean "something else took the time". */
const DISPLACEMENT_REASONS = new Set(['UNEXPECTED_CONFLICT', 'BAD_TIMING', 'TOO_MUCH']);

/** From this local hour onward a commitment counts as an evening one. */
const EVENING_HOUR = 17;

const noteSchema = z.object({ text: z.string().max(280) });

/**
 * A number a model invented, or a judgement it added, must never reach the user.
 * Both are checked before a rephrase is accepted.
 */
const FORBIDDEN_IN_NOTE = /score|quality|rating|grade/i;

const STYLE_INSTRUCTIONS: Record<string, string> = {
  GENTLE: 'Be warm and unhurried. Never imply the user is behind.',
  BALANCED: 'Be plain. No cheerleading, no lecturing.',
  DIRECT: 'Be brief and concrete.',
};

export interface SummaryQuery {
  weekStart?: string;
  weeks?: number;
}

interface Displacement {
  count: number;
  eveningCount: number;
}

/**
 * Planned versus kept, per ritual, per week (issue #45, epic E08).
 *
 * ONE ENDPOINT, because E10's weekly review and E11's momentum both need these
 * numbers and two aggregations would eventually disagree — and the way they
 * would disagree is that one of them would invent a percentage. There is no
 * ratio in the payload: a consumer that wants `kept / planned` can divide, and
 * the API not doing it is what keeps it the reader's arithmetic rather than the
 * product's opinion (VISION §12).
 */
@Injectable()
export class FamilySummaryService {
  private readonly logger = new Logger(FamilySummaryService.name);

  /**
   * Rephrased sentences, keyed by the NUMBERS they contain.
   *
   * Per process, and that is a documented limitation rather than an oversight:
   * two replicas each rephrase once and a restart forgets, which costs one
   * cheap call and nothing else. Keying on the computed counts rather than on
   * the request window is deliberate — skipping a commitment changes the count,
   * which changes the key, so the user never reads a sentence that contradicts
   * the integers printed beside it. The cache's only job is to avoid asking the
   * model to rephrase a sentence it has already rephrased.
   */
  private readonly notes = new Map<string, { text: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly userProfile: UserProfileService,
  ) {}

  async getSummary(
    userId: string,
    query: SummaryQuery,
    now: Date = new Date(),
  ): Promise<FamilySummary> {
    const profile = await this.userProfile.find(userId);
    const timezone = safeTimeZone(profile?.timezone);

    const weeks = query.weeks ?? 4;
    const weekStart = query.weekStart ?? weekStartOfDate(localDate(now, timezone));

    if (weekdayOf(weekStart) !== 1) {
      throw new BadRequestException({
        message: 'weekStart must be a Monday',
        details: { reason: 'WEEK_START_NOT_MONDAY', weekStart },
      });
    }

    // Newest first: `weekStart` is the most recent week, and `weeks` counts
    // backwards from it inclusive.
    const starts = Array.from({ length: weeks }, (_, index) =>
      addDays(weekStart, -7 * index),
    );

    const rituals = await this.prisma.ritual.findMany({ where: { userId } });

    const windows = starts.map((start) => ({
      start,
      from: localDayBounds(start, timezone).start,
      to: localDayBounds(addDays(start, 7), timezone).start,
    }));

    const perWeek: FamilySummaryWeek[] = [];
    const allRows: Commitment[] = [];

    for (const window of windows) {
      const rows = await this.prisma.commitment.findMany({
        where: {
          userId,
          domain: 'FAMILY',
          status: { not: 'CANCELLED' },
          scheduledStart: { gte: window.from, lt: window.to },
        },
      });

      allRows.push(...rows);
      perWeek.push(this.aggregate(window.start, window.to, rows, rituals));
    }

    const displacement = await this.measureDisplacement(userId, allRows, timezone);
    const coachNote = await this.buildNote(userId, displacement, weeks, profile?.coachingStyle);

    return { timezone, weeks: perWeek, coachNote };
  }

  // ---------------------------------------------------------------------------

  /**
   * One week's counts.
   *
   * A ritual with no rows this week is still listed, at zero, when it was
   * active and already existed — the user planned nothing because nothing was
   * due, and hiding the line would make an every-other-week ritual look like it
   * had been abandoned.
   */
  private aggregate(
    weekStart: string,
    windowEnd: Date,
    rows: Commitment[],
    rituals: Ritual[],
  ): FamilySummaryWeek {
    const byRitual = new Map<string | null, RitualWeekCounts>();

    const blank = (ritualId: string | null, title: string): RitualWeekCounts => ({
      ritualId,
      title,
      planned: 0,
      kept: 0,
      partial: 0,
      moved: 0,
      skipped: 0,
      missed: 0,
      open: 0,
    });

    for (const ritual of rituals) {
      if (ritual.active && ritual.createdAt.getTime() < windowEnd.getTime()) {
        byRitual.set(ritual.id, blank(ritual.id, ritual.title));
      }
    }

    for (const row of rows) {
      const key = row.ritualId;
      const title =
        rituals.find((ritual) => ritual.id === key)?.title ??
        (key === null ? UNGROUPED_TITLE : row.title);

      const counts = byRitual.get(key) ?? blank(key, title);
      byRitual.set(key, counts);

      counts.planned += 1;

      if (row.status === 'COMPLETED') counts.kept += 1;
      else if (row.status === 'PARTIALLY_COMPLETED') counts.partial += 1;
      else if (row.status === 'RESCHEDULED') counts.moved += 1;
      else if (row.status === 'SKIPPED') counts.skipped += 1;
      else if (row.status === 'MISSED') counts.missed += 1;
      else counts.open += 1;
    }

    const list = [...byRitual.values()];

    const totals = COUNT_KEYS.reduce(
      (accumulator, key) => ({
        ...accumulator,
        [key]: list.reduce((sum, counts) => sum + counts[key], 0),
      }),
      {} as Omit<RitualWeekCounts, 'ritualId' | 'title'>,
    );

    return { weekStart, rituals: list, totals };
  }

  /**
   * How many family commitments something else took the time from.
   *
   * A SKIPPED row carries the reason on the commitment. A RESCHEDULED one does
   * not — E05's reschedule closes the original and opens a new row, and asks
   * for no reason — so it counts only when the user left a reflection whose
   * friction tag says the same thing. That asymmetry is deliberate: a move
   * without a stated reason is not evidence that work displaced anything, and
   * counting it would inflate the one number this sentence rests on.
   */
  private async measureDisplacement(
    userId: string,
    rows: Commitment[],
    timezone: string,
  ): Promise<Displacement> {
    const skipped = rows.filter(
      (row) => row.status === 'SKIPPED' && DISPLACEMENT_REASONS.has(row.skipReason ?? ''),
    );

    const moved = rows.filter((row) => row.status === 'RESCHEDULED');
    let taggedMoves: Commitment[] = [];

    if (moved.length > 0) {
      const reflections = await this.prisma.reflection.findMany({
        where: {
          userId,
          relatedType: 'commitment',
          relatedId: { in: moved.map((row) => row.id) },
        },
        select: { relatedId: true, frictionTags: true },
      });

      const displacedIds = new Set(
        reflections
          .filter((reflection) =>
            reflection.frictionTags.some((tag) => DISPLACEMENT_REASONS.has(tag)),
          )
          .map((reflection) => reflection.relatedId),
      );

      taggedMoves = moved.filter((row) => displacedIds.has(row.id));
    }

    const displaced = [...skipped, ...taggedMoves];

    return {
      count: displaced.length,
      eveningCount: displaced.filter(
        (row) => localHour(row.scheduledStart, timezone) >= EVENING_HOUR,
      ).length,
    };
  }

  private async buildNote(
    userId: string,
    displacement: Displacement,
    weeks: number,
    coachingStyle?: string | null,
  ): Promise<FamilySummary['coachNote']> {
    if (displacement.count < DISPLACEMENT_THRESHOLD) {
      this.logger.log(`family.summary user=${userId} weeks=${weeks} source=none`);

      return null;
    }

    const template = renderDisplacementNote({ ...displacement, weeks });
    const key = `${userId}:${weeks}:${displacement.count}:${displacement.eveningCount}`;

    const cached = this.notes.get(key);
    if (cached && Date.now() - cached.at < NOTE_CACHE_TTL_MS) {
      this.logger.log(`family.summary user=${userId} weeks=${weeks} source=ai cache=hit`);

      return { text: cached.text, source: 'ai' };
    }

    const result = await this.ai.invoke({
      persona: 'coach',
      userId,
      promptVersion: SUMMARY_NOTE_PROMPT_VERSION,
      instructions: [
        'Rephrase the given sentence about the user’s own week in at most two sentences.',
        'Keep every number exactly as given. Ask one question at the end.',
        'Never rate, score or judge the relationship or the other people involved.',
        STYLE_INSTRUCTIONS[coachingStyle ?? 'BALANCED'] ?? STYLE_INSTRUCTIONS.BALANCED,
      ].join(' '),
      input: JSON.stringify({ ...displacement, weeks, template }),
      schema: noteSchema,
      schemaName: SUMMARY_NOTE_SCHEMA_NAME,
    });

    if (!result.ok) {
      // PRD §120: the deterministic sentence is the product; the rephrase is a
      // nicety. Branch, never throw.
      this.logger.log(
        `family.summary user=${userId} weeks=${weeks} source=template reason=${result.error.code}`,
      );

      return { text: template, source: 'template' };
    }

    const text = result.output.text.trim();

    // THE NUMBERS ARE THE SERVER'S. A rephrase that lost or changed the count
    // is a sentence about a week that did not happen.
    if (!text.includes(String(displacement.count)) || FORBIDDEN_IN_NOTE.test(text)) {
      this.logger.log(
        `family.summary user=${userId} weeks=${weeks} source=template reason=rephrase_rejected`,
      );

      return { text: template, source: 'template' };
    }

    this.notes.set(key, { text, at: Date.now() });
    this.logger.log(`family.summary user=${userId} weeks=${weeks} source=ai`);

    return { text, source: 'ai' };
  }
}
