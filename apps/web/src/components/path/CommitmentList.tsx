import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import type { Commitment, CommitmentStatus } from '../../types';
import { STATUS_COLORS, STATUS_LABELS, TRANSITION_LABELS } from '../../utils/commitmentTransitions';
import { ImportanceDots } from './ImportanceDots';

interface CommitmentListProps {
  commitments: Commitment[];
  disabled?: boolean;
  onAdd: () => void;
  onTransition: (commitment: Commitment, to: CommitmentStatus) => void;
}

function formatWhen(commitment: Commitment): string {
  // The API stores UTC; the browser renders the user's local time. `Intl` is
  // the only thing here that knows which timezone that is.
  const start = new Date(commitment.scheduledStart);
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(start);
}

export function CommitmentList({
  commitments,
  disabled = false,
  onAdd,
  onTransition,
}: CommitmentListProps) {
  const [menu, setMenu] = useState<{ anchor: HTMLElement; commitment: Commitment } | null>(null);

  return (
    <Card data-testid="commitment-list">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Upcoming commitments
        </Typography>

        {commitments.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            Nothing scheduled in the next two weeks.
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            {commitments.map((commitment) => (
              <Box
                key={commitment.id}
                data-testid={`commitment-${commitment.id}`}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  // 44px minimum touch target on a phone.
                  minHeight: 44,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" component="h3">
                    {commitment.title}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {formatWhen(commitment)}
                    </Typography>
                    <ImportanceDots value={commitment.importance} />
                    {/* "moved twice" is readable on the LIVE row: the count
                        travels with the intention, not the closed commitment. */}
                    {commitment.rescheduleCount > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        rescheduled ×{commitment.rescheduleCount}
                      </Typography>
                    )}
                    {commitment.evidenceCount > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        {commitment.evidenceCount} evidence · USER_LOG
                      </Typography>
                    )}
                  </Stack>
                </Box>

                {/* The chip IS the menu button. Its accessible name names the
                    commitment: a list of eight "Change status" buttons is a
                    list a screen-reader user cannot navigate. */}
                <Chip
                  label={STATUS_LABELS[commitment.status]}
                  size="small"
                  color={STATUS_COLORS[commitment.status]}
                  aria-haspopup="menu"
                  aria-label={`Change status of ${commitment.title}. Currently ${STATUS_LABELS[commitment.status]}`}
                  data-testid={`commitment-status-${commitment.id}`}
                  disabled={disabled || commitment.allowedTransitions.length === 0}
                  onClick={(event) =>
                    commitment.allowedTransitions.length > 0 &&
                    setMenu({ anchor: event.currentTarget, commitment })
                  }
                />
              </Box>
            ))}
          </Box>
        )}

        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={disabled}
          data-testid="add-commitment"
        >
          Add commitment
        </Button>
      </CardContent>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {/* EXACTLY the API's list, never a locally computed one. A client
            running an older bundle therefore cannot offer a move the API would
            refuse — the options came from the API that would refuse them. */}
        {menu?.commitment.allowedTransitions.map((to) => (
          <MenuItem
            key={to}
            onClick={() => {
              const { commitment } = menu;
              setMenu(null);
              onTransition(commitment, to);
            }}
          >
            {TRANSITION_LABELS[to]}
          </MenuItem>
        ))}
      </Menu>
    </Card>
  );
}

export default CommitmentList;
