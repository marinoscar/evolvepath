import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Divider,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';

import { useNutritionBehaviours } from '../hooks/useNutritionBehaviours';
import { useWeightLog } from '../hooks/useWeightLog';
import { NutritionBehaviourList } from '../components/health/NutritionBehaviourList';
import { WeightLogForm } from '../components/health/WeightLogForm';
import { WeightTrendChart } from '../components/health/WeightTrendChart';

/**
 * `/health` — the Health surface (PRD §46, §47; VISION §16).
 *
 * A route under Path, like `/path/family`: PRD §11 fixes five destinations, and
 * `DESTINATION_ROUTES.path` owns `/health` by prefix, so this needs no
 * navigation change and no settings card.
 *
 * Three sections in the order somebody actually uses them: the program they are
 * running, the eating behaviours they might add, and the optional weight log —
 * optional both in the sense that nothing requires it and in the sense that
 * nothing else in the product reads it. Momentum (E11) is computed from
 * behaviour evidence; weight is for the user, not for the software.
 */
export function HealthPage() {
  const behaviours = useNutritionBehaviours();
  const weight = useWeightLog();
  const [notice, setNotice] = useState<string | null>(null);

  const handleCommit = async (key: string, repeatDays: number) => {
    const behaviour = behaviours.behaviours.find((row) => row.key === key);

    try {
      const count = await behaviours.commit(key, repeatDays);
      setNotice(
        `${behaviour?.title ?? 'Added'} — on your next ${count} ${count === 1 ? 'day' : 'days'}.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not add that.');
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Health
      </Typography>

      <Stack spacing={4}>
        <Box component="section" aria-labelledby="health-programs">
          <Typography variant="h6" component="h2" id="health-programs" gutterBottom>
            Training
          </Typography>
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <FitnessCenterIcon color="action" />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body1">Workout programs</Typography>
                  <Typography variant="body2" color="text.secondary">
                    A structured program that schedules itself onto your days.
                  </Typography>
                </Box>
                <Button component={RouterLink} to="/health/programs" size="small">
                  Open
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Box>

        <Divider />

        <Box component="section" aria-labelledby="health-nutrition">
          <Typography variant="h6" component="h2" id="health-nutrition" gutterBottom>
            Eating habits
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Behaviours, not numbers. Pick one and put it on the week.
          </Typography>

          {behaviours.isLoading ? (
            <CircularProgress size={24} />
          ) : behaviours.error ? (
            <Alert severity="error">{behaviours.error}</Alert>
          ) : (
            <NutritionBehaviourList
              behaviours={behaviours.behaviours}
              onCommit={handleCommit}
            />
          )}
        </Box>

        <Divider />

        <Box component="section" aria-labelledby="health-weight">
          <Typography variant="h6" component="h2" id="health-weight" gutterBottom>
            Weight
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Optional, and about the direction over weeks rather than any one morning.
          </Typography>

          <WeightLogForm onSave={weight.save} />

          <Box sx={{ mt: 3 }}>
            {weight.isLoading ? (
              <CircularProgress size={24} />
            ) : weight.error ? (
              <Alert severity="error">{weight.error}</Alert>
            ) : weight.trend ? (
              <WeightTrendChart trend={weight.trend} />
            ) : null}
          </Box>
        </Box>
      </Stack>

      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </Container>
  );
}

export default HealthPage;
