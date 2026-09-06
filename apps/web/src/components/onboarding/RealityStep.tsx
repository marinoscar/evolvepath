import { forwardRef } from 'react';
import { Box, Chip } from '@mui/material';

import type { ObstacleKey } from '../../types';
import { OBSTACLE_LABELS, OBSTACLE_ORDER, REALITY_QUESTION, REALITY_TITLE } from './copy';
import { StepShell } from './StepShell';

export interface RealityStepProps {
  obstacles: ObstacleKey[];
  onToggle: (obstacle: ObstacleKey) => void;
}

/**
 * Step 4 (PRD §20).
 *
 * The chips carry `role="checkbox"` and `aria-checked` rather than relying on
 * MUI's filled/outlined variants: the selected state here is the whole answer,
 * and a treatment only a sighted user can read is not an answer at all.
 *
 * -----------------------------------------------------------------------------
 * `OTHER` IS A CHIP AND NOTHING MORE
 * -----------------------------------------------------------------------------
 * The obvious design puts a short text field behind it. There is nowhere to put
 * what the user types: `user_profiles.obstacles` is `String[]` of stable keys on
 * purpose — E07 groups avoidance patterns on them and a free-text entry would
 * split every cohort — and no other column means "the obstacle they described".
 *
 * A field whose contents are dropped on the next request is worse than not
 * asking: the user believes they have told us something. So the chip records
 * "something else", and E06's memory is where the sentence belongs, once there
 * is a coach to say it to.
 */
export const RealityStep = forwardRef<HTMLHeadingElement, RealityStepProps>(
  function RealityStep({ obstacles, onToggle }, ref) {
    return (
      <StepShell ref={ref} title={REALITY_TITLE} question={REALITY_QUESTION}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {OBSTACLE_ORDER.map((obstacle) => {
            const selected = obstacles.includes(obstacle);

            return (
              <Chip
                key={obstacle}
                label={OBSTACLE_LABELS[obstacle]}
                onClick={() => onToggle(obstacle)}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                role="checkbox"
                aria-checked={selected}
              />
            );
          })}
        </Box>
      </StepShell>
    );
  },
);
