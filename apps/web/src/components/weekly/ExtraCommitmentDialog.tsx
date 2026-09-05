import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';

import type { Domain, ExtraCommitment } from '../../types';

const DOMAINS: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

/** Adding something the routines do not cover (PRD §50 step 5). */
export default function ExtraCommitmentDialog({
  open,
  weekDates,
  onClose,
  onAdd,
}: {
  open: boolean;
  /** The seven local dates of the week being planned. */
  weekDates: string[];
  onClose: () => void;
  onAdd: (extra: ExtraCommitment) => void;
}) {
  const [domain, setDomain] = useState<Domain>('WORK');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(weekDates[0] ?? '');
  const [startTime, setStartTime] = useState('09:00');
  const [minutes, setMinutes] = useState(30);
  const [recurring, setRecurring] = useState(false);

  const submit = () => {
    onAdd({
      domain,
      title: title.trim(),
      date,
      startTime,
      estimatedMinutes: minutes,
      minimumVersion: null,
      recurring,
    });

    setTitle('');
    setRecurring(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add a commitment</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value as Domain)}
          >
            {DOMAINS.map((option) => (
              <MenuItem key={option} value={option}>
                {option.charAt(0) + option.slice(1).toLowerCase()}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="What are you committing to?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            autoFocus
          />

          <TextField
            select
            label="Day"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          >
            {weekDates.map((option) => (
              <MenuItem key={option} value={option}>
                {formatDay(option)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Time"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <TextField
            label="Minutes"
            type="number"
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 480 } }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
              />
            }
            // The switch is what the load check counts: one-off commitments are
            // not habits, and counting them would fire the PRD §48 warning on a
            // week that only has a dentist appointment in it.
            label="This is a habit I want to repeat"
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={title.trim().length === 0} onClick={submit}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * "Mon 7 Sep". Built from the parts, never `new Date('YYYY-MM-DD')` — that
 * parses as UTC midnight and renders the previous day west of Greenwich.
 */
export function formatDay(dateLocal: string): string {
  const [year, month, day] = dateLocal.split('-').map(Number);

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day));
}
