import { useState } from 'react';
import { Chip, CircularProgress, Popover, Typography } from '@mui/material';

import type { ProgressionSuggestion } from '../../../types';

interface ProgressionChipProps {
  suggestion: ProgressionSuggestion;
  onExplain: () => Promise<string>;
}

/**
 * The deterministic suggestion, and a tap for why.
 *
 * The LABEL is the rule's own answer and never a model's: the number is decided
 * before this renders. The explanation costs a request and the user's key, so
 * it is fetched on tap rather than for every movement on the screen.
 *
 * `first_session` and `insufficient_history` render nothing. "We have no
 * advice" is not worth a chip, and a chip that says "hold" on a movement
 * somebody has never done reads as a judgment about them.
 */
export function ProgressionChip({ suggestion, onExplain }: ProgressionChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sentence, setSentence] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (suggestion.reason === 'first_session' || suggestion.reason === 'insufficient_history') {
    return null;
  }

  const label =
    suggestion.action === 'increase'
      ? suggestion.suggestedWeightKg === null
        ? 'Make it harder'
        : `Suggest ${suggestion.suggestedWeightKg} kg`
      : suggestion.action === 'reduce'
        ? `Try ${suggestion.suggestedWeightKg} kg`
        : suggestion.currentWeightKg !== null
          ? `Hold ${suggestion.currentWeightKg} kg`
          : 'Hold';

  const open = async (event: React.MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget);

    if (sentence !== null) return;

    setLoading(true);
    try {
      setSentence(await onExplain());
    } catch {
      setSentence('No explanation available right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Chip
        label={label}
        color={suggestion.action === 'increase' ? 'primary' : 'default'}
        onClick={(event) => void open(event)}
        sx={{ minHeight: 32 }}
        data-testid="progression-chip"
      />
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Typography variant="body2" sx={{ p: 2, maxWidth: 320 }}>
          {loading ? <CircularProgress size={16} /> : sentence}
        </Typography>
      </Popover>
    </>
  );
}
