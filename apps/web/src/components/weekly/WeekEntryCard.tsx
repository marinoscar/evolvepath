import {
  Button,
  Card,
  CardActions,
  CardContent,
  Skeleton,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import type { WeeklyReviewDetail } from '../../types';

const DOMAINS = ['WORK', 'FAMILY', 'HEALTH'] as const;

/**
 * The way into the weekly review from Progress (issue #84).
 *
 * A card on the Progress placeholder rather than a sixth destination: the
 * review IS the weekly view of progress, so it lives under the tab that lights
 * up for it. E11-04 keeps this card when it replaces the rest of the page.
 */
export default function WeekEntryCard({
  review,
  isLoading,
}: {
  review: WeeklyReviewDetail | null;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="week-entry-card">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Your Week
        </Typography>

        {isLoading ? (
          <Skeleton width={220} />
        ) : review ? (
          <Typography color="text.secondary">
            {DOMAINS.map(
              (domain) =>
                `${label(domain)} ${review.counts[domain].completed} / ${review.counts[domain].planned}`,
            ).join(' · ')}
          </Typography>
        ) : (
          <Typography color="text.secondary">No review yet.</Typography>
        )}
      </CardContent>

      <CardActions>
        <Button component={RouterLink} to="/progress/week">
          {review ? 'Open your week' : 'Generate a review'}
        </Button>
      </CardActions>
    </Card>
  );
}

function label(domain: string): string {
  return domain.charAt(0) + domain.slice(1).toLowerCase();
}
