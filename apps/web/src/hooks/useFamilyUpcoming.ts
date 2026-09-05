import { useCallback, useEffect, useState } from 'react';

import type { Commitment, CommitmentCard } from '../types';
import { getCommitments } from '../services/api';
import { useIsMounted } from './useIsMounted';

/** The materialization horizon, matching `MATERIALIZE_HORIZON_DAYS` on the API. */
export const FAMILY_HORIZON_DAYS = 7;

/**
 * A `Commitment` from `GET /commitments` as the card `CommitmentRow` renders.
 *
 * The two shapes overlap but are not the same: the list endpoint sends the
 * stored row with `allowedTransitions`, while the row renders `availableActions`
 * and a derived `durationMinutes`. Adapting in ONE place — rather than in each
 * page, or by adding a second endpoint — keeps the reconciliation surface at
 * this function.
 *
 * `availableActions` is derived from the SERVER's `allowedTransitions`, never
 * from a local opinion about what a status permits. A bundle running yesterday's
 * rules must not offer a move the API refuses.
 */
export function commitmentToCard(row: Commitment): CommitmentCard {
  const fullMinutes = row.fullMinutes ?? 25;
  const canAct = row.allowedTransitions.includes('COMPLETED');

  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    durationMinutes: fullMinutes,
    versions: {
      full: { title: row.fullVersion ?? row.title, minutes: fullMinutes },
      short:
        row.shortVersion && row.shortMinutes
          ? { title: row.shortVersion, minutes: row.shortMinutes }
          : null,
      minimum:
        row.minimumVersion && row.minimumMinutes
          ? { title: row.minimumVersion, minutes: row.minimumMinutes }
          : null,
    },
    importance: row.importance,
    rescheduleCount: row.rescheduleCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    versionUsed: null,
    minutesSpent: null,
    outcomeId: row.outcomeId,
    ritualId: row.ritualId,
    familyMemberId: row.familyMemberId,
    decomposedFromId: null,
    steps: null,
    timer: null,
    availableActions: canAct
      ? (['complete', 'reschedule', 'skip'] as CommitmentCard['availableActions'])
      : [],
  };
}

interface UseFamilyUpcomingResult {
  commitments: CommitmentCard[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/** The next seven days of FAMILY commitments, as cards. */
export function useFamilyUpcoming(): UseFamilyUpcomingResult {
  const [commitments, setCommitments] = useState<CommitmentCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const from = new Date();
    const to = new Date(from.getTime() + FAMILY_HORIZON_DAYS * 24 * 3600_000);

    try {
      const rows = await getCommitments({
        from: from.toISOString(),
        to: to.toISOString(),
        domain: 'FAMILY',
      });
      if (isMounted()) setCommitments(rows.map(commitmentToCard));
    } catch {
      // Survivable: the surrounding page is about the rules, not this list.
      if (isMounted()) setCommitments([]);
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { commitments, isLoading, refresh };
}
