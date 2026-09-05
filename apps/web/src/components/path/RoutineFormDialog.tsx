import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { Routine, RoutineFrequency, RoutineInput, RoutineTriggerType } from '../../types';

interface RoutineFormDialogProps {
  open: boolean;
  initial?: Routine | null;
  onClose: () => void;
  onSave: (input: RoutineInput) => Promise<unknown>;
}

interface FormValues {
  title: string;
  triggerType: RoutineTriggerType;
  triggerValue: string;
  frequency: RoutineFrequency;
  daysOfWeek: number[];
  preferredTime: string;
  estimatedDurationMin: string;
  minimumDurationMin: string;
  fallbackBehavior: string;
}

const EMPTY: FormValues = {
  title: '',
  triggerType: 'TIME',
  triggerValue: '',
  frequency: 'WEEKDAYS',
  daysOfWeek: [],
  preferredTime: '',
  estimatedDurationMin: '30',
  minimumDurationMin: '10',
  fallbackBehavior: '',
};

const FREQUENCIES: Array<{ value: RoutineFrequency; label: string }> = [
  { value: 'DAILY', label: 'Every day' },
  { value: 'WEEKDAYS', label: 'Weekdays' },
  { value: 'WEEKENDS', label: 'Weekends' },
  { value: 'WEEKLY', label: 'Once a week' },
  { value: 'CUSTOM', label: 'Specific days' },
];

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates the whole routine, exactly as the API's `refineRoutineFields` does.
 *
 * Duplicated deliberately rather than shared: the API is the authority and
 * rejects these itself, but a user who types a 90-minute minimum on a
 * 45-minute routine should be told before they press Save, not after a round
 * trip. Each rule below has a matching one in
 * `apps/api/src/path/routines/dto/create-routine.dto.ts`.
 */
function validate(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};

  if (!values.title.trim()) {
    errors.title = 'A title is required';
  }

  if (values.triggerType === 'EVENT' && !values.triggerValue.trim()) {
    // An implementation intention with no "when" is not one (VISION VI §25).
    errors.triggerValue = 'What happens right before this?';
  }

  if (values.triggerType === 'TIME' && values.triggerValue && !TIME_PATTERN.test(values.triggerValue)) {
    errors.triggerValue = 'Use HH:mm, e.g. 06:30';
  }

  if (values.frequency === 'CUSTOM' && values.daysOfWeek.length === 0) {
    errors.daysOfWeek = 'Pick at least one day';
  }

  const estimated = Number(values.estimatedDurationMin);
  const minimum = Number(values.minimumDurationMin);

  if (!Number.isFinite(estimated) || estimated < 1 || estimated > 480) {
    errors.estimatedDurationMin = 'Between 1 and 480 minutes';
  }

  if (!Number.isFinite(minimum) || minimum < 1) {
    errors.minimumDurationMin = 'At least 1 minute';
  } else if (Number.isFinite(estimated) && minimum > estimated) {
    // The minimum version is the bad-day path (PRD §57); a minimum longer than
    // the ideal makes the bad day the harder one.
    errors.minimumDurationMin = 'The minimum cannot be longer than the full version';
  }

  return errors;
}

export function RoutineFormDialog({ open, initial, onClose, onSave }: RoutineFormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(
      initial
        ? {
            title: initial.title,
            triggerType: initial.triggerType,
            triggerValue: initial.triggerValue ?? '',
            frequency: initial.frequency,
            daysOfWeek: initial.daysOfWeek,
            preferredTime: initial.preferredTime ?? '',
            estimatedDurationMin: String(initial.estimatedDurationMin),
            minimumDurationMin: String(initial.minimumDurationMin),
            fallbackBehavior: initial.fallbackBehavior ?? '',
          }
        : EMPTY,
    );
    setSubmitted(false);
    setError(null);
  }, [open, initial]);

  const errors = validate(values);
  const showError = (field: keyof FormValues) => (submitted ? errors[field] : undefined);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: values.title.trim(),
        triggerType: values.triggerType,
        triggerValue: values.triggerValue.trim() || null,
        frequency: values.frequency,
        // The API rejects days on a non-CUSTOM frequency, so they are cleared
        // here rather than sent and refused.
        daysOfWeek: values.frequency === 'CUSTOM' ? values.daysOfWeek : [],
        preferredTime: values.preferredTime || null,
        estimatedDurationMin: Number(values.estimatedDurationMin),
        minimumDurationMin: Number(values.minimumDurationMin),
        fallbackBehavior: values.fallbackBehavior.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the routine');
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
      aria-labelledby="routine-dialog-title"
    >
      <DialogTitle id="routine-dialog-title">
        {initial ? 'Edit routine' : 'New routine'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="What will you do?"
            value={values.title}
            onChange={(event) => set('title', event.target.value)}
            required
            fullWidth
            autoFocus
            error={Boolean(showError('title'))}
            helperText={showError('title') ?? 'e.g. Morning workout'}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <div>
            <Typography variant="body2" id="trigger-type-label" gutterBottom>
              What starts it?
            </Typography>
            <ToggleButtonGroup
              value={values.triggerType}
              exclusive
              size="small"
              onChange={(_, next: RoutineTriggerType | null) => {
                if (next) {
                  set('triggerType', next);
                  // The two kinds of trigger hold different things; carrying a
                  // time over into an event field would look like a valid value.
                  set('triggerValue', '');
                }
              }}
              aria-labelledby="trigger-type-label"
            >
              <ToggleButton value="TIME">A time</ToggleButton>
              <ToggleButton value="EVENT">Something else</ToggleButton>
            </ToggleButtonGroup>
          </div>

          <TextField
            label={values.triggerType === 'TIME' ? 'At what time?' : 'Right after…'}
            type={values.triggerType === 'TIME' ? 'time' : 'text'}
            value={values.triggerValue}
            onChange={(event) => set('triggerValue', event.target.value)}
            fullWidth
            error={Boolean(showError('triggerValue'))}
            helperText={
              showError('triggerValue') ??
              (values.triggerType === 'TIME'
                ? 'Optional — leave empty for "any time"'
                : 'e.g. after morning coffee')
            }
            slotProps={{
              inputLabel: values.triggerType === 'TIME' ? { shrink: true } : undefined,
              htmlInput: { maxLength: 200 },
            }}
          />

          <TextField
            select
            label="How often?"
            value={values.frequency}
            onChange={(event) => set('frequency', event.target.value as RoutineFrequency)}
            fullWidth
          >
            {FREQUENCIES.map((frequency) => (
              <MenuItem key={frequency.value} value={frequency.value}>
                {frequency.label}
              </MenuItem>
            ))}
          </TextField>

          {values.frequency === 'CUSTOM' && (
            <div>
              <Typography variant="body2" id="days-label" gutterBottom>
                Which days?
              </Typography>
              <ToggleButtonGroup
                value={values.daysOfWeek}
                size="small"
                onChange={(_, next: number[]) => set('daysOfWeek', next)}
                aria-labelledby="days-label"
              >
                {DAYS.map((day) => (
                  <ToggleButton key={day.value} value={day.value} aria-label={day.label}>
                    {day.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              {showError('daysOfWeek') && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                  {showError('daysOfWeek')}
                </Typography>
              )}
            </div>
          )}

          <TextField
            label="Preferred time"
            type="time"
            value={values.preferredTime}
            onChange={(event) => set('preferredTime', event.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Optional"
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Full version (minutes)"
              type="number"
              value={values.estimatedDurationMin}
              onChange={(event) => set('estimatedDurationMin', event.target.value)}
              fullWidth
              error={Boolean(showError('estimatedDurationMin'))}
              helperText={showError('estimatedDurationMin')}
              slotProps={{ htmlInput: { min: 1, max: 480 } }}
            />
            <TextField
              label="Minimum version (minutes)"
              type="number"
              value={values.minimumDurationMin}
              onChange={(event) => set('minimumDurationMin', event.target.value)}
              fullWidth
              error={Boolean(showError('minimumDurationMin'))}
              helperText={showError('minimumDurationMin') ?? 'What still counts on a bad day'}
              slotProps={{ htmlInput: { min: 1, max: 480 } }}
            />
          </Stack>

          <TextField
            label="If you cannot do it at all…"
            value={values.fallbackBehavior}
            onChange={(event) => set('fallbackBehavior', event.target.value)}
            fullWidth
            multiline
            helperText="e.g. 10-minute bodyweight circuit"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

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

export default RoutineFormDialog;
