import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';

import { MEMORY_INSIGHT_CATEGORIES, type MemoryInsightCategory } from '../../types';
import { CATEGORY_LABELS } from './memoryCategories';

export default function AddMemoryInsightDialog({
  open,
  saving = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: { category: MemoryInsightCategory; statement: string }) => void;
}) {
  const [category, setCategory] = useState<MemoryInsightCategory>('COACHING_PREFERENCE');
  const [statement, setStatement] = useState('');

  const submit = () => {
    const trimmed = statement.trim();
    if (!trimmed) return;
    onSubmit({ category, statement: trimmed });
    setStatement('');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Tell the coach something about you</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Category"
            size="small"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as MemoryInsightCategory)
            }
          >
            {MEMORY_INSIGHT_CATEGORIES.map((key) => (
              <MenuItem key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Statement"
            placeholder="Morning workouts are more reliable for me than evening ones."
            value={statement}
            helperText={`${statement.length}/280`}
            slotProps={{ htmlInput: { maxLength: 280 } }}
            onChange={(event) => setStatement(event.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || statement.trim().length === 0}
          onClick={submit}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
