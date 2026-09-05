/**
 * The notification centre — a bell in the `AppBar` with an unread badge, and a
 * popover listing what has arrived recently.
 *
 * Issue #127, epic #109.
 *
 * =============================================================================
 * THIS IS THE PRIMARY SURFACE, NOT A CONVENIENCE ON TOP OF NATIVE TOASTS
 * =============================================================================
 *
 * Everything here works with the SSE stream down and with browser notification
 * permission denied, because those are the NORMAL cases: permission is denied
 * by a large fraction of users and cannot be re-requested, and a stream is one
 * proxy misconfiguration away from never connecting. Epic #109 is explicit that
 * a feature existing only as an OS toast does not exist at all for the people
 * who denied it.
 *
 * So this component reads `NotificationContext`, whose contents come from
 * `GET /api/notifications` — a database table — and never from the stream
 * directly. The stream only makes the numbers change without a refresh.
 *
 * =============================================================================
 * NO BREAKPOINT GATE, DELIBERATELY
 * =============================================================================
 *
 * There is no `useMediaQuery` here. `CLAUDE.md` names FIVE coupled gates that
 * move together or not at all (`Layout`'s `showRail`, `BottomNav`'s self-gate,
 * `<main>`'s padding, and `isCompactWindow` in both `SettingsHub` and
 * `AppBar`), and a sixth would be a sixth thing to keep in lockstep for no
 * gain.
 *
 * The popover sizes itself with `min()` instead: `min(100vw - 32px, 380px)`
 * gives a phone a near-full-width sheet and a desktop a fixed panel, from ONE
 * declaration with no breakpoint in it and no second layout to keep in sync.
 * The same trick bounds its height against the viewport so a long list scrolls
 * inside the popover rather than off the bottom of a short screen.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  NotificationsNone as NotificationsNoneIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../contexts/NotificationContext';
import { recordNotificationInteraction } from '../../services/api';
import { isInternalLink } from '../../utils/internalLink';
import { formatRelativeTime } from '../../utils/relativeTime';
import type {
  AppNotification,
  NotificationAction,
  NotificationInteractionInput,
} from '../../types';

/**
 * The badge stops counting here and shows "20+".
 *
 * MUI's `max`. A four-digit badge is unreadable and would widen the toolbar;
 * the exact number past this point is not a thing anyone acts on, and the list
 * itself holds the same 20 (`RECENT_NOTIFICATION_COUNT`).
 */
const BADGE_MAX = 20;

export function NotificationBell() {
  const centre = useNotifications();
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * Open the popover, and RE-READ while doing it.
   *
   * The refresh is not redundant with the stream. A tab that has been open for
   * hours may have missed events entirely — the stream replays nothing after a
   * drop, and its fan-out is per API process, so a multi-replica deployment can
   * leave a perfectly healthy connection unaware of an event published
   * elsewhere. Opening the bell is a deliberate "show me what there is", which
   * makes it exactly the right moment to pay for one query. See the header of
   * `contexts/NotificationContext.tsx`.
   */
  const handleOpen = useCallback(() => {
    setOpen(true);
    void centre?.refresh();
  }, [centre]);

  /**
   * Record what the user did, without waiting for it.
   *
   * DELIBERATELY NOT AWAITED anywhere it is called. A metric must never be able
   * to delay or block the action it is measuring — a slow write must not leave
   * the user staring at a popover that has not closed. A failure costs one row
   * and a console warning.
   *
   * Only `coach.*` rows are recorded. The foundation events have no decision
   * behind them and nothing to attribute a click to; posting for them would
   * produce 404s and rows that mean nothing.
   */
  const record = useCallback(
    (notification: AppNotification, input: Omit<NotificationInteractionInput, 'notificationId'>) => {
      if (!notification.eventKey.startsWith('coach.')) return;

      void recordNotificationInteraction({
        notificationId: notification.id,
        ...input,
      }).catch(() => {
        // Intentionally quiet in production terms: there is nothing the user
        // could do, and nothing about their action failed.
        console.warn('Could not record a notification interaction');
      });
    },
    [],
  );

  const handleActionClick = useCallback(
    (notification: AppNotification, action: NotificationAction) => {
      if (notification.readAt === null) void centre?.markRead(notification.id);
      record(notification, { kind: 'ACTIONED', action: action.action });

      setOpen(false);

      // Re-checked, like the row's own link: `actions[].link` carries the same
      // root-relative guarantee, and a client that also checks survives the day
      // that guarantee is broken.
      if (isInternalLink(action.link)) navigate(action.link);
    },
    [centre, navigate, record],
  );

  const handleRowClick = useCallback(
    (notification: AppNotification) => {
      // Marked read on ANY click, including one that navigates nowhere: the
      // user has demonstrably seen it. Fire-and-forget — the context applies it
      // optimistically and reconciles the count from the response, so awaiting
      // here would only delay closing the popover.
      if (notification.readAt === null) void centre?.markRead(notification.id);

      // Closed BEFORE navigating. A popover left open across a route change
      // hangs over the page it just took the user to, anchored to a toolbar
      // button they are no longer looking at.
      setOpen(false);

      // `isInternalLink` re-checks a guarantee the API already makes (see that
      // function). A notification with no link is a perfectly ordinary
      // notification — it is an announcement, not a shortcut — so a missing
      // link is not an error state and the row simply marks itself read.
      // Opening the row IS the open. Recorded before navigating, and not
      // awaited, for the same reason as the action above.
      record(notification, { kind: 'OPENED' });

      if (isInternalLink(notification.link)) navigate(notification.link);
    },
    [centre, navigate, record],
  );

  // NO PROVIDER, NO BELL. `useNotifications` returns `null` rather than
  // throwing, so the app shell renders normally where the centre is not mounted
  // — `AppBar` is rendered standalone in several test files, none of which is
  // about notifications, and a shell that refuses to render because an optional
  // data provider is absent turns a missing decoration into a blank page. The
  // wiring point is `App.tsx`, which wraps the `Layout` route element.
  if (!centre) return null;

  const { notifications, unreadCount, isLoading, error, markAllRead } = centre;
  const hasUnread = unreadCount > 0;

  // One instant for the whole list, so seven rows rendered in one pass cannot
  // disagree about what "now" is.
  const renderedAt = new Date();

  return (
    <>
      {/* The accessible name CARRIES THE COUNT. A badge is a visual affordance
          and MUI renders it as decorative text a screen reader reads as a bare
          number next to a button called "notifications" — which is at best
          ambiguous and at worst silent. Spelling it into the label is what makes
          the unread state perceivable without sight. */}
      <Tooltip title="Notifications">
        <IconButton
          ref={anchorRef}
          onClick={handleOpen}
          color="inherit"
          aria-label={
            hasUnread
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, none unread'
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          sx={{ mr: 1, flexShrink: 0 }}
        >
          <Badge badgeContent={unreadCount} max={BADGE_MAX} color="error">
            {/* A FILLED bell when there is something unread, an outlined one
                otherwise. A second, non-colour cue for the same fact the badge
                carries: the badge is a small red dot, and red-on-grey is the
                single most common thing a colour-blind user cannot resolve. */}
            {hasUnread ? <NotificationsIcon /> : <NotificationsNoneIcon />}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            // `role="dialog"` matches the `aria-haspopup` on the trigger, and
            // the label names it — without one a screen reader announces an
            // unnamed dialog and the user has to guess what they just opened.
            role: 'dialog',
            'aria-label': 'Notifications',
            sx: {
              // See the header: `min()` rather than a breakpoint. `- 32px`
              // leaves the popover clear of the viewport edges on a phone
              // instead of butting against them.
              width: 'min(100vw - 32px, 380px)',
              // Bounded against the SHORT side too, so a long list scrolls
              // inside the panel rather than running off a landscape phone.
              maxHeight: 'min(70vh, 480px)',
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 1.5,
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            Notifications
          </Typography>
          {/* Shown only when it would do something. A permanently visible
              "Mark all read" that is disabled half the time is a control the
              user has to read before learning it is inert. */}
          {hasUnread && (
            <Button size="small" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </Box>

        <Divider />

        {/* `overflow: auto` on the SCROLLING region, not on the paper, so the
            header above stays put while the list moves under it. */}
        <Box sx={{ overflowY: 'auto', flexGrow: 1 }}>
          {error && (
            // Inline and permanent, not a snackbar. The list below it is either
            // empty or stale, and an auto-hiding message would leave the user
            // looking at "no notifications" with no reason given.
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}

          {isLoading && notifications.length === 0 && !error && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress size={24} aria-label="Loading notifications" />
            </Box>
          )}

          {!isLoading && !error && notifications.length === 0 && (
            // A REAL ANSWER, distinct from the spinner above. An empty list with
            // no text is indistinguishable from one that failed to load.
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                You&rsquo;re all caught up.
              </Typography>
            </Box>
          )}

          {notifications.length > 0 && (
            <List disablePadding>
              {notifications.map((notification, index) => {
                const isUnread = notification.readAt === null;

                return (
                  <Box component="li" key={notification.id} sx={{ listStyle: 'none' }}>
                    {index > 0 && <Divider component="div" />}
                    <ListItemButton
                      // `component="div"` + an explicit `role`/`tabIndex`: the
                      // row still behaves as a button, but it is no longer a
                      // real `<button>` element, so the action buttons inside it
                      // are valid markup rather than nested interactive content.
                      component="div"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowClick(notification)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleRowClick(notification);
                        }
                      }}
                      sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.5 }}
                    >
                      {/* THE THIRD, PURELY STRUCTURAL UNREAD CUE, after the
                          bold title and the badge. `aria-hidden` because the
                          text below already says "unread" to a screen reader —
                          a decorative dot that also announces itself is noise. */}
                      <Box
                        aria-hidden
                        sx={{
                          mt: 0.75,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          flexShrink: 0,
                          backgroundColor: isUnread ? 'primary.main' : 'transparent',
                        }}
                      />
                      {/* `minWidth: 0` so a long unbroken word (a URL in a body)
                          wraps instead of widening the popover past its `min()`. */}
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: isUnread ? 600 : 400 }}
                        >
                          {/* Rendered as TEXT. `title` and `body` were rendered
                              server-side at write time and are plain text by
                              contract; React escapes them regardless, and there
                              is deliberately no `dangerouslySetInnerHTML`
                              anywhere near a value that originates in a
                              notification template. */}
                          {notification.title}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.25 }}
                        >
                          {notification.body}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mt: 0.5 }}
                        >
                          {/* `<time>` with a machine-readable `dateTime`, and
                              the absolute timestamp in `title`: the relative
                              form answers "is this new?" at a glance, and the
                              tooltip answers "when exactly?" without a second
                              column. */}
                          <Box
                            component="time"
                            dateTime={notification.createdAt}
                            title={new Date(notification.createdAt).toLocaleString()}
                          >
                            {formatRelativeTime(notification.createdAt, renderedAt)}
                          </Box>
                          {isUnread && ' · Unread'}
                        </Typography>

                        {/*
                          ===========================================================
                          THE ACTION BUTTONS (#68, epic E12)
                          ===========================================================
                          VISION §37: minimise the steps between a reminder and the
                          real-world behaviour. The row's own click still works and
                          still lands on the primary link; these are the *other*
                          answers — "move it", "skip today" — which otherwise cost a
                          navigation, a search for the row, and a menu.

                          RENDERED AS A `div`, NOT INSIDE THE `ListItemButton`'s
                          click target semantics. A `<button>` nested inside a
                          `<button>` is invalid HTML and produces an accessibility
                          tree browsers disagree about, so the row is switched to
                          `component="div"` above and both the row and these buttons
                          carry their own handlers.

                          Each click stops propagation, or the row's own handler
                          would fire too and record a second, wrong interaction.

                          `flexWrap` and no breakpoint gate: below 600px the buttons
                          wrap onto their own line because there is no room, above it
                          they sit inline. That is layout responding to width, not a
                          sixth gate.
                        */}
                        {/* `?? []` because this row may have been fetched by a page
                            loaded before the field existed — a deploy is not
                            atomic across open tabs, and a blank popover is a
                            worse failure than a missing button. */}
                        {(notification.actions ?? []).length > 0 && (
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ flexWrap: 'wrap', mt: 1 }}
                          >
                            {(notification.actions ?? []).map((action, actionIndex) => (
                              <Button
                                key={action.action}
                                size="small"
                                variant={actionIndex === 0 ? 'outlined' : 'text'}
                                // The title is in the label because a screen
                                // reader hears these out of context: three rows
                                // each offering "Skip today" are otherwise
                                // indistinguishable.
                                aria-label={`${action.label} — ${notification.title}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleActionClick(notification, action);
                                }}
                              >
                                {action.label}
                              </Button>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    </ListItemButton>
                  </Box>
                );
              })}
            </List>
          )}
        </Box>
      </Popover>
    </>
  );
}

export default NotificationBell;
