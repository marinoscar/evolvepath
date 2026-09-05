import { Box, Chip, Stack, Typography } from '@mui/material';

import type { CoachReply } from '../../types';

/**
 * The coach asking what got in the way.
 *
 * The chosen option is sent as the user's next message rather than posted to
 * some answer endpoint: the answer belongs in the conversation, where the coach
 * reads it back and where the user can see what they said.
 */
export default function FrictionQuestion({
  question,
  disabled = false,
  onAnswer,
}: {
  question: NonNullable<CoachReply['friction_question']>;
  disabled?: boolean;
  onAnswer: (option: string) => void;
}) {
  return (
    <Box sx={{ mt: 1 }} data-testid="friction-question">
      <Typography variant="body2" gutterBottom>
        {question.prompt}
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {question.options.map((option) => (
          <Chip
            key={option}
            label={option}
            variant="outlined"
            clickable
            disabled={disabled}
            onClick={() => onAnswer(option)}
          />
        ))}
      </Stack>
    </Box>
  );
}
