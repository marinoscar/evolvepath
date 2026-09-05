import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { CommitmentInput, Domain, Outcome, Routine } from '../../types';
import { toIsoWithOffset } from './TransitionDialog';

interface CommitmentFormDialogProps {
  open: boolean;
  outcome: Outcome;
  planVersionId: string | null;
  routines: Routine[];
  onClose: () => void;
  onSave: (input: CommitmentInput) => Promise<unknown>;
}

const SCALE_MARKS = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));

/** Now, rounded up to the next half hour, as a `datetime-local` value. */
function defaultStart(): string {
  const when = new Date();
  when.setMinutes(when.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export function CommitmentFormDialog({
  open,
  outcome,
  planVersionId,
  routines,
  onClose,
  onSave,
}: CommitmentFormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [importance, setImportance] = useState(3);
  const [routineId, setRoutineId] = useState('');
  const [fullVersion, setFullVersion] = useState('');
  const [shortVersion, setShortVersion] = useState('');
  const [minimumVersion, setMinimumVersion] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setStart(defaultStart());
    setEnd('');
    setImportance(outcome.importance);
    setRoutineId('');
    setFullVersion('');
    setShortVersion('');
    setMinimumVersion('');
    setSubmitted(false);
    setError(null);
  }, [open, outcome.importance]);

  const titleError = submitted && !title.trim();
  const endError = submitted && Boolean(end) && Boolean(start) && new Date(end) <= new Date(start);

  const handleSave = async () => {
    setSubmitted(true);
    if (!title.trim() || !start) return;
    if (end && new Date(end) <= new Date(start)) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        domain: outcome.domain as Domain,
        title: title.trim(),
        // Wall-clock text from the input, resolved through the browser's own
        // timezone into an instant — see `toIsoWithOffset`.
        scheduledStart: toIsoWithOffset(start),
        scheduledEnd: end ? toIsoWithOffset(end) : null,
        importance,
        outcomeId: outcome.id,
        // A routine cannot be attached without the version it belongs to; the
        // API rejects that combination, so both travel together or neither does.
        ...(routineId && planVersionId ? { planVersionId, routineId } : {}),
        fullVersion: fullVersion.trim() || null,
        shortVersion: shortVersion.trim() || null,
        minimumVersion: minimumVersion.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the commitment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      aria-labelledby="commitment-dialog-title"
    >
      <DialogTitle id="commitment-dialog-title">New commitment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="What will you do?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            fullWidth
            autoFocus
            error={titleError}
            helperText={titleError ? 'A title is required' : undefined}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Starts"
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Ends"
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              fullWidth
              error={endError}
              helperText={endError ? 'Must be after the start' : 'Optional'}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <div>
            <Typography id="commitment-importance-label" gutterBottom>
              How much does this one matter?
            </Typography>
            <Slider
              value={importance}
              onChange={(_, value) => setImportance(value as number)}
              min={1}
              max={5}
              step={1}
              marks={SCALE_MARKS}
              valueLabelDisplay="auto"
              aria-labelledby="commitment-importance-label"
            />
          </div>

          {routines.length > 0 && (
            <TextField
              select
              label="From a routine"
              value={routineId}
              onChange={(event) => setRoutineId(event.target.value)}
              fullWidth
              helperText="Optional — links this to the plan it came from"
            >
              <MenuItem value="">Not from a routine</MenuItem>
              {routines.map((routine) => (
                <MenuItem key={routine.id} value={routine.id}>
                  {routine.title}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* The three sizes of one intention (PRD §57). The minimum version is
              what keeps the streak alive on a bad day. */}
          <TextField
            label="Full version"
            value={fullVersion}
            onChange={(event) => setFullVersion(event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="Short version"
            value={shortVersion}
            onChange={(event) => setShortVersion(event.target.value)}
            fullWidth
            helperText="For a tight day"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="Minimum version"
            value={minimumVersion}
            onChange={(event) => setMinimumVersion(event.target.value)}
            fullWidth
            helperText="The smallest thing that still counts"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CommitmentFormDialog;
