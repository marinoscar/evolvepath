import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { OutcomeWorkPlanSession } from '../../types';

interface PlannedSessionsListProps {
  sessions: OutcomeWorkPlanSession[];
  onStart: (session: OutcomeWorkPlanSession) => void;
  onReschedule: (session: OutcomeWorkPlanSession) => void;
}

const OPEN_STATUSES = new Set(['PLANNED', 'READY', 'STARTED']);

/** `Fri 12 Sep`, in the reader's own locale. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The dated sessions this outcome's plan produced, grouped by day (PRD §24).
 *
 * Grouped rather than listed flat because the question somebody opens this to
 * answer is "what is this week", and a list of fifteen timestamps does not
 * answer it.
 */
export function PlannedSessionsList({
  sessions,
  onStart,
  onReschedule,
}: PlannedSessionsListProps) {
  const [menuFor, setMenuFor] = useState<{
    anchor: HTMLElement;
    session: OutcomeWorkPlanSession;
  } | null>(null);

  const byDay = new Map<string, OutcomeWorkPlanSession[]>();

  for (const session of sessions) {
    const key = session.scheduledStart.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), session]);
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Planned sessions
        </Typography>

        {sessions.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            No sessions planned yet.
          </Typography>
        ) : (
          [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, daySessions]) => (
              <div key={day}>
                <Typography variant="overline" color="text.secondary">
                  {dayLabel(daySessions[0].scheduledStart)}
                </Typography>

                <List disablePadding>
                  {daySessions.map((session) => (
                    <ListItem
                      key={session.id}
                      disableGutters
                      data-testid={`planned-session-${session.id}`}
                      secondaryAction={
                        <IconButton
                          edge="end"
                          size="small"
                          aria-label={`Actions for ${session.title}`}
                          onClick={(event) =>
                            setMenuFor({ anchor: event.currentTarget, session })
                          }
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={session.title}
                        slotProps={{ secondary: { component: 'div' } }}
                        secondary={
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.5 }}
                          >
                            <Typography variant="caption" color="text.secondary">
                              {timeLabel(session.scheduledStart)}
                              {session.durationMinutes
                                ? ` · ${session.durationMinutes} min`
                                : ''}
                            </Typography>

                            <Chip size="small" variant="outlined" label={session.status} />

                            {session.rescheduleCount >= 1 && (
                              <Chip
                                size="small"
                                color="warning"
                                variant="outlined"
                                label={`Moved ×${session.rescheduleCount}`}
                              />
                            )}

                            {OPEN_STATUSES.has(session.status) && (
                              <Button size="small" onClick={() => onStart(session)}>
                                Start
                              </Button>
                            )}
                          </Stack>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </div>
            ))
        )}
      </CardContent>

      <Menu
        anchorEl={menuFor?.anchor ?? null}
        open={Boolean(menuFor)}
        onClose={() => setMenuFor(null)}
      >
        <MenuItem
          onClick={() => {
            const session = menuFor?.session;
            setMenuFor(null);
            if (session) onReschedule(session);
          }}
        >
          Reschedule
        </MenuItem>
      </Menu>
    </Card>
  );
}
