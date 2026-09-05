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

import type { CommitmentActionName, CommitmentCard, CommitmentStatus } from '../../types';
import { ACTION_LABELS, formatTime } from './todayLabels';
import { CommitmentActionsMenu } from './CommitmentActionsMenu';

interface CommitmentRowProps {
  commitment: CommitmentCard;
  disabled?: boolean;
  onAction: (action: CommitmentActionName, commitment: CommitmentCard) => void;
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

  const [primary, ...rest] = commitment.availableActions;
  const isTerminal = commitment.availableActions.length === 0;

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
                onClick={() => onAction(primary, commitment)}
              >
                {ACTION_LABELS[primary]}
              </Button>
            )}
          </Box>
        }
      />

      <CommitmentActionsMenu
        anchorEl={anchorEl}
        actions={rest}
        onClose={() => setAnchorEl(null)}
        onSelect={(action) => onAction(action, commitment)}
      />
    </ListItem>
  );
}
