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
} from '@mui/material';

interface ApproveDialogProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onApprove: (body: { preferredTime: string; startDate: string }) => void;
}

function tomorrow(): string {
  return new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The two things approving needs to know.
 *
 * Both have defaults that are almost always right — tomorrow, at 07:00 — so the
 * dialog is one confirmation rather than a form. It exists at all because
 * approving writes fourteen days onto somebody's calendar, and a button that
 * does that with no visible time is a button people press twice.
 */
export function ApproveDialog({ open, submitting, onClose, onApprove }: ApproveDialogProps) {
  const [preferredTime, setPreferredTime] = useState('07:00');
  const [startDate, setStartDate] = useState(tomorrow());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Put this on your days</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The next two weeks of training days go onto Today. You can move any of them.
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Usual time"
            type="time"
            value={preferredTime}
            onChange={(event) => setPreferredTime(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            label="Starting"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={submitting}
          onClick={() => onApprove({ preferredTime, startDate })}
        >
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}
