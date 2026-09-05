import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { CoachReply } from '../../types';

/**
 * PRD §67's call to action: one action, one button, a number of minutes.
 *
 * With a `commitmentId` it deep-links into E05's Start flow (`/start/:id`) so
 * the timer the coach just talked about is the timer that opens. Without one
 * it falls back to `/today` — a button that promised "Start 10 min" and landed
 * nowhere would be worse than no button.
 */
export default function RecommendedActionCard({
  action,
  fallback,
}: {
  action: NonNullable<CoachReply['recommended_action']>;
  fallback: CoachReply['fallback_action'];
}) {
  const navigate = useNavigate();

  return (
    <Card variant="outlined" sx={{ mt: 1 }} data-testid="recommended-action">
      <CardContent sx={{ py: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Typography variant="body2">{action.title}</Typography>

          <Button
            variant="contained"
            size="small"
            onClick={() =>
              navigate(
                action.commitmentId ? `/start/${action.commitmentId}` : '/today',
              )
            }
          >
            Start {action.duration_minutes} min
          </Button>
        </Stack>

        {fallback && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Fallback: {fallback.title} ({fallback.duration_minutes} min)
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
