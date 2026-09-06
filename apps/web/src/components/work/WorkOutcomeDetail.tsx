import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Snackbar, Stack } from '@mui/material';

import type { Outcome, OutcomeWorkPlanSession } from '../../types';
import { useWorkOutcome } from '../../hooks/useWorkOutcome';
import { rescheduleCommitment } from '../../services/api';
import { RescheduleDialog } from '../today/dialogs/RescheduleDialog';
import { MilestoneList } from './MilestoneList';
import { PlannedSessionsList } from './PlannedSessionsList';
import { PlanSessionsDialog } from './PlanSessionsDialog';
import { SessionHistory } from './SessionHistory';

interface WorkOutcomeDetailProps {
  outcome: Outcome;
  disabled?: boolean;
}

/**
 * The Work variant of the outcome detail page (PRD §24, epic E07).
 *
 * Rendered ONLY for `domain === 'WORK'`, below the plan summary in the existing
 * two-column grid. It adds no breakpoint of its own — the stacking is E02-06's
 * grid, and the dialogs' `fullScreen` is a local layout choice inside each one.
 */
export function WorkOutcomeDetail({ outcome, disabled = false }: WorkOutcomeDetailProps) {
  const navigate = useNavigate();
  const work = useWorkOutcome(outcome.id);

  const [planOpen, setPlanOpen] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<OutcomeWorkPlanSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const sessions = work.plan?.sessions ?? [];
  const milestones = work.plan?.milestones ?? [];
  const intention = work.plan?.implementationIntention ?? null;

  return (
    <Stack spacing={2}>
      {work.error && <Alert severity="error">{work.error}</Alert>}

      {/*
        The sentence the plan is anchored to. Shown above the lists because it is
        the thing the user is meant to recognise in their own day (PRD §24) — a
        trigger buried under a table of timestamps is a trigger nobody reads.
      */}
      {intention && (
        <Alert severity="info" icon={false} data-testid="implementation-intention">
          {intention.when} → {intention.then}
        </Alert>
      )}

      <MilestoneList milestones={milestones} sessions={sessions} />

      <PlannedSessionsList
        sessions={sessions}
        onStart={(session) => navigate(`/start/${session.id}`)}
        onReschedule={(session) => setRescheduleFor(session)}
      />

      <Button
        variant="contained"
        disabled={disabled || work.isLoading}
        data-testid="plan-sessions-cta"
        onClick={() => setPlanOpen(true)}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        {sessions.length > 0 ? 'Plan more sessions' : 'Plan sessions with the coach'}
      </Button>

      <SessionHistory sessions={work.sessions} />

      <PlanSessionsDialog
        open={planOpen}
        outcome={outcome}
        hasSessions={sessions.length > 0}
        onClose={() => setPlanOpen(false)}
        onApplied={(created) => {
          setToast(
            `${created} ${created === 1 ? 'session' : 'sessions'} added to your Path`,
          );
          void work.refresh();
        }}
      />

      {rescheduleFor && (
        <RescheduleDialog
          open
          commitment={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onReschedule={async (body) => {
            await rescheduleCommitment(rescheduleFor.id, body);
            await work.refresh();
          }}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  );
}
