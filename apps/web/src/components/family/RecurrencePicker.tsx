import {
  Box,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import type { RitualRecurrence } from '../../types';
import { WEEKDAY_LONG, WEEKDAY_ORDER, WEEKDAY_SHORT, describeRecurrence } from '../../utils/recurrence';

interface RecurrencePickerProps {
  value: RitualRecurrence;
  onChange: (next: RitualRecurrence) => void;
  disabled?: boolean;
}

const CADENCES: Array<{ value: 1 | 2 | 4; label: string }> = [
  { value: 1, label: 'Every week' },
  { value: 2, label: 'Every 2 weeks' },
  { value: 4, label: 'Every 4 weeks' },
];

/**
 * Days, time and cadence.
 *
 * The weekday chips render Monday-first but carry `0 = Sunday` values, which is
 * the API's numbering and `Date#getDay()`'s. Converting between the two would
 * be a conversion in every component that touches a recurrence; here the value
 * never changes and only the render order does.
 *
 * A native `<input type="time">` rather than a picker component: it is
 * keyboard-accessible, locale-aware and already in the platform, and pulling in
 * a date-picker package plus its adapter for one field is a dependency the rest
 * of this codebase has consistently declined.
 */
export function RecurrencePicker({ value, onChange, disabled = false }: RecurrencePickerProps) {
  const toggleDay = (day: number) => {
    const next = value.weekdays.includes(day)
      ? value.weekdays.filter((entry) => entry !== day)
      : [...value.weekdays, day];

    onChange({ ...value, weekdays: next.sort((a, b) => a - b) });
  };

  return (
    <Box>
      <Typography variant="subtitle2" id="recurrence-days-label" gutterBottom>
        Which days
      </Typography>

      <Box
        role="group"
        aria-labelledby="recurrence-days-label"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}
      >
        {WEEKDAY_ORDER.map((day) => {
          const selected = value.weekdays.includes(day);

          return (
            <ToggleButton
              key={day}
              value={day}
              size="small"
              selected={selected}
              disabled={disabled}
              // The full day name, not "Tue": a screen reader saying "Tue,
              // pressed" is guessing at an abbreviation the user cannot see.
              aria-label={WEEKDAY_LONG[day]}
              aria-pressed={selected}
              data-testid={`recurrence-weekday-${day}`}
              onChange={() => toggleDay(day)}
            >
              {WEEKDAY_SHORT[day]}
            </ToggleButton>
          );
        })}
      </Box>

      <TextField
        label="Time"
        type="time"
        size="small"
        value={value.time}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, time: event.target.value })}
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: { step: 300, 'data-testid': 'recurrence-time' },
        }}
        sx={{ mb: 2 }}
      />

      <Typography variant="subtitle2" id="recurrence-cadence-label" gutterBottom>
        How often
      </Typography>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={value.everyNWeeks}
        disabled={disabled}
        aria-labelledby="recurrence-cadence-label"
        onChange={(_event, next: 1 | 2 | 4 | null) => {
          if (next !== null) onChange({ ...value, everyNWeeks: next });
        }}
        sx={{ flexWrap: 'wrap' }}
      >
        {CADENCES.map((cadence) => (
          <ToggleButton key={cadence.value} value={cadence.value}>
            {cadence.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {describeRecurrence(value)}
      </Typography>
    </Box>
  );
}
