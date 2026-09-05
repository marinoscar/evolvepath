import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { CommitmentCard } from '../../../types';

interface RescheduleDialogProps {
  open: boolean;
  commitment: CommitmentCard | null;
  onClose: () => void;
  onReschedule: (body: { scheduledStart: string }) => Promise<unknown>;
}

/** A `Date` as the `datetime-local` value the input wants, in local time. */
function toLocalInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * Move it.
 *
 * Defaults to TOMORROW AT THE SAME TIME. Most reschedules are "not today, but
 * still a real plan", and a blank field would make the user re-decide something
 * they already decided. A native `datetime-local` rather than a picker library:
 * it is the same control the commitment form already uses, and on a phone it is
 * the OS's own picker.
 *
 * The copy says what the API does — this closes the commitment and opens a new
 * one — because the count on the new row is what E07 later reads back to them.
 */
export function RescheduleDialog({
  open,
  commitment,
  onClose,
  onReschedule,
}: RescheduleDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !commitment) return;

    const next = new Date(commitment.scheduledStart);
    next.setDate(next.getDate() + 1);
    setValue(toLocalInput(next));
  }, [open, commitment]);

  const submit = async () => {
    if (!value) return;
    setSaving(true);
    try {
      await onReschedule({ scheduledStart: new Date(value).toISOString() });
      onClose();
    } catch {
      // STAY OPEN — the caller shows why, and the chosen time is not lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>Move “{commitment?.title ?? 'this'}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="New time"
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <Typography variant="body2" color="text.secondary">
            This closes today’s commitment and opens a new one at that time, carrying the
            count of how often it has moved.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={saving || !value}>
          Move it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
