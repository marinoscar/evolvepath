import { forwardRef } from 'react';
import { TextField } from '@mui/material';

import { VISION_HELPER, VISION_MIN_LENGTH, VISION_QUESTION, VISION_TITLE } from './copy';
import { StepShell } from './StepShell';

export interface VisionStepProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Step 2 (PRD §20). Text only.
 *
 * PRD §125's voice input is P1 and deliberately not here — the field is left
 * with room for a mic button rather than shipping half of one.
 */
export const VisionStep = forwardRef<HTMLHeadingElement, VisionStepProps>(function VisionStep(
  { value, onChange },
  ref,
) {
  const short = value.trim().length > 0 && value.trim().length < VISION_MIN_LENGTH;

  return (
    <StepShell ref={ref} title={VISION_TITLE} question={VISION_QUESTION}>
      <TextField
        label="Six months from now"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        multiline
        minRows={5}
        fullWidth
        autoFocus
        helperText={
          short ? `A little more — ${VISION_MIN_LENGTH} characters or so.` : VISION_HELPER
        }
        slotProps={{ htmlInput: { maxLength: 4000, 'aria-describedby': undefined } }}
      />
    </StepShell>
  );
});
