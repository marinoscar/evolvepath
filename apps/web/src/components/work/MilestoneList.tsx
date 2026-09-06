import {
  Card,
  CardContent,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';

import type { OutcomeWorkPlanSession, WorkMilestone } from '../../types';

interface MilestoneListProps {
  milestones: WorkMilestone[];
  sessions: OutcomeWorkPlanSession[];
}

const DONE_STATUSES = new Set(['COMPLETED', 'PARTIALLY_COMPLETED']);

/**
 * The deliverables an outcome breaks into, with how far each has got
 * (PRD §24).
 *
 * Progress is COMPLETED SESSIONS, not a self-assessment: a milestone is done
 * when the work under it is done, and asking the user to rate it would be one
 * more thing to keep up to date.
 */
export function MilestoneList({ milestones, sessions }: MilestoneListProps) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Milestones
        </Typography>

        {milestones.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            No milestones yet. Plan sessions with the coach to break this into deliverables.
          </Typography>
        ) : (
          <List disablePadding>
            {milestones.map((milestone) => {
              const own = sessions.filter((session) => session.milestoneId === milestone.id);
              const done = own.filter((session) => DONE_STATUSES.has(session.status)).length;
              const progress = own.length === 0 ? 0 : (done / own.length) * 100;

              return (
                <ListItem
                  key={milestone.id}
                  disableGutters
                  sx={{ display: 'block' }}
                  data-testid={`milestone-${milestone.id}`}
                >
                  <ListItemText
                    primary={milestone.title}
                    secondary={
                      own.length === 0
                        ? 'No sessions yet'
                        : `${done} of ${own.length} sessions done`
                    }
                  />
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    aria-label={`${milestone.title}: ${done} of ${own.length} sessions done`}
                    sx={{ mb: 1 }}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
