import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';

import type { CommitmentStatus, TransitionInput } from '../../types';
import { TRANSITION_LABELS } from '../../utils/commitmentTransitions';

interface TransitionDialogProps {
  open: boolean;
  to: CommitmentStatus | null;
  commitmentTitle: string;
  onClose: () => void;
  onConfirm: (input: TransitionInput) => Promise<unknown>;
}

/**
 * Converts a `datetime-local` value into an ISO string WITH OFFSET.
 *
 * `<input type="datetime-local">` yields wall-clock text with no timezone
 * ("2026-02-12T06:30"). `new Date(...)` reads that as LOCAL time, which is
 * what the user meant, and `toISOString()` then renders the same instant in
 * UTC — which is what the API's `z.string().datetime({ offset: true })`
 * accepts. Sending the raw value instead would be rejected, and sending it
 * with a "Z" appended would silently shift the appointment by the user's
 * offset.
 */
export function toIsoWithOffset(localValue: string): string {
  return new Date(localValue).toISOString();
}

export function TransitionDialog({
  open,
  to,
  commitmentTitle,
  onClose,
  onConfirm,
}: TransitionDialogProps) {
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('');
  const [rescheduleTo, setRescheduleTo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote('');
    setAmount('');
    setUnit('');
    setReason('');
    setRescheduleTo('');
    setSubmitted(false);
    setError(null);
  }, [open]);

  if (!to) return null;

  const isCompleting = to === 'COMPLETED' || to === 'PARTIALLY_COMPLETED';
  const isRescheduling = to === 'RESCHEDULED';
  const isSkipping = to === 'SKIPPED';
  const rescheduleError = submitted && isRescheduling && !rescheduleTo;

  const handleConfirm = async () => {
    setSubmitted(true);
    if (isRescheduling && !rescheduleTo) return;

    setSaving(true);
    setError(null);
    try {
      const input: TransitionInput = { to };

      if (isCompleting) {
        const hasNote = Boolean(note.trim());
        const hasAmount = amount !== '' && Number.isFinite(Number(amount));
        // EVIDENCE ONLY IF THE USER ACTUALLY LOGGED SOMETHING. Completion is a
        // status; evidence is a fact the user asserted. Sending an empty
        // evidence object would have the product claim something happened that
        // nobody said happened (PRD §10.9).
        if (hasNote || hasAmount) {
          input.evidence = {
            ...(hasNote ? { qualitativeValue: note.trim() } : {}),
            ...(hasAmount ? { quantitativeValue: Number(amount) } : {}),
            ...(hasAmount && unit.trim() ? { quantitativeUnit: unit.trim() } : {}),
          };
        }
      }

      if (isRescheduling) {
        input.rescheduleTo = toIsoWithOffset(rescheduleTo);
      }

      if (isSkipping && reason.trim()) {
        input.reason = reason.trim();
      }

      await onConfirm(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change the status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="transition-title">
      <DialogTitle id="transition-title">
        {isCompleting ? 'Log what happened' : `${TRANSITION_LABELS[to]} “${commitmentTitle}”?`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {isCompleting && (
            <>
              <TextField
                label="How did it go?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                fullWidth
                multiline
                minRows={2}
                autoFocus
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Amount"
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  fullWidth
                />
                <TextField
                  label="Unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  fullWidth
                  placeholder="minutes"
                  slotProps={{ htmlInput: { maxLength: 20 } }}
                />
              </Stack>
              <DialogContentText variant="caption">
                Leave empty to record the status without evidence.
              </DialogContentText>
            </>
          )}

          {isRescheduling && (
            <TextField
              label="Move it to"
              type="datetime-local"
              value={rescheduleTo}
              onChange={(event) => setRescheduleTo(event.target.value)}
              fullWidth
              required
              autoFocus
              error={rescheduleError}
              helperText={rescheduleError ? 'Pick a new time' : 'The original stays in your history'}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}

          {isSkipping && (
            <TextField
              label="Why are you skipping it?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              fullWidth
              multiline
              autoFocus
              helperText="Optional — but it is what makes patterns visible later"
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          )}

          {!isCompleting && !isRescheduling && !isSkipping && (
            <DialogContentText>
              This will move “{commitmentTitle}” to {TRANSITION_LABELS[to].toLowerCase()}.
            </DialogContentText>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} variant="contained" disabled={saving}>
          {isCompleting ? 'Save' : TRANSITION_LABELS[to]}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TransitionDialog;
