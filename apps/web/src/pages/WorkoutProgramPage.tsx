import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';

import { useWorkoutProgram } from '../hooks/useWorkoutProgram';
import { listExercises } from '../services/api';
import { NON_EQUIVALENCE_CAPTION, TemplateTable } from '../components/workouts/TemplateTable';
import { WeeklyStructure } from '../components/workouts/WeeklyStructure';

/**
 * `/health/programs/:programId` — the plan, outside the conversation (VISION §14).
 *
 * A NOT-FOUND STATE rather than a redirect for an id that is not yours: the API
 * answers 404 identically for a foreign id and one that never existed, and
 * redirecting would make a mistyped URL look like a working one.
 */
export function WorkoutProgramPage() {
  const { programId } = useParams<{ programId: string }>();
  const location = useLocation();
  const { program, proposals, isLoading, notFound, error, archive } =
    useWorkoutProgram(programId);

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const [instructions, setInstructions] = useState<Record<string, string>>({});

  // The catalog text, fetched once and shared by every table on the page. A
  // per-exercise request would be an N+1 on a screen that shows twenty.
  useEffect(() => {
    let cancelled = false;

    listExercises()
      .then((rows) => {
        if (!cancelled) {
          setInstructions(
            Object.fromEntries(rows.map((row) => [row.id, row.instructions])),
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const fullTemplates = useMemo(
    () => program?.templates.filter((template) => template.variant === 'FULL') ?? [],
    [program],
  );

  if (isLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <CircularProgress size={24} />
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Typography variant="h6" component="h1" gutterBottom>
          That program is not here
        </Typography>
        <Button component={RouterLink} to="/health/programs">
          Back to programs
        </Button>
      </Container>
    );
  }

  if (error || !program) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{error ?? 'Something went wrong.'}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" component="h1">
            {program.name}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
            <Chip
              size="small"
              label={program.status === 'DRAFT' ? 'Not started' : program.status.toLowerCase()}
              color={program.status === 'ACTIVE' ? 'success' : 'default'}
            />
            <Typography variant="body2" color="text.secondary">
              {program.weeklyStructure.length} days a week · {program.durationWeeks} weeks
            </Typography>
          </Stack>
        </Box>
        {program.status !== 'ARCHIVED' ? (
          <Button onClick={() => setConfirmArchive(true)}>Archive</Button>
        ) : null}
      </Stack>

      {proposals.length > 0 ? (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button component={RouterLink} to="/coach" size="small">
              Read it
            </Button>
          }
        >
          Your coach has suggested a change to this program.
        </Alert>
      ) : null}

      <WeeklyStructure
        weeklyStructure={program.weeklyStructure}
        templates={program.templates}
      />

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 3 }}>
        {NON_EQUIVALENCE_CAPTION}
      </Typography>

      <Stack spacing={4}>
        {fullTemplates.map((template) => (
          <Box key={template.id} component="section" aria-label={template.name}>
            <Typography variant="subtitle1" component="h2" gutterBottom>
              {template.name}
            </Typography>
            <TemplateTable
              variants={program.templates.filter((row) => row.name === template.name)}
              instructions={instructions}
            />
          </Box>
        ))}
      </Stack>

      {program.rationale ? (
        <Box
          component="blockquote"
          sx={{ m: 0, mt: 4, pl: 2, borderLeft: 3, borderColor: 'divider' }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {program.rationale}
          </Typography>
        </Box>
      ) : null}

      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)}>
        <DialogTitle>Archive this program?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Training days still to come are cancelled. Everything you have already done stays
            where it is.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmArchive(false)}>Keep it</Button>
          <Button
            onClick={() => {
              setConfirmArchive(false);
              void archive();
            }}
          >
            Archive
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={notice !== null}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </Container>
  );
}

export default WorkoutProgramPage;
