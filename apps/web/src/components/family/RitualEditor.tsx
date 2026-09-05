import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { FamilyMember, Outcome, Ritual, RitualInput } from '../../types';
import { useBehaviourLint } from '../../hooks/useBehaviourLint';
import {
  DEFAULT_RITUAL_FORM,
  ritualFormSchema,
  toRitualForm,
  toRitualInput,
  type RitualFormValues,
} from '../../utils/ritualForm.schema';
import { EditorShell } from './EditorShell';
import { RecurrencePicker } from './RecurrencePicker';

interface RitualEditorProps {
  open: boolean;
  initial?: Ritual | null;
  members: FamilyMember[];
  outcomes?: Outcome[];
  submitting?: boolean;
  /** A server-side lint refusal, mapped to the title field by the page. */
  titleError?: { message: string; match: string | null } | null;
  onClose: () => void;
  onSubmit: (input: RitualInput) => Promise<void>;
}

/** The sizes people actually pick, plus whatever they type. */
const MINUTE_CHIPS = [5, 10, 15, 20, 30, 45, 60];

export function RitualEditor({
  open,
  initial = null,
  members,
  outcomes = [],
  submitting = false,
  titleError = null,
  onClose,
  onSubmit,
}: RitualEditorProps) {
  const [values, setValues] = useState<RitualFormValues>(DEFAULT_RITUAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setValues(initial ? toRitualForm(initial) : DEFAULT_RITUAL_FORM);
    setFieldErrors({});
    setFormError(null);
  }, [open, initial]);

  // Runs while the editor is open, on the trimmed title, debounced.
  const lint = useBehaviourLint(values.title, open);

  /**
   * The title's verdict.
   *
   * The SERVER's refusal wins when there is one: it is the authoritative check,
   * and showing the debounced client verdict over it would let a stale "looks
   * fine" sit above a save that just failed.
   */
  const titleProblem = useMemo(() => {
    if (titleError) return { message: titleError.message, suggestion: null as string | null };
    if (lint.result && !lint.result.ok) {
      return { message: 'Describe what you will do, not how someone else should feel or behave.', suggestion: lint.result.suggestion };
    }
    return null;
  }, [titleError, lint.result]);

  const set = <K extends keyof RitualFormValues>(key: K, value: RitualFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const parsed = ritualFormSchema.safeParse(values);

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    setFormError(null);

    try {
      await onSubmit(toRitualInput(parsed.data));
    } catch (err) {
      // The editor stays open with the values intact. A ritual is six fields of
      // typing and a failed save must not cost them.
      setFormError(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  const recurrence = {
    weekdays: values.weekdays,
    time: values.time,
    everyNWeeks: values.everyNWeeks,
  };

  return (
    <EditorShell
      open={open}
      title={initial ? 'Edit ritual' : 'Create a ritual'}
      titleId="ritual-editor-title"
      onClose={onClose}
    >
      <Stack spacing={2.5} sx={{ mt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <Box>
          <TextField
            label="What you will do"
            fullWidth
            autoFocus
            value={values.title}
            error={titleProblem !== null || Boolean(fieldErrors.title)}
            aria-invalid={titleProblem !== null}
            aria-describedby={titleProblem ? 'ritual-title-error' : undefined}
            helperText={
              <span id="ritual-title-error">
                {titleProblem?.message ?? fieldErrors.title ?? 'Your own behaviour, in your words'}
              </span>
            }
            onChange={(event) => set('title', event.target.value)}
            slotProps={{ htmlInput: { maxLength: 120, 'data-testid': 'ritual-title' } }}
          />

          {/* Offered, never applied: the rewrite fills the field and waits. */}
          {titleProblem?.suggestion && (
            <Button
              size="small"
              sx={{ mt: 0.5 }}
              data-testid="ritual-suggest-rewrite"
              onClick={() => set('title', titleProblem.suggestion!)}
            >
              Suggest a rewrite
            </Button>
          )}
        </Box>

        <TextField
          label="Why it matters (optional)"
          fullWidth
          multiline
          minRows={2}
          value={values.purpose ?? ''}
          onChange={(event) => set('purpose', event.target.value)}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />

        <TextField
          select
          label="With"
          fullWidth
          value={values.familyMemberId ?? ''}
          onChange={(event) => set('familyMemberId', event.target.value || null)}
        >
          <MenuItem value="">No one in particular</MenuItem>
          {members.map((member) => (
            <MenuItem key={member.id} value={member.id}>
              {member.nickname}
            </MenuItem>
          ))}
        </TextField>

        <Box>
          <RecurrencePicker
            value={recurrence}
            disabled={submitting}
            onChange={(next) =>
              setValues((current) => ({
                ...current,
                weekdays: next.weekdays,
                time: next.time,
                everyNWeeks: next.everyNWeeks,
              }))
            }
          />
          {fieldErrors.weekdays && (
            <Typography variant="caption" color="error">
              {fieldErrors.weekdays}
            </Typography>
          )}
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            How long, ideally
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            {MINUTE_CHIPS.map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes} min`}
                size="small"
                variant={values.idealMinutes === minutes ? 'filled' : 'outlined'}
                color={values.idealMinutes === minutes ? 'primary' : 'default'}
                onClick={() => set('idealMinutes', minutes)}
              />
            ))}
          </Box>
          <TextField
            label="Ideal minutes"
            type="number"
            size="small"
            value={values.idealMinutes}
            error={Boolean(fieldErrors.idealMinutes)}
            helperText={fieldErrors.idealMinutes}
            onChange={(event) => set('idealMinutes', Number(event.target.value))}
            slotProps={{ htmlInput: { min: 5, max: 240, 'data-testid': 'ritual-ideal' } }}
          />
        </Box>

        <TextField
          label="The smallest version that still counts"
          type="number"
          size="small"
          value={values.minimumMinutes}
          error={Boolean(fieldErrors.minimumMinutes)}
          helperText={fieldErrors.minimumMinutes ?? 'Minutes — the bad-day path'}
          onChange={(event) => set('minimumMinutes', Number(event.target.value))}
          slotProps={{ htmlInput: { min: 1, max: 240, 'data-testid': 'ritual-minimum' } }}
        />

        <TextField
          label="What you do instead on a bad day (optional)"
          fullWidth
          value={values.fallbackBehavior ?? ''}
          helperText="What is the smallest version that still counts?"
          onChange={(event) => set('fallbackBehavior', event.target.value)}
          slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'ritual-fallback' } }}
        />

        {!initial && outcomes.length > 0 && (
          <TextField
            select
            label="Link to a Path outcome (shows on Path)"
            fullWidth
            value={values.outcomeId ?? ''}
            onChange={(event) => set('outcomeId', event.target.value || null)}
          >
            <MenuItem value="">Not linked</MenuItem>
            {outcomes.map((outcome) => (
              <MenuItem key={outcome.id} value={outcome.id}>
                {outcome.title}
              </MenuItem>
            ))}
          </TextField>
        )}

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            // Blocked while the title is known to be bad: the API would refuse
            // it anyway, and a save that fails is a worse way to learn.
            disabled={submitting || titleProblem !== null}
            data-testid="ritual-save"
            onClick={() => void submit()}
          >
            Save
          </Button>
        </Stack>
      </Stack>
    </EditorShell>
  );
}
