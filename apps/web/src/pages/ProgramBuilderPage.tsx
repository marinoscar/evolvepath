import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';

import { useWorkoutPrograms } from '../hooks/useWorkoutPrograms';
import { deleteWorkoutProgram } from '../services/api';
import type { GenerateProgramRequest, GenerateProgramResult } from '../types';
import { ApproveDialog } from '../components/workouts/builder/ApproveDialog';
import { BuilderWizard } from '../components/workouts/builder/BuilderWizard';
import { ProgramProposalReview } from '../components/workouts/builder/ProgramProposalReview';

/**
 * `/health/programs/new` — PRD §37's builder.
 *
 * Three states: the wizard, a busy state, and the draft. The draft is NOT a
 * plan — approving it is (PRD §15) — which is why the review screen and the
 * approve dialog are separate steps rather than a single "generate and start".
 *
 * REGENERATE DELETES THE PREVIOUS DRAFT FIRST. Otherwise a user who pressed it
 * four times would accumulate four abandoned programs in their list, and the
 * list is supposed to say what training they have.
 *
 * The wizard's `defaults` are a prop rather than a fetch: E04's onboarding
 * writes `user_profiles.health_baseline`, and the moment that screen exists the
 * prefill is one binding here. Until then the defaults are the wizard's own,
 * and they are reasonable ones.
 */
export function ProgramBuilderPage() {
  const navigate = useNavigate();
  const { generate, approve } = useWorkoutPrograms();

  const [request, setRequest] = useState<GenerateProgramRequest | null>(null);
  const [result, setResult] = useState<GenerateProgramResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [approving, setApproving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const run = async (next: GenerateProgramRequest, previousProgramId?: string) => {
    setBusy(true);
    setError(null);
    setNeedsKey(false);

    try {
      // A draft the user is replacing, not one they decided about.
      if (previousProgramId) {
        await deleteWorkoutProgram(previousProgramId).catch(() => undefined);
      }

      const generated = await generate(next);
      setRequest(next);
      setResult(generated);
    } catch (err) {
      const status = (err as { status?: number }).status;

      if (status === 412) setNeedsKey(true);
      // The inputs stay on screen: a network failure must not cost somebody the
      // four answers they just typed.
      else setError(err instanceof Error ? err.message : 'Could not build a program.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (body: { preferredTime: string; startDate: string }) => {
    if (!result) return;

    setApproving(true);
    setError(null);

    try {
      await approve(result.program.id, body);
      navigate(`/health/programs/${result.program.id}`, {
        state: { notice: 'Your first two weeks are on Today' },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;

      setError(
        status === 409
          ? 'This program has already been decided on.'
          : err instanceof Error
            ? err.message
            : 'Could not approve that.',
      );
      setApproving(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Build a program
      </Typography>

      {needsKey ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Building a program uses your own OpenAI key.{' '}
          <Button component={RouterLink} to="/settings/ai-key" size="small">
            Add a key
          </Button>
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {busy ? (
        <Box aria-busy="true" aria-live="polite">
          <Typography variant="body1" sx={{ mb: 2 }}>
            Building your program…
          </Typography>
          <Stack spacing={1}>
            <Skeleton variant="rounded" height={32} />
            <Skeleton variant="rounded" height={180} />
            <Skeleton variant="rounded" height={180} />
          </Stack>
        </Box>
      ) : result ? (
        <>
          <ProgramProposalReview
            result={result}
            submitting={approving}
            onApprove={() => setDialogOpen(true)}
            onRegenerate={() => request && void run(request, result.program.id)}
          />
          <ApproveDialog
            open={dialogOpen}
            submitting={approving}
            onClose={() => setDialogOpen(false)}
            onApprove={(body) => void handleApprove(body)}
          />
        </>
      ) : (
        <BuilderWizard submitting={busy} onGenerate={(next) => void run(next)} />
      )}
    </Container>
  );
}

export default ProgramBuilderPage;
