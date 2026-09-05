import { useCallback, useEffect, useState } from 'react';

import type { FamilyMember, FamilyMemberInput } from '../types';
import {
  createFamilyMember,
  deleteFamilyMember,
  getFamilyMembers,
  updateFamilyMember,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseFamilyMembersOptions {
  /**
   * Whether to fetch at all. Defaults to true.
   *
   * Today passes `false` until its own data has arrived, and that is not an
   * optimisation. A request fired at mount races the boot token refresh: it
   * lands before `AuthContext` has an access token, gets a 401, and starts a
   * second refresh whose rotation collides with the first — which the API
   * correctly reads as refresh-token reuse and answers by revoking the
   * session. The user is bounced to the login screen by a birthday cue.
   *
   * Waiting until the screen has data is also simply right: the cue decorates
   * a card that does not exist yet.
   */
  enabled?: boolean;
}

interface UseFamilyMembersResult {
  members: FamilyMember[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: FamilyMemberInput) => Promise<FamilyMember>;
  update: (id: string, patch: Partial<FamilyMemberInput>) => Promise<FamilyMember>;
  remove: (id: string) => Promise<void>;
}

/**
 * The people the user shares rituals with.
 *
 * Nothing about a member is cached in `localStorage`, here or anywhere: these
 * are other people's names, recorded without their knowledge (VISION §50), and
 * they belong in memory for the length of a session and nowhere else.
 */
export function useFamilyMembers(
  options: UseFamilyMembersOptions = {},
): UseFamilyMembersResult {
  const { enabled = true } = options;
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await getFamilyMembers();
      if (isMounted()) setMembers(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load family members';
      if (isMounted()) {
        setError(message);
        setMembers([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [enabled, isMounted]);

  // Every mutation refetches rather than splicing: the API orders by creation
  // and reproducing that here would be a second implementation of it.
  const create = useCallback(
    async (input: FamilyMemberInput) => {
      setError(null);
      try {
        const created = await createFamilyMember(input);
        await refresh();
        return created;
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Failed to add that person');
        }
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const update = useCallback(
    async (id: string, patch: Partial<FamilyMemberInput>) => {
      setError(null);
      try {
        const updated = await updateFamilyMember(id, patch);
        await refresh();
        return updated;
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Failed to save that change');
        }
        throw err;
      }
    },
    [refresh, isMounted],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteFamilyMember(id);
        await refresh();
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'Failed to remove that person');
        }
        throw err;
      }
    },
    [refresh, isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { members, isLoading, error, refresh, create, update, remove };
}
