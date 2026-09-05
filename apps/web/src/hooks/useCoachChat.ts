import { useCallback, useEffect, useRef, useState } from 'react';

import type { CoachMessage } from '../types';
import { getCoachMessages, sendCoachMessage } from '../services/api';
import { useIsMounted } from './useIsMounted';

// =============================================================================
// One coach thread (issue #86, epic E06)
// =============================================================================
//
// OPTIMISTIC, AND THAT IS THE POINT. A coaching turn takes seconds, and a user
// who types a sentence and watches an empty screen assumes it did not send.
// The bubble appears immediately as `pending`, the server row replaces it when
// it arrives, and a failure leaves it `failed` with the text intact so Retry
// has something to retry.
//
// Temp ids are prefixed `tmp-` and are NEVER sent to the API. The only place
// one is used is as a React key and as the row `send` replaces on success.
// =============================================================================

let tempCounter = 0;
const nextTempId = () => `tmp-${(tempCounter += 1)}`;

export interface UseCoachChatResult {
  messages: CoachMessage[];
  isLoading: boolean;
  error: string | null;
  /** True while a reply is outstanding. Drives the "Thinking…" placeholder. */
  thinking: boolean;
  send: (text: string, attachmentIds?: string[]) => Promise<void>;
  retry: (tempId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCoachChat(
  conversationId: string | undefined,
  options: { onConversationCreated?: (id: string) => void } = {},
): UseCoachChatResult {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(conversationId));
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const isMounted = useIsMounted();

  // A ref so `send` does not have to be rebuilt when the callback identity
  // changes on every render of the page that owns it.
  const onCreated = useRef(options.onConversationCreated);
  onCreated.current = options.onConversationCreated;

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await getCoachMessages(conversationId);
      if (isMounted()) setMessages(result.items);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load this conversation';
      if (isMounted()) {
        setError(message);
        setMessages([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [conversationId, isMounted]);

  const deliver = useCallback(
    async (tempId: string, text: string, attachmentIds?: string[]) => {
      setThinking(true);
      setError(null);

      try {
        const result = await sendCoachMessage({
          conversationId,
          text,
          ...(attachmentIds?.length ? { attachmentIds } : {}),
        });

        if (!isMounted()) return;

        setMessages((current) => [
          ...current.filter((message) => message.id !== tempId),
          result.userMessage,
          result.coachMessage,
        ]);

        if (!conversationId) onCreated.current?.(result.conversationId);
      } catch (err) {
        if (!isMounted()) return;

        // The text stays in the bubble. A retry that lost what the user wrote
        // is not a retry.
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, status: 'failed' } : message,
          ),
        );
        setError(err instanceof Error ? err.message : 'Failed to send');
      } finally {
        if (isMounted()) setThinking(false);
      }
    },
    [conversationId, isMounted],
  );

  const send = useCallback(
    async (text: string, attachmentIds?: string[]) => {
      const tempId = nextTempId();

      setMessages((current) => [
        ...current,
        {
          id: tempId,
          role: 'USER',
          content: text,
          structured: null,
          attachmentIds: attachmentIds ?? [],
          safety: null,
          createdAt: new Date().toISOString(),
          status: 'pending',
        },
      ]);

      await deliver(tempId, text, attachmentIds);
    },
    [deliver],
  );

  const retry = useCallback(
    async (tempId: string) => {
      const failed = messages.find((message) => message.id === tempId);
      if (!failed) return;

      setMessages((current) =>
        current.map((message) =>
          message.id === tempId ? { ...message, status: 'pending' } : message,
        ),
      );

      await deliver(tempId, failed.content, failed.attachmentIds);
    },
    [deliver, messages],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { messages, isLoading, error, thinking, send, retry, refresh };
}
