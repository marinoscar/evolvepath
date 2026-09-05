import { useCallback, useEffect, useState } from 'react';

import type { CoachConversation } from '../types';
import {
  createCoachConversation,
  deleteCoachConversation,
  getCoachConversations,
} from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseCoachConversationsResult {
  conversations: CoachConversation[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (title?: string) => Promise<CoachConversation>;
  remove: (id: string) => Promise<void>;
}

export function useCoachConversations(): UseCoachConversationsResult {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getCoachConversations();
      if (isMounted()) setConversations(result.items);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load your conversations';
      if (isMounted()) {
        setError(message);
        setConversations([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  // Refetch rather than splice: the API orders by `lastMessageAt`, and
  // reproducing that here would be a second implementation of it.
  const create = useCallback(
    async (title?: string) => {
      const created = await createCoachConversation(title);
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteCoachConversation(id);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, isLoading, error, refresh, create, remove };
}
