import { Box, Card, CardContent, Container, Stack, Typography } from '@mui/material';

import WeekEntryCard from '../components/weekly/WeekEntryCard';
import { useWeeklyReview } from '../hooks/useWeeklyReview';

/**
 * Progress — momentum and charts arrive with E11.
 *
 * E10 adds the way into the weekly review. The review lives under this
 * destination rather than at a route of its own because it IS the weekly view
 * of progress; E11-04 keeps this card when it replaces the placeholder below.
 */
export default function ProgressPage() {
  const { review, isLoading } = useWeeklyReview();

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Progress
        </Typography>

        <Stack spacing={3} sx={{ mt: 3 }}>
          <WeekEntryCard review={review} isLoading={isLoading} />

          <Card data-testid="progress-placeholder">
            <CardContent>
              <Typography color="text.secondary">
                Momentum and evidence will appear here.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </Container>
  );
}
