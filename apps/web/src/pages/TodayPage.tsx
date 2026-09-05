import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import {
  createCommitment,
  getOutcomes,
  postDayReflection,
  transitionCommitment,
  updateCommitment,
} from '../services/api';
import type {
  CommitmentActionName,
  CommitmentCard,
  DecompositionProposal,
  NextBestAction,
  Outcome,
} from '../types';
import type { CommitmentFormValues } from '../utils/commitmentForm.schema';
import { toCommitmentInput } from '../utils/commitmentForm.schema';
import { CheckInChips } from '../components/today/CheckInChips';
import { QuickAddFab } from '../components/today/QuickAddFab';
import { QuickAddSheet } from '../components/today/QuickAddSheet';
import type { FamilyRowAction } from '../components/family/familyLabels';
import { BirthdayCue } from '../components/family/BirthdayCue';
import { useFamilyMembers } from '../hooks/useFamilyMembers';
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
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editing, setEditing] = useState<CommitmentCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [undoId, setUndoId] = useState<string | null>(null);

  const actions = useCommitmentActions({
    onCard: replaceCommitment,
    onChanged: refresh,
  });

  useEffect(() => {
    if (actions.error) setToast(actions.error);
  }, [actions.error]);

  const checkIn = useCheckIn(refresh);

  // The birthday cue on the Family card. Deliberately NOT fetched until
  // `/today` has answered: a request fired at mount races the boot token
  // refresh and can cost the user their session (see `useFamilyMembers`).
  // Failing is otherwise survivable — the cue does not render and nothing else
  // on Today depends on it.
  const { members: familyMembers } = useFamilyMembers({ enabled: today !== null });

  const allCommitments = useMemo(
    () => today?.domains.flatMap((section) => section.commitments) ?? [],
    [today],
  );

  // Loaded once, for the editor's "serves which outcome?" select. Failing is
  // survivable: the select falls back to "No outcome (just today)", which is a
  // complete answer on its own.
  useEffect(() => {
    void getOutcomes()
      .then(setOutcomes)
      .catch(() => setOutcomes([]));
  }, []);

  const openDialogFor = useCallback(
    (action: FamilyRowAction, commitment: CommitmentCard) => {
      switch (action) {
        case 'edit':
          setEditing(commitment);
          setQuickAddOpen(true);
          return true;
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
    async (action: FamilyRowAction, commitment: CommitmentCard) => {
      if (openDialogFor(action, commitment)) return;

      switch (action) {
        // "I'm in" (epic E08). Not an action endpoint: it is the ordinary
        // PLANNED → READY transition, wearing family words on a family row.
        case 'ready':
          try {
            await transitionCommitment(commitment.id, { to: 'READY' });
            await refresh();
          } catch (err) {
            setToast(err instanceof Error ? err.message : 'Could not update that');
          }
          return;
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
    [actions, navigate, openDialogFor, refresh, runDecomposition],
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

  const submitQuickAdd = useCallback(
    async (values: CommitmentFormValues) => {
      setSaving(true);
      try {
        const input = toCommitmentInput(values);

        if (editing) {
          // `domain` is immutable server-side, so it is not in the patch: a
          // field that silently does nothing is worse than no field.
          const { domain: _domain, ...patch } = input;
          await updateCommitment(editing.id, patch);
          setToast('Saved');
        } else {
          const created = await createCommitment(input);
          setUndoId(created.id);
          setToast('Added to today');
        }

        setQuickAddOpen(false);
        setEditing(null);
        await refresh();
      } catch (err) {
        // The sheet stays open with the values intact — the server's message
        // says what to change, and re-typing the form is not part of that.
        setToast(err instanceof Error ? err.message : 'Could not save that');
      } finally {
        setSaving(false);
      }
    },
    [editing, refresh],
  );

  /**
   * Undo an add.
   *
   * CANCELLED rather than deleted: the API exposes no delete for a commitment,
   * and it should not — PRD §103 keeps the record of a day, and a row the user
   * created and immediately dismissed is still something that happened. It
   * leaves today's board because a cancelled commitment offers no actions.
   */
  const undoAdd = useCallback(async () => {
    if (!undoId) return;

    const id = undoId;
    setUndoId(null);
    setToast(null);
    try {
      await transitionCommitment(id, { to: 'CANCELLED' });
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not undo that');
    }
  }, [undoId, refresh]);

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
                headerExtra={
                  section.domain === 'FAMILY' ? <BirthdayCue members={familyMembers} /> : null
                }
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

      <QuickAddFab
        onClick={() => {
          setEditing(null);
          setQuickAddOpen(true);
        }}
      />

      <QuickAddSheet
        open={quickAddOpen}
        editing={editing}
        outcomes={outcomes}
        submitting={saving}
        onClose={() => {
          setQuickAddOpen(false);
          setEditing(null);
        }}
        onSubmit={submitQuickAdd}
      />

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
        // Six seconds is the undo window: long enough to notice a mistake,
        // short enough that the offer is gone before it becomes a decision.
        autoHideDuration={6000}
        onClose={() => {
          setToast(null);
          setUndoId(null);
        }}
        message={toast}
        action={
          undoId ? (
            <Button color="secondary" size="small" onClick={() => void undoAdd()}>
              Undo
            </Button>
          ) : undefined
        }
      />
    </Container>
  );
}
