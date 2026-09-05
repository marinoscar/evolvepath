import { useCallback, useEffect, useRef, useState } from 'react';

import type { LogSetBody } from '../types';
import { logWorkoutSet, logWorkoutSetsBatch } from '../services/api';
import { useIsMounted } from './useIsMounted';

// =============================================================================
// The offline outbox (issue #109, epic E09)
// =============================================================================
//
// PRD §121: the runner has to work in a basement with no signal. So a completed
// set is written to `localStorage` FIRST and sent afterwards, and the screen
// shows it either way — because the user did the set, and an app that forgets
// it because a request failed is an app they stop trusting mid-workout.
//
// THE SERVER'S IDEMPOTENCY IS WHAT MAKES THE RETRY SAFE. `clientId` is minted
// here, and a replay of an id the server already has comes back in
// `duplicates` rather than as a second row. That is why the retry can be dumb:
// it does not need to know whether the last attempt got through.
//
// EVERY `localStorage` ACCESS IS WRAPPED. Private mode throws on write, and a
// runner that crashes because storage is unavailable is worse than one with no
// outbox at all — the sets still send, they just have no safety net.
// =============================================================================

/** How often a queued set is retried while the network is down. */
export const RETRY_INTERVAL_MS = 5_000;

/** At or above this many queued items, replay through the batch endpoint. */
export const BATCH_THRESHOLD = 2;

export function outboxKey(sessionId: string): string {
  return `workout.outbox.${sessionId}`;
}

export interface OutboxItem {
  clientId: string;
  body: LogSetBody;
  queuedAt: string;
}

function read(sessionId: string): OutboxItem[] {
  try {
    const raw = localStorage.getItem(outboxKey(sessionId));

    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    // Corrupt JSON, a quota error, or storage disabled entirely. An empty
    // outbox is the honest answer to all three.
    return [];
  }
}

function write(sessionId: string, items: OutboxItem[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(outboxKey(sessionId));
    else localStorage.setItem(outboxKey(sessionId), JSON.stringify(items));
  } catch {
    // Nothing to do and nothing worth telling the user: the set is still in
    // memory and still being sent.
  }
}

export function clearOutbox(sessionId: string): void {
  write(sessionId, []);
}

export interface UseSetLogOutboxResult {
  /** `clientId`s still waiting to reach the server. */
  pending: string[];
  /** Items the server refused, with its reason. */
  rejected: Array<{ clientId: string; reason: string }>;
  /** Queue a set and try to send it. Never throws. */
  enqueue: (body: LogSetBody) => Promise<{ safetyCopy: string | null }>;
  /** Try everything queued. Called on mount, on `online`, and on a timer. */
  flush: () => Promise<void>;
  discard: (clientId: string) => void;
}

export function useSetLogOutbox(
  sessionId: string | undefined,
  options: { onSynced?: () => void } = {},
): UseSetLogOutboxResult {
  const [pending, setPending] = useState<string[]>([]);
  const [rejected, setRejected] = useState<Array<{ clientId: string; reason: string }>>([]);
  const isMounted = useIsMounted();
  const flushing = useRef(false);
  const onSynced = useRef(options.onSynced);

  onSynced.current = options.onSynced;

  const sync = useCallback(
    (items: OutboxItem[]) => {
      if (!sessionId) return;
      write(sessionId, items);
      if (isMounted()) setPending(items.map((item) => item.clientId));
    },
    [isMounted, sessionId],
  );

  const flush = useCallback(async () => {
    if (!sessionId || flushing.current) return;

    const items = read(sessionId);

    if (items.length === 0) return;

    flushing.current = true;

    try {
      if (items.length >= BATCH_THRESHOLD) {
        const result = await logWorkoutSetsBatch(
          sessionId,
          items.map((item) => item.body),
        );

        // A duplicate is a SUCCESS: the server already has that set, which is
        // exactly what the previous attempt was trying to achieve.
        const settled = new Set([
          ...result.accepted.map((set) => set.clientId),
          ...result.duplicates,
          ...result.rejected.map((entry) => entry.clientId),
        ]);

        if (result.rejected.length > 0 && isMounted()) {
          setRejected((current) => [...current, ...result.rejected]);
        }

        sync(items.filter((item) => !settled.has(item.clientId)));
      } else {
        const [item] = items;

        try {
          await logWorkoutSet(sessionId, item.body);
          sync([]);
        } catch (error) {
          // A 4xx is the server saying no; retrying forever would be a set
          // that never leaves the queue and a badge that never clears.
          const status = (error as { status?: number }).status;

          if (typeof status === 'number' && status >= 400 && status < 500) {
            if (isMounted()) {
              setRejected((current) => [
                ...current,
                { clientId: item.clientId, reason: 'REJECTED' },
              ]);
            }
            sync([]);
          }

          return;
        }
      }

      onSynced.current?.();
    } catch {
      // The network. Leave the queue alone; the timer will come back.
    } finally {
      flushing.current = false;
    }
  }, [isMounted, sessionId, sync]);

  const enqueue = useCallback(
    async (body: LogSetBody) => {
      if (!sessionId) return { safetyCopy: null };

      const item: OutboxItem = {
        clientId: body.clientId,
        body,
        queuedAt: new Date().toISOString(),
      };

      // Stored BEFORE the request. The user did the set; a failed request must
      // not be able to lose it.
      const queued = [...read(sessionId), item];
      sync(queued);

      try {
        const result = await logWorkoutSet(sessionId, body);

        sync(read(sessionId).filter((row) => row.clientId !== body.clientId));
        onSynced.current?.();

        return { safetyCopy: result.safety?.copy ?? null };
      } catch (error) {
        const status = (error as { status?: number }).status;

        if (typeof status === 'number' && status >= 400 && status < 500) {
          if (isMounted()) {
            setRejected((current) => [
              ...current,
              { clientId: body.clientId, reason: 'REJECTED' },
            ]);
          }
          sync(read(sessionId).filter((row) => row.clientId !== body.clientId));
        }

        return { safetyCopy: null };
      }
    },
    [isMounted, sessionId, sync],
  );

  const discard = useCallback(
    (clientId: string) => {
      if (!sessionId) return;

      sync(read(sessionId).filter((row) => row.clientId !== clientId));
      setRejected((current) => current.filter((row) => row.clientId !== clientId));
    },
    [sessionId, sync],
  );

  // Replay on mount, whenever the browser says the network came back, and on a
  // slow timer for the case it never says anything.
  useEffect(() => {
    if (!sessionId) return;

    setPending(read(sessionId).map((item) => item.clientId));
    void flush();

    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);

    const timer = window.setInterval(() => void flush(), RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [flush, sessionId]);

  return { pending, rejected, enqueue, flush, discard };
}
