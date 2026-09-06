import { Injectable, Logger } from '@nestjs/common';
import type { Commitment } from '@prisma/client';

import { toCommitmentCard } from '../commitments/commitment-card.mapper';
import { DOMAINS } from '../path/domain.schema';
import { elapsedSeconds } from '../commitments/actions/commitment-timer';
import { DOMAINS as ALL_DOMAINS } from '../path/domain.schema';
import { MomentumService } from '../progress/momentum/momentum.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { AvoidanceService } from '../work/avoidance/avoidance.service';
import type { AvoidanceAssessment } from '../work/avoidance/avoidance-detector';
import type { MomentumSummaryPayload } from './today.schema';
import { greetingFor } from './local-date';
import { CandidateLoaderService, type TodayCandidates } from './nba/candidate-loader.service';
import { resolveInterventionMode } from './nba/intervention-mode';
import { chooseVersion, fallbackFor } from './nba/nba-sizing';
import {
  confidenceOf,
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type Domain,
} from './nba/nba-scorer';
import { rationaleFor, stateLineFor } from './nba/rationale-templates';
import type { NextBestAction, TodayResponse } from './today.schema';

// =============================================================================
// GET /today (issue #38, epic E05)
// =============================================================================
//
// The composition: load once, size each candidate, rank, resolve a posture,
// build a sentence. Every step is a pure function except the load.
//
// THIS METHOD NEVER CALLS AI. Not "has a short timeout" — never calls it. PRD
// §120 requires the whole screen to render with the provider down, and the only
// way to be sure of that is for the code path not to exist. The coach's sentence
// arrives separately from `GET /today/insight`.
// =============================================================================

@Injectable()
export class TodayService {
  private readonly logger = new Logger(TodayService.name);

  constructor(
    private readonly loader: CandidateLoaderService,
    private readonly momentum: MomentumService,
    private readonly profiles: UserProfileService,
    private readonly avoidance: AvoidanceService,
  ) {}

  async getToday(userId: string, now: Date = new Date()): Promise<TodayResponse> {
    const [loaded, momentum, profile] = await Promise.all([
      this.loader.load(userId, now),
      this.momentumOrDegraded(userId, now),
      this.profiles.find(userId),
    ]);

    const avoidance = await this.avoidanceOrEmpty(userId, loaded.rows, now, loaded.timeZone);

    const scored = this.rank(loaded);
    const nextBestAction = this.buildNextBestAction(loaded, scored, avoidance);

    return {
      greeting: greetingFor(now, loaded.timeZone),
      stateLine: stateLineFor({
        commitmentCount: loaded.rows.length,
        pausedDomains: DOMAINS.filter(
          (domain) => loaded.domainModes[domain as Domain] === 'PAUSE',
        ) as Domain[],
        maintainDomains: DOMAINS.filter(
          (domain) => loaded.domainModes[domain as Domain] === 'MAINTAIN',
        ) as Domain[],
      }),
      dateLocal: loaded.dateLocal,
      timeZone: loaded.timeZone,
      checkIn: loaded.context.checkIn ? { feel: loaded.context.checkIn } : null,
      nextBestAction,
      // Always three, in canonical order — including the empty and the paused.
      // A domain that vanishes because nothing is scheduled looks like data loss.
      domains: DOMAINS.map((domain) => ({
        domain,
        mode: loaded.domainModes[domain as Domain],
        commitments: loaded.rows
          .filter((row) => row.domain === domain)
          // `avoidance` is null for every non-WORK card by construction: the
          // map only ever contains WORK ids.
          .map((row) => toCommitmentCard(row, now, avoidance.get(row.id) ?? null)),
      })),
      momentum,
      // A pointer, never a backlog. The restart row is an ordinary commitment
      // and already appears on its own domain card.
      comeback:
        profile && profile.comebackState !== 'NONE' && profile.comebackOfferedAt
          ? {
              state: profile.comebackState,
              restartCommitmentId: profile.comebackCommitmentId,
              offeredAt: profile.comebackOfferedAt.toISOString(),
            }
          : null,
      coachInsight: null,
    };
  }

  /**
   * The ladder, or nothing at all.
   *
   * `GET /today` MUST NOT FAIL BECAUSE THE ASSESSMENT FAILED. The screen is
   * about the next hour; a ladder reading is a secondary annotation on it, and
   * degrading to `avoidance: null` says "no reading" while the day still
   * renders — the same bargain `momentumOrDegraded` makes below.
   */
  private async avoidanceOrEmpty(
    userId: string,
    rows: Commitment[],
    now: Date,
    timeZone: string,
  ): Promise<Map<string, AvoidanceAssessment>> {
    try {
      return await this.avoidance.assessMany(userId, rows, now, timeZone);
    } catch (error) {
      this.logger.warn(
        `avoidance unavailable for today: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return new Map();
    }
  }

  /**
   * Momentum, or an honest shrug.
   *
   * Progress is a SECONDARY reading on this screen; the day still has to render
   * when its query fails. Degrading to `INSUFFICIENT_DATA` says "no reading"
   * rather than inventing a state, and the whole screen stays a 200.
   */
  private async momentumOrDegraded(
    userId: string,
    now: Date,
  ): Promise<Record<'WORK' | 'FAMILY' | 'HEALTH', MomentumSummaryPayload>> {
    try {
      return (await this.momentum.summary(userId, now)) as Record<
        'WORK' | 'FAMILY' | 'HEALTH',
        MomentumSummaryPayload
      >;
    } catch (error) {
      this.logger.warn(
        `momentum unavailable for today: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return Object.fromEntries(
        ALL_DOMAINS.map((domain) => [
          domain,
          { state: 'INSUFFICIENT_DATA' as const, headline: null },
        ]),
      ) as Record<'WORK' | 'FAMILY' | 'HEALTH', MomentumSummaryPayload>;
    }
  }

  /** Size each candidate, then rank. Sizing first: the score depends on it. */
  private rank(loaded: TodayCandidates): CandidateInput[] {
    const inputs: CandidateInput[] = loaded.candidates.map((commitment) => ({
      commitment,
      context: loaded.context,
      chosenMinutes: chooseVersion({
        versions: commitment.versions,
        checkIn: loaded.context.checkIn,
        availableMinutesRemaining: loaded.context.availableMinutesRemaining,
      }).durationMinutes,
    }));

    return rankCandidates(inputs);
  }

  private buildNextBestAction(
    loaded: TodayCandidates,
    ranked: CandidateInput[],
    avoidance: Map<string, AvoidanceAssessment>,
  ): NextBestAction | null {
    if (ranked.length === 0) return null;

    // THE PRE-RULE: something already in progress IS the next best action.
    // Ranking a started commitment against the rest would let the engine tell a
    // user to abandon what they are doing, which is never the right advice from
    // a screen they opened mid-session.
    const startedId = loaded.context.startedCommitmentId;
    const started = startedId ? ranked.find((c) => c.commitment.id === startedId) : undefined;

    // Confidence is defined from the full ranking either way, so the number
    // means the same thing whether or not the pre-rule fired.
    const confidence = confidenceOf(
      ranked.map((candidate) => scoreCandidate(candidate).score),
    );

    if (started) {
      const row = loaded.rows.find((r) => r.id === startedId);
      const remaining = this.remainingMinutes(row, loaded.context.now);

      return {
        commitmentId: started.commitment.id,
        title: started.commitment.versions.full.title,
        domain: started.commitment.domain,
        durationMinutes: remaining ?? started.chosenMinutes,
        version: 'full',
        rationale: 'You already started this — continue.',
        fallback: fallbackFor(
          { versions: started.commitment.versions },
          { version: 'full', title: '', durationMinutes: 0 },
        ),
        interventionMode: 'ACT',
        confidence,
      };
    }

    const top = ranked[0];
    const chosen = chooseVersion({
      versions: top.commitment.versions,
      checkIn: loaded.context.checkIn,
      availableMinutesRemaining: loaded.context.availableMinutesRemaining,
    });

    const outcome = top.commitment.id
      ? loaded.outcomeById.get(
          loaded.rows.find((row) => row.id === top.commitment.id)?.outcomeId ?? '',
        )
      : undefined;

    const topAvoidance = avoidance.get(top.commitment.id) ?? null;

    const mode = resolveInterventionMode({
      daysSinceLastEvidence: loaded.daysSinceLastEvidence,
      hasAnyEvidence: loaded.hasAnyEvidence,
      routineFailuresLast14Days: this.routineFailuresFor(loaded, top.commitment.id),
      avoidanceLevel: topAvoidance?.level ?? null,
      checkIn: loaded.context.checkIn,
      chosenMinutes: chosen.durationMinutes,
      availableMinutesRemaining: loaded.context.availableMinutesRemaining,
      outcomeLacksMeaning: !outcome?.motivation && !outcome?.successDefinition,
      completionsLast7Days: loaded.completionsLast7Days,
      missesLast7Days: loaded.missesLast7Days,
    });

    return {
      commitmentId: top.commitment.id,
      title: chosen.title,
      domain: top.commitment.domain,
      durationMinutes: chosen.durationMinutes,
      version: chosen.version,
      // The ladder's own sentence carries the counts ("moved 2 times,
      // untouched for 4 days"), which is exactly the evidence the posture's
      // template does not have. Appended rather than replacing it: the template
      // says what to DO and the rationale says why the product thinks so.
      rationale:
        rationaleFor(mode, {
          title: chosen.title,
          minutes: chosen.durationMinutes,
          domain: top.commitment.domain,
          rescheduleCount: top.commitment.rescheduleCount,
          whyItMatters: outcome?.motivation ?? null,
          availableMinutesRemaining: loaded.context.availableMinutesRemaining,
        }) + (topAvoidance && topAvoidance.level >= 1 ? ` ${topAvoidance.rationale}` : ''),
      fallback: fallbackFor({ versions: top.commitment.versions }, chosen),
      interventionMode: mode,
      confidence,
    };
  }

  private routineFailuresFor(loaded: TodayCandidates, commitmentId: string): number {
    const routineId = loaded.rows.find((row) => row.id === commitmentId)?.routineId;

    return routineId ? (loaded.routineFailuresLast14Days.get(routineId) ?? 0) : 0;
  }

  /** What is left on a running timer, rounded up so "0 min" never shows. */
  private remainingMinutes(row: Commitment | undefined, now: Date): number | null {
    if (!row?.timerMinutes) return null;

    const elapsed = elapsedSeconds(
      { activeSince: row.activeSince, activeSeconds: row.activeSeconds },
      now,
    );

    return Math.max(1, Math.ceil((row.timerMinutes * 60 - elapsed) / 60));
  }
}
