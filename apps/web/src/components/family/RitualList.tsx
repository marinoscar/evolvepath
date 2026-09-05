import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { FamilyMember, Ritual } from '../../types';
import { describeDurations, describeRecurrence } from '../../utils/recurrence';

interface RitualListProps {
  rituals: Ritual[];
  members: FamilyMember[];
  onCreate: () => void;
  onEdit: (ritual: Ritual) => void;
  onToggleActive: (ritual: Ritual) => void;
  onDelete: (ritual: Ritual) => void;
}

export function RitualList({
  rituals,
  members,
  onCreate,
  onEdit,
  onToggleActive,
  onDelete,
}: RitualListProps) {
  const [menuFor, setMenuFor] = useState<{ ritual: Ritual; anchor: HTMLElement } | null>(null);
  const [confirmFor, setConfirmFor] = useState<Ritual | null>(null);

  return (
    <Card component="section" aria-label="Rituals" sx={{ mb: 2 }}>
      <CardContent>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
        >
          <Typography variant="h6" component="h2">
            Rituals
          </Typography>
          <Button size="small" data-testid="family-create-ritual" onClick={onCreate}>
            Create a ritual
          </Button>
        </Box>

        {rituals.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No rituals yet. A ritual is a repeating time you are protecting.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {rituals.map((ritual) => {
              const member = members.find((entry) => entry.id === ritual.familyMemberId);

              return (
                <Box
                  key={ritual.id}
                  data-testid={`ritual-card-${ritual.id}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
                    opacity: ritual.active ? 1 : 0.65,
                  }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    {/* `subtitle1` maps to an <h6> by default, which would put a level-6
                        heading under the page's h1 and break heading order. This
                        is an item title, not a section heading. */}
                    <Typography variant="subtitle1" component="div">
                      {ritual.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {describeRecurrence(ritual.recurrence)} ·{' '}
                      {describeDurations(ritual.idealMinutes, ritual.minimumMinutes)}
                    </Typography>

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {member && <Chip size="small" variant="outlined" label={member.nickname} />}
                      {!ritual.active && <Chip size="small" label="Paused" />}
                    </Box>

                    {ritual.purpose && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {ritual.purpose}
                      </Typography>
                    )}
                  </Box>

                  <IconButton
                    size="small"
                    aria-label={`Actions for ${ritual.title}`}
                    onClick={(event) => setMenuFor({ ritual, anchor: event.currentTarget })}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>

      <Menu
        open={menuFor !== null}
        anchorEl={menuFor?.anchor ?? null}
        onClose={() => setMenuFor(null)}
      >
        <MenuItem
          onClick={() => {
            if (menuFor) onEdit(menuFor.ritual);
            setMenuFor(null);
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFor) onToggleActive(menuFor.ritual);
            setMenuFor(null);
          }}
        >
          {menuFor?.ritual.active ? 'Pause' : 'Resume'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirmFor(menuFor?.ritual ?? null);
            setMenuFor(null);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={confirmFor !== null} onClose={() => setConfirmFor(null)}>
        <DialogTitle>Delete “{confirmFor?.title}”?</DialogTitle>
        <DialogContent>
          {/* Says exactly what survives, because the honest answer is
              reassuring: the record of what they actually did is not at risk. */}
          <DialogContentText>
            Future occurrences will be cancelled. Past ones stay on your record.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmFor(null)}>Keep it</Button>
          <Button
            color="error"
            onClick={() => {
              if (confirmFor) onDelete(confirmFor);
              setConfirmFor(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
