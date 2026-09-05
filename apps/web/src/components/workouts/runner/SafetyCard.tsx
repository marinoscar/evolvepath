import { Alert, AlertTitle, Button, Stack } from '@mui/material';

interface SafetyCardProps {
  copy: string;
  onStopExercise: () => void;
  onEndWorkout: () => void;
}

/**
 * PRD §45, and the shortest component in the epic on purpose.
 *
 * The copy comes from the SERVER — one constant, quoted identically by the
 * runner, the form check and the progression explanation. There is no
 * programming advice here and there must never be: not "try it lighter", not
 * "switch to the machine version". The two actions are stop and stop.
 */
export function SafetyCard({ copy, onStopExercise, onEndWorkout }: SafetyCardProps) {
  return (
    <Alert severity="warning" sx={{ mt: 2 }} data-testid="safety-card">
      <AlertTitle>Stop</AlertTitle>
      {copy}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" onClick={onStopExercise} sx={{ minHeight: 44 }}>
          Stop this exercise
        </Button>
        <Button onClick={onEndWorkout} sx={{ minHeight: 44 }}>
          End workout
        </Button>
      </Stack>
    </Alert>
  );
}
