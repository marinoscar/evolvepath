import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Chip,
  IconButton,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CancelIcon from '@mui/icons-material/Cancel';
import HistoryIcon from '@mui/icons-material/History';

import type { CommitmentCard, CommitmentStatus } from '../../types';
import type { FamilyRowAction } from '../family/familyLabels';
import { ACTION_LABELS, formatTime, type RowAction } from './todayLabels';
import {
  familyActionLabel,
  familyRowActions,
  familyStatusLabel,
  isFamilyOccurrence,
} from './familyActions';
import { CommitmentActionsMenu } from './CommitmentActionsMenu';

interface CommitmentRowProps {
  commitment: CommitmentCard;
  disabled?: boolean;
  onAction: (action: FamilyRowAction, commitment: CommitmentCard) => void;
}

function StatusIcon({ status }: { status: CommitmentStatus }) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircleIcon color="success" fontSize="small" />;
    case 'PARTIALLY_COMPLETED':
      return <CheckCircleIcon color="warning" fontSize="small" />;
    case 'STARTED':
      return <PlayCircleIcon color="primary" fontSize="small" />;
    case 'SKIPPED':
    case 'CANCELLED':
    case 'MISSED':
      return <CancelIcon color="disabled" fontSize="small" />;
    case 'RESCHEDULED':
      return <HistoryIcon color="disabled" fontSize="small" />;
    default:
      return <RadioButtonUncheckedIcon color="disabled" fontSize="small" />;
  }
}

/**
 * One commitment on a domain card.
 *
 * The primary button is `availableActions[0]` — the API orders that list with
 * the most likely move first, so the row does not need its own opinion about
 * what a user probably wants. Everything else goes in the ⋯ menu.
 *
 * A terminal commitment has no actions at all and renders as a record of the
 * day, which is exactly what it is.
 */
export function CommitmentRow({ commitment, disabled = false, onAction }: CommitmentRowProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const isFamily = isFamilyOccurrence(commitment);

  // `edit` is a client-side action (PATCH, not an action endpoint), so it is
  // appended here rather than expected back from the server — and only where
  // the API would accept the patch. `ready` (epic E08) is the same shape: a
  // transition rather than an action endpoint, offered only on a family row.
  const actions: FamilyRowAction[] = [
    ...familyRowActions(commitment),
    ...(commitment.status === 'PLANNED' || commitment.status === 'READY'
      ? (['edit'] as FamilyRowAction[])
      : []),
  ];

  // A workout opens the runner, not the generic timer (epic E09). Swapped in
  // place of `start` rather than appended, so the row still offers exactly one
  // primary move — two "start" buttons on one line is a choice nobody asked
  // for. Decided from `workoutTemplateId` rather than from the domain: a walk
  // is a Health commitment too.
  const workoutIndex = commitment.workoutTemplateId
    ? actions.indexOf('start' as FamilyRowAction)
    : -1;

  if (workoutIndex >= 0) actions[workoutIndex] = 'start_workout' as FamilyRowAction;

  const labelFor = (action: FamilyRowAction) =>
    isFamily ? familyActionLabel(action) : ACTION_LABELS[action as RowAction];

  const [primary, ...rest] = actions;
  const isTerminal = commitment.availableActions.length === 0;
  const statusLabel = familyStatusLabel(commitment);

  return (
    <ListItem
      data-testid={`commitment-row-${commitment.id}`}
      sx={{ px: 0, alignItems: 'flex-start', opacity: isTerminal ? 0.65 : 1 }}
      secondaryAction={
        rest.length > 0 ? (
          <IconButton
            edge="end"
            size="small"
            aria-label={`Actions for ${commitment.title}`}
            disabled={disabled}
            onClick={(event) => setAnchorEl(event.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ) : undefined
      }
    >
      <Box sx={{ mr: 1.5, mt: 0.5 }}>
        <StatusIcon status={commitment.status} />
      </Box>

      <ListItemText
        primary={commitment.title}
        // A `div` because the secondary line holds chips and a button; MUI's
        // default `p` would nest interactive elements inside a paragraph.
        slotProps={{ secondary: { component: 'div' } }}
        secondary={
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {formatTime(commitment.scheduledStart)} · {commitment.durationMinutes} min
            </Typography>

            {/* "Kept", not "Done": a family ritual is not a task ticked off. */}
            {statusLabel && (
              <Chip size="small" variant="outlined" color="success" label={statusLabel} />
            )}

            {/* The fact PRD §101 wants visible: this was done, but smaller. */}
            {commitment.versionUsed && commitment.versionUsed !== 'FULL' && (
              <Chip
                size="small"
                variant="outlined"
                color="info"
                label={commitment.versionUsed === 'SHORT' ? 'Short version' : 'Minimum version'}
              />
            )}

            {commitment.rescheduleCount >= 1 && (
              <Badge
                badgeContent={commitment.rescheduleCount}
                color="warning"
                aria-label={`Moved ${commitment.rescheduleCount} times`}
                sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none' } }}
              />
            )}

            {primary && (
              <Button
                size="small"
                variant="text"
                disabled={disabled}
                // Named on a FAMILY row only. Several "I'm in" buttons can sit
                // on one screen, and "I'm in" alone does not say which dinner.
                // On every other row the visible label already IS the
                // accessible name, and overriding it would only add noise.
                aria-label={isFamily ? `${labelFor(primary)}: ${commitment.title}` : undefined}
                onClick={() => onAction(primary, commitment)}
              >
                {labelFor(primary)}
              </Button>
            )}
          </Box>
        }
      />

      <CommitmentActionsMenu
        anchorEl={anchorEl}
        actions={rest}
        labelFor={labelFor}
        onClose={() => setAnchorEl(null)}
        onSelect={(action) => onAction(action, commitment)}
      />
    </ListItem>
  );
}
