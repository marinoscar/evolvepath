/**
 * Load, save, refresh and test the deployment's AI configuration.
 *
 * Issue #27, epic #20. A near-twin of `useEmailSettings` — same `isMounted`
 * discipline, same "an error is a string the page renders" contract, same
 * PUT-with-`If-Match` save and same 409-reloads-the-form recovery. Read that
 * hook's header for the reasoning behind all four; it is not repeated here.
 *
 * Three additions, all specific to this endpoint:
 *
 *   1. TWO MORE THINGS TO LOAD. Personas come from the server (the web app
 *      keeps no copy of the registry) and are fetched ONCE — they are a static
 *      declaration that cannot change without a deploy. Models are fetched on
 *      mount from the API's cache and on demand with `refresh=true`.
 *
 *   2. A FAILED CATALOG FETCH IS NOT A REJECTED PROMISE, exactly as a failed
 *      test is not. `/models` answers 200 with `{ success: false, error }`, and
 *      the only thing that rejects is a transport failure or the 429 from the
 *      refresh throttle. Both end up in the same `models` object, so the page
 *      has one place to render "the catalog is empty and here is why".
 *
 *   3. `refreshModels` AND `test` HAVE SEPARATE PENDING FLAGS. They are
 *      different buttons that fail for different reasons, and a shared spinner
 *      would grey out the one an administrator is trying to use to diagnose the
 *      other.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ApiError,
  getAiModels,
  getAiPersonas,
  getAiSettings,
  testAiConnection,
  updateAiSettings,
} from '../services/api';
import type {
  AiModelsResult,
  AiPersona,
  AiSettings,
  AiSettingsInput,
  AiTestResult,
} from '../types';
import { useIsMounted } from './useIsMounted';

/** What the page renders before the first catalog response arrives. */
const EMPTY_MODELS: AiModelsResult = {
  success: false,
  models: [],
  fetchedAt: null,
  source: null,
  error: null,
};

interface UseAiSettingsReturn {
  settings: AiSettings | null;
  personas: AiPersona[];
  models: AiModelsResult;
  isLoading: boolean;
  /** Failure to LOAD the settings. Distinct from `saveError` and from `models.error`. */
  loadError: string | null;
  isSaving: boolean;
  saveError: string | null;
  isTesting: boolean;
  testResult: AiTestResult | null;
  isRefreshingModels: boolean;
  /** Resolves `true` when the save landed, `false` when it did not — never throws. */
  save: (input: AiSettingsInput) => Promise<boolean>;
  test: () => Promise<void>;
  refreshModels: () => Promise<void>;
  clearTestResult: () => void;
  clearSaveError: () => void;
  refresh: () => Promise<void>;
}

export function useAiSettings(): UseAiSettingsReturn {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [personas, setPersonas] = useState<AiPersona[]>([]);
  const [models, setModels] = useState<AiModelsResult>(EMPTY_MODELS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);

  const isMounted = useIsMounted();

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await getAiSettings();
      if (isMounted()) setSettings(data);
    } catch (err) {
      if (isMounted()) {
        // 403 is named explicitly because it is the one failure an admin can
        // act on themselves; everything else surfaces the API's own message.
        if (err instanceof ApiError && err.status === 403) {
          setLoadError('You do not have permission to view AI settings');
        } else {
          setLoadError(err instanceof ApiError ? err.message : 'Failed to load AI settings');
        }
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  /**
   * Fetch the catalog.
   *
   * NEVER THROWS. A transport failure or a 429 becomes `models.error` with an
   * empty list, so the page renders the same inline explanation it renders for
   * the API's own `success: false` — one surface, one code path.
   */
  const loadModels = useCallback(
    async (refresh: boolean) => {
      try {
        if (refresh) setIsRefreshingModels(true);
        const data = await getAiModels(refresh);
        if (isMounted()) setModels(data);
      } catch (err) {
        if (isMounted()) {
          setModels((prev) => ({
            ...prev,
            success: false,
            error:
              err instanceof ApiError ? err.message : 'The model list could not be loaded',
          }));
        }
      } finally {
        if (isMounted()) setIsRefreshingModels(false);
      }
    },
    [isMounted],
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    // ONCE. The persona registry is a static declaration in the API; it cannot
    // change without a deploy, so re-fetching it on every save would be a
    // request that can only ever return the same bytes.
    //
    // A failure is deliberately silent: an empty persona table is a degraded
    // page, not a broken one — the provider, key and default model are all
    // still editable, and an error banner for a list nobody has scrolled to yet
    // would compete with the ones that matter.
    getAiPersonas()
      .then((data) => {
        if (isMounted()) setPersonas(data);
      })
      .catch(() => undefined);
  }, [isMounted]);

  useEffect(() => {
    // From the API's cache on mount: opening this page three times must not
    // make three provider calls. The Refresh button is the deliberate bypass.
    loadModels(false);
  }, [loadModels]);

  const save = useCallback(
    async (input: AiSettingsInput): Promise<boolean> => {
      try {
        setIsSaving(true);
        setSaveError(null);
        // The version this form was built from, as `If-Match`. `?? 0` rather
        // than omitting: 0 asserts "I believe nothing is stored yet", so even a
        // first save on a fresh deployment is guarded.
        const data = await updateAiSettings(input, settings?.version ?? 0);
        if (isMounted()) setSettings(data);
        return true;
      } catch (err) {
        // 409 IS NOT A GENERIC FAILURE. Somebody else saved between this page's
        // load and this click, so every retry would 409 identically until the
        // form is rebuilt. Reload it and say plainly that the fields have been
        // replaced — a message over a form still holding stale values would
        // invite the admin to press Save again and (version now current)
        // overwrite the colleague's change for real.
        if (err instanceof ApiError && err.status === 409) {
          await fetchSettings();
          if (isMounted()) {
            setSaveError(
              'Someone else changed the AI settings while you were editing. ' +
                'The form has been reloaded with the current configuration — review it and save again.',
            );
          }
          return false;
        }
        if (isMounted()) {
          setSaveError(err instanceof ApiError ? err.message : 'Failed to save AI settings');
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [settings, fetchSettings, isMounted],
  );

  /**
   * Probe the platform key, and record what the provider said.
   *
   * TWO KINDS OF FAILURE, ONE SURFACE. The endpoint answers 200 with
   * `{ success: false, error }` when the provider refuses — that is the
   * interesting case and it is NOT an exception. It rejects only when the call
   * itself fails (403, 429, a dropped connection). Both are failed tests, so
   * both end up in the same `testResult`, and there is no way to mistake a
   * resolved promise for a working connection.
   */
  const test = useCallback(async () => {
    try {
      setIsTesting(true);
      setTestResult(null);
      const result = await testAiConnection();
      if (isMounted()) setTestResult(result);
    } catch (err) {
      if (isMounted()) {
        setTestResult({
          success: false,
          // The API's message verbatim — a 403 and a 429 read very differently,
          // and flattening both to "test failed" throws away the only clue.
          error: err instanceof ApiError ? err.message : 'The test request could not be sent',
        });
      }
    } finally {
      if (isMounted()) setIsTesting(false);
    }
  }, [isMounted]);

  const refreshModels = useCallback(() => loadModels(true), [loadModels]);
  const clearTestResult = useCallback(() => setTestResult(null), []);
  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    settings,
    personas,
    models,
    isLoading,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    isRefreshingModels,
    save,
    test,
    refreshModels,
    clearTestResult,
    clearSaveError,
    refresh: fetchSettings,
  };
}
