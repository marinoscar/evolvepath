import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { Domain, Outcome, OutcomeInput } from '../../types';
import { DOMAIN_LABELS } from '../../types';

interface OutcomeFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  domain: Domain;
  initial?: Outcome | null;
  onClose: () => void;
  onSave: (input: OutcomeInput) => Promise<unknown>;
}

interface FormValues {
  title: string;
  description: string;
  targetDate: string;
  importance: number;
  successDefinition: string;
  userConfidence: number;
}

const EMPTY: FormValues = {
  title: '',
  description: '',
  targetDate: '',
  importance: 3,
  successDefinition: '',
  userConfidence: 3,
};

const SCALE_MARKS = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));

export function OutcomeFormDialog({
  open,
  mode,
  domain,
  initial,
  onClose,
  onSave,
}: OutcomeFormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [titleTouched, setTitleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues({
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      targetDate: initial?.targetDate ?? '',
      importance: initial?.importance ?? 3,
      successDefinition: initial?.successDefinition ?? '',
      userConfidence: initial?.userConfidence ?? 3,
    });
    setTitleTouched(false);
    setError(null);
  }, [open, initial]);

  const titleError = titleTouched && !values.title.trim();

  const handleSave = async () => {
    setTitleTouched(true);
    // Validated here as well as by the API: a round trip to be told the title
    // is empty is a round trip the user did not need.
    if (!values.title.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        // `domain` is immutable after creation — the API rejects it on PATCH,
        // so it is sent only on create.
        ...(mode === 'create' ? { domain } : {}),
        title: values.title.trim(),
        description: values.description.trim() || null,
        targetDate: values.targetDate || null,
        importance: values.importance,
        successDefinition: values.successDefinition.trim() || null,
        userConfidence: values.userConfidence,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the outcome');
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
      aria-labelledby="outcome-dialog-title"
    >
      <DialogTitle id="outcome-dialog-title">
        {mode === 'create' ? `New ${DOMAIN_LABELS[domain]} outcome` : 'Edit outcome'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {mode === 'edit' && (
            // Shown, not editable: moving an outcome between domains would
            // orphan the plan and routines sized for the old domain's mode.
            <TextField
              label="Domain"
              value={DOMAIN_LABELS[domain]}
              fullWidth
              disabled
              helperText="A domain cannot be changed after the outcome is created"
            />
          )}

          <TextField
            label="What do you want to be true?"
            value={values.title}
            onChange={(event) => setValues((v) => ({ ...v, title: event.target.value }))}
            onBlur={() => setTitleTouched(true)}
            required
            fullWidth
            autoFocus
            error={titleError}
            helperText={titleError ? 'A title is required' : 'e.g. Three strength workouts per week'}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <TextField
            label="Description"
            value={values.description}
            onChange={(event) => setValues((v) => ({ ...v, description: event.target.value }))}
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />

          <TextField
            label="Target date"
            type="date"
            value={values.targetDate}
            onChange={(event) => setValues((v) => ({ ...v, targetDate: event.target.value }))}
            fullWidth
            // A native date input: no picker library, no bundle cost, and the
            // platform's own accessible date entry rather than a reimplemented one.
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <div>
            <Typography id="importance-label" gutterBottom>
              How much does this matter?
            </Typography>
            <Slider
              value={values.importance}
              onChange={(_, value) => setValues((v) => ({ ...v, importance: value as number }))}
              min={1}
              max={5}
              step={1}
              marks={SCALE_MARKS}
              valueLabelDisplay="auto"
              aria-labelledby="importance-label"
            />
          </div>

          <TextField
            label="What does done look like?"
            value={values.successDefinition}
            onChange={(event) =>
              setValues((v) => ({ ...v, successDefinition: event.target.value }))
            }
            fullWidth
            multiline
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />

          <div>
            <Typography id="confidence-label" gutterBottom>
              How confident do you feel?
            </Typography>
            <Slider
              value={values.userConfidence}
              onChange={(_, value) => setValues((v) => ({ ...v, userConfidence: value as number }))}
              min={1}
              max={5}
              step={1}
              marks={SCALE_MARKS}
              valueLabelDisplay="auto"
              aria-labelledby="confidence-label"
            />
          </div>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default OutcomeFormDialog;
