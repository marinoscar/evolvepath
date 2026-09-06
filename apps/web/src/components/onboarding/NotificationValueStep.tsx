import { forwardRef } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';

import type { BrowserNotificationPermission } from '../../hooks/useBrowserNotificationPermission';
import {
  NOTIFICATIONS_ALLOW,
  NOTIFICATIONS_BODY,
  NOTIFICATIONS_DECLINE,
  NOTIFICATIONS_TITLE,
} from './copy';
import { StepShell } from './StepShell';

export interface NotificationValueStepProps {
  permission: BrowserNotificationPermission;
  isRequesting: boolean;
  onRequestPermission: () => void;
  onDecline: () => void;
  declined: boolean;
}

/**
 * Step 9 (PRD §20) — the value exchange.
 *
 * IT EXPLAINS BEFORE IT PROMPTS, and the browser prompt fires only from the
 * button's own click handler. `Notification.requestPermission()` on mount is
 * how an app gets permanently denied by a user who had no idea what they were
 * being asked for.
 */
export const NotificationValueStep = forwardRef<HTMLHeadingElement, NotificationValueStepProps>(
  function NotificationValueStep(
    { permission, isRequesting, onRequestPermission, onDecline, declined },
    ref,
  ) {
    return (
      <StepShell ref={ref} title={NOTIFICATIONS_TITLE}>
        <Typography variant="body1" color="text.secondary">
          {NOTIFICATIONS_BODY}
        </Typography>

        {permission === 'granted' && (
          <Alert severity="success">Notifications are on. You can change that in Settings.</Alert>
        )}
        {permission === 'denied' && (
          <Alert severity="info">
            Your browser is blocking notifications. Nothing else changes — you can turn them on
            from your browser settings later.
          </Alert>
        )}
        {permission === 'unsupported' && (
          <Alert severity="info">This browser does not support notifications.</Alert>
        )}
        {declined && permission === 'default' && (
          <Alert severity="info">No notifications for now. Settings has the switch.</Alert>
        )}

        {permission === 'default' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="outlined" onClick={onRequestPermission} disabled={isRequesting}>
              {NOTIFICATIONS_ALLOW}
            </Button>
            <Button variant="text" onClick={onDecline} disabled={isRequesting}>
              {NOTIFICATIONS_DECLINE}
            </Button>
          </Stack>
        )}
      </StepShell>
    );
  },
);
