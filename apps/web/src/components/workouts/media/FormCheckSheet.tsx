import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  SwipeableDrawer,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { formCheck } from '../../../services/api';
import type { FormCheckResult } from '../../../types';
import { MediaCapture } from '../../health/media/MediaCapture';
import { FormCheckResultCard } from '../../health/media/HealthMediaResultCard';

interface FormCheckSheetProps {
  open: boolean;
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  setNumber?: number;
  onClose: () => void;
}

/**
 * "Check my form", from inside the workout (issue #111, epic E09).
 *
 * A sheet over the runner rather than a route: the session stays mounted
 * behind it and the rest timer keeps running, which is the difference between
 * asking a question mid-workout and leaving the workout to ask one.
 *
 * The bottom-sheet-below-`sm` choice is this component's own layout decision
 * and NOT a sixth entry in the shell's five coupled gates — the runner mounts
 * no shell at all.
 */
export function FormCheckSheet({
  open,
  sessionId,
  exerciseId,
  exerciseName,
  setNumber,
  onClose,
}: FormCheckSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));

  const [storageObjectId, setStorageObjectId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<FormCheckResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const ask = async () => {
    if (!storageObjectId) return;

    setAsking(true);
    setError(null);

    try {
      const response = await formCheck(sessionId, { storageObjectId, exerciseId, setNumber });

      if (response.ok) setResult(response.result);
      else setError(response.error);
    } catch (err) {
      setError({
        code: 'network',
        message: err instanceof Error ? err.message : 'That did not go through.',
      });
    } finally {
      setAsking(false);
    }
  };

  const body = (
    <Box>
      {result ? (
        <FormCheckResultCard result={result} />
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A few seconds of one set, filmed from the side. I will describe what I can see — I do
            not diagnose anything.
          </Typography>

          <MediaCapture
            label="Record a video of your set"
            accept="video/*"
            capture="environment"
            disabled={asking}
            onUploaded={(id) => setStorageObjectId(id)}
          />

          {storageObjectId ? (
            <Button
              variant="contained"
              sx={{ mt: 2, minHeight: 44 }}
              disabled={asking}
              onClick={() => void ask()}
              startIcon={asking ? <CircularProgress size={16} /> : undefined}
            >
              Ask the coach
            </Button>
          ) : null}
        </>
      )}

      {error ? (
        <Alert
          severity={error.code === 'no_user_key' ? 'info' : 'error'}
          sx={{ mt: 2 }}
          action={
            error.code === 'no_user_key' ? (
              <Button component={RouterLink} to="/settings/ai-key" size="small">
                Add a key
              </Button>
            ) : (
              <Button size="small" onClick={() => void ask()}>
                Try again
              </Button>
            )
          }
        >
          {error.code === 'no_user_key'
            ? 'Looking at video uses your own OpenAI key.'
            : error.message}
        </Alert>
      ) : null}
    </Box>
  );

  const title = `Check my form · ${exerciseName}`;

  if (isPhone) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        onOpen={() => undefined}
        disableSwipeToOpen
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
      >
        <Box sx={{ p: 2, pb: 4 }} role="dialog" aria-labelledby="form-check-title">
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" component="h2" id="form-check-title" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <IconButton aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
          {body}
        </Box>
      </SwipeableDrawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="form-check-title">
      <DialogTitle id="form-check-title">{title}</DialogTitle>
      <DialogContent>{body}</DialogContent>
    </Dialog>
  );
}
