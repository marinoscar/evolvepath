import { Box, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

/** VISION §10 names these three; everything else is "custom". */
export const TIMER_PRESETS = [5, 10, 20] as const;

interface TimerPickerProps {
  minutes: number;
  onChange: (minutes: number) => void;
}

/**
 * How long to go for.
 *
 * 5 / 10 / 20 is not an arbitrary ladder — VISION §10 names them because the
 * decision that matters is "start", and a picker that asked for a number first
 * would put arithmetic between the user and the button. Custom exists for the
 * person who already knows.
 */
export function TimerPicker({ minutes, onChange }: TimerPickerProps) {
  const isPreset = (TIMER_PRESETS as readonly number[]).includes(minutes);

  return (
    <Box sx={{ my: 3 }}>
      <Typography variant="body2" color="text.secondary" id="timer-picker-label" gutterBottom>
        How long?
      </Typography>

      <ToggleButtonGroup
        exclusive
        value={isPreset ? minutes : 'custom'}
        aria-labelledby="timer-picker-label"
        onChange={(_event, value) => {
          if (value === null) return;
          // Switching to Custom keeps the current number rather than blanking
          // it: the field is there to adjust an answer, not to demand a new one.
          onChange(value === 'custom' ? minutes : Number(value));
        }}
      >
        {TIMER_PRESETS.map((preset) => (
          <ToggleButton key={preset} value={preset} sx={{ minWidth: 72, minHeight: 44 }}>
            {preset} min
          </ToggleButton>
        ))}
        <ToggleButton value="custom" sx={{ minWidth: 72, minHeight: 44 }}>
          Custom
        </ToggleButton>
      </ToggleButtonGroup>

      {!isPreset && (
        <TextField
          label="Minutes"
          type="number"
          value={minutes}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(180, Math.max(1, next)));
          }}
          sx={{ mt: 2, width: 140 }}
          slotProps={{ htmlInput: { min: 1, max: 180 } }}
        />
      )}
    </Box>
  );
}
