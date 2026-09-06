import { Alert, Box, CircularProgress, Container, Grid, Stack, Typography } from '@mui/material';

import WeekEntryCard from '../components/weekly/WeekEntryCard';
import CoachDependencyCard from '../components/progress/CoachDependencyCard';
import ConsistencyChart from '../components/progress/ConsistencyChart';
import EvidenceTimeline from '../components/progress/EvidenceTimeline';
import EvolutionCard from '../components/progress/EvolutionCard';
import InsightsList from '../components/progress/InsightsList';
import MilestoneToast from '../components/progress/MilestoneToast';
import MomentumCard from '../components/progress/MomentumCard';
import RecoveryCard from '../components/progress/RecoveryCard';
import { useBestSelf } from '../hooks/useBestSelf';
import { useMilestoneToasts } from '../hooks/useMilestoneToasts';
import { useProgress } from '../hooks/useProgress';
import { useProgressTimeline } from '../hooks/useProgressTimeline';
import { useWeeklyReview } from '../hooks/useWeeklyReview';
import { DOMAIN_ORDER } from '../types';

/**
 * Progress (issue #117, epic E11).
 *
 * PRD §75's sections, in its order. THERE IS NO SCORE ON THIS PAGE, and its
 * absence is the design (PRD P13, §54): every number rendered here is a count
 * inside a sentence, and there is nothing in the payload to build a percentage
 * from — the API deliberately does not serialise the ratios its engine
 * compares.
 *
 * Each section is a landmark with its own `h2`, so the page can be navigated by
 * heading rather than by scrolling — this is the screen a user comes to in
 * order to find one specific thing about themselves.
 */
export default function ProgressPage() {
  const { progress, isLoading, error } = useProgress();
  const { profile: bestSelf } = useBestSelf();
  const { review, isLoading: reviewLoading } = useWeeklyReview();
  const timeline = useProgressTimeline();
  const milestones = useMilestoneToasts();

  if (isLoading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress aria-label="Loading progress" />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Progress
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={4} sx={{ mt: 3 }}>
          {/* E10's way into the weekly review. It IS the weekly view of
              progress, so it stays where E10 put it. */}
          <WeekEntryCard review={review} isLoading={reviewLoading} />

          {progress && (
            <>
              <section aria-labelledby="progress-evolution">
                <Typography variant="h6" component="h2" id="progress-evolution" gutterBottom>
                  Your evolution
                </Typography>
                <EvolutionCard progress={progress} bestSelf={bestSelf} />
              </section>

              <section aria-labelledby="progress-momentum">
                <Typography variant="h6" component="h2" id="progress-momentum" gutterBottom>
                  Momentum
                </Typography>
                <Grid container spacing={2}>
                  {DOMAIN_ORDER.map((domain) => (
                    <Grid key={domain} size={{ xs: 12, md: 4 }}>
                      <MomentumCard momentum={progress.momentum[domain]} />
                    </Grid>
                  ))}
                </Grid>
              </section>

              <section aria-labelledby="progress-evidence">
                <Typography variant="h6" component="h2" id="progress-evidence" gutterBottom>
                  Evidence
                </Typography>
                <EvidenceTimeline items={timeline.items} compact />
              </section>

              <section aria-labelledby="progress-consistency">
                <Typography variant="h6" component="h2" id="progress-consistency" gutterBottom>
                  Consistency
                </Typography>
                <ConsistencyChart run={progress.consistencyRun} />
              </section>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <section aria-labelledby="progress-recovery">
                    <Typography variant="h6" component="h2" id="progress-recovery" gutterBottom>
                      Recovery
                    </Typography>
                    <RecoveryCard recovery={progress.recovery} />
                  </section>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <section aria-labelledby="progress-independence">
                    <Typography
                      variant="h6"
                      component="h2"
                      id="progress-independence"
                      gutterBottom
                    >
                      Coach dependency
                    </Typography>
                    <CoachDependencyCard independence={progress.independence} />
                  </section>
                </Grid>
              </Grid>

              <section aria-labelledby="progress-insights">
                <Typography variant="h6" component="h2" id="progress-insights" gutterBottom>
                  Insights
                </Typography>
                <InsightsList insights={progress.insights} />
              </section>
            </>
          )}
        </Stack>
      </Box>

      <MilestoneToast
        milestone={milestones.current}
        onClose={() => void milestones.dismiss()}
      />
    </Container>
  );
}
