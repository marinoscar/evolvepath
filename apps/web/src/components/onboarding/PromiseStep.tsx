import { forwardRef } from 'react';
import { Typography } from '@mui/material';

import { PROMISE_BODY, PROMISE_TITLE } from './copy';
import { StepShell } from './StepShell';

/** Step 1 (PRD §20). No question and no input — a promise, and one button. */
export const PromiseStep = forwardRef<HTMLHeadingElement>(function PromiseStep(_props, ref) {
  return (
    <StepShell ref={ref} title={PROMISE_TITLE}>
      <Typography variant="body1" color="text.secondary">
        {PROMISE_BODY}
      </Typography>
    </StepShell>
  );
});
