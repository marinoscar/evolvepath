import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
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
import CakeIcon from '@mui/icons-material/Cake';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { FamilyMember } from '../../types';
import {
  daysUntilBirthday,
  describeBirthdayCue,
  formatBirthdayWithoutYear,
  todayLocalDate,
} from '../../utils/birthday';
import { RELATIONSHIP_LABELS } from './familyLabels';

interface FamilyMemberCardsProps {
  members: FamilyMember[];
  todayLocal?: string;
  onAdd: () => void;
  onEdit: (member: FamilyMember) => void;
  onDelete: (member: FamilyMember) => void;
}

/**
 * The people, and only what PRD §33 permits about them.
 *
 * Nickname, relationship, and a birthday reduced to a day and a month. The card
 * is intentionally sparse — that sparseness IS the privacy boundary, not a
 * placeholder for a richer card later.
 */
export function FamilyMemberCards({
  members,
  todayLocal = todayLocalDate(),
  onAdd,
  onEdit,
  onDelete,
}: FamilyMemberCardsProps) {
  const [menuFor, setMenuFor] = useState<{ member: FamilyMember; anchor: HTMLElement } | null>(
    null,
  );
  const [confirmFor, setConfirmFor] = useState<FamilyMember | null>(null);

  return (
    <Card component="section" aria-label="Family members" sx={{ mb: 2 }}>
      <CardContent>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
        >
          <Typography variant="h6" component="h2">
            People
          </Typography>
          <Button size="small" data-testid="family-add-member" onClick={onAdd}>
            Add a family member
          </Button>
        </Box>

        {members.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nobody added yet. A nickname and a relationship is all this holds.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {members.map((member) => {
              const days = daysUntilBirthday(member.birthday, todayLocal);
              const cue = describeBirthdayCue(days);

              return (
                <Box
                  key={member.id}
                  data-testid={`family-member-${member.id}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    {/* `component="div"`: MUI maps subtitle2 to an <h6>, and a
                        person's name is an item title rather than a heading. */}
                    <Typography variant="subtitle2" component="div">
                      {member.nickname} · {RELATIONSHIP_LABELS[member.relationship]}
                    </Typography>

                    {cue ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <CakeIcon fontSize="inherit" color="action" />
                        {/* Text, not colour: the cue has to survive being read
                            aloud and being seen by somebody who cannot tell
                            these two shades apart. */}
                        <Typography variant="caption" color="text.secondary">
                          {cue}
                        </Typography>
                      </Box>
                    ) : (
                      member.birthday && (
                        <Typography variant="caption" color="text.secondary">
                          {/* The year is never shown — it may be a placeholder. */}
                          {formatBirthdayWithoutYear(member.birthday)}
                        </Typography>
                      )
                    )}
                  </Box>

                  <IconButton
                    size="small"
                    aria-label={`Actions for ${member.nickname}`}
                    onClick={(event) => setMenuFor({ member, anchor: event.currentTarget })}
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
            if (menuFor) onEdit(menuFor.member);
            setMenuFor(null);
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirmFor(menuFor?.member ?? null);
            setMenuFor(null);
          }}
        >
          Remove
        </MenuItem>
      </Menu>

      <Dialog open={confirmFor !== null} onClose={() => setConfirmFor(null)}>
        <DialogTitle>Remove {confirmFor?.nickname}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Rituals and past commitments keep their history; the name is removed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmFor(null)}>Keep</Button>
          <Button
            color="error"
            onClick={() => {
              if (confirmFor) onDelete(confirmFor);
              setConfirmFor(null);
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
