import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';

import type { OnboardingProposalCommitment } from '../../types';

export interface CommitmentEditRowProps {
  commitment: OnboardingProposalCommitment;
  /** `YYYY-MM-DDTHH:mm`, the bounds the guardrails will re-check server-side. */
  min: string;
  max: string;
  canRemove: boolean;
  onChange: (next: OnboardingProposalCommitment) => void;
  onRemove: () => void;
}

const DURATIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

/**
 * One editable commitment (issue #104, epic E04).
 *
 * A NATIVE `datetime-local` with `min`/`max` rather than `@mui/x-date-pickers`:
 * the dependency is not in this app, the bounds are the whole validation, and
 * on a phone the native picker is the one the user already knows.
 *
 * The bounds are a courtesy, not the enforcement — `POST /onboarding/approve`
 * re-checks every guardrail, and a client that skipped the attribute would get
 * a 400 naming the rule rather than a plan the server quietly corrected.
 */
export function CommitmentEditRow({
  commitment,
  min,
  max,
  canRemove,
  onChange,
  onRemove,
}: CommitmentEditRowProps) {
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack spacing={1.5}>
        <TextField
          label="What"
          value={commitment.title}
          onChange={(event) => onChange({ ...commitment, title: event.target.value })}
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            label="When"
            type="datetime-local"
            value={toLocalInput(commitment.scheduledStart)}
            onChange={(event) =>
              onChange({ ...commitment, scheduledStart: fromLocalInput(event.target.value) })
            }
            size="small"
            fullWidth
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min, max } }}
          />

          <TextField
            label="For"
            select
            value={commitment.durationMinutes}
            onChange={(event) =>
              onChange({ ...commitment, durationMinutes: Number(event.target.value) })
            }
            size="small"
            sx={{ minWidth: 120 }}
          >
            {DURATIONS.map((minutes) => (
              <MenuItem key={minutes} value={minutes}>
                {`${minutes} min`}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            color="error"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={`Remove ${commitment.title}`}
          >
            Remove
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

/**
 * ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in the
 * BROWSER's zone. `toISOString().slice(0, 16)` is the tempting one-liner and is
 * wrong: it renders UTC, so a 07:30 commitment shows as 13:30 in Costa Rica.
 */
export function toLocalInput(iso: string): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** …and back. An empty or unparseable value keeps the field usable as `''`. */
export function fromLocalInput(value: string): string {
  const at = new Date(value);

  return Number.isNaN(at.getTime()) ? value : at.toISOString();
}
