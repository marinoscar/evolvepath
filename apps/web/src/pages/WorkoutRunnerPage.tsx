import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';

import { useIsMounted } from '../hooks/useIsMounted';
import { clearOutbox, useSetLogOutbox } from '../hooks/useSetLogOutbox';
import {
  explainProgression,
  finishWorkoutSession,
  getWorkoutSession,
  switchWorkoutVariant,
} from '../services/api';
import type { WorkoutSessionView, WorkoutVariant } from '../types';
import { ExerciseCard } from '../components/workouts/runner/ExerciseCard';
import { FinishDialog } from '../components/workouts/runner/FinishDialog';
import { RestTimer } from '../components/workouts/runner/RestTimer';
import { RunnerHeader } from '../components/workouts/runner/RunnerHeader';
import { SafetyCard } from '../components/workouts/runner/SafetyCard';
import { SetInputs, type SetInputValues } from '../components/workouts/runner/SetInputs';

// =============================================================================
// `/workout/:sessionId` — the runner (issue #109, epic E09)
// =============================================================================
//
// FULL SCREEN BY ROUTE PLACEMENT AND NOTHING ELSE. The route sits outside
// `Layout`, exactly like `/start/:commitmentId` and `/activate`, so there is no
// rail and no bottom bar to hide. The five coupled breakpoint gates are
// untouched: this file does not know they exist, and that is the point.
//
// PRD §11 asks the runner to replace the navigation while a workout runs, and
// "replace" is achieved by never mounting it rather than by a gate that
// remembers to turn it off.
//
// ONE COLUMN AT EVERY WIDTH. Somebody is holding this at arm's length between
// sets; a two-column layout on a tablet would put the set inputs somewhere
// other than under the thumb.
// =============================================================================

/** How long a rest timer stays on screen after the set that started it. */
function restStartFor(loggedAt: string): number {
  return new Date(loggedAt).getTime();
}

export function WorkoutRunnerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const isMounted = useIsMounted();

  const [session, setSession] = useState<WorkoutSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rest, setRest] = useState<{ startedAt: number; seconds: number } | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string[]>([]);
  const [finishOpen, setFinishOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;

    try {
      const view = await getWorkoutSession(sessionId);

      if (!isMounted()) return;

      setSession(view);
      setSafety(view.safety?.copy ?? null);

      // A reload mid-rest picks the timer back up rather than dropping it: the
      // set's own timestamp is the only state it ever needed.
      const newest = view.exercises
        .flatMap((exercise) => exercise.logged.map((set) => ({ set, exercise })))
        .sort(
          (a, b) => restStartFor(b.set.loggedAt) - restStartFor(a.set.loggedAt),
        )[0];

      if (newest) {
        const startedAt = restStartFor(newest.set.loggedAt);
        const elapsed = (Date.now() - startedAt) / 1000;

        if (elapsed < newest.exercise.restSeconds) {
          setRest({ startedAt, seconds: newest.exercise.restSeconds });
        }
      }
    } catch (err) {
      const status = (err as { status?: number }).status;

      if (!isMounted()) return;

      if (status === 404) setNotFound(true);
      else setError(err instanceof Error ? err.message : 'Could not load this workout.');
    } finally {
      if (isMounted()) setLoading(false);
    }
  }, [isMounted, sessionId]);

  const outbox = useSetLogOutbox(sessionId, { onSynced: () => void refresh() });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentExercise = session?.exercises.find(
    (exercise) =>
      !stopped.includes(exercise.exerciseId) && exercise.logged.length < exercise.sets,
  );

  const completeSet = async (values: SetInputValues) => {
    if (!session || !currentExercise) return;

    setSubmitting(true);

    const body = {
      clientId: crypto.randomUUID(),
      exerciseId: currentExercise.exerciseId,
      setNumber: currentExercise.logged.length + 1,
      weightKg: values.weightKg,
      reps: values.reps,
      rpe: values.rpe,
      discomfort: values.discomfort,
      loggedAt: new Date().toISOString(),
    };

    // Optimistic: the set is on screen before the request resolves, because the
    // user did it and a failed request must not be able to take it away.
    setSession((current) =>
      current
        ? {
            ...current,
            exercises: current.exercises.map((exercise) =>
              exercise.exerciseId === body.exerciseId
                ? {
                    ...exercise,
                    logged: [
                      ...exercise.logged,
                      { ...body, id: body.clientId, rpe: body.rpe ?? null } as never,
                    ],
                  }
                : exercise,
            ),
          }
        : current,
    );

    setRest({ startedAt: Date.now(), seconds: currentExercise.restSeconds });

    const result = await outbox.enqueue(body);

    if (isMounted()) {
      if (result.safetyCopy) setSafety(result.safetyCopy);
      setSubmitting(false);
    }
  };

  const handleSwitchVariant = async (variant: WorkoutVariant) => {
    if (!sessionId) return;

    try {
      const view = await switchWorkoutVariant(sessionId, variant);
      if (isMounted()) setSession(view);
    } catch (err) {
      if (isMounted()) {
        setError(err instanceof Error ? err.message : 'Could not switch version.');
      }
    }
  };

  const handleFinish = async (
    status: 'COMPLETED' | 'ABANDONED',
    notes: string | null,
  ) => {
    if (!sessionId) return;

    setSubmitting(true);

    try {
      // Anything still queued goes now: a finished session refuses new sets.
      await outbox.flush();

      const result = await finishWorkoutSession(sessionId, { status, notes });

      clearOutbox(sessionId);
      navigate('/', {
        state: {
          notice: `${result.summary.sets} sets · ${result.summary.volumeKg} kg · ${result.summary.minutes} min`,
        },
      });
    } catch (err) {
      if (isMounted()) {
        setError(err instanceof Error ? err.message : 'Could not finish the workout.');
        setSubmitting(false);
        setFinishOpen(false);
      }
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Typography variant="h6" component="h1" gutterBottom>
          This workout is gone
        </Typography>
        <Button component={RouterLink} to="/">
          Back to Today
        </Button>
      </Container>
    );
  }

  if (!session) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="error">{error ?? 'Something went wrong.'}</Alert>
      </Container>
    );
  }

  const done = !currentExercise;

  return (
    <Container maxWidth="sm" sx={{ py: 3, pb: 12 }}>
      <RunnerHeader
        title={session.header.title}
        sessionIndex={session.header.sessionIndex}
        sessionTotal={session.header.sessionTotal}
        startedAt={session.startedAt}
        variant={session.variant}
        availableVariants={session.availableVariants}
        onSwitchVariant={(variant) => void handleSwitchVariant(variant)}
        onEnd={() => setFinishOpen(true)}
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {outbox.rejected.length > 0 ? (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button size="small" onClick={() => outbox.rejected.forEach((row) => outbox.discard(row.clientId))}>
              Discard
            </Button>
          }
        >
          {outbox.rejected.length} set{outbox.rejected.length === 1 ? '' : 's'} could not be
          saved.
        </Alert>
      ) : null}

      {safety ? (
        <SafetyCard
          copy={safety}
          onStopExercise={() => {
            if (currentExercise) {
              setStopped((current) => [...current, currentExercise.exerciseId]);
            }
            setSafety(null);
            setRest(null);
          }}
          onEndWorkout={() => {
            setSafety(null);
            setFinishOpen(true);
          }}
        />
      ) : null}

      <Stack spacing={2} sx={{ mt: 2 }}>
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.exerciseId}
            exercise={exercise}
            pending={outbox.pending}
            onExplain={async () => {
              const result = await explainProgression(session.id, exercise.exerciseId);
              return result.sentence;
            }}
          >
            {exercise.exerciseId === currentExercise?.exerciseId && !safety ? (
              <>
                <SetInputs
                  setNumber={exercise.logged.length + 1}
                  suggestedWeightKg={
                    exercise.logged[exercise.logged.length - 1]?.weightKg ??
                    exercise.progression?.suggestedWeightKg ??
                    exercise.progression?.currentWeightKg ??
                    null
                  }
                  suggestedReps={exercise.repMax}
                  submitting={submitting}
                  onComplete={(values) => void completeSet(values)}
                />
                {rest ? (
                  <RestTimer
                    startedAt={rest.startedAt}
                    seconds={rest.seconds}
                    onSkip={() => setRest(null)}
                    onExtend={(extra) =>
                      setRest((current) =>
                        current ? { ...current, seconds: current.seconds + extra } : current,
                      )
                    }
                  />
                ) : null}
              </>
            ) : null}
          </ExerciseCard>
        ))}
      </Stack>

      {session.alsoLogged.length > 0 ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" component="h2">
            Also logged
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session.alsoLogged.length} set
            {session.alsoLogged.length === 1 ? '' : 's'} from movements this version does not
            include. They still happened.
          </Typography>
        </Box>
      ) : null}

      <Button
        variant={done ? 'contained' : 'outlined'}
        fullWidth
        sx={{ mt: 4, minHeight: 56 }}
        onClick={() => setFinishOpen(true)}
      >
        Finish workout
      </Button>

      <FinishDialog
        open={finishOpen}
        submitting={submitting}
        sets={session.exercises.reduce(
          (total, exercise) => total + exercise.logged.length,
          session.alsoLogged.length,
        )}
        onClose={() => setFinishOpen(false)}
        onFinish={(status, notes) => void handleFinish(status, notes)}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </Container>
  );
}

export default WorkoutRunnerPage;
