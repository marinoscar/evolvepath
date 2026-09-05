import { Card, CardContent, Skeleton, Typography } from '@mui/material';

import type { TodayInsight } from '../../types';

interface CoachInsightCardProps {
  insight: TodayInsight | null;
  isLoading: boolean;
}

/**
 * The coach's sentence.
 *
 * RENDERS NOTHING when there is nothing to say. It is the one card on this
 * screen that depends on an AI provider, and the page is designed so its absence
 * is invisible rather than an error box next to a perfectly usable
 * recommendation (PRD §120).
 *
 * The "written without the coach" caption is deliberate honesty: the sentence is
 * real advice either way, and a user comparing two days should be able to tell
 * which one the model wrote.
 */
export function CoachInsightCard({ insight, isLoading }: CoachInsightCardProps) {
  if (isLoading) {
    return (
      <Card sx={{ mb: 2 }} data-testid="coach-insight-loading">
        <CardContent>
          <Skeleton width="90%" />
          <Skeleton width="60%" />
        </CardContent>
      </Card>
    );
  }

  if (!insight) return null;

  return (
    <Card sx={{ mb: 2 }} data-testid="coach-insight">
      <CardContent>
        <Typography>{insight.text}</Typography>
        {insight.source === 'template' && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1 }}
            data-testid="coach-insight-template"
          >
            Written without the coach
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
