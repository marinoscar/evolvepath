import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';

import type { SessionExercise, SetLog } from '../../../types';
import { ProgressionChip } from './ProgressionChip';

interface ExerciseCardProps {
  exercise: SessionExercise;
  /** `clientId`s that have not reached the server yet. */
  pending: string[];
  onExplain: () => Promise<string>;
  /** Opens the form check for this movement (epic E09). */
  onCheckForm?: () => void;
  children?: React.ReactNode;
}

function describeSets(sets: SetLog[]): string {
  if (sets.length === 0) return '—';

  const weight = sets.find((set) => set.weightKg !== null)?.weightKg;
  const reps = sets.map((set) => set.reps).join(', ');

  return weight === undefined || weight === null ? reps : `${weight} kg × ${reps}`;
}

/**
 * One movement, with what happened last time and what to do about it.
 *
 * "Last time: —" rather than hiding the line for a movement with no history.
 * The line's absence and an empty line say different things, and the second one
 * is true: we looked, and there is nothing yet.
 *
 * A logged set that has not reached the server still renders, with a badge.
 * The user did it; hiding it until a request succeeds would be the app losing
 * work in front of them.
 */
export function ExerciseCard({
  exercise,
  pending,
  onExplain,
  onCheckForm,
  children,
}: ExerciseCardProps) {
  const range =
    exercise.repMin === exercise.repMax
      ? `${exercise.repMin}`
      : `${exercise.repMin}–${exercise.repMax}`;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
            {exercise.name}
          </Typography>
          {onCheckForm ? (
            <IconButton
              aria-label={`Record a video of your ${exercise.name} set`}
              onClick={onCheckForm}
              data-testid="runner-form-check"
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <VideocamIcon />
            </IconButton>
          ) : null}
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {exercise.sets} × {range} · rest {exercise.restSeconds} s
        </Typography>

        <Typography variant="body2" sx={{ mt: 1 }} data-testid="runner-last-time">
          Last time: {exercise.lastTime ? describeSets(exercise.lastTime.sets) : '—'}
        </Typography>

        {exercise.progression ? (
          <Box sx={{ mt: 1 }}>
            <ProgressionChip suggestion={exercise.progression} onExplain={onExplain} />
          </Box>
        ) : null}

        {exercise.logged.length > 0 ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}
            aria-label={`Sets logged for ${exercise.name}`}
          >
            {exercise.logged.map((set) => (
              <Chip
                key={set.clientId}
                size="small"
                variant="outlined"
                label={`${set.weightKg ?? '—'} kg × ${set.reps}`}
                title={
                  pending.includes(set.clientId) ? 'Saved on this device' : undefined
                }
                icon={
                  pending.includes(set.clientId) ? (
                    <Box
                      component="span"
                      aria-label="Saved on this device"
                      sx={{ pl: 1, fontSize: 12 }}
                    >
                      ⧗
                    </Box>
                  ) : undefined
                }
              />
            ))}
          </Stack>
        ) : null}

        {children}
      </CardContent>
    </Card>
  );
}
