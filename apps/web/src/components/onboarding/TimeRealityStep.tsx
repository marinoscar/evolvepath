import { forwardRef } from 'react';
import { Box, Slider, Typography } from '@mui/material';

import { TIME_QUESTION, TIME_TITLE } from './copy';
import { StepShell } from './StepShell';

const MARKS = [15, 30, 45, 60, 90].map((value) => ({ value, label: `${value}` }));

export interface TimeRealityStepProps {
  minutes: number;
  onChange: (minutes: number) => void;
}

/** Step 5 (PRD §20). The number every guardrail in the flow is measured against. */
export const TimeRealityStep = forwardRef<HTMLHeadingElement, TimeRealityStepProps>(
  function TimeRealityStep({ minutes, onChange }, ref) {
    const hours = Math.round((minutes * 5) / 6) / 10;

    return (
      <StepShell ref={ref} title={TIME_TITLE} question={TIME_QUESTION}>
        <Box sx={{ px: 1 }}>
          <Typography variant="h4" component="p" sx={{ textAlign: 'center' }}>
            {minutes} min
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
            {`≈ ${hours} hours a week`}
          </Typography>
          <Slider
            value={minutes}
            onChange={(_event, value) => onChange(Array.isArray(value) ? value[0] : value)}
            min={10}
            max={120}
            step={5}
            marks={MARKS}
            valueLabelDisplay="auto"
            aria-label="Minutes on a normal weekday"
          />
        </Box>
      </StepShell>
    );
  },
);
