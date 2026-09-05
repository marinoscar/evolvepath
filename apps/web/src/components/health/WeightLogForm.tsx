import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';

import type { BodyWeightLog } from '../../types';

interface WeightLogFormProps {
  onSave: (entry: BodyWeightLog) => Promise<void>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Log a weight for a day (PRD §47).
 *
 * The date defaults to today and is editable, because people weigh themselves
 * and log it later, and refusing yesterday would mean either a wrong date or no
 * reading at all.
 *
 * `inputMode="decimal"` rather than `type="number"`: a numeric keypad on a
 * phone without the spinner, the scroll-wheel hazard and the locale trouble a
 * number input brings.
 */
export function WeightLogForm({ onSave }: WeightLogFormProps) {
  const [dateLocal, setDateLocal] = useState(today());
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const weightKg = Number(weight.replace(',', '.'));

    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
      setError('Enter a weight in kilograms.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({ dateLocal, weightKg: Math.round(weightKg * 10) / 10 });
      setWeight('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: 'flex-start' }}
      >
        <TextField
          label="Date"
          type="date"
          value={dateLocal}
          onChange={(event) => setDateLocal(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }}
          size="small"
        />
        <TextField
          label="Weight (kg)"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          slotProps={{
            htmlInput: { inputMode: 'decimal', 'aria-label': 'Weight in kilograms' },
          }}
          size="small"
        />
        <Button type="submit" variant="contained" disabled={saving || weight.trim() === ''}>
          Save
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
