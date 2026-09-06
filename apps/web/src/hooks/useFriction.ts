import { useCallback, useState } from 'react';

import type { FrictionAnswer, FrictionAnswerResult } from '../types';
import { answerFriction } from '../services/api';
import { useIsMounted } from './useIsMounted';

interface UseFrictionResult {
  result: FrictionAnswerResult | null;
  pending: boolean;
  error: string | null;
  submit: (answer: FrictionAnswer, text?: string) => Promise<void>;
  reset: () => void;
}

/**
 * The friction question (VISION §9, epic E07).
 *
 * One call, and the answer is held here rather than lifted into the page: the
 * dialog swaps from question to intervention in place, and a page that owned
 * the state would have to re-open a closed dialog to show the reply.
 */
export function useFriction(commitmentId: string | undefined): UseFrictionResult {
  const [result, setResult] = useState<FrictionAnswerResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const submit = useCallback(
    async (answer: FrictionAnswer, text?: string) => {
      if (!commitmentId) return;

      setPending(true);
      setError(null);

      try {
        const answered = await answerFriction(commitmentId, {
          answer,
          ...(text?.trim() ? { text: text.trim() } : {}),
        });

        if (isMounted()) setResult(answered);
      } catch (err) {
        if (isMounted()) {
          setError(err instanceof Error ? err.message : 'That did not go through');
        }
      } finally {
        if (isMounted()) setPending(false);
      }
    },
    [commitmentId, isMounted],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, pending, error, submit, reset };
}
