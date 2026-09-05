import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Grid,
  Snackbar,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useCheckIn } from '../hooks/useCheckIn';
import { useCommitmentActions } from '../hooks/useCommitmentActions';
import { useToday } from '../hooks/useToday';
import { useTodayInsight } from '../hooks/useTodayInsight';
import { postDayReflection } from '../services/api';
import type {
  CommitmentActionName,
  CommitmentCard,
  DecompositionProposal,
  NextBestAction,
} from '../types';
import { CheckInChips } from '../components/today/CheckInChips';
import { CoachInsightCard } from '../components/today/CoachInsightCard';
import { DomainCard } from '../components/today/DomainCard';
import { NextBestActionCard } from '../components/today/NextBestActionCard';
import { TodayGreeting } from '../components/today/TodayGreeting';
import {
  REFLECTION_HOUR,
  ReflectionPrompt,
  reflectionDismissedKey,
} from '../components/today/ReflectionPrompt';
import { CompleteDialog } from '../components/today/dialogs/CompleteDialog';
import { MakeItSmallerDialog } from '../components/today/dialogs/MakeItSmallerDialog';
import { RescheduleDialog } from '../components/today/dialogs/RescheduleDialog';
import { SkipDialog } from '../components/today/dialogs/SkipDialog';

/**
 * Today — the product's primary surface (VISION §27, PRD §12).
 *
 * THE SCREEN IS COMPLETE BEFORE THE COACH ANSWERS. `GET /today` carries the
 * recommendation, its rationale and every card; the coach's sentence arrives
 * afterwards from a second request and its absence is invisible. That ordering
 * is PRD §120 made visible rather than promised.
 *
 * The two-column split uses `md`, which is this page's own layout choice and
 * deliberately NOT one of the shell's five coupled `sm` gates — those decide
 * which navigation is mounted, and nothing here touches them.
 */
export default function TodayPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { today, isLoading, error, refresh, replaceCommitment } = useToday();
  const { insight, isLoading: insightLoading } = useTodayInsight(
    today !== null,
    today?.checkIn?.feel ?? 'none',
  );

  const [toast, setToast] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<CommitmentCard | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<CommitmentCard | null>(null);
  const [skipFor, setSkipFor] = useState<CommitmentCard | null>(null);
  const [smallerFor, setSmallerFor] = useState<{ id: string; title: string } | null>(null);
  const [proposal, setProposal] = useState<DecompositionProposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [reflectionDone, setReflectionDone] = useState(false);

  const actions = useCommitmentActions({
    onCard: replaceCommitment,
    onChanged: refresh,
  });

  useEffect(() => {
    if (actions.error) setToast(actions.error);
  }, [actions.error]);

  const checkIn = useCheckIn(refresh);

  const allCommitments = useMemo(
    () => today?.domains.flatMap((section) => section.commitments) ?? [],
    [today],
  );

  const openDialogFor = useCallback(
    (action: CommitmentActionName, commitment: CommitmentCard) => {
      switch (action) {
        case 'complete':
        case 'partial':
          setCompleteFor(commitment);
          return true;
        case 'reschedule':
          setRescheduleFor(commitment);
          return true;
        case 'skip':
          setSkipFor(commitment);
          return true;
        default:
          return false;
      }
    },
    [],
  );

  const runDecomposition = useCallback(
    async (id: string, title: string) => {
      setSmallerFor({ id, title });
      setProposal(null);
      setProposalError(null);
      setProposalLoading(true);
      try {
        setProposal(await actions.decompose(id));
      } catch (err) {
        setProposalError(
          err instanceof Error ? err.message : 'Could not reach the coach right now',
        );
      } finally {
        setProposalLoading(false);
      }
    },
    [actions],
  );

  const handleAction = useCallback(
    async (action: CommitmentActionName, commitment: CommitmentCard) => {
      if (openDialogFor(action, commitment)) return;

      switch (action) {
        case 'start':
          // The Start screen owns the timer; starting from here means going
          // there, not flipping a status in place.
          navigate(`/start/${commitment.id}`);
          return;
        case 'pause':
          await actions.pause(commitment.id).catch(() => undefined);
          return;
        case 'continue':
          navigate(`/start/${commitment.id}`);
          return;
        case 'fallback': {
          // Prefer the size the user actually declared; `minimum` is the point
          // of the button, but a commitment may only have a short version.
          const version = commitment.versions.minimum ? 'minimum' : 'short';
          await actions.fallback(commitment.id, version).catch(() => undefined);
          return;
        }
        case 'decompose':
          await runDecomposition(commitment.id, commitment.title);
          return;
        default:
          return;
      }
    },
    [actions, navigate, openDialogFor, runDecomposition],
  );

  // ---------------------------------------------------------------------------
  // Deep links from E12's notifications: /?commitment=<id>&action=start
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const commitmentId = searchParams.get('commitment');
    const action = searchParams.get('action');
    if (!commitmentId || !today) return;

    // Params are stripped BEFORE acting, so a back navigation returns to a
    // clean `/` rather than re-firing the same dialog.
    setSearchParams({}, { replace: true });

    if (action === 'start') {
      navigate(`/start/${commitmentId}`, { replace: true });
      return;
    }

    const commitment = allCommitments.find((row) => row.id === commitmentId);
    if (!commitment) {
      setToast('That commitment is no longer on today’s path');
      return;
    }

    if (action && ['complete', 'fallback', 'skip', 'reschedule'].includes(action)) {
      void handleAction(action as CommitmentActionName, commitment);
    }
  }, [searchParams, today, allCommitments, navigate, setSearchParams, handleAction]);

  const startNba = useCallback(
    (nba: NextBestAction) => navigate(`/start/${nba.commitmentId}`),
    [navigate],
  );

  const showReflection = useMemo(() => {
    if (!today || reflectionDone) return false;
    if (searchParams.get('reflect') === '1') return true;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(reflectionDismissedKey(today.dateLocal)) === '1';
    } catch {
      // Private windows and blocked site data: ask again rather than hide the
      // prompt, which is the harmless direction to fail in.
      dismissed = false;
    }

    return !dismissed && new Date().getHours() >= REFLECTION_HOUR;
  }, [today, reflectionDone, searchParams]);

  if (isLoading && !today) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="Loading today" />
        </Box>
      </Container>
    );
  }

  if (error && !today) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ py: 4 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Container>
    );
  }

  if (!today) return null;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <TodayGreeting
          greeting={today.greeting}
          stateLine={today.stateLine}
          name={user?.displayName ?? null}
        />

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <CheckInChips
              value={today.checkIn?.feel ?? null}
              disabled={checkIn.isSaving}
              onChange={(feel) => void checkIn.save(feel)}
            />

            <NextBestActionCard
              nba={today.nextBestAction}
              disabled={actions.pendingId !== null}
              onStart={startNba}
              onMakeSmaller={(nba) => void runDecomposition(nba.commitmentId, nba.title)}
              onAddSomething={() => navigate('/path')}
            />

            <CoachInsightCard insight={insight} isLoading={insightLoading} />
          </Grid>

          <Grid size={{ xs: 12, md: 7 }}>
            {today.domains.map((section) => (
              <DomainCard
                key={section.domain}
                domain={section.domain}
                mode={section.mode}
                commitments={section.commitments}
                pendingId={actions.pendingId}
                onAction={(action, commitment) => void handleAction(action, commitment)}
              />
            ))}
          </Grid>
        </Grid>

        {showReflection && (
          <ReflectionPrompt
            onSubmit={async (input) => {
              await postDayReflection(input);
              try {
                window.localStorage.setItem(reflectionDismissedKey(today.dateLocal), '1');
              } catch {
                // Nothing to do: the reflection is saved either way.
              }
              setReflectionDone(true);
              setToast('Noted — thank you');
            }}
          />
        )}
      </Box>

      <CompleteDialog
        open={completeFor !== null}
        commitment={completeFor}
        onClose={() => setCompleteFor(null)}
        onComplete={(body) => actions.complete(completeFor!.id, body)}
        onPartial={(body) => actions.partial(completeFor!.id, body)}
      />

      <RescheduleDialog
        open={rescheduleFor !== null}
        commitment={rescheduleFor}
        onClose={() => setRescheduleFor(null)}
        onReschedule={async (body) => {
          await actions.reschedule(rescheduleFor!.id, body);
          setToast('Moved. It carries the count of how often it has moved.');
        }}
      />

      <SkipDialog
        open={skipFor !== null}
        commitment={skipFor}
        onClose={() => setSkipFor(null)}
        onSkip={(body) => actions.skip(skipFor!.id, body)}
      />

      <MakeItSmallerDialog
        open={smallerFor !== null}
        title={smallerFor?.title ?? ''}
        proposal={proposal}
        isLoading={proposalLoading}
        error={proposalError}
        onClose={() => setSmallerFor(null)}
        onApply={async (edited) => {
          const created = await actions.applyProposal(smallerFor!.id, edited);
          navigate(`/start/${created.id}`);
        }}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Container>
  );
}
