import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';

interface FinishDialogProps {
  open: boolean;
  submitting: boolean;
  sets: number;
  onClose: () => void;
  onFinish: (status: 'COMPLETED' | 'ABANDONED', notes: string | null) => void;
}

/**
 * Ending a workout, with the two answers kept apart.
 *
 * "Finished" and "stopped" are different facts and the API settles the
 * commitment differently for each — so the dialog asks rather than inferring
 * from whether every set was logged.
 */
export function FinishDialog({
  open,
  submitting,
  sets,
  onClose,
  onFinish,
}: FinishDialogProps) {
  const [notes, setNotes] = useState('');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>End this workout?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {sets === 0
            ? 'Nothing logged yet. Stopping now leaves today’s workout open on Today.'
            : `${sets} ${sets === 1 ? 'set' : 'sets'} logged.`}
        </DialogContentText>
        <TextField
          label="Anything worth remembering?"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          fullWidth
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep going</Button>
        <Button
          disabled={submitting}
          onClick={() => onFinish('ABANDONED', notes.trim() || null)}
        >
          Stop
        </Button>
        <Button
          variant="contained"
          disabled={submitting}
          onClick={() => onFinish('COMPLETED', notes.trim() || null)}
        >
          Finish
        </Button>
      </DialogActions>
    </Dialog>
  );
}
