import { useState } from 'react';
import {
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import type { FocusSession } from '../../types';

interface SessionHistoryProps {
  sessions: FocusSession[];
}

/** The most recent sessions worth reading in one sitting. */
const MAX_SHOWN = 20;

const OUTCOME_LABELS: Record<string, string> = {
  DONE: 'Done',
  PARTIAL: 'Partly done',
  ABANDONED: 'Stopped',
};

/**
 * What actually happened, session by session (PRD §29's raw material).
 *
 * Planned versus actual minutes side by side, because the gap between them is
 * the interesting number and neither one is on its own. No score and no verdict:
 * a session that ran short is information, not a mark.
 */
export function SessionHistory({ sessions }: SessionHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Recent focus sessions
        </Typography>

        {sessions.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            No focus sessions in the last 30 days.
          </Typography>
        ) : (
          <List disablePadding>
            {sessions.slice(0, MAX_SHOWN).map((session) => (
              <ListItem
                key={session.id}
                disableGutters
                sx={{ display: 'block' }}
                data-testid={`focus-session-${session.id}`}
              >
                <ListItemText
                  primary={new Date(session.startedAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.5 }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {session.actualMinutes ?? 0} of {session.plannedMinutes} min
                      </Typography>

                      {session.outcome && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={OUTCOME_LABELS[session.outcome] ?? session.outcome}
                        />
                      )}

                      {session.continuedCount > 0 && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color="success"
                          label={`Continued ×${session.continuedCount}`}
                        />
                      )}

                      {session.distractionNotes.length > 0 && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            {session.distractionNotes.length}{' '}
                            {session.distractionNotes.length === 1 ? 'note' : 'notes'}
                          </Typography>
                          <IconButton
                            size="small"
                            aria-label={`Show distraction notes for this session`}
                            aria-expanded={expanded === session.id}
                            onClick={() =>
                              setExpanded(expanded === session.id ? null : session.id)
                            }
                          >
                            <ExpandMoreIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  }
                />

                <Collapse in={expanded === session.id}>
                  <Stack spacing={0.5} sx={{ pl: 2, pb: 1 }}>
                    {session.distractionNotes.map((note, index) => (
                      <Typography key={`${note}-${index}`} variant="caption" color="text.secondary">
                        {note}
                      </Typography>
                    ))}
                  </Stack>
                </Collapse>
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
