import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import type { CommitmentCard, Ritual } from '../../types';
import { describeRecurrence } from '../../utils/recurrence';

interface PathFamilySectionProps {
  rituals: Ritual[];
  /** The next seven days of family occurrences, ascending. */
  upcoming: CommitmentCard[];
}

/** The soonest upcoming occurrence of one ritual, if there is one. */
function nextFor(ritualId: string, upcoming: CommitmentCard[]): CommitmentCard | undefined {
  return upcoming.find((commitment) => commitment.ritualId === ritualId);
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Family on the Path screen: what the user is protecting, and when it is next.
 *
 * A LINK, not a second Family surface. `/path/family` owns the editors; this
 * section exists because the Path screen answers "what is the shape of my
 * life?", and a set of rituals the user committed to belongs in that answer.
 * Duplicating the editors here would be two places to keep in step.
 */
export function PathFamilySection({ rituals, upcoming }: PathFamilySectionProps) {
  const active = rituals.filter((ritual) => ritual.active);

  return (
    <Card component="section" aria-label="Family rituals" sx={{ mt: 3 }}>
      <CardContent>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
        >
          <Typography variant="h6" component="h2">
            Family
          </Typography>
          <Button size="small" component={RouterLink} to="/path/family">
            Manage rituals
          </Button>
        </Box>

        {active.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No rituals yet — the recurring times you are protecting will show here.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {active.map((ritual) => {
              const next = nextFor(ritual.id, upcoming);

              return (
                <Box key={ritual.id} data-testid={`path-ritual-${ritual.id}`}>
                  <Typography variant="subtitle2" component="div">
                    {ritual.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {describeRecurrence(ritual.recurrence)}
                    {next ? ` · Next ${formatWhen(next.scheduledStart)}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
