import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import type { Discomfort } from '../../../types';

export interface SetInputValues {
  weightKg: number | null;
  reps: number;
  rpe: number | null;
  discomfort: Discomfort;
}

interface SetInputsProps {
  setNumber: number;
  /** Prefilled from the progression suggestion, or the last set logged. */
  suggestedWeightKg: number | null;
  suggestedReps: number;
  submitting: boolean;
  onComplete: (values: SetInputValues) => void;
}

/**
 * One set, as somebody standing at a rack types it.
 *
 * A FORM, so Enter completes the set — a phone keyboard's "go" key is the
 * fastest way to log one, and a div with a click handler swallows it.
 *
 * RPE is collapsed by default. It is the field most likely to be left blank
 * (the API allows null, and the progression rule treats absent as comfortable),
 * so showing it open would ask everybody a question most people skip.
 *
 * Discomfort is three named buttons rather than a scale. A number invites the
 * software to average it; PRD §45's whole design is that sharp pain is a
 * signal, not a magnitude.
 */
export function SetInputs({
  setNumber,
  suggestedWeightKg,
  suggestedReps,
  submitting,
  onComplete,
}: SetInputsProps) {
  const [weight, setWeight] = useState(
    suggestedWeightKg === null ? '' : String(suggestedWeightKg),
  );
  const [reps, setReps] = useState(String(suggestedReps));
  const [rpe, setRpe] = useState<number | null>(null);
  const [showRpe, setShowRpe] = useState(false);
  const [discomfort, setDiscomfort] = useState<Discomfort>('NONE');

  // A new set number means a new set: re-seed rather than leaving the previous
  // one's numbers in the boxes.
  useEffect(() => {
    setWeight(suggestedWeightKg === null ? '' : String(suggestedWeightKg));
    setReps(String(suggestedReps));
    setRpe(null);
    setShowRpe(false);
    setDiscomfort('NONE');
  }, [setNumber, suggestedReps, suggestedWeightKg]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsedReps = Number.parseInt(reps, 10);

    if (!Number.isFinite(parsedReps) || parsedReps < 0) return;

    const parsedWeight = weight.trim() === '' ? null : Number(weight.replace(',', '.'));

    onComplete({
      weightKg: parsedWeight !== null && Number.isFinite(parsedWeight) ? parsedWeight : null,
      reps: parsedReps,
      rpe,
      discomfort,
    });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ mt: 2 }} data-testid="set-inputs">
      <Typography variant="overline" color="text.secondary">
        Set {setNumber}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Weight (kg)"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          slotProps={{
            htmlInput: { inputMode: 'decimal', step: 0.25, 'aria-label': 'Weight in kilograms' },
          }}
          size="small"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Reps"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Reps' } }}
          size="small"
          sx={{ flex: 1 }}
        />
      </Stack>

      <Box sx={{ mt: 1 }}>
        {showRpe ? (
          <Box>
            <Typography variant="caption" id={`rpe-label-${setNumber}`}>
              How hard was it? (RPE)
            </Typography>
            <Slider
              value={rpe ?? 7}
              onChange={(_event, value) => setRpe(value as number)}
              min={1}
              max={10}
              step={1}
              marks
              valueLabelDisplay="auto"
              aria-labelledby={`rpe-label-${setNumber}`}
            />
          </Box>
        ) : (
          <Button size="small" onClick={() => setShowRpe(true)}>
            Add RPE
          </Button>
        )}
      </Box>

      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" id={`discomfort-label-${setNumber}`}>
          Anything hurt?
        </Typography>
        <ToggleButtonGroup
          exclusive
          value={discomfort}
          onChange={(_event, value: Discomfort | null) => value && setDiscomfort(value)}
          aria-labelledby={`discomfort-label-${setNumber}`}
          sx={{ display: 'block', mt: 0.5 }}
        >
          <ToggleButton value="NONE" sx={{ minHeight: 44 }}>
            None
          </ToggleButton>
          <ToggleButton value="MILD" sx={{ minHeight: 44 }}>
            Mild
          </ToggleButton>
          <ToggleButton value="SHARP_PAIN" sx={{ minHeight: 44 }}>
            Sharp pain
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Collapse in>
        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={submitting}
          sx={{ mt: 2, minHeight: 56 }}
        >
          Complete set
        </Button>
      </Collapse>
    </Box>
  );
}
