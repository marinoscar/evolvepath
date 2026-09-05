import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { NotificationBell } from '../../../components/navigation/NotificationBell';
import type { NotificationContextValue } from '../../../contexts/NotificationContext';
import type { AppNotification } from '../../../types';

/**
 * Issue #127, epic #109. `NotificationBell` reads `NotificationContext`
 * exclusively - it never touches the SSE stream itself - so `useNotifications`
 * is mocked directly with a controllable fixture matching
 * `NotificationContextValue`. The positive-wiring assertion below directly
 * guards the documented failure mode in `NotificationContext.tsx`'s own
 * header: a wiring mistake that makes `useNotifications` return `null` hides
 * the bell with no test noticing, unless something asserts the bell IS there
 * when the provider is mounted.
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const recordInteractionMock = vi.fn().mockResolvedValue({ id: 'r1' });
vi.mock('../../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api')>(
    '../../../services/api',
  );
  return {
    ...actual,
    recordNotificationInteraction: (...args: unknown[]) => recordInteractionMock(...args),
  };
});

const useNotificationsMock = vi.fn<() => NotificationContextValue | null>();
vi.mock('../../../contexts/NotificationContext', async () => {
  const actual = await vi.importActual<
    typeof import('../../../contexts/NotificationContext')
  >('../../../contexts/NotificationContext');
  return { ...actual, useNotifications: () => useNotificationsMock() };
});

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    eventKey: 'security.role_changed',
    title: 'Your role changed',
    body: 'You are now an Admin.',
    link: '/settings',
    // A foundation event, so no buttons — the coaching cases below override it.
    actions: [],
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFixture(overrides: Partial<NotificationContextValue> = {}): NotificationContextValue {
  return {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    error: null,
    streamState: 'open',
    refresh: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useNotificationsMock.mockReset();
  });

  describe('provider wiring', () => {
    it('renders the bell button when useNotifications returns a non-null value', () => {
      useNotificationsMock.mockReturnValue(makeFixture());

      render(<NotificationBell />);

      expect(screen.getByLabelText(/notifications/i)).toBeInTheDocument();
    });

    it('renders nothing when useNotifications returns null (no provider mounted)', () => {
      useNotificationsMock.mockReturnValue(null);

      const { container } = render(<NotificationBell />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('unread badge and accessible name', () => {
    it('shows "Notifications, N unread" and the badge when unreadCount > 0', () => {
      useNotificationsMock.mockReturnValue(makeFixture({ unreadCount: 3 }));

      render(<NotificationBell />);

      expect(screen.getByLabelText('Notifications, 3 unread')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('shows "Notifications, none unread" at zero', () => {
      useNotificationsMock.mockReturnValue(makeFixture({ unreadCount: 0 }));

      render(<NotificationBell />);

      expect(screen.getByLabelText('Notifications, none unread')).toBeInTheDocument();
    });
  });

  describe('independence from live connection state', () => {
    it('renders notifications and count from context even with a disconnected-looking streamState', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(
        makeFixture({
          streamState: 'closed',
          unreadCount: 1,
          notifications: [makeNotification({ title: 'Still here' })],
        }),
      );

      render(<NotificationBell />);

      expect(screen.getByLabelText('Notifications, 1 unread')).toBeInTheDocument();

      await user.click(screen.getByLabelText('Notifications, 1 unread'));

      expect(await screen.findByText('Still here')).toBeInTheDocument();
    });
  });

  describe('opening the popover', () => {
    it('clicking the bell opens the popover and calls refresh()', async () => {
      const user = userEvent.setup();
      const fixture = makeFixture();
      useNotificationsMock.mockReturnValue(fixture);

      render(<NotificationBell />);

      await user.click(screen.getByLabelText(/notifications/i));

      expect(fixture.refresh).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    });
  });

  describe('row interaction', () => {
    it('clicking an unread row calls markRead(id) and navigates when the link is internal', async () => {
      const user = userEvent.setup();
      const notification = makeNotification({ id: 'row-1', link: '/settings', readAt: null });
      const fixture = makeFixture({ notifications: [notification], unreadCount: 1 });
      useNotificationsMock.mockReturnValue(fixture);

      render(<NotificationBell />);

      await user.click(screen.getByLabelText('Notifications, 1 unread'));
      const row = await screen.findByText(notification.title);
      await user.click(row);

      expect(fixture.markRead).toHaveBeenCalledWith('row-1');
      expect(mockNavigate).toHaveBeenCalledWith('/settings');
    });

    it('clicking an unread row with no link marks it read but does not navigate', async () => {
      const user = userEvent.setup();
      const notification = makeNotification({ id: 'row-2', link: null, readAt: null });
      const fixture = makeFixture({ notifications: [notification], unreadCount: 1 });
      useNotificationsMock.mockReturnValue(fixture);

      render(<NotificationBell />);

      await user.click(screen.getByLabelText('Notifications, 1 unread'));
      const row = await screen.findByText(notification.title);
      await user.click(row);

      expect(fixture.markRead).toHaveBeenCalledWith('row-2');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('clicking an already-read row does not call markRead again', async () => {
      const user = userEvent.setup();
      const notification = makeNotification({
        id: 'row-3',
        link: '/settings',
        readAt: new Date().toISOString(),
      });
      const fixture = makeFixture({ notifications: [notification], unreadCount: 0 });
      useNotificationsMock.mockReturnValue(fixture);

      render(<NotificationBell />);

      await user.click(screen.getByLabelText('Notifications, none unread'));
      const row = await screen.findByText(notification.title);
      await user.click(row);

      expect(fixture.markRead).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/settings');
    });
  });

  describe('list states', () => {
    it('renders the empty state when there are no notifications and nothing is loading or erroring', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(
        makeFixture({ notifications: [], isLoading: false, error: null }),
      );

      render(<NotificationBell />);
      await user.click(screen.getByLabelText(/notifications/i));

      expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    });

    it('renders a loading spinner when isLoading is true and the list is empty', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(
        makeFixture({ notifications: [], isLoading: true, error: null }),
      );

      render(<NotificationBell />);
      await user.click(screen.getByLabelText(/notifications/i));

      expect(await screen.findByLabelText(/loading notifications/i)).toBeInTheDocument();
    });

    it('does not render the loading spinner once notifications are present, even if isLoading is true', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(
        makeFixture({
          notifications: [makeNotification()],
          isLoading: true,
          error: null,
        }),
      );

      render(<NotificationBell />);
      await user.click(screen.getByLabelText(/notifications/i));

      await waitFor(() => {
        expect(screen.queryByLabelText(/loading notifications/i)).not.toBeInTheDocument();
      });
    });

    it('renders an error alert when error is set', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(
        makeFixture({ notifications: [], isLoading: false, error: 'Failed to load notifications' }),
      );

      render(<NotificationBell />);
      await user.click(screen.getByLabelText(/notifications/i));

      expect(await screen.findByText('Failed to load notifications')).toBeInTheDocument();
    });
  });

  describe('mark all read', () => {
    it('shows "Mark all read" and calls markAllRead when there is unread, hides it at zero', async () => {
      const user = userEvent.setup();
      const fixture = makeFixture({ unreadCount: 2, notifications: [makeNotification()] });
      useNotificationsMock.mockReturnValue(fixture);

      render(<NotificationBell />);
      await user.click(screen.getByLabelText('Notifications, 2 unread'));

      const markAllButton = await screen.findByText(/mark all read/i);
      await user.click(markAllButton);

      expect(fixture.markAllRead).toHaveBeenCalledTimes(1);
    });

    it('does not render "Mark all read" when unreadCount is 0', async () => {
      const user = userEvent.setup();
      useNotificationsMock.mockReturnValue(makeFixture({ unreadCount: 0 }));

      render(<NotificationBell />);
      await user.click(screen.getByLabelText('Notifications, none unread'));

      await waitFor(() => {
        expect(screen.queryByText(/mark all read/i)).not.toBeInTheDocument();
      });
    });
  });
});

// =============================================================================
// Coaching actions and attribution (#68, epic E12)
// =============================================================================

const COACHING = {
  id: 'coach-row-1',
  eventKey: 'coach.family_presence',
  title: 'Phone-free dinner starts in 15 minutes',
  body: 'Phone down, people first.',
  link: '/today?commitment=c1&action=in&n=n1',
  actions: [
    { action: 'in' as const, label: "I'm in", link: '/today?commitment=c1&action=in&n=n1' },
    { action: 'move' as const, label: 'Move it', link: '/today?commitment=c1&action=move&n=n1' },
    { action: 'skip' as const, label: 'Skip today', link: '/today?commitment=c1&action=skip&n=n1' },
  ],
};

describe('NotificationBell coaching actions', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    recordInteractionMock.mockClear();
    recordInteractionMock.mockResolvedValue({ id: 'r1' });
  });

  const openBellWith = async (notification: AppNotification, markRead = vi.fn()) => {
    useNotificationsMock.mockReturnValue(
      makeFixture({ notifications: [notification], unreadCount: 1, markRead }),
    );
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    return user;
  };

  it('renders one button per action, in the order the API gave them', async () => {
    await openBellWith(makeNotification(COACHING));

    expect(screen.getByRole('button', { name: /I'm in —/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move it —/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip today —/ })).toBeInTheDocument();
  });

  // A screen reader hears these out of context: three rows each offering "Skip
  // today" are otherwise indistinguishable.
  it('names the notification in each button’s accessible label', async () => {
    await openBellWith(makeNotification(COACHING));

    expect(
      screen.getByRole('button', {
        name: "Skip today — Phone-free dinner starts in 15 minutes",
      }),
    ).toBeInTheDocument();
  });

  it('records the action and navigates to its own link', async () => {
    const user = await openBellWith(makeNotification(COACHING));

    await user.click(screen.getByRole('button', { name: /Move it —/ }));

    await waitFor(() =>
      expect(recordInteractionMock).toHaveBeenCalledWith({
        notificationId: 'coach-row-1',
        kind: 'ACTIONED',
        action: 'move',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/today?commitment=c1&action=move&n=n1');
  });

  // Otherwise the row's own handler fires too and records a second, wrong
  // interaction for the same click.
  it('does not also record an open when a button was clicked', async () => {
    const user = await openBellWith(makeNotification(COACHING));

    await user.click(screen.getByRole('button', { name: /I'm in —/ }));

    await waitFor(() => expect(recordInteractionMock).toHaveBeenCalledTimes(1));
    expect(recordInteractionMock.mock.calls[0][0].kind).toBe('ACTIONED');
  });

  it('marks the row read when an action is used', async () => {
    const markRead = vi.fn().mockResolvedValue(undefined);
    const user = await openBellWith(makeNotification(COACHING), markRead);

    await user.click(screen.getByRole('button', { name: /I'm in —/ }));

    expect(markRead).toHaveBeenCalledWith('coach-row-1');
  });

  it('records an open when the row itself is clicked', async () => {
    const user = await openBellWith(makeNotification(COACHING));

    await user.click(screen.getByText('Phone-free dinner starts in 15 minutes'));

    await waitFor(() =>
      expect(recordInteractionMock).toHaveBeenCalledWith({
        notificationId: 'coach-row-1',
        kind: 'OPENED',
      }),
    );
  });

  // Foundation events have no decision behind them and nothing to attribute a
  // click to; posting for them would produce 404s and rows that mean nothing.
  it('renders no buttons and records nothing for a foundation event', async () => {
    const user = await openBellWith(makeNotification({ id: 'role-1' }));

    expect(screen.queryByRole('button', { name: /Skip today/ })).not.toBeInTheDocument();

    await user.click(screen.getByText('Your role changed'));

    expect(recordInteractionMock).not.toHaveBeenCalled();
  });

  // A metric must never be able to block the action it is measuring.
  it('navigates even when recording fails', async () => {
    recordInteractionMock.mockRejectedValue(new Error('offline'));
    const user = await openBellWith(makeNotification(COACHING));

    await user.click(screen.getByRole('button', { name: /Move it —/ }));

    expect(mockNavigate).toHaveBeenCalledWith('/today?commitment=c1&action=move&n=n1');
  });

  // `actions[].link` carries the same root-relative guarantee as `link`, and a
  // client that also checks survives the day that guarantee is broken.
  it('refuses to navigate to an action link that is not root-relative', async () => {
    const user = await openBellWith(
      makeNotification({
        ...COACHING,
        actions: [
          { action: 'move' as const, label: 'Move it', link: 'https://evil.test/steal' },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: /Move it —/ }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
