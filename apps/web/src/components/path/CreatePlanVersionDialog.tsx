import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { PlanVersionInput } from '../../types';

interface CreatePlanVersionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (input: PlanVersionInput) => Promise<unknown>;
}

export function CreatePlanVersionDialog({
  open,
  onClose,
  onSave,
}: CreatePlanVersionDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [rationale, setRationale] = useState('');
  const [touched, setTouched] = useState(false);
  const [weeklyLoad, setWeeklyLoad] = useState('');
  const [fallback, setFallback] = useState('');
  const [copyRoutines, setCopyRoutines] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRationale('');
    setTouched(false);
    setWeeklyLoad('');
    setFallback('');
    setCopyRoutines(true);
    setError(null);
  }, [open]);

  const rationaleError = touched && !rationale.trim();

  const handleSave = async () => {
    setTouched(true);
    // Required by the API too — checked here so the user is told immediately
    // rather than after a round trip.
    if (!rationale.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        rationale: rationale.trim(),
        expectedWeeklyLoad: weeklyLoad ? Number(weeklyLoad) : null,
        fallbackStrategy: fallback.trim() || null,
        copyRoutinesFrom: copyRoutines ? 'active' : 'none',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the version');
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
      aria-labelledby="create-version-title"
    >
      {/* The title asks the question the required field answers. PRD §80 wants
          "Changed Sep 12 · Reason: 3 repeated evening misses" renderable for
          every change, and the moment the user knew why has passed by the time
          anybody notices it is missing. */}
      <DialogTitle id="create-version-title">Why is the plan changing?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Reason for the change"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            onBlur={() => setTouched(true)}
            required
            fullWidth
            multiline
            minRows={2}
            autoFocus
            error={rationaleError}
            helperText={
              rationaleError
                ? 'A reason is required — it is what makes the history readable later'
                : 'e.g. Evenings kept slipping; move to two mornings + Saturday'
            }
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
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={copyRoutines}
                onChange={(event) => setCopyRoutines(event.target.checked)}
              />
            }
            // On by default: a new version is nearly always an adjustment to
            // what exists, and an empty v2 would silently drop everything.
            label="Copy routines from the active version"
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Create draft
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CreatePlanVersionDialog;
