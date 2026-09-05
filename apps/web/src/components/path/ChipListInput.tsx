import { useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';

interface ChipListInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  helperText?: string;
}

/**
 * A short list of short strings, entered one at a time.
 *
 * Enter commits the current text; Backspace on an empty field removes the last
 * chip — the two gestures every chip input has taught users to expect. Nothing
 * here is a combobox: there is no set of options to choose from, so an
 * autocomplete's listbox semantics would be a promise the control cannot keep.
 */
export function ChipListInput({ label, value, onChange, max = 10, helperText }: ChipListInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.length >= max || value.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...value, trimmed]);
    setDraft('');
  };

  return (
    <Box>
      <TextField
        label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        fullWidth
        size="small"
        disabled={value.length >= max}
        helperText={
          value.length >= max ? `${max} is the maximum` : (helperText ?? 'Press Enter to add')
        }
      />

      {value.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1 }}>
          {value.map((entry) => (
            <Chip
              key={entry}
              label={entry}
              size="small"
              onDelete={() => onChange(value.filter((item) => item !== entry))}
              // The delete button's accessible name is otherwise just "delete",
              // which is unusable when there are five of them.
              deleteIcon={undefined}
              aria-label={`${label}: ${entry}`}
            />
          ))}
        </Stack>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'none' }}>
        {value.length} of {max}
      </Typography>
    </Box>
  );
}

export default ChipListInput;
