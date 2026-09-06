import { forwardRef } from 'react';
import { FormControl, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';

import type { CoachingStyle } from '../../types';
import {
  COACHING_QUESTION,
  COACHING_STYLE_DESCRIPTIONS,
  COACHING_STYLE_LABELS,
  COACHING_TITLE,
} from './copy';
import { StepShell } from './StepShell';

const STYLES: CoachingStyle[] = ['GENTLE', 'BALANCED', 'DIRECT'];

export interface CoachingStyleStepProps {
  value: CoachingStyle;
  onChange: (value: CoachingStyle) => void;
}

/** Step 7 (PRD §20). Read by every persona that speaks to the user. */
export const CoachingStyleStep = forwardRef<HTMLHeadingElement, CoachingStyleStepProps>(
  function CoachingStyleStep({ value, onChange }, ref) {
    return (
      <StepShell ref={ref} title={COACHING_TITLE} question={COACHING_QUESTION}>
        <FormControl>
          <RadioGroup
            aria-label="Coaching style"
            value={value}
            onChange={(event) => onChange(event.target.value as CoachingStyle)}
          >
            {STYLES.map((style) => (
              <FormControlLabel
                key={style}
                value={style}
                control={<Radio />}
                sx={{ alignItems: 'flex-start', mb: 1.5 }}
                label={
                  <span>
                    <Typography variant="subtitle1" component="span" sx={{ display: 'block' }}>
                      {COACHING_STYLE_LABELS[style]}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {COACHING_STYLE_DESCRIPTIONS[style]}
                    </Typography>
                  </span>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
      </StepShell>
    );
  },
);
