import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { PlanInput } from '../../types';

interface CreatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (input: PlanInput) => Promise<unknown>;
}

export function CreatePlanDialog({ open, onClose, onSave }: CreatePlanDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [rationale, setRationale] = useState('');
  const [weeklyLoad, setWeeklyLoad] = useState('');
  const [fallback, setFallback] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRationale('');
    setWeeklyLoad('');
    setFallback('');
    setError(null);
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        // Optional on the FIRST version — there is no change to explain yet.
        // Every version after this one requires a rationale.
        rationale: rationale.trim() || null,
        expectedWeeklyLoad: weeklyLoad ? Number(weeklyLoad) : null,
        fallbackStrategy: fallback.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      aria-labelledby="create-plan-title"
    >
      <DialogTitle id="create-plan-title">Create plan</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="How are you going to approach this?"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            fullWidth
            multiline
            minRows={2}
            autoFocus
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            label="Expected weekly load (minutes)"
            type="number"
            value={weeklyLoad}
            onChange={(event) => setWeeklyLoad(event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { min: 0, max: 10080 } }}
          />
          <TextField
            label="If the week goes wrong…"
            value={fallback}
            onChange={(event) => setFallback(event.target.value)}
            fullWidth
            multiline
            helperText="The fallback that keeps this alive on a bad week"
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Create plan
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CreatePlanDialog;
