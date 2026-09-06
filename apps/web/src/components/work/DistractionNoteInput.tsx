import { useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';

interface DistractionNoteInputProps {
  notes: string[];
  disabled?: boolean;
  onAdd: (text: string) => void;
}

/**
 * "Anything pulling you away?" (PRD §28), saved the moment it is typed.
 *
 * SERVER-SIDE, unlike the textarea it replaces. E05-05 kept these in React
 * state and a reload lost them — and the user types these while distracted,
 * which is exactly when a tab gets reloaded or a phone locks.
 */
export function DistractionNoteInput({
  notes,
  disabled = false,
  onAdd,
}: DistractionNoteInputProps) {
  const [text, setText] = useState('');

  const add = () => {
    if (!text.trim()) return;

    onAdd(text.trim());
    setText('');
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Distraction note (optional)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              add();
            }
          }}
          fullWidth
          size="small"
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: 280, 'data-testid': 'focus-note-input' } }}
        />
        <Button
          variant="outlined"
          disabled={disabled || !text.trim()}
          onClick={add}
          sx={{ minHeight: 40 }}
        >
          Add
        </Button>
      </Stack>

      {notes.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {notes.map((note, index) => (
            <Chip key={`${note}-${index}`} size="small" variant="outlined" label={note} />
          ))}
        </Stack>
      )}

      {notes.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Noting what pulled you away is data, not a confession.
        </Typography>
      )}
    </Box>
  );
}
