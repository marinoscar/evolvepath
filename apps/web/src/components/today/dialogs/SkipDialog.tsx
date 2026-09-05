import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { CommitmentCard, SkipReason } from '../../../types';
import { SKIP_REASON_LABELS, SKIP_REASONS } from '../todayLabels';

interface SkipDialogProps {
  open: boolean;
  commitment: CommitmentCard | null;
  onClose: () => void;
  onSkip: (body: { reason: SkipReason; text?: string | null }) => Promise<unknown>;
}

/**
 * "Not today."
 *
 * A REASON IS REQUIRED, and that is the one piece of friction on this screen
 * worth keeping: PRD P5 says a failed plan is information, and a skip with no
 * reason is the one thing the product cannot learn anything from. The options
 * are one tap each, and `I avoided it` is deliberately on the list — naming
 * avoidance is what lets E07 do anything about it later.
 *
 * The text box is optional and never leaves the user's record: the API keeps it
 * out of audit rows and log lines.
 */
export function SkipDialog({ open, commitment, onClose, onSkip }: SkipDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [reason, setReason] = useState<SkipReason | ''>('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      await onSkip({ reason, text: text.trim() ? text.trim() : null });
      setReason('');
      setText('');
      onClose();
    } catch {
      // STAY OPEN — the caller shows why, and the note is not lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>Skip “{commitment?.title ?? 'this'}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl>
            <FormLabel id="skip-reason-label">What got in the way?</FormLabel>
            <RadioGroup
              aria-labelledby="skip-reason-label"
              value={reason}
              onChange={(event) => setReason(event.target.value as SkipReason)}
            >
              {SKIP_REASONS.map((option) => (
                <FormControlLabel
                  key={option}
                  value={option}
                  control={<Radio />}
                  label={SKIP_REASON_LABELS[option]}
                />
              ))}
            </RadioGroup>
          </FormControl>

          <TextField
            label="Anything else? (optional)"
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />

          <Typography variant="body2" color="text.secondary">
            Skipping is a normal part of a week. Naming why is what makes the plan get
            better.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={saving || !reason}>
          Skip it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
