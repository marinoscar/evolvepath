import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Grid,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';

import { useCommitmentActions } from '../hooks/useCommitmentActions';
import { useFamilyMembers } from '../hooks/useFamilyMembers';
import { useFamilySummary } from '../hooks/useFamilySummary';
import { RitualTitleError, useRituals } from '../hooks/useRituals';
import { useFamilyUpcoming } from '../hooks/useFamilyUpcoming';
import { getOutcomes, transitionCommitment } from '../services/api';
import type {
  CommitmentCard,
  FamilyMember,
  Outcome,
  Ritual,
  RitualInput,
} from '../types';
import type { FamilyRowAction } from '../components/family/familyLabels';
import {
  FAMILY_EMPTY_BODY,
  FAMILY_EMPTY_HEADLINE,
} from '../components/family/familyLabels';
import { BirthdayCue } from '../components/family/BirthdayCue';
import { FamilyMemberCards } from '../components/family/FamilyMemberCards';
import { FamilyMemberEditor } from '../components/family/FamilyMemberEditor';
import { FamilyWeekPanel } from '../components/family/FamilyWeekPanel';
import { RitualEditor } from '../components/family/RitualEditor';
import { RitualList } from '../components/family/RitualList';
import { UpcomingFamilyCommitments } from '../components/family/UpcomingFamilyCommitments';
import { RescheduleDialog } from '../components/today/dialogs/RescheduleDialog';
import { SkipDialog } from '../components/today/dialogs/SkipDialog';

/**
 * `/path/family` — the Family surface (VISION §11, PRD §33–§35, §105).
 *
 * A ROUTE UNDER PATH, not a sixth destination. PRD §11 fixes the five
 * destinations, and `DESTINATION_ROUTES.path` already owns `/path/family` by
 * prefix — so this page needs no registry entry, no navigation change and no
 * settings card. It is a product surface, not a settings page.
 *
 * The two-column split uses `md`, which is this page's own layout choice and
 * deliberately NOT one of the shell's five coupled `sm` gates.
 */
export default function FamilyPage() {
  const members = useFamilyMembers();
  const rituals = useRituals();
  const summary = useFamilySummary(1);

  const upcoming = useFamilyUpcoming();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [memberEditor, setMemberEditor] = useState<{ open: boolean; initial: FamilyMember | null }>(
    { open: false, initial: null },
  );
  const [ritualEditor, setRitualEditor] = useState<{ open: boolean; initial: Ritual | null }>({
    open: false,
    initial: null,
  });
  const [titleError, setTitleError] = useState<{ message: string; match: string | null } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<CommitmentCard | null>(null);
  const [skipFor, setSkipFor] = useState<CommitmentCard | null>(null);

  useEffect(() => {
    void getOutcomes({ domain: 'FAMILY' })
      .then(setOutcomes)
      .catch(() => setOutcomes([]));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([rituals.refresh(), summary.refresh(), upcoming.refresh()]);
  }, [rituals, summary, upcoming]);

  const actions = useCommitmentActions({ onChanged: refreshAll });

  useEffect(() => {
    if (actions.error) setToast(actions.error);
  }, [actions.error]);

  const submitRitual = useCallback(
    async (input: RitualInput) => {
      setSaving(true);
      setTitleError(null);
      try {
        if (ritualEditor.initial) {
          await rituals.update(ritualEditor.initial.id, input);
        } else {
          await rituals.create(input);
        }
        setRitualEditor({ open: false, initial: null });
        await Promise.all([summary.refresh(), upcoming.refresh()]);
      } catch (err) {
        // A lint refusal belongs under the title field, not in a toast: the
        // page is fine, one sentence in the form is not.
        if (err instanceof RitualTitleError) {
          setTitleError({ message: err.message, match: err.match });
          return;
        }
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [ritualEditor.initial, rituals, summary, upcoming],
  );

  const handleAction = useCallback(
    async (action: FamilyRowAction, commitment: CommitmentCard) => {
      switch (action) {
        case 'ready':
          try {
            await transitionCommitment(commitment.id, { to: 'READY' });
            await refreshAll();
          } catch (err) {
            setToast(err instanceof Error ? err.message : 'Could not update that');
          }
          return;
        case 'reschedule':
          setRescheduleFor(commitment);
          return;
        case 'skip':
          setSkipFor(commitment);
          return;
        case 'complete':
          await actions.complete(commitment.id).catch(() => undefined);
          return;
        default:
          return;
      }
    },
    [actions, refreshAll],
  );

  const isEmpty =
    !rituals.isLoading &&
    !members.isLoading &&
    rituals.rituals.length === 0 &&
    members.members.length === 0;

  const loading = rituals.isLoading && members.isLoading && rituals.rituals.length === 0;

  const cue = useMemo(() => <BirthdayCue members={members.members} />, [members.members]);

  if (loading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="Loading family" />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography variant="h5" component="h1">
            Family
          </Typography>
          {cue}
        </Box>

        {rituals.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {rituals.error}
          </Alert>
        )}

        {isEmpty ? (
          <Box sx={{ py: 4, maxWidth: 520 }}>
            <Typography variant="h6" gutterBottom>
              {FAMILY_EMPTY_HEADLINE}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {FAMILY_EMPTY_BODY}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                data-testid="family-add-member"
                onClick={() => setMemberEditor({ open: true, initial: null })}
              >
                Add a family member
              </Button>
              <Button
                variant="outlined"
                data-testid="family-create-ritual"
                onClick={() => {
                  setTitleError(null);
                  setRitualEditor({ open: true, initial: null });
                }}
              >
                Create a ritual
              </Button>
            </Stack>
          </Box>
        ) : (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 7 }}>
              <RitualList
                rituals={rituals.rituals}
                members={members.members}
                onCreate={() => {
                  setTitleError(null);
                  setRitualEditor({ open: true, initial: null });
                }}
                onEdit={(ritual) => {
                  setTitleError(null);
                  setRitualEditor({ open: true, initial: ritual });
                }}
                onToggleActive={(ritual) => {
                  void rituals
                    .update(ritual.id, { active: !ritual.active })
                    .then(refreshAll)
                    .catch(() => undefined);
                }}
                onDelete={(ritual) => {
                  void rituals.remove(ritual.id).then(refreshAll).catch(() => undefined);
                }}
              />

              <UpcomingFamilyCommitments
                commitments={upcoming.commitments}
                pendingId={actions.pendingId}
                onAction={(action, commitment) => void handleAction(action, commitment)}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <FamilyMemberCards
                members={members.members}
                onAdd={() => setMemberEditor({ open: true, initial: null })}
                onEdit={(member) => setMemberEditor({ open: true, initial: member })}
                onDelete={(member) => {
                  void members.remove(member.id).catch(() => undefined);
                }}
              />

              <FamilyWeekPanel summary={summary.summary} isLoading={summary.isLoading} />
            </Grid>
          </Grid>
        )}
      </Box>

      <FamilyMemberEditor
        open={memberEditor.open}
        initial={memberEditor.initial}
        submitting={saving}
        onClose={() => setMemberEditor({ open: false, initial: null })}
        onSubmit={async (input) => {
          if (memberEditor.initial) {
            await members.update(memberEditor.initial.id, input);
          } else {
            await members.create(input);
          }
          setMemberEditor({ open: false, initial: null });
        }}
      />

      <RitualEditor
        open={ritualEditor.open}
        initial={ritualEditor.initial}
        members={members.members}
        outcomes={outcomes}
        submitting={saving}
        titleError={titleError}
        onClose={() => {
          setRitualEditor({ open: false, initial: null });
          setTitleError(null);
        }}
        onSubmit={submitRitual}
      />

      <RescheduleDialog
        open={rescheduleFor !== null}
        commitment={rescheduleFor}
        onClose={() => setRescheduleFor(null)}
        onReschedule={(body) => actions.reschedule(rescheduleFor!.id, body)}
      />

      <SkipDialog
        open={skipFor !== null}
        commitment={skipFor}
        onClose={() => setSkipFor(null)}
        onSkip={(body) => actions.skip(skipFor!.id, body)}
      />

      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        message={toast ?? ''}
        onClose={() => setToast(null)}
      />
    </Container>
  );
}
