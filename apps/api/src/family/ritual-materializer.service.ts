import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Ritual } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { localDayBounds, safeTimeZone } from '../today/local-date';
import { parseRecurrence } from './family.mapper';
import { addDays, localDateOf, nextOccurrences } from './recurrence';

/**
 * How far ahead occurrences are created.
 *
 * Seven days, and not more, on purpose. A ritual that is edited or paused has
 * to cancel its future occurrences, and every extra week of horizon is another
 * week of rows to cancel and another week in which a "Tue/Thu/Sun" the user
 * changed their mind about is sitting in the database looking authoritative.
 * Seven days is also exactly what `/path/family`'s Upcoming panel shows, so
 * nothing is materialized that nobody can see.
 */
export const MATERIALIZE_HORIZON_DAYS = 7;

/** How many rituals one cron run pulls at a time. */
const MATERIALIZE_PAGE_SIZE = 200;

export interface MaterializeResult {
  created: number;
  skipped: number;
  /** The local date the ritual is now covered through, `YYYY-MM-DD`. */
  through: string;
}

/**
 * Turning a ritual into real commitments (issue #41, epic E08).
 *
 * A RITUAL IS A RULE; TODAY RANKS ROWS. `GET /today` (E05-01) reads
 * `Commitment` rows and nothing else, and so does the Path, the summary and
 * E11's momentum. If a ritual stayed a rule, it would be invisible to all four
 * — so it is expanded ahead of time into ordinary commitments that the ordinary
 * lifecycle then completes, moves and skips. Nothing in this epic re-implements
 * that lifecycle.
 *
 * IDEMPOTENCY IS THE UNIQUE INDEX, NOT A TRANSACTION. Occurrences are inserted
 * one at a time and `P2002` on `(ritual_id, scheduled_start)` is counted as
 * `skipped`. That is what makes the cron, an on-demand call and a retry after a
 * half-finished run all safe, and — crucially — what makes a row the user has
 * already touched untouchable: a `COMPLETED` occurrence collides on the index
 * and is skipped, rather than being found, inspected and possibly overwritten.
 */
@Injectable()
export class RitualMaterializerService {
  private readonly logger = new Logger(RitualMaterializerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every instant this ritual SHOULD occupy between `now` and the horizon.
   *
   * Distinct from what `materialize` walks, which starts at
   * `lastMaterializedThrough` and therefore answers "what is missing" rather
   * than "what should exist". The edit path needs the second question: it has
   * to tell an occurrence the new rule still wants from one it no longer does.
   */
  async desiredOccurrences(
    userId: string,
    ritual: Ritual,
    now: Date = new Date(),
    timezone?: string,
  ): Promise<{ zone: string; throughLocal: string; starts: Date[] }> {
    const zone = safeTimeZone(timezone ?? (await this.timezoneOf(userId)));
    const throughLocal = addDays(localDateOf(now, zone), MATERIALIZE_HORIZON_DAYS);
    const horizonEnd = localDayBounds(throughLocal, zone).end;

    const starts = nextOccurrences(
      parseRecurrence(ritual.recurrence),
      now,
      horizonEnd,
      zone,
      ritual.createdAt,
    ).map((occurrence) => occurrence.scheduledStart);

    return { zone, throughLocal, starts };
  }

  /**
   * The fields an occurrence carries from its ritual.
   *
   * Shared by the insert and by the edit path's in-place refresh, so a row the
   * user has not touched shows the new title and the new durations rather than
   * the ones the rule had when it was created.
   */
  contentFor(ritual: Ritual): Prisma.CommitmentUncheckedUpdateInput {
    // The three sizes come straight from the ritual (PRD §57). `shortVersion`
    // is only offered when there is real room between the ideal and the
    // minimum — below ten minutes of spread the "short" version is the same
    // decision as the minimum one wearing a different label, and a third
    // identical choice makes the card harder to read, not easier.
    const spread = ritual.idealMinutes - ritual.minimumMinutes;
    const hasShort = spread >= 10;

    return {
      title: ritual.title,
      familyMemberId: ritual.familyMemberId,
      routineId: ritual.routineId,
      fullVersion: ritual.title,
      fullMinutes: ritual.idealMinutes,
      shortVersion: hasShort ? ritual.title : null,
      shortMinutes: hasShort
        ? Math.round((ritual.idealMinutes + ritual.minimumMinutes) / 2)
        : null,
      // The fallback text IS the minimum version's title when the user wrote
      // one: "Sit down phone-free for the first 10 minutes" is a better bad-day
      // instruction than the ritual's own name.
      minimumVersion: ritual.fallbackBehavior ?? ritual.title,
      minimumMinutes: ritual.minimumMinutes,
    };
  }

  /**
   * Create every missing occurrence of one ritual inside the horizon.
   *
   * Call it AFTER the ritual's own write has committed and OUTSIDE any
   * transaction: the guarantee here is the index, and holding a transaction
   * open across a dozen inserts buys nothing and blocks the row.
   */
  async materialize(
    userId: string,
    ritual: Ritual,
    now: Date = new Date(),
    timezone?: string,
  ): Promise<MaterializeResult> {
    const zone = safeTimeZone(timezone ?? (await this.timezoneOf(userId)));
    const todayLocal = localDateOf(now, zone);
    const throughLocal = addDays(todayLocal, MATERIALIZE_HORIZON_DAYS);
    // The END of the horizon day, so an occurrence late on the seventh day is
    // inside the window rather than a day beyond it.
    const horizonEnd = localDayBounds(throughLocal, zone).end;

    if (!ritual.active) {
      // A paused ritual is not a deleted one: its existing rows stay, and
      // `lastMaterializedThrough` stays where it was so resuming re-creates
      // exactly what pausing cancelled.
      return { created: 0, skipped: 0, through: ritual.lastMaterializedThrough
        ? ritual.lastMaterializedThrough.toISOString().slice(0, 10)
        : todayLocal };
    }

    // Start from whichever is later: now, or the end of what is already
    // covered. Re-walking covered ground is safe (the index catches it) but
    // pointless, and starting before `now` would materialize the past.
    const coveredThrough = ritual.lastMaterializedThrough
      ? localDayBounds(ritual.lastMaterializedThrough.toISOString().slice(0, 10), zone).end
      : null;
    const from =
      coveredThrough && coveredThrough.getTime() > now.getTime() ? coveredThrough : now;

    const occurrences = nextOccurrences(
      parseRecurrence(ritual.recurrence),
      from,
      horizonEnd,
      zone,
      ritual.createdAt,
    );

    let created = 0;
    let skipped = 0;

    for (const occurrence of occurrences) {
      try {
        await this.prisma.commitment.create({
          data: this.occurrenceData(userId, ritual, occurrence.scheduledStart),
        });
        created += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped += 1;
          continue;
        }

        throw error;
      }
    }

    await this.prisma.ritual.update({
      where: { id: ritual.id },
      data: { lastMaterializedThrough: new Date(`${throughLocal}T00:00:00.000Z`) },
    });

    if (created > 0) {
      // Audited only when something was actually written. The cron visits every
      // ritual every night; auditing a no-op would add 365 rows a year per
      // ritual to a table whose whole value is that everything in it happened.
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'ritual:materialize',
          targetType: 'ritual',
          targetId: ritual.id,
          meta: { created, skipped, through: throughLocal },
        },
      });
    }

    return { created, skipped, through: throughLocal };
  }

  /**
   * The nightly sweep.
   *
   * Each ritual runs in its own try/catch: one user's unparseable recurrence or
   * unusable timezone must not stop every other user's dinner from appearing.
   */
  async materializeAllDue(now: Date = new Date()): Promise<{ rituals: number; created: number }> {
    let cursor: string | undefined;
    let rituals = 0;
    let created = 0;

    for (;;) {
      const page: Array<Ritual & { user: { profile: { timezone: string | null } | null } }> =
        await this.prisma.ritual.findMany({
          where: { active: true },
          include: { user: { select: { profile: { select: { timezone: true } } } } },
          orderBy: { id: 'asc' },
          take: MATERIALIZE_PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

      if (page.length === 0) break;

      for (const ritual of page) {
        rituals += 1;

        try {
          const result = await this.materialize(
            ritual.userId,
            ritual,
            now,
            ritual.user.profile?.timezone ?? undefined,
          );
          created += result.created;
        } catch (error) {
          this.logger.warn(
            `ritual.materialize failed ritual=${ritual.id}: ${(error as Error).message}`,
          );
        }
      }

      cursor = page[page.length - 1]!.id;
      if (page.length < MATERIALIZE_PAGE_SIZE) break;
    }

    return { rituals, created };
  }

  /** One occurrence, as a commitment. Content from `contentFor`. */
  private occurrenceData(
    userId: string,
    ritual: Ritual,
    scheduledStart: Date,
  ): Prisma.CommitmentUncheckedCreateInput {
    return {
      ...(this.contentFor(ritual) as Prisma.CommitmentUncheckedCreateInput),
      userId,
      domain: 'FAMILY',
      status: 'PLANNED',
      scheduledStart,
      scheduledEnd: new Date(scheduledStart.getTime() + ritual.idealMinutes * 60_000),
      // Family rituals outrank an average commitment by default: they are the
      // thing PRD §30 says work displaces, and the whole point of protecting
      // them is that they do not lose every tie.
      importance: 4,
      ritualId: ritual.id,
    };
  }

  private async timezoneOf(userId: string): Promise<string | null> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });

    return profile?.timezone ?? null;
  }
}
