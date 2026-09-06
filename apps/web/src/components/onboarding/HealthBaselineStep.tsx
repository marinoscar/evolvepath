import { forwardRef } from 'react';
import {
  Box,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import type { HealthBaseline } from '../../types';
import {
  HEALTH_EQUIPMENT_OPTIONS,
  HEALTH_LIMITATIONS_HINT,
  HEALTH_QUESTION,
  HEALTH_TITLE,
} from './copy';
import { StepShell } from './StepShell';

const EXPERIENCE: Array<{ value: HealthBaseline['experience']; label: string }> = [
  { value: 'NONE', label: 'I am starting from nothing' },
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
];

export interface HealthBaselineStepProps {
  baseline: HealthBaseline;
  onChange: (baseline: HealthBaseline) => void;
}

/**
 * Step 6 (PRD §20), shown only when Health was selected on step 3.
 *
 * The limitations field asks for what to plan AROUND, not for a diagnosis —
 * the hint says so, and the planner's instructions say so too. Neither this app
 * nor the coach is a place to write down a medical history.
 */
export const HealthBaselineStep = forwardRef<HTMLHeadingElement, HealthBaselineStepProps>(
  function HealthBaselineStep({ baseline, onChange }, ref) {
    const patch = (over: Partial<HealthBaseline>) => onChange({ ...baseline, ...over });

    return (
      <StepShell ref={ref} title={HEALTH_TITLE} question={HEALTH_QUESTION}>
        <Stack spacing={3}>
          <FormControl>
            <FormLabel id="experience-label">Experience with training</FormLabel>
            <RadioGroup
              aria-labelledby="experience-label"
              value={baseline.experience}
              onChange={(event) =>
                patch({ experience: event.target.value as HealthBaseline['experience'] })
              }
            >
              {EXPERIENCE.map((option) => (
                <FormControlLabel
                  key={option.value}
                  value={option.value}
                  control={<Radio />}
                  label={option.label}
                />
              ))}
            </RadioGroup>
          </FormControl>

          <Box>
            <FormLabel component="legend" sx={{ mb: 1, display: 'block' }}>
              Days a week
            </FormLabel>
            <ToggleButtonGroup
              exclusive
              value={baseline.daysPerWeek}
              onChange={(_event, value) => value != null && patch({ daysPerWeek: value })}
              aria-label="Days a week"
              size="small"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <ToggleButton key={day} value={day} aria-label={`${day} days a week`}>
                  {day}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Box>
            <FormLabel component="legend" sx={{ mb: 1, display: 'block' }}>
              {`Minutes per session — ${baseline.minutesPerSession}`}
            </FormLabel>
            <Slider
              value={baseline.minutesPerSession}
              onChange={(_event, value) =>
                patch({ minutesPerSession: Array.isArray(value) ? value[0] : value })
              }
              min={10}
              max={120}
              step={5}
              valueLabelDisplay="auto"
              aria-label="Minutes per session"
            />
          </Box>

          <Box>
            <FormLabel component="legend" sx={{ mb: 1, display: 'block' }}>
              What do you have access to?
            </FormLabel>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {HEALTH_EQUIPMENT_OPTIONS.map((item) => {
                const selected = baseline.equipment.includes(item);

                return (
                  <Chip
                    key={item}
                    label={item}
                    role="checkbox"
                    aria-checked={selected}
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() =>
                      patch({
                        equipment: selected
                          ? baseline.equipment.filter((e) => e !== item)
                          : [...baseline.equipment, item],
                      })
                    }
                  />
                );
              })}
            </Box>
          </Box>

          <TextField
            label="Anything you enjoy or would rather avoid"
            value={baseline.preferences ?? ''}
            onChange={(event) => patch({ preferences: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          <TextField
            label="Anything I should plan around"
            value={baseline.limitations ?? ''}
            onChange={(event) => patch({ limitations: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            size="small"
            helperText={HEALTH_LIMITATIONS_HINT}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          <Typography variant="caption" color="text.secondary">
            This shapes the first plan only. Nothing here is stored as a medical record.
          </Typography>
        </Stack>
      </StepShell>
    );
  },
);
