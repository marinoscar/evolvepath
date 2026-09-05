import { Box, Chip, Typography } from '@mui/material';

import type { CheckInFeel } from '../../types';

const OPTIONS: Array<{ value: CheckInFeel; label: string }> = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'PACKED', label: 'Packed' },
  { value: 'LOW_ENERGY', label: 'Low energy' },
  { value: 'UNEXPECTED_PROBLEM', label: 'Something came up' },
];

interface CheckInChipsProps {
  value: CheckInFeel | null;
  disabled?: boolean;
  onChange: (feel: CheckInFeel) => void;
}

/**
 * "How does today feel?" (PRD §73).
 *
 * FOUR CHIPS AND NOTHING ELSE. PRD §73 warns against "daily emotional
 * interrogation", and the guard is that there is nowhere here to ask a second
 * question — the same reason the API's request body has exactly one field.
 *
 * A `radiogroup` rather than a set of toggle buttons: exactly one answer applies
 * at a time, and screen readers should say so.
 */
export function CheckInChips({ value, disabled = false, onChange }: CheckInChipsProps) {
  return (
    <Box sx={{ mb: 2 }} data-testid="check-in-chips">
      <Typography variant="body2" color="text.secondary" id="check-in-label" gutterBottom>
        How does today feel?
      </Typography>
      <Box
        role="radiogroup"
        aria-labelledby="check-in-label"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            role="radio"
            aria-checked={value === option.value}
            color={value === option.value ? 'primary' : 'default'}
            variant={value === option.value ? 'filled' : 'outlined'}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          />
        ))}
      </Box>
    </Box>
  );
}
