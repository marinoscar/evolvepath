import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  MenuItem,
  Rating,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import type { CommitmentCard, Domain, Outcome } from '../../types';
import {
  DURATION_PRESETS,
  defaultScheduledStart,
  validateCommitmentForm,
  type CommitmentFormErrors,
  type CommitmentFormValues,
} from '../../utils/commitmentForm.schema';
import { DOMAIN_LABELS } from './todayLabels';

interface CommitmentEditorFormProps {
  mode: 'create' | 'edit';
  initialDomain?: Domain;
  initial?: CommitmentCard;
  outcomes: Outcome[];
  submitting: boolean;
  onSubmit: (values: CommitmentFormValues) => Promise<void>;
  onCancel: () => void;
}

/** An ISO instant as the local `datetime-local` value the input wants. */
function toLocalInput(iso: string): string {
  const when = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

function initialValues(
  initial: CommitmentCard | undefined,
  initialDomain: Domain | undefined,
): CommitmentFormValues {
  if (!initial) {
    return {
      domain: initialDomain ?? 'WORK',
      title: '',
      outcomeId: null,
      scheduledStart: defaultScheduledStart(),
      durationMinutes: 20,
      importance: 3,
      short: {},
      minimum: {},
    };
  }

  return {
    domain: initial.domain,
    title: initial.title,
    outcomeId: initial.outcomeId,
    scheduledStart: toLocalInput(initial.scheduledStart),
    durationMinutes: initial.versions.full.minutes,
    importance: initial.importance,
    short: initial.versions.short
      ? { title: initial.versions.short.title, minutes: initial.versions.short.minutes }
      : {},
    minimum: initial.versions.minimum
      ? { title: initial.versions.minimum.title, minutes: initial.versions.minimum.minutes }
      : {},
  };
}

/**
 * One form for creating and for editing (epic E05, issue #52).
 *
 * The same fields either way, on purpose: a user who added something in ten
 * seconds and then wants to change the time should meet the form they already
 * know, not a second, differently-shaped one.
 *
 * THE SMALLER VERSIONS ARE COLLAPSED BY DEFAULT. They are what makes a bad day
 * survivable (PRD §57), and they are also the reason a quick add would stop
 * being quick if they were the first thing on screen. Someone who wants them
 * opens one section; someone who does not never sees them.
 *
 * `domain` is editable in create mode only: the API refuses to change it, and a
 * field that silently does nothing is worse than no field.
 */
export function CommitmentEditorForm({
  mode,
  initialDomain,
  initial,
  outcomes,
  submitting,
  onSubmit,
  onCancel,
}: CommitmentEditorFormProps) {
  const [values, setValues] = useState<CommitmentFormValues>(() =>
    initialValues(initial, initialDomain),
  );
  const [errors, setErrors] = useState<CommitmentFormErrors>({});
  const [showVersions, setShowVersions] = useState(
    Boolean(initial?.versions.short || initial?.versions.minimum),
  );

  useEffect(() => {
    setValues(initialValues(initial, initialDomain));
  }, [initial, initialDomain]);

  const set = <K extends keyof CommitmentFormValues>(key: K, value: CommitmentFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const found = validateCommitmentForm(values);
    setErrors(found ?? {});
    if (found) return;

    await onSubmit(values);
  };

  const isPreset = (DURATION_PRESETS as readonly number[]).includes(values.durationMinutes);

  return (
    <Stack spacing={2.5}>
      {mode === 'create' && (
        <Box>
          <Typography variant="body2" color="text.secondary" id="domain-label" gutterBottom>
            Which part of your life?
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={values.domain}
            aria-labelledby="domain-label"
            onChange={(_event, value) => value && set('domain', value as Domain)}
          >
            {(Object.keys(DOMAIN_LABELS) as Domain[]).map((domain) => (
              <ToggleButton key={domain} value={domain} sx={{ minHeight: 44 }}>
                {DOMAIN_LABELS[domain]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}

      <TextField
        label="What are you committing to?"
        value={values.title}
        onChange={(event) => set('title', event.target.value)}
        error={Boolean(errors.title)}
        helperText={errors.title}
        autoFocus
        fullWidth
        required
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />

      <TextField
        label="When"
        type="datetime-local"
        value={values.scheduledStart}
        onChange={(event) => set('scheduledStart', event.target.value)}
        error={Boolean(errors.scheduledStart)}
        helperText={errors.scheduledStart}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />

      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          How long?
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {DURATION_PRESETS.map((preset) => (
            <Chip
              key={preset}
              label={`${preset} min`}
              color={values.durationMinutes === preset ? 'primary' : 'default'}
              variant={values.durationMinutes === preset ? 'filled' : 'outlined'}
              onClick={() => set('durationMinutes', preset)}
            />
          ))}
          <TextField
            label="Custom"
            type="number"
            size="small"
            value={isPreset ? '' : values.durationMinutes}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next > 0) set('durationMinutes', next);
            }}
            sx={{ width: 110 }}
            slotProps={{ htmlInput: { min: 1, max: 480 } }}
          />
        </Box>
        {errors.durationMinutes && (
          <Typography variant="caption" color="error">
            {errors.durationMinutes}
          </Typography>
        )}
      </Box>

      <TextField
        select
        label="Serves which outcome?"
        value={values.outcomeId ?? ''}
        onChange={(event) => set('outcomeId', event.target.value || null)}
        fullWidth
      >
        <MenuItem value="">No outcome (just today)</MenuItem>
        {outcomes
          .filter((outcome) => outcome.domain === values.domain)
          .map((outcome) => (
            <MenuItem key={outcome.id} value={outcome.id}>
              {outcome.title}
            </MenuItem>
          ))}
      </TextField>

      <Box>
        <Typography variant="body2" color="text.secondary" id="importance-label" gutterBottom>
          How much does this matter?
        </Typography>
        <Rating
          value={values.importance}
          max={5}
          aria-labelledby="importance-label"
          onChange={(_event, value) => value && set('importance', value)}
        />
      </Box>

      <Box>
        <Button
          size="small"
          onClick={() => setShowVersions((current) => !current)}
          aria-expanded={showVersions}
        >
          {showVersions ? 'Hide smaller versions' : 'Add smaller versions'}
        </Button>
        <Collapse in={showVersions}>
          <Stack spacing={2} sx={{ mt: 2 }} data-testid="version-fields">
            <Typography variant="caption" color="text.secondary">
              What this becomes on a tight day, and on a bad one. Both are optional — and both
              are what keep a streak alive.
            </Typography>

            {(['short', 'minimum'] as const).map((which) => (
              <Box key={which} sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  label={which === 'short' ? 'Short version' : 'Minimum version'}
                  value={values[which].title ?? ''}
                  onChange={(event) =>
                    set(which, { ...values[which], title: event.target.value || undefined })
                  }
                  error={Boolean(errors[`${which}.title`])}
                  helperText={errors[`${which}.title`]}
                  fullWidth
                />
                <TextField
                  label="Minutes"
                  type="number"
                  value={values[which].minutes ?? ''}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    set(which, {
                      ...values[which],
                      minutes: event.target.value === '' ? undefined : next,
                    });
                  }}
                  error={Boolean(errors[`${which}.minutes`])}
                  helperText={errors[`${which}.minutes`]}
                  sx={{ width: 140 }}
                  slotProps={{ htmlInput: { min: 1, max: 480 } }}
                />
              </Box>
            ))}
          </Stack>
        </Collapse>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={submitting}>
          {mode === 'create' ? 'Add it' : 'Save'}
        </Button>
      </Box>
    </Stack>
  );
}
