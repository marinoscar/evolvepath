import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import type { CoachReply, DiffEntry, PlanChange } from '../../types';
import type { ProposalOutcome } from '../../hooks/useProposals';
import EditProposalDialog from './EditProposalDialog';
import PlanChangeDiff from './PlanChangeDiff';

/**
 * PRD §15's three buttons, and nothing that could be mistaken for a fourth.
 *
 * "Keep current plan" rather than "Reject" or "Dismiss": the user is choosing
 * between two plans, and one of them is already theirs. A dismissive verb here
 * would make declining feel like a failure to comply.
 */
export interface ProposalCardProps {
  proposal: NonNullable<CoachReply['proposal']>;
  /** From `useProposals`; absent until the user decides in this session. */
  outcome?: ProposalOutcome;
  diff: DiffEntry[];
  domainLabel?: string;
  busy?: boolean;
  onAccept: (id: string) => void;
  onEdit: (id: string, changes: PlanChange[]) => void;
  onReject: (id: string) => void;
}

export default function ProposalCard({
  proposal,
  outcome,
  diff,
  domainLabel,
  busy = false,
  onAccept,
  onEdit,
  onReject,
}: ProposalCardProps) {
  const theme = useTheme();
  // Page-local layout choice — see the header of PlanChangeDiff.
  const dense = useMediaQuery(theme.breakpoints.down('sm'));
  const [editing, setEditing] = useState(false);

  const id = proposal.proposalId;
  const decided = outcome !== undefined;

  return (
    <Card variant="outlined" sx={{ mt: 1 }} data-testid="proposal-card">
      <CardContent>
        <Typography variant="subtitle1" component="h3" gutterBottom>
          I recommend changing your {domainLabel ?? 'plan'}
        </Typography>

        <Typography variant="body2" sx={{ mb: 2 }}>
          {proposal.summary}
        </Typography>

        <PlanChangeDiff entries={diff} dense={dense} />

        {outcome?.status === 'ACCEPTED' && (
          // Text, not colour alone: a chip that only turned green would say
          // nothing to a screen reader or to anyone who cannot see it.
          <Chip
            sx={{ mt: 2 }}
            color="success"
            label={`Plan updated (v${outcome.version ?? '2'})`}
            component={RouterLink}
            to="/path"
            clickable
          />
        )}

        {outcome?.status === 'REJECTED' && (
          <Chip sx={{ mt: 2 }} label="Kept current plan" />
        )}

        {!id && !decided && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This suggestion was not saved, so it cannot be applied. Ask the coach again.
          </Alert>
        )}
      </CardContent>

      {id && !decided && (
        <CardActions sx={{ px: 2, pb: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={busy} onClick={() => onAccept(id)}>
            Accept
          </Button>
          <Button variant="outlined" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button disabled={busy} onClick={() => onReject(id)}>
            Keep current plan
          </Button>
        </CardActions>
      )}

      {id && (
        <EditProposalDialog
          open={editing}
          changes={proposal.changes}
          saving={busy}
          onClose={() => setEditing(false)}
          onSubmit={(changes) => {
            setEditing(false);
            onEdit(id, changes);
          }}
        />
      )}
    </Card>
  );
}

/** Kept beside the card so the empty-diff case reads the same everywhere. */
export function diffFromChanges(changes: PlanChange[]): DiffEntry[] {
  return changes.map((change) => ({
    op: change.op,
    target: {
      type: change.target.type,
      id: change.target.id ?? 'new',
      title: change.after?.title ?? change.before?.title ?? 'this routine',
    },
    reason: change.reason,
    fields: Object.entries(change.after ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({
        field,
        before: (change.before as Record<string, unknown> | null)?.[field] ?? null,
        after: value,
      })),
  }));
}
