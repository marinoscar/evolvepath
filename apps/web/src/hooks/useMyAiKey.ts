/**
 * Load, save, test and remove the caller's own OpenAI key.
 *
 * Issue #28, epic #20. Same `isMounted` discipline and same "an error is a
 * string the page renders" contract as `useEmailSettings` / `useAiSettings`,
 * with one behaviour neither of those has:
 *
 * -----------------------------------------------------------------------------
 * A SUCCESSFUL SAVE OR REMOVE REFRESHES THE AUTH USER
 * -----------------------------------------------------------------------------
 *
 * `user.aiKey.configured` on `AuthContext` is what `RequireAiKey` (#29) gates
 * the entire app shell on. Without a refresh here, saving a key on the setup
 * page would leave the gate still reading `false` and bounce the user straight
 * back to setup, and removing one on the settings page would leave them inside
 * a shell they no longer have a key for. `refreshUser()` is called rather than
 * a hand-rolled `GET /auth/me` so the context stays the only writer of its own
 * state.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ApiError,
  deleteMyAiKey,
  getMyAiKey,
  setMyAiKey,
  testMyAiKey,
} from '../services/api';
import type { AiTestResult, MyAiKeyStatus } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useIsMounted } from './useIsMounted';

interface UseMyAiKeyReturn {
  status: MyAiKeyStatus | null;
  isLoading: boolean;
  loadError: string | null;
  isSaving: boolean;
  saveError: string | null;
  isTesting: boolean;
  testResult: AiTestResult | null;
  isRemoving: boolean;
  /** Resolves `true` when the key was stored — never throws. */
  save: (apiKey: string) => Promise<boolean>;
  test: () => Promise<void>;
  /** Resolves `true` when the key was removed — never throws. */
  remove: () => Promise<boolean>;
  clearTestResult: () => void;
  clearSaveError: () => void;
  refresh: () => Promise<void>;
}

export function useMyAiKey(): UseMyAiKeyReturn {
  const { refreshUser } = useAuth();

  const [status, setStatus] = useState<MyAiKeyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const isMounted = useIsMounted();

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await getMyAiKey();
      if (isMounted()) setStatus(data);
    } catch (err) {
      if (isMounted()) {
        setLoadError(
          err instanceof ApiError ? err.message : 'Failed to load your key status',
        );
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const save = useCallback(
    async (apiKey: string): Promise<boolean> => {
      try {
        setIsSaving(true);
        setSaveError(null);
        const data = await setMyAiKey(apiKey);
        if (isMounted()) {
          setStatus(data);
          // The previous test described a different key.
          setTestResult(null);
        }
        // NOT guarded by `isMounted`: the whole point is that the gate
        // re-evaluates, and the component unmounting is the SUCCESS case on the
        // setup page — it is replaced by the app shell the moment this lands.
        await refreshUser();
        return true;
      } catch (err) {
        if (isMounted()) {
          // The API's message verbatim: "That key looks too short" and "An API
          // key cannot contain spaces" are both actionable, and flattening them
          // to "failed to save" throws away the only clue.
          setSaveError(err instanceof ApiError ? err.message : 'Failed to save your key');
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted, refreshUser],
  );

  /**
   * Probe the stored key.
   *
   * TWO KINDS OF FAILURE, ONE SURFACE — the endpoint answers 200 with
   * `{ success: false, error }` for a refused key, and rejects only when the
   * call itself fails (a 429 from the throttle, a dropped connection). Both are
   * failed tests, so both land in the same `testResult`.
   */
  const test = useCallback(async () => {
    try {
      setIsTesting(true);
      setTestResult(null);
      const result = await testMyAiKey();
      if (isMounted()) setTestResult(result);
    } catch (err) {
      if (isMounted()) {
        setTestResult({
          success: false,
          error: err instanceof ApiError ? err.message : 'The test request could not be sent',
        });
      }
    } finally {
      if (isMounted()) setIsTesting(false);
    }
  }, [isMounted]);

  const remove = useCallback(async (): Promise<boolean> => {
    try {
      setIsRemoving(true);
      setSaveError(null);
      await deleteMyAiKey();
      if (isMounted()) {
        setTestResult(null);
        await fetchStatus();
      }
      // Same reasoning as `save`: the gate must re-evaluate, and this component
      // is about to be replaced by the setup page.
      await refreshUser();
      return true;
    } catch (err) {
      if (isMounted()) {
        setSaveError(err instanceof ApiError ? err.message : 'Failed to remove your key');
      }
      return false;
    } finally {
      if (isMounted()) setIsRemoving(false);
    }
  }, [isMounted, fetchStatus, refreshUser]);

  const clearTestResult = useCallback(() => setTestResult(null), []);
  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    status,
    isLoading,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    isRemoving,
    save,
    test,
    remove,
    clearTestResult,
    clearSaveError,
    refresh: fetchStatus,
  };
}
