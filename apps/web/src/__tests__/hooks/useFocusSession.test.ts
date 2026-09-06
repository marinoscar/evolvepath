import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useFocusSession } from '../../hooks/useFocusSession';
import { makeFocusSession, seedFocusSessions } from '../mocks/workHandlers';

// =============================================================================
// The focus session hook (issue #118, epic E07)
// =============================================================================
//
// The two properties worth a test: it re-anchors from the SERVER's clock rather
// than the browser's, and it adopts only a session belonging to the commitment
// on screen. Somebody else's running session is a conflict the Begin button
// reports, not a countdown this page should render.
// =============================================================================

describe('useFocusSession', () => {
  it('re-anchors from serverNow, not from the local clock', async () => {
    seedFocusSessions(makeFocusSession({ id: 'focus-1', commitmentId: 'c1' }));

    const { result } = renderHook(() => useFocusSession('c1'));

    await waitFor(() => expect(result.current.session).not.toBeNull());

    expect(result.current.serverNow?.toISOString()).toBe('2026-09-08T09:00:00.000Z');
  });

  it("ignores another commitment's running session", async () => {
    seedFocusSessions(makeFocusSession({ id: 'focus-1', commitmentId: 'somebody-else' }));

    const { result } = renderHook(() => useFocusSession('c1'));

    await waitFor(() => expect(result.current.serverNow).not.toBeNull());
    expect(result.current.session).toBeNull();
  });

  it('reports a 409 as a conflict rather than an error message', async () => {
    seedFocusSessions(makeFocusSession({ id: 'focus-1', commitmentId: 'somebody-else' }));

    const { result } = renderHook(() => useFocusSession('c1'));
    await waitFor(() => expect(result.current.serverNow).not.toBeNull());

    await act(async () => {
      await result.current.begin({ commitmentId: 'c1', plannedMinutes: 25 });
    });

    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.conflict?.activeSessionId).toBe('focus-1');
    expect(result.current.error).toBeNull();
  });

  it('takes over when asked to', async () => {
    seedFocusSessions(makeFocusSession({ id: 'focus-1', commitmentId: 'somebody-else' }));

    const { result } = renderHook(() => useFocusSession('c1'));
    await waitFor(() => expect(result.current.serverNow).not.toBeNull());

    await act(async () => {
      await result.current.begin({ commitmentId: 'c1', plannedMinutes: 25, takeOver: true });
    });

    await waitFor(() => expect(result.current.session?.commitmentId).toBe('c1'));
    expect(result.current.conflict).toBeNull();
  });

  it('refetches on visibilitychange, so a woken phone re-anchors', async () => {
    const { result } = renderHook(() => useFocusSession('c1'));
    await waitFor(() => expect(result.current.serverNow).not.toBeNull());

    // A session appears while the tab was in the background.
    seedFocusSessions(makeFocusSession({ id: 'focus-2', commitmentId: 'c1' }));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current.session?.id).toBe('focus-2'));
  });

  it('adds a note and extends through the session it holds', async () => {
    const { result } = renderHook(() => useFocusSession('c1'));
    await waitFor(() => expect(result.current.serverNow).not.toBeNull());

    await act(async () => {
      await result.current.begin({ commitmentId: 'c1', plannedMinutes: 25 });
    });

    await act(async () => {
      await result.current.addNote('  Checked Slack  ');
    });
    expect(result.current.session?.distractionNotes).toEqual(['Checked Slack']);

    await act(async () => {
      await result.current.extend(15);
    });
    expect(result.current.session?.plannedMinutes).toBe(40);
    expect(result.current.session?.continuedCount).toBe(1);
  });

  it('reports the minutes actually focused when it stops', async () => {
    const { result } = renderHook(() => useFocusSession('c1'));
    await waitFor(() => expect(result.current.serverNow).not.toBeNull());

    await act(async () => {
      await result.current.begin({ commitmentId: 'c1', plannedMinutes: 25 });
    });

    let stopped: { actualMinutes: number; continuedCount: number } | null = null;

    await act(async () => {
      stopped = await result.current.stop('partial');
    });

    expect(stopped).toEqual({ actualMinutes: 12, continuedCount: 0 });
  });
});
