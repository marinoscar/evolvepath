import { useCallback, useEffect, useState } from 'react';

import type { Domain, DomainMode, DomainModeKind } from '../types';
import { getDomainModes, setDomainMode } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseDomainModesResult {
  /** Always three, in WORK/FAMILY/HEALTH order — the API synthesises the gaps. */
  modes: DomainMode[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setMode: (domain: Domain, mode: DomainModeKind, reason?: string | null) => Promise<DomainMode>;
}

export function useDomainModes(): UseDomainModesResult {
  const [modes, setModes] = useState<DomainMode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getDomainModes();
      if (isMounted()) setModes(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load domain modes';
      if (isMounted()) {
        setError(message);
        setModes([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  const setMode = useCallback(
    async (domain: Domain, mode: DomainModeKind, reason?: string | null) => {
      setError(null);
      try {
        const saved = await setDomainMode(domain, { mode, reason });
        // Replaces one entry in place: the list is a fixed three in a fixed
        // order, so there is nothing a refetch would reorder.
        if (isMounted()) {
          setModes((current) =>
            current.map((entry) => (entry.domain === domain ? saved : entry)),
          );
        }
        return saved;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to change the mode';
        if (isMounted()) setError(message);
        throw err;
      }
    },
    [isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { modes, isLoading, error, refresh, setMode };
}
