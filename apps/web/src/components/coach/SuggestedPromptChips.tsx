import { Chip, Stack, Typography } from '@mui/material';

import type { SuggestedPrompt } from '../../types';

/**
 * PRD §66's seven chips, in the order the API returns them.
 *
 * NOT SORTED HERE. The order runs from planning through friction to
 * re-deciding, and a user scanning them left to right is walking that arc;
 * re-sorting would turn a designed sequence into a menu.
 */
export default function SuggestedPromptChips({
  prompts,
  disabled = false,
  onPick,
}: {
  prompts: SuggestedPrompt[];
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  if (prompts.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ p: 2 }} data-testid="suggested-prompts">
      <Typography variant="body2" color="text.secondary">
        Not sure where to start?
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {prompts.map((prompt) => (
          <Chip
            key={prompt.key}
            label={prompt.label}
            aria-label={prompt.label}
            variant="outlined"
            clickable
            disabled={disabled}
            onClick={() => onPick(prompt.text)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
