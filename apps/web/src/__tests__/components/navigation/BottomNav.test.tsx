import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';
import { render, mockAdminUser } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import { BottomNav } from '../../../components/navigation/BottomNav';

/**
 * The phone half of the coverage migrated from the deleted `Sidebar.test.tsx`:
 * the destination list, permission gating, active highlight, navigate-on-click.
 *
 * Since #51 the bar carries the five PRD §11 product destinations and OMITS
 * pinned ones — Console is a rail/menu surface, not a sixth tab. The
 * five-labelled-tabs-at-360px claim is held here in the DOM and in
 * `tests/visual/specs/bottom-nav.spec.ts` in pixels.
 */

/** The five tabs, in navigation order. Console is deliberately absent. */
const TABS = ['Today', 'Path', 'Coach', 'Progress', 'Profile'];

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { usePermissions } from '../../../hooks/usePermissions';

const mockUsePermissions = vi.mocked(usePermissions);

function setPermissions(granted: string[], isAdmin = false) {
  mockUsePermissions.mockReturnValue({
    permissions: new Set(granted),
    roles: new Set(isAdmin ? ['admin'] : ['viewer']),
    hasPermission: (perm: string) => granted.includes(perm),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin,
  });
}

const ADMIN_PERMISSIONS = ['users:read', 'system_settings:read'];
const PHONE = 375;

/** Renders at a phone width, which is the only width this bar exists at. */
function renderPhone(route = '/') {
  const result = render(<BottomNav />, {
    wrapperOptions: { route, user: mockAdminUser },
  });
  act(() => setViewportWidth(PHONE));
  return result;
}

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPermissions(ADMIN_PERMISSIONS, true);
    setViewportWidth(PHONE);
  });

  describe('Self-gating', () => {
    it('renders nothing at or above sm, even though Layout also unmounts it there', () => {
      // Belt and braces: `Layout` mounts it only below `sm`, and it refuses to
      // render above `sm` anyway. Either gate alone would be enough; both
      // together mean a future caller cannot mount it into the rail's band.
      render(<BottomNav />, { wrapperOptions: { user: mockAdminUser } });

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('renders below sm', () => {
      renderPhone();

      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    it('appears and disappears across the sm boundary', async () => {
      renderPhone();
      expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();

      await act(async () => setViewportWidth(600));
      expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();

      await act(async () => setViewportWidth(599));
      expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    });
  });

  describe('Destinations', () => {
    it('renders all five destinations for a fully permitted user', () => {
      renderPhone();

      for (const name of TABS) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument();
      }
    });

    it('shows the compact label as visible text but the full label as the accessible name', () => {
      // All five product labels are 8 characters or fewer, so compact and full
      // agree today — the distinction survives because the full label is the
      // accessible name.
      renderPhone();

      expect(screen.getByText('Progress')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Progress' })).toBeInTheDocument();
    });

    it('renders exactly five actions — the Material 3 ceiling showLabels needs', () => {
      renderPhone();

      expect(screen.getAllByRole('button')).toHaveLength(5);
      expect(screen.getAllByRole('button').length).toBeLessThanOrEqual(5);
    });

    it('renders them in PRD §11 order', () => {
      renderPhone();

      expect(
        screen.getAllByRole('button').map((action) => action.getAttribute('aria-label')),
      ).toEqual(TABS);
    });

    // Console is `pinned`, and the bar omits pinned destinations rather than
    // pinning them: it has no foot to pin to, and a sixth tab would break the
    // five-tab budget. An admin reaches Console from the avatar menu.
    it('never shows Console, even to an admin holding both permissions', () => {
      setPermissions(ADMIN_PERMISSIONS, true);
      renderPhone();

      expect(screen.queryByRole('button', { name: 'Console' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(5);
    });

    it('shows the same five tabs to a user holding no permissions at all', () => {
      // None of the five product destinations is permission-gated — they are
      // the app. Only Console is, and it is not here.
      setPermissions([]);
      renderPhone();

      expect(
        screen.getAllByRole('button').map((action) => action.getAttribute('aria-label')),
      ).toEqual(TABS);
    });
  });

  describe('Active state', () => {
    it('selects the destination that owns the route', () => {
      renderPhone('/settings');

      expect(screen.getByRole('button', { name: 'Profile' })).toHaveClass('Mui-selected');
      expect(screen.getByRole('button', { name: 'Today' })).not.toHaveClass('Mui-selected');
    });

    it('resolves a child route to its parent destination', () => {
      renderPhone('/settings/tokens');

      expect(screen.getByRole('button', { name: 'Profile' })).toHaveClass('Mui-selected');
    });

    it('marks the active tab with aria-current="page"', () => {
      renderPhone('/path');

      expect(screen.getByRole('button', { name: 'Path' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    // Console is not a tab, so an admin route highlights nothing — which is
    // correct: the bar has no row for where the user is.
    it('selects nothing on an admin route, because Console is not a tab', () => {
      renderPhone('/admin/settings/users');

      for (const action of screen.getAllByRole('button')) {
        expect(action).not.toHaveClass('Mui-selected');
      }
    });

    it('selects NOTHING on a route no destination owns', () => {
      // `false`, not `null`, is what BottomNavigation wants for "nothing
      // selected" — and an unowned route is exactly where that must show.
      renderPhone('/settingsfoo');

      for (const action of screen.getAllByRole('button')) {
        expect(action).not.toHaveClass('Mui-selected');
      }
    });

    it('selects nothing when the active destination is one the bar does not carry', () => {
      setPermissions([]);
      renderPhone('/admin/settings');

      for (const action of screen.getAllByRole('button')) {
        expect(action).not.toHaveClass('Mui-selected');
      }
    });
  });

  describe('Navigation', () => {
    it('navigates to the destination path on tap', async () => {
      const user = userEvent.setup();
      renderPhone('/');

      await user.click(screen.getByRole('button', { name: 'Path' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Path' })).toHaveClass('Mui-selected');
      });
    });

    it('reaches all five destinations', async () => {
      const user = userEvent.setup();
      renderPhone('/');

      for (const name of TABS) {
        await user.click(screen.getByRole('button', { name }));
        await waitFor(() => {
          expect(screen.getByRole('button', { name })).toHaveClass('Mui-selected');
        });
      }
    });
  });

  describe('Accessibility', () => {
    it('has no axe violations with all five tabs rendered', async () => {
      const { container } = renderPhone('/path');

      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
