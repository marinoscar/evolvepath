import { useState } from 'react';
import {
  Alert,
  Box,
  Container,
  Skeleton,
  Snackbar,
  Typography,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';

import WeeklyPlanWizard, { weekDatesFrom } from '../components/weekly/WeeklyPlanWizard';
import { formatDay } from '../components/weekly/ExtraCommitmentDialog';
import { useWeeklyPlan } from '../hooks/useWeeklyPlan';

/**
 * Plan next week (`/progress/week/plan`).
 *
 * Inside `Layout`, not full-screen — unlike E09's workout runner. A weekly plan
 * is a deliberate sit-down, not a live activity, and taking the navigation away
 * would make leaving it feel like abandoning something.
 */
export default function WeeklyPlanPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { plan, isLoading, isSaving, error, update, propose, approve } = useWeeklyPlan(
    params.get('planId') ?? undefined,
  );
  const [approvedCount, setApprovedCount] = useState<number | null>(null);

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Plan next week
        </Typography>

        {plan && (
          <Typography variant="body2" color="text.secondary">
            {weekRange(plan.weekStart)}
          </Typography>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {isLoading && <Skeleton variant="rounded" height={220} sx={{ mt: 3 }} />}

        {plan && (
          <WeeklyPlanWizard
            plan={plan}
            saving={isSaving}
            onUpdate={update}
            onPropose={propose}
            onApprove={async (acknowledgeWarnings) => {
              const result = await approve(acknowledgeWarnings);
              if (!result) return;

              setApprovedCount(result.createdCommitmentIds.length);
              // Back to the review the plan came from, where "Next week
              // approved" is now the state of the Next week section.
              navigate('/progress/week');
            }}
          />
        )}

        <Snackbar
          open={approvedCount !== null}
          autoHideDuration={5000}
          onClose={() => setApprovedCount(null)}
          message={`Next week is ready · ${approvedCount} commitments`}
        />
      </Box>
    </Container>
  );
}

function weekRange(weekStart: string): string {
  const dates = weekDatesFrom(weekStart);

  return `${formatDay(dates[0])} – ${formatDay(dates[6])}`;
}
