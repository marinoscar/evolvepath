import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { CONFIDENCE_HIGH_LABEL, CONFIDENCE_LOW_LABEL, CONFIDENCE_QUESTION } from './copy';

export interface ConfidenceQuestionProps {
  value: number | null;
  disabled?: boolean;
  onChange: (score: number) => void;
}

/**
 * PRD §72's check, asked before the plan is activated (issue #104, epic E04).
 *
 * A `radiogroup`, not five checkboxes: exactly one answer is possible, and the
 * ends are labelled rather than the middle because "3" means nothing on its own.
 */
export function ConfidenceQuestion({ value, disabled, onChange }: ConfidenceQuestionProps) {
  return (
    <Box component="section" aria-labelledby="confidence-question">
      {/* `component="h2"`: MUI maps `subtitle1` to `<h6>`, which lands
          after the sections' `<h2>`s and breaks heading order. */}
      <Typography id="confidence-question" variant="subtitle1" component="h2" sx={{ mb: 1.5 }}>
        {CONFIDENCE_QUESTION}
      </Typography>

      <ToggleButtonGroup
        exclusive
        value={value}
        disabled={disabled}
        onChange={(_event, next) => next != null && onChange(next)}
        aria-labelledby="confidence-question"
        sx={{ display: 'flex' }}
      >
        {[1, 2, 3, 4, 5].map((score) => (
          <ToggleButton key={score} value={score} sx={{ flex: 1 }} aria-label={String(score)}>
            {score}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {CONFIDENCE_LOW_LABEL}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {CONFIDENCE_HIGH_LABEL}
        </Typography>
      </Box>
    </Box>
  );
}
