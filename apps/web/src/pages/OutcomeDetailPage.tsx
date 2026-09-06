import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { Commitment, CommitmentStatus, Routine, TransitionInput } from '../types';
import { DOMAIN_LABELS } from '../types';
import { ApiError } from '../services/api';
import { useOutcome } from '../hooks/useOutcome';
import { useOutcomeCommitments } from '../hooks/useOutcomeCommitments';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ArchiveOutcomeDialog } from '../components/path/ArchiveOutcomeDialog';
import { CommitmentFormDialog } from '../components/path/CommitmentFormDialog';
import { CommitmentList } from '../components/path/CommitmentList';
import { CreatePlanDialog } from '../components/path/CreatePlanDialog';
import { CreatePlanVersionDialog } from '../components/path/CreatePlanVersionDialog';
import { OutcomeFormDialog } from '../components/path/OutcomeFormDialog';
import { PlanSummaryCard } from '../components/path/PlanSummaryCard';
import { PlanVersionHistory } from '../components/path/PlanVersionHistory';
import { RoutineFormDialog } from '../components/path/RoutineFormDialog';
import { RoutineList } from '../components/path/RoutineList';
import { TransitionDialog } from '../components/path/TransitionDialog';
import { WorkOutcomeDetail } from '../components/work/WorkOutcomeDetail';

/** Transitions that need no extra input go straight through, with no dialog. */
const DIRECT_TRANSITIONS: ReadonlySet<CommitmentStatus> = new Set<CommitmentStatus>([
  'READY',
  'STARTED',
  'PLANNED',
]);

/**
 * One outcome, in full: its plan, the routines that plan prescribes, the
 * commitments it produces, and the history of how the plan got here.
 *
 * ITS OWN ROUTE AT EVERY WIDTH. A master/detail split above `sm` would make
 * the same click produce a different URL depending on the window — a link
 * shared from a laptop would land somewhere else on a phone, and Back would
 * mean two different things. Only the LAYOUT changes: one column below `md`,
 * two above.
 */
export default function OutcomeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const detail = useOutcome(id);
  const commitments = useOutcomeCommitments(id);

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [routineDialog, setRoutineDialog] = useState<{ routine: Routine | null } | null>(null);
  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [transition, setTransition] = useState<{
    commitment: Commitment;
    to: CommitmentStatus;
  } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (detail.isLoading && !detail.outcome && !detail.notFound) {
    return <LoadingSpinner />;
  }

  // A 404 is the API's answer for an id that never existed AND for one
  // belonging to somebody else — deliberately indistinguishable. So this is a
  // dead end with a way back, never a redirect: bouncing the user to /path
  // would make a mistyped URL look like a working one.
  if (detail.notFound || !detail.outcome) {
    return (
      <Container maxWidth="sm">
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h5" component="h1" gutterBottom>
            Outcome not found
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            It may have been removed, or the link may be wrong.
          </Typography>
          <Button component={RouterLink} to="/path" variant="contained">
            Back to Path
          </Button>
        </Box>
      </Container>
    );
  }

  const outcome = detail.outcome;
  const isArchived = outcome.state === 'ARCHIVED';
  // Routines are editable only where the API will accept a write: a superseded
  // or rejected version is history. Disabling the controls is the honest
  // rendering of a rule the server enforces anyway.
  const canEditRoutines =
    !isArchived &&
    (detail.editableVersion?.status === 'ACTIVE' || detail.editableVersion?.status === 'DRAFT');

  const handleTransition = async (input: TransitionInput, commitment: Commitment) => {
    try {
      await commitments.transition(commitment.id, input);
    } catch (err) {
      // The one conflict worth its own message: someone (or another tab)
      // changed this commitment, so the menu the user clicked was stale.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.details as { reason?: string } | undefined)?.reason === 'INVALID_TRANSITION'
      ) {
        setToast('That change is no longer possible — the commitment has moved on.');
        await commitments.refresh();
        return;
      }
      throw err;
    }
  };

  const startTransition = (commitment: Commitment, to: CommitmentStatus) => {
    if (DIRECT_TRANSITIONS.has(to)) {
      void handleTransition({ to }, commitment);
      return;
    }
    setTransition({ commitment, to });
  };

  const planColumn = (
    <Stack spacing={2}>
      <PlanSummaryCard
        plan={detail.plan}
        activeVersion={detail.plan?.activeVersion ?? null}
        disabled={isArchived}
        onCreatePlan={() => setPlanOpen(true)}
        onNewVersion={() => setVersionOpen(true)}
      />
      {/*
        The Work domain's own section (epic E07): milestones, the dated sessions
        the plan produced, and the focus history. Below the plan summary in the
        SAME column — no new breakpoint, no new route.
      */}
      {outcome.domain === 'WORK' && (
        <WorkOutcomeDetail outcome={outcome} disabled={isArchived} />
      )}
      {detail.plan && (
        <RoutineList
          routines={detail.routines}
          editable={Boolean(canEditRoutines)}
          onAdd={() => setRoutineDialog({ routine: null })}
          onEdit={(routine) => setRoutineDialog({ routine })}
          onToggleActive={(routine) => {
            void detail.editRoutine(routine.id, { active: !routine.active });
          }}
          onDelete={(routine) => {
            void detail.removeRoutine(routine.id);
          }}
        />
      )}
    </Stack>
  );

  const historyColumn = (
    <Stack spacing={2}>
      <CommitmentList
        commitments={commitments.commitments}
        disabled={isArchived}
        onAdd={() => setCommitmentOpen(true)}
        onTransition={startTransition}
      />
      <PlanVersionHistory
        planId={detail.plan?.id ?? null}
        versions={detail.versions}
        disabled={isArchived}
        onActivate={(version) => {
          void detail.activateVersion(version);
        }}
        onReject={(version) => {
          void detail.rejectVersion(version);
        }}
      />
    </Stack>
  );

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}
        >
          <Box>
            <Typography variant="overline" color="text.secondary">
              {DOMAIN_LABELS[outcome.domain]}
            </Typography>
            <Typography variant="h4" component="h1">
              {outcome.title}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label={outcome.state} size="small" />
            <IconButton
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              aria-haspopup="menu"
              aria-label={`Actions for ${outcome.title}`}
            >
              <MoreVertIcon />
            </IconButton>
          </Stack>
        </Stack>

        {outcome.description && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {outcome.description}
          </Typography>
        )}

        {isArchived && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This outcome is archived. Its history stays readable; nothing here can be changed.
          </Alert>
        )}

        {(detail.error || commitments.error) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {detail.error ?? commitments.error}
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>{planColumn}</Grid>
          <Grid size={{ xs: 12, md: 5 }}>{historyColumn}</Grid>
        </Grid>
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={isArchived}
          onClick={() => {
            setMenuAnchor(null);
            setEditOpen(true);
          }}
        >
          Edit outcome
        </MenuItem>
        <MenuItem
          disabled={isArchived}
          onClick={() => {
            setMenuAnchor(null);
            setArchiveOpen(true);
          }}
          data-testid="outcome-archive"
        >
          Archive
        </MenuItem>
      </Menu>

      <OutcomeFormDialog
        open={editOpen}
        mode="edit"
        domain={outcome.domain}
        initial={outcome}
        onClose={() => setEditOpen(false)}
        onSave={detail.updateOutcomeFields}
      />

      <ArchiveOutcomeDialog
        open={archiveOpen}
        title={outcome.title}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => {
          setArchiveOpen(false);
          void detail.archive().then(() => navigate('/path'));
        }}
      />

      <CreatePlanDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onSave={detail.addPlan}
      />

      <CreatePlanVersionDialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        onSave={detail.addVersion}
      />

      {routineDialog && (
        <RoutineFormDialog
          open
          initial={routineDialog.routine}
          onClose={() => setRoutineDialog(null)}
          onSave={(input) =>
            routineDialog.routine
              ? detail.editRoutine(routineDialog.routine.id, input)
              : detail.addRoutine(input)
          }
        />
      )}

      <CommitmentFormDialog
        open={commitmentOpen}
        outcome={outcome}
        planVersionId={detail.editableVersion?.id ?? null}
        routines={detail.routines}
        onClose={() => setCommitmentOpen(false)}
        onSave={commitments.add}
      />

      <TransitionDialog
        open={Boolean(transition)}
        to={transition?.to ?? null}
        commitmentTitle={transition?.commitment.title ?? ''}
        onClose={() => setTransition(null)}
        onConfirm={(input) => handleTransition(input, transition!.commitment)}
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
