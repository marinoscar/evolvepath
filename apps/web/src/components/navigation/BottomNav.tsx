/**
 * The phone bottom bar — the ONLY navigation chrome below `sm`.
 *
 * Issue #55, epic #51. The temporary drawer that used to be the sole way into
 * every page is gone, and there is no hamburger in the top bar either:
 * Material 3 acknowledges it has no recommended drawer replacement at this
 * size, which is why the answer is a bottom bar and nothing else.
 *
 * THREE TO FIVE DESTINATIONS, which is Material 3's range for a bottom bar,
 * and this app has exactly five (PRD §11: Today, Path, Coach, Progress,
 * Profile). That is the ceiling, not a coincidence: `showLabels` stays on, and
 * a sixth tab would force a choice between labels and fit.
 *
 * PINNED DESTINATIONS ARE OMITTED, NOT PINNED (#51). Console is `pinned` in
 * `config/destinations.ts` because the rail lifts it to its foot — but a
 * bottom bar has no foot to pin to, it IS the foot, and Console as a sixth tab
 * would break the five-tab budget for a surface an admin visits rarely from a
 * phone. `UserMenu` still lists it, so it stays reachable.
 *
 * Five labelled tabs DO fit at 360px, but only with `minWidth: 0` on each
 * action: MUI defaults `BottomNavigationAction` to `minWidth: 80`, and five of
 * those is 400px of content in a 360px bar. `tests/visual/specs/bottom-nav.spec.ts`
 * holds the pixel baseline that keeps this true.
 *
 * ACTIVE STATE COMES FROM THE DESTINATION MODEL, NOT A PATH PREFIX
 * (`config/destinations.ts`). The `startsWith` chain this replaces would have
 * matched `/settingsfoo` against Settings.
 */

import {
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import {
  DESTINATIONS,
  isDestinationVisible,
  resolveActiveDestination,
} from '../../config/destinations';
import type { DestinationKey } from '../../config/destinations';

export function BottomNav() {
  const theme = useTheme();
  // The EXACT complement of `Layout`'s `showRail` (`up('sm')`), and it must
  // stay that way: any drift opens a band with two navigation surfaces or none.
  // 600px is Material 3's compact/medium boundary — see the coupled-gate list
  // in `common/Layout.tsx`.
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();

  if (!isCompactWindow) return null;

  const visibleDestinations = DESTINATIONS.filter(
    (destination) => !destination.pinned && isDestinationVisible(destination, hasPermission),
  );

  const resolved = resolveActiveDestination(location.pathname);
  // `false` — NOT `null` — is what MUI's BottomNavigation wants for "nothing
  // selected", which is the correct rendering on the routes `destinations.ts`
  // leaves deliberately unowned. Passing `null` leaves the component thinking a
  // value was supplied and matching nothing, which is the same picture by
  // accident rather than by contract.
  //
  // A destination the user cannot see also resolves to "nothing selected"
  // rather than to a phantom highlighted tab.
  const active: DestinationKey | false =
    resolved !== null && visibleDestinations.some((d) => d.key === resolved)
      ? resolved
      : false;

  const handleChange = (_: React.SyntheticEvent, value: DestinationKey) => {
    const destination = DESTINATIONS.find((d) => d.key === value);
    if (destination) navigate(destination.path);
  };

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: theme.zIndex.appBar,
      }}
    >
      <BottomNavigation value={active} onChange={handleChange} showLabels>
        {visibleDestinations.map((destination) => (
          <BottomNavigationAction
            key={destination.key}
            value={destination.key}
            // `minWidth: 0` overrides MUI's 80px default so five labelled
            // actions fit a 360px bar; see the header. `px` keeps a little
            // breathing room between them at that width.
            sx={{ minWidth: 0, px: 0.5 }}
            // SET EXPLICITLY. MUI's `selected` prop drives the visual state
            // and the `Mui-selected` class, but emits no `aria-current` — so
            // without this a screen-reader user gets five identical tabs with
            // no indication of where they are. The rail sets it the same way.
            aria-current={active === destination.key ? 'page' : undefined}
            // The COMPACT label. All five product destinations are 8 characters
            // or fewer, so it equals the full label today — the distinction is
            // kept because the full label is the accessible name and the two
            // may diverge again.
            label={destination.compactLabel}
            aria-label={destination.label}
            icon={<destination.Icon />}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}

export default BottomNav;
