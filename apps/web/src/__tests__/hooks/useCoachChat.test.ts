import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useCoachChat } from '../../hooks/useCoachChat';
import {
  failNextSend,
  seedConversation,
  seedMessage,
} from '../mocks/coachHandlers';

// =============================================================================
// useCoachChat (issue #86)
// =============================================================================
//
// The optimistic bubble is the whole reason this hook exists rather than a
// `useState` in the page, and the three assertions below are its lifecycle:
// it appears immediately, the server row replaces it, and a failure leaves it
// standing with the text intact so Retry has something to retry.
// =============================================================================

describe('useCoachChat', () => {
  it('loads an existing thread oldest-first', async () => {
    const conversation = seedConversation();
    seedMessage(conversation.id, { role: 'USER', content: 'one' });
    seedMessage(conversation.id, { role: 'COACH', content: 'two' });

    const { result } = renderHook(() => useCoachChat(conversation.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages.map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('shows the user bubble before the reply arrives', async () => {
    const conversation = seedConversation();
    const { result } = renderHook(() => useCoachChat(conversation.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.send('hello there');
    });

    // Immediately, without awaiting the send: the bubble is already there and
    // marked pending.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      content: 'hello there',
      role: 'USER',
      status: 'pending',
    });
    expect(result.current.messages[0].id).toMatch(/^tmp-/);
    expect(result.current.thinking).toBe(true);

    await act(async () => {
      await pending;
    });

    // The temp row is gone, replaced by the server's pair.
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.every((m) => !m.id.startsWith('tmp-'))).toBe(true);
    expect(result.current.messages[1].role).toBe('COACH');
    expect(result.current.thinking).toBe(false);
  });

  it('keeps the failed message and its text', async () => {
    const conversation = seedConversation();
    const { result } = renderHook(() => useCoachChat(conversation.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    failNextSend();

    await act(async () => {
      await result.current.send('hello there');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      content: 'hello there',
      status: 'failed',
    });
    expect(result.current.error).not.toBeNull();
  });

  it('retries a failed message with the text it kept', async () => {
    const conversation = seedConversation();
    const { result } = renderHook(() => useCoachChat(conversation.id));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    failNextSend();

    await act(async () => {
      await result.current.send('hello there');
    });

    const tempId = result.current.messages[0].id;

    await act(async () => {
      await result.current.retry(tempId);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe('hello there');
    expect(result.current.messages[0].status).toBeUndefined();
  });

  it('reports the conversation it created when there was none', async () => {
    let created: string | undefined;
    const { result } = renderHook(() =>
      useCoachChat(undefined, { onConversationCreated: (id) => (created = id) }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.send('start a thread');
    });

    expect(created).toBeDefined();
  });

  it('holds no messages and does not load without a conversation', async () => {
    const { result } = renderHook(() => useCoachChat(undefined));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([]);
  });
});
