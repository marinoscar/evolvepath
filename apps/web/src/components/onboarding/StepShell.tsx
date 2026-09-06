import { forwardRef, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * The heading, question and body every step shares (issue #102, epic E04).
 *
 * The heading takes `tabIndex={-1}` and is focused by `OnboardingPage` on each
 * step change: without it a screen reader stays where the Next button used to
 * be and announces nothing, which on a nine-screen flow means nine silent
 * transitions.
 */
export interface StepShellProps {
  title: string;
  question?: string;
  children: ReactNode;
}

export const StepShell = forwardRef<HTMLHeadingElement, StepShellProps>(function StepShell(
  { title, question, children },
  ref,
) {
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography ref={ref} variant="h5" component="h1" tabIndex={-1} sx={{ outline: 'none' }}>
          {title}
        </Typography>
        {question && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            {question}
          </Typography>
        )}
      </Box>
      {children}
    </Stack>
  );
});
