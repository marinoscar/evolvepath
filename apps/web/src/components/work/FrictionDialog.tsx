import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { CommitmentCard, FrictionAnswer, FrictionIntervention } from '../../types';
import { useFriction } from '../../hooks/useFriction';
import { FRICTION_ANSWERS } from './frictionAnswers';
import { InterventionCard } from './InterventionCard';

interface FrictionDialogProps {
  open: boolean;
  commitment: Pick<CommitmentCard, 'id' | 'title' | 'rescheduleCount' | 'versions'>;
  onClose: () => void;
  onResolved: (intervention: FrictionIntervention) => void;
  onStart: (minutes: number, instruction: string) => void;
  onUseMinimum: () => void;
  onProtectedReschedule: (slot: { scheduledStart: string; scheduledEnd: string }) => void;
}

/**
 * "What's making it hard to start?" (VISION §9, epic E07).
 *
 * ONE DIALOG, TWO FACES. It asks, and then it becomes the answer in place
 * rather than closing and opening something else — the user is being asked this
 * because they are stuck, and a second modal is one more thing between them and
 * a ten-minute start.
 *
 * `fullScreen` below `sm` is a LOCAL layout choice inside this component. It is
 * not one of the five coupled breakpoint gates in CLAUDE.md, and it touches
 * none of them.
 */
export function FrictionDialog({
  open,
  commitment,
  onClose,
  onResolved,
  onStart,
  onUseMinimum,
  onProtectedReschedule,
}: FrictionDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const friction = useFriction(commitment.id);

  const [answer, setAnswer] = useState<FrictionAnswer | ''>('');
  const [text, setText] = useState('');

  // A fresh question each time it opens: the previous intervention belongs to
  // the answer that produced it.
  useEffect(() => {
    if (!open) return;

    setAnswer('');
    setText('');
    friction.reset();
    // Opening is the only trigger; `friction` is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsText = answer === 'OTHER';
  const canSend = answer !== '' && (!needsText || text.trim().length > 0);

  const submit = async () => {
    if (answer === '') return;

    await friction.submit(answer, text);
  };

  const intervention = friction.result?.intervention ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      aria-labelledby="friction-dialog-title"
    >
      <DialogTitle id="friction-dialog-title">
        {intervention ? 'Try this' : "What's making it hard to start?"}
      </DialogTitle>

      <DialogContent>
        {!intervention && (
          <>
            <DialogContentText sx={{ mb: 2 }}>
              You&apos;ve moved &ldquo;{commitment.title}&rdquo; {commitment.rescheduleCount}{' '}
              {commitment.rescheduleCount === 1 ? 'time' : 'times'}.
            </DialogContentText>

            <FormControl component="fieldset" fullWidth>
              <FormLabel component="legend">Choose the closest one</FormLabel>
              <RadioGroup
                value={answer}
                onChange={(event) => setAnswer(event.target.value as FrictionAnswer)}
              >
                {FRICTION_ANSWERS.map((option) => (
                  <FormControlLabel
                    key={option.key}
                    value={option.key}
                    control={<Radio data-testid={`friction-answer-${option.key}`} />}
                    label={option.label}
                  />
                ))}
              </RadioGroup>
            </FormControl>

            {needsText && (
              <TextField
                label="Tell the coach more"
                value={text}
                onChange={(event) => setText(event.target.value)}
                multiline
                minRows={2}
                fullWidth
                required
                sx={{ mt: 2 }}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            )}

            {friction.error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {friction.error}
              </Alert>
            )}
          </>
        )}

        {intervention && (
          <InterventionCard
            intervention={intervention}
            commitment={commitment}
            pending={friction.pending}
            onStart={onStart}
            onUseMinimum={onUseMinimum}
            onProtectedReschedule={onProtectedReschedule}
            onDismiss={() => {
              onResolved(intervention);
              onClose();
            }}
          />
        )}
      </DialogContent>

      {!intervention && (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!canSend || friction.pending}
            data-testid="friction-send"
            onClick={() => void submit()}
          >
            Send
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
