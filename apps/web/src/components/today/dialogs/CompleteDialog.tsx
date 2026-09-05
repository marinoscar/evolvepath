import { useState } from 'react';
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

import type { CommitmentCard, CompleteCommitmentInput } from '../../../types';

interface CompleteDialogProps {
  open: boolean;
  commitment: CommitmentCard | null;
  onClose: () => void;
  onComplete: (body: CompleteCommitmentInput) => Promise<unknown>;
  onPartial: (body: CompleteCommitmentInput) => Promise<unknown>;
}

/**
 * "How did it go?"
 *
 * TWO BUTTONS, not a radio group. "Done" and "Partly done" are different facts
 * about a day (PRD §101) and both are legitimate endings; making the user pick a
 * category first and then confirm would put a step between them and the honest
 * answer.
 *
 * `minutesSpent` is optional and empty by default. The server derives it from
 * the timer, and pre-filling a number here would invite the user to accept a
 * figure they did not check.
 */
export function CompleteDialog({
  open,
  commitment,
  onClose,
  onComplete,
  onPartial,
}: CompleteDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);

  const body = (): CompleteCommitmentInput => ({
    notes: notes.trim() ? notes.trim() : null,
    minutesSpent: minutes.trim() ? Number(minutes) : null,
  });

  const submit = async (which: 'complete' | 'partial') => {
    setSaving(true);
    try {
      await (which === 'complete' ? onComplete(body()) : onPartial(body()));
      setNotes('');
      setMinutes('');
      onClose();
    } catch {
      // STAY OPEN. The caller surfaces the server's message; closing here would
      // discard what the user typed and leave them guessing whether it saved.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>{commitment?.title ?? 'Finish up'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Anything worth remembering about this one? Both fields are optional.
          </Typography>
          <TextField
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          <TextField
            label="Minutes spent"
            type="number"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            helperText="Leave blank to use the timer’s own count"
            slotProps={{ htmlInput: { min: 0, max: 1440 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit('partial')} disabled={saving}>
          Partly done
        </Button>
        <Button variant="contained" onClick={() => void submit('complete')} disabled={saving}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
