import { useCallback, useEffect, useState } from 'react';

import type { WeeklySettings } from '../types';
import { getWeeklySettings, updateWeeklySettings } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseWeeklySettingsResult {
  settings: WeeklySettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (body: { weeklyReviewWeekday: number; weeklyReviewTime: string }) => Promise<void>;
}

/** The day and time the weekly review is prepared (issue #84, epic E10). */
export function useWeeklySettings(): UseWeeklySettingsResult {
  const [settings, setSettings] = useState<WeeklySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    void (async () => {
      try {
        const found = await getWeeklySettings();
        if (isMounted()) setSettings(found);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load your rhythm';
        if (isMounted()) setError(message);
      } finally {
        if (isMounted()) setIsLoading(false);
      }
    })();
  }, [isMounted]);

  const save = useCallback(
    async (body: { weeklyReviewWeekday: number; weeklyReviewTime: string }) => {
      setIsSaving(true);
      setError(null);
      try {
        // The response carries a recomputed `nextReviewAt`, so the page shows
        // the server's answer rather than a locally derived guess at it.
        const saved = await updateWeeklySettings(body);
        if (isMounted()) setSettings(saved);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save your rhythm';
        if (isMounted()) setError(message);
        throw err;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted],
  );

  return { settings, isLoading, isSaving, error, save };
}
