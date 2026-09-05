import { useCallback, useEffect, useState } from 'react';

import { getNotificationPolicy, updateNotificationPolicy } from '../services/api';
import type { NotificationPolicy, NotificationPolicyPatch } from '../types';
import { useIsMounted } from './useIsMounted';

export interface UseNotificationPolicy {
  policy: NotificationPolicy | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  update: (patch: NotificationPolicyPatch) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * The coaching policy, for `/settings/notifications` (#68, epic E12).
 *
 * ITS OWN HOOK, not part of `useUserSettings`. The policy is not in the
 * `user_settings` JSON document at all — quiet hours are columns on
 * `user_profiles` and the caps are a separate column beside them — so it has a
 * different endpoint, a different concurrency story (no `If-Match`) and a
 * different failure mode. Routing it through the settings document would mean
 * either lying about where it lives or teaching that hook a second backend.
 *
 * MUTATIONS REFETCH RATHER THAN SPLICE, in the same sense the Path hooks do:
 * the server's response IS the new state, including any value it clamped or
 * normalised, so the control shows what was actually stored.
 */
export function useNotificationPolicy(): UseNotificationPolicy {
  const isMounted = useIsMounted();
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await getNotificationPolicy();
      if (isMounted()) {
        setPolicy(next);
        setError(null);
      }
    } catch (err) {
      if (isMounted()) {
        setError(err instanceof Error ? err.message : 'Could not load your coaching settings');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: NotificationPolicyPatch) => {
      setIsSaving(true);
      try {
        const next = await updateNotificationPolicy(patch);
        if (isMounted()) {
          setPolicy(next);
          setError(null);
        }
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Could not save that');
          // Re-read rather than keep the optimistic value: a control showing a
          // cap the server rejected is a page that lies about what the coach
          // will do.
          await refresh();
        }
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted, refresh],
  );

  return { policy, isLoading, error, isSaving, update, refresh };
}
