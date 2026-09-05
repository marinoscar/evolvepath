import { useState } from 'react';
import {
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
} from '@mui/material';
import { Logout as LogoutIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { DESTINATIONS, isDestinationVisible } from '../../config/destinations';

export function UserMenu() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { user, logout } = useAuth();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();

  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    handleClose();
  };

  const handleLogout = async () => {
    handleClose();
    await logout();
  };

  if (!user) return null;

  // Paths, labels, icons and gates all come from the destination table rather
  // than being spelled out again here. This menu used to hardcode `/settings`
  // and `/admin/settings` and gate the latter on `system_settings:read` while
  // the sidebar gated the same page on the `admin` ROLE — the two disagreed for
  // any Contributor granted that permission. There is now one answer.
  //
  // EVERY visible destination, with nothing filtered out (#51). The old
  // version dropped Home on the grounds that the AppBar brand already routed
  // there — but the shell now has five product destinations plus Console, and
  // on a phone this menu is the ONLY place Console appears at all (the bottom
  // bar omits pinned destinations). A menu that silently skips one row is a
  // menu a reader cannot trust to be the complete list, which matters far more
  // than saving one row that duplicates the brand.
  const menuDestinations = DESTINATIONS.filter((destination) =>
    isDestinationVisible(destination, hasPermission),
  );

  const initials = user.displayName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || user.email[0].toUpperCase();

  return (
    <>
      <IconButton
        onClick={handleOpen}
        size="small"
        // The e2e helpers (`isLoggedIn`, `logout`, and #62's phone-Console
        // check) have always looked for this and never found it — `isLoggedIn`
        // swallowed the timeout and answered `false`, so nothing failed and
        // nothing worked either.
        data-testid="user-menu"
        aria-controls={open ? 'user-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        <Avatar
          src={user.profileImageUrl || undefined}
          alt={user.displayName || user.email}
          sx={{ width: 32, height: 32, fontSize: '0.875rem' }}
        >
          {initials}
        </Avatar>
      </IconButton>

      <Menu
        id="user-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          paper: { sx: { minWidth: 200, mt: 1 } },
        }}
      >
        {/* User Info Header */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {user.displayName || 'No name set'}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {user.email}
          </Typography>
        </Box>

        <Divider />

        {/* Navigation Items */}
        {menuDestinations.map((destination) => (
          <MenuItem
            key={destination.key}
            onClick={() => handleNavigate(destination.path)}
          >
            <ListItemIcon>
              <destination.Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{destination.label}</ListItemText>
          </MenuItem>
        ))}

        <Divider />

        {/* Logout */}
        <MenuItem onClick={handleLogout} data-testid="logout-button">
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
