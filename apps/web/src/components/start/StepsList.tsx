import { Box, Typography } from '@mui/material';

import type { CommitmentVersionView } from '../../types';

interface StepsListProps {
  steps: CommitmentVersionView[] | null;
  /** Shown when there are no steps — the one-sentence instruction (PRD §27). */
  instruction: string;
}

/**
 * What to actually do.
 *
 * An ordered list when a decomposition was applied, one sentence otherwise. PRD
 * §27 asks for the sentence specifically: a Start screen with a timer and no
 * instruction leaves the user to remember what they meant, which is the state
 * they opened this screen to get out of.
 */
export function StepsList({ steps, instruction }: StepsListProps) {
  if (!steps || steps.length === 0) {
    return (
      <Typography sx={{ mb: 2 }} data-testid="start-instruction">
        {instruction}
      </Typography>
    );
  }

  return (
    <Box sx={{ mb: 2 }} data-testid="start-steps">
      <Typography variant="subtitle2" gutterBottom>
        The steps
      </Typography>
      <Box component="ol" sx={{ pl: 3, m: 0 }}>
        {steps.map((step, index) => (
          <Typography key={`${step.title}-${index}`} component="li" sx={{ mb: 0.5 }}>
            {step.title}{' '}
            <Typography component="span" variant="caption" color="text.secondary">
              · {step.minutes} min
            </Typography>
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
