import { useCallback, useEffect, useState } from 'react';

import type { Milestone } from '../types';
import { acknowledgeMilestone, getMilestones } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseMilestoneToastsResult {
  /** The one milestone currently being celebrated, or null. */
  current: Milestone | null;
  dismiss: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * One celebration at a time (issue #117, epic E11).
 *
 * PRD §77: "celebrations must match significance" and "avoid constant
 * confetti". A user who earned three milestones in one sweep gets three
 * sentences in a row, not three overlapping toasts — so the queue is drained
 * one at a time and each is acknowledged as it closes.
 *
 * ACKNOWLEDGING IS WHAT MAKES IT ONCE. The server holds `acknowledgedAt`, so
 * the toast does not come back after a reload; a client-side "seen" set would
 * lose that on the next device.
 *
 * A failing poll is silent. The screen behind it is the point; a milestone the
 * user does not see today is a milestone they see tomorrow.
 */
export function useMilestoneToasts(): UseMilestoneToastsResult {
  const [queue, setQueue] = useState<Milestone[]>([]);
  const isMounted = useIsMounted();

  const reload = useCallback(async () => {
    try {
      const result = await getMilestones({ unacknowledged: true });
      if (isMounted()) setQueue(result.items);
    } catch {
      // Deliberately silent — see the header.
    }
  }, [isMounted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dismiss = useCallback(async () => {
    const [head, ...rest] = queue;
    if (!head) return;

    // Removed from the queue FIRST: the next toast should appear immediately,
    // and a slow acknowledgement must not hold the celebration open.
    setQueue(rest);

    try {
      await acknowledgeMilestone(head.id);
    } catch {
      // The row stays unacknowledged and comes back on the next load, which is
      // the right failure: a milestone shown twice beats one never shown.
    }
  }, [queue]);

  return { current: queue[0] ?? null, dismiss, reload };
}
