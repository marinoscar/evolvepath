import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { Equipment, GenerateProgramRequest } from '../../../types';
import { EquipmentPhotoStep } from '../media/EquipmentPhotoStep';

// =============================================================================
// PRD §37's seven inputs, one question at a time (issue #95, epic E09)
// =============================================================================
//
// A stepper rather than one long form, for the reason every wizard in this
// product is one: the questions are not equally easy. "What do you want?" is a
// sentence somebody has to compose; "how many days?" is a tap. Putting them on
// one page makes the hard one look optional.
//
// THE LIMITATIONS FIELD IS THE ONE THAT NEEDS ITS COPY RIGHT. It asks for pain
// in plain words and promises two things in the same breath: the plan will be
// conservative, and nothing here will diagnose anything. Both promises are
// kept by code — the safety pre-check and the contraindication rules — so the
// helper text is a description rather than a reassurance.
// =============================================================================

export const EQUIPMENT_OPTIONS: Array<{ value: Equipment; label: string }> = [
  { value: 'BODYWEIGHT', label: 'Bodyweight only' },
  { value: 'DUMBBELL', label: 'Dumbbells' },
  { value: 'BARBELL', label: 'Barbell' },
  { value: 'BENCH', label: 'Bench' },
  { value: 'MACHINE', label: 'Machines' },
  { value: 'CABLE', label: 'Cables' },
  { value: 'KETTLEBELL', label: 'Kettlebell' },
  { value: 'BAND', label: 'Bands' },
];

const STEPS = ['Goal', 'You', 'Equipment', 'Preferences'];

export interface BuilderDefaults {
  experience?: 'BEGINNER' | 'INTERMEDIATE';
  daysPerWeek?: number;
  minutesPerSession?: number;
  equipment?: Equipment[];
  preferences?: string;
  limitations?: string;
}

interface BuilderWizardProps {
  defaults?: BuilderDefaults;
  submitting: boolean;
  onGenerate: (request: GenerateProgramRequest) => void;
}

export function BuilderWizard({ defaults = {}, submitting, onGenerate }: BuilderWizardProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState('');
  const [experience, setExperience] = useState<'BEGINNER' | 'INTERMEDIATE'>(
    defaults.experience ?? 'BEGINNER',
  );
  const [daysPerWeek, setDaysPerWeek] = useState(defaults.daysPerWeek ?? 3);
  const [minutesPerSession, setMinutesPerSession] = useState(
    defaults.minutesPerSession ?? 40,
  );
  const [equipment, setEquipment] = useState<Equipment[]>(
    defaults.equipment?.length ? defaults.equipment : ['BODYWEIGHT'],
  );
  const [preferences, setPreferences] = useState(defaults.preferences ?? '');
  const [limitations, setLimitations] = useState(defaults.limitations ?? '');

  const toggleEquipment = (value: Equipment) =>
    setEquipment((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  const submit = () =>
    onGenerate({
      goal: goal.trim(),
      experience,
      daysPerWeek,
      minutesPerSession,
      // Never empty: the API refuses it, and "nothing at all" is not a real
      // answer — everybody has their own bodyweight.
      equipment: equipment.length > 0 ? equipment : ['BODYWEIGHT'],
      ...(preferences.trim() ? { preferences: preferences.trim() } : {}),
      ...(limitations.trim() ? { limitations: limitations.trim() } : {}),
    });

  const canContinue = step !== 0 || goal.trim().length >= 3;

  return (
    <Box data-testid="builder-wizard">
      <Stepper
        activeStep={step}
        orientation={compact ? 'vertical' : 'horizontal'}
        sx={{ mt: 3 }}
      >
        {STEPS.map((label, index) => (
          <Step key={label} completed={step > index}>
            <StepLabel aria-current={step === index ? 'step' : undefined}>{label}</StepLabel>
            {/* Only in vertical mode: `StepContent` is designed for it, and a
                horizontal stepper renders an <ol> whose only legal children are
                list items — a panel inside it is an axe violation, not a
                cosmetic one. `unmountOnExit` keeps four identical Next buttons
                out of the tab order, since Collapse keeps children mounted. */}
            {compact ? (
              <StepContent slotProps={{ transition: { unmountOnExit: true } }}>
                {renderStep(index)}
              </StepContent>
            ) : null}
          </Step>
        ))}
      </Stepper>

      {!compact ? (
        <Box component="section" sx={{ width: '100%', mt: 3 }}>
          {renderStep(step)}
        </Box>
      ) : null}
    </Box>
  );

  function navigation(last = false) {
    return (
      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        {step > 0 ? (
          <Button onClick={() => setStep((current) => current - 1)}>Back</Button>
        ) : null}
        {last ? (
          <Button variant="contained" onClick={submit} disabled={submitting}>
            Generate
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => setStep((current) => current + 1)}
            disabled={!canContinue}
          >
            Next
          </Button>
        )}
      </Stack>
    );
  }

  function renderStep(index: number) {
    switch (index) {
      case 0:
        return (
          <Box>
            <TextField
              label="What do you want out of training?"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="In your own words. “Get stronger and look better” is a perfectly good answer."
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            {navigation()}
          </Box>
        );

      case 1:
        return (
          <Stack spacing={3}>
            <FormControl>
              <FormLabel id="experience-label">How much have you trained before?</FormLabel>
              <RadioGroup
                aria-labelledby="experience-label"
                value={experience}
                onChange={(event) =>
                  setExperience(event.target.value as 'BEGINNER' | 'INTERMEDIATE')
                }
              >
                <FormControlLabel
                  value="BEGINNER"
                  control={<Radio />}
                  label="New to it, or coming back"
                />
                <FormControlLabel
                  value="INTERMEDIATE"
                  control={<Radio />}
                  label="I've trained consistently before"
                />
              </RadioGroup>
            </FormControl>

            <Box>
              <FormLabel id="days-label">Days a week</FormLabel>
              <ToggleButtonGroup
                exclusive
                value={daysPerWeek}
                onChange={(_event, value: number | null) =>
                  value !== null && setDaysPerWeek(value)
                }
                aria-labelledby="days-label"
                sx={{ display: 'block', mt: 1 }}
              >
                {[2, 3, 4, 5].map((value) => (
                  <ToggleButton key={value} value={value} sx={{ minWidth: 56, minHeight: 44 }}>
                    {value}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Box>
              <FormLabel id="minutes-label">Minutes a session</FormLabel>
              <Slider
                value={minutesPerSession}
                onChange={(_event, value) => setMinutesPerSession(value as number)}
                min={20}
                max={75}
                step={5}
                marks
                valueLabelDisplay="on"
                aria-labelledby="minutes-label"
                sx={{ mt: 4 }}
              />
            </Box>

            {navigation()}
          </Stack>
        );

      case 2:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              What do you actually have access to? The plan only uses these.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {EQUIPMENT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  onClick={() => toggleEquipment(option.value)}
                  color={equipment.includes(option.value) ? 'primary' : 'default'}
                  variant={equipment.includes(option.value) ? 'filled' : 'outlined'}
                  aria-pressed={equipment.includes(option.value)}
                  sx={{ minHeight: 44 }}
                />
              ))}
            </Stack>

            {/* The photo PRE-SELECTS; it never overrides. A picture of one
                corner of a garage is evidence, not an inventory. */}
            <EquipmentPhotoStep
              onDetected={(detected) =>
                setEquipment((current) => [...new Set([...current, ...detected])])
              }
            />

            {navigation()}
          </Box>
        );

      default:
        return (
          <Stack spacing={3}>
            <TextField
              label="Anything you like or hate?"
              value={preferences}
              onChange={(event) => setPreferences(event.target.value)}
              fullWidth
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <TextField
              label="Anything your body can't do right now?"
              value={limitations}
              onChange={(event) => setLimitations(event.target.value)}
              fullWidth
              multiline
              minRows={2}
              helperText="Tell me about pain or injuries in plain words — I'll keep the plan conservative and won't diagnose."
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {navigation(true)}
          </Stack>
        );
    }
  }
}
