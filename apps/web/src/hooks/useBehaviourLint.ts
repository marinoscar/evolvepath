import { useCallback, useEffect, useRef, useState } from 'react';

import type { LintResult } from '../types';
import { lintFamilyTitle } from '../services/api';
import { useIsMounted } from './useIsMounted';

/** Long enough that a user typing a sentence is not linted mid-word. */
export const LINT_DEBOUNCE_MS = 500;

interface UseBehaviourLintResult {
  /** `null` until a title has been checked, or while the field is empty. */
  result: LintResult | null;
  isChecking: boolean;
  /** Clears the verdict — call it when the editor opens on a fresh title. */
  reset: () => void;
}

/**
 * The PRD §32 check, run as the user types.
 *
 * DEBOUNCED, and the debounce is not only about request volume: a lint that
 * fires on every keystroke tells somebody typing "Make pancakes with the kids"
 * that they are wrong after the third word. Waiting until they stop is the
 * difference between a correction and an interruption.
 *
 * A failed request is treated as "no verdict yet", not as a refusal. The
 * authoritative check runs on save; this one only saves the user a round trip.
 */
export function useBehaviourLint(title: string, enabled = true): UseBehaviourLintResult {
  const [result, setResult] = useState<LintResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isMounted = useIsMounted();
  // Guards against an out-of-order response overwriting a newer verdict.
  const requestId = useRef(0);

  const reset = useCallback(() => {
    requestId.current += 1;
    setResult(null);
    setIsChecking(false);
  }, []);

  useEffect(() => {
    const trimmed = title.trim();

    if (!enabled || trimmed.length === 0) {
      reset();
      return;
    }

    const id = (requestId.current += 1);
    setIsChecking(true);

    const timer = window.setTimeout(() => {
      void lintFamilyTitle(trimmed)
        .then((next) => {
          if (isMounted() && requestId.current === id) setResult(next);
        })
        .catch(() => {
          if (isMounted() && requestId.current === id) setResult(null);
        })
        .finally(() => {
          if (isMounted() && requestId.current === id) setIsChecking(false);
        });
    }, LINT_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [title, enabled, isMounted, reset]);

  return { result, isChecking, reset };
}
