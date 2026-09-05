import { Box, Card, CardContent, List, Typography } from '@mui/material';

import type { CommitmentCard } from '../../types';
import { CommitmentRow } from '../today/CommitmentRow';
import type { FamilyRowAction } from './familyLabels';

interface UpcomingFamilyCommitmentsProps {
  commitments: CommitmentCard[];
  pendingId?: string | null;
  onAction: (action: FamilyRowAction, commitment: CommitmentCard) => void;
}

/** The local day a commitment belongs to, as a heading. */
function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/**
 * The next seven days of family commitments, grouped by day.
 *
 * Reuses `CommitmentRow` rather than drawing its own: the row already renders
 * the API's `availableActions` and, on a FAMILY commitment, already speaks in
 * family words. A second row component here would be a second place for the
 * two to disagree.
 */
export function UpcomingFamilyCommitments({
  commitments,
  pendingId,
  onAction,
}: UpcomingFamilyCommitmentsProps) {
  const byDay = new Map<string, CommitmentCard[]>();

  for (const commitment of commitments) {
    const key = dayLabel(commitment.scheduledStart);
    byDay.set(key, [...(byDay.get(key) ?? []), commitment]);
  }

  return (
    <Card component="section" aria-label="Upcoming" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Upcoming
        </Typography>

        {commitments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing in the next seven days. Create a ritual and it will appear here.
          </Typography>
        ) : (
          [...byDay.entries()].map(([day, rows]) => (
            <Box key={day} sx={{ mb: 1.5 }}>
              <Typography variant="overline" color="text.secondary">
                {day}
              </Typography>
              <List disablePadding>
                {rows.map((commitment) => (
                  <CommitmentRow
                    key={commitment.id}
                    commitment={commitment}
                    disabled={pendingId === commitment.id}
                    onAction={onAction}
                  />
                ))}
              </List>
            </Box>
          ))
        )}
      </CardContent>
    </Card>
  );
}
