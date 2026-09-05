import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { ReflectionQuickOption } from '../../types';
import { REFLECTION_OPTIONS, REFLECTION_OPTION_LABELS } from './todayLabels';

interface ReflectionPromptProps {
  onSubmit: (input: {
    quickOption: ReflectionQuickOption;
    text?: string | null;
  }) => Promise<unknown>;
}

/** The hour after which the day is done enough to look back on. */
export const REFLECTION_HOUR = 18;

/** Per-day, per-browser. Answering twice is allowed; being ASKED twice is not. */
export function reflectionDismissedKey(dateLocal: string): string {
  return `today.reflection.${dateLocal}`;
}

/**
 * "Anything EvolvePath should learn from today?" (PRD §74).
 *
 * One tap is a complete answer; the text box is optional. PRD §74 wants
 * "structured friction data", and the structure is the chip — the sentence is
 * for the user and their coach.
 *
 * Dismissal lives in `localStorage` rather than on the server, and that is the
 * right trade for this one flag: it is a per-device convenience about whether a
 * card is on screen, not a fact about the user's day. The reflection itself is
 * persisted properly.
 */
export function ReflectionPrompt({ onSubmit }: ReflectionPromptProps) {
  const [option, setOption] = useState<ReflectionQuickOption | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!option) return;
    setSaving(true);
    try {
      await onSubmit({ quickOption: option, text: text.trim() ? text.trim() : null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card sx={{ mt: 2 }} data-testid="reflection-prompt">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Anything EvolvePath should learn from today?
        </Typography>

        <Box
          role="radiogroup"
          aria-label="What today was like"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 1.5 }}
        >
          {REFLECTION_OPTIONS.map((value) => (
            <Chip
              key={value}
              label={REFLECTION_OPTION_LABELS[value]}
              role="radio"
              aria-checked={option === value}
              color={option === value ? 'primary' : 'default'}
              variant={option === value ? 'filled' : 'outlined'}
              onClick={() => setOption(value)}
            />
          ))}
        </Box>

        <Stack spacing={2}>
          <TextField
            label="In your words (optional)"
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          <Box>
            <Button
              variant="contained"
              onClick={() => void submit()}
              disabled={saving || !option}
            >
              Save
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
