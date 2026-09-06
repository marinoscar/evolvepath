import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type {
  MediaAttachment,
  MediaAskResult,
  MediaPurpose,
  MediaTargetType,
} from '../../types';
import { askAboutMedia } from '../../services/api';
import { MediaAttachmentPicker } from './MediaAttachmentPicker';
import { MediaAdviceCard } from './MediaAdviceCard';

interface AskAboutMediaDialogProps {
  open: boolean;
  onClose: () => void;
  purpose?: MediaPurpose;
  targetType?: MediaTargetType;
  targetId?: string;
  /** When given, step 1 is skipped — the media is already chosen. */
  attachment?: MediaAttachment;
  onAsked?: (attachment: MediaAttachment) => void;
}

const PURPOSES: ReadonlyArray<{
  value: MediaPurpose;
  label: string;
  helper: string;
  placeholder: string;
}> = [
  {
    value: 'WORKOUT_FORM',
    label: 'Workout form',
    helper: 'A set you filmed, or a position you want checked.',
    placeholder: 'Is my back rounding on the way up?',
  },
  {
    value: 'EQUIPMENT',
    label: 'Equipment',
    helper: 'What you have to train with, wherever you are.',
    placeholder: 'What can I train with here?',
  },
  {
    value: 'MEAL',
    label: 'Meal',
    helper: 'Habits, not calories. No numbers here.',
    placeholder: 'Is this a decent breakfast?',
  },
  {
    value: 'GENERAL',
    label: 'Something else',
    helper: 'Anything else you want a second look at.',
    placeholder: 'What am I looking at?',
  },
];

/**
 * Pick media, say what it is, ask a question (issue #96, epic #67).
 *
 * ONE dialog with three sections rather than a wizard: on a phone the whole
 * thing is one scrollable full-screen sheet, and a three-step wizard for
 * "picture, kind, question" is three taps of ceremony around one action.
 *
 * ⚠️ The `down('sm')` below is a LOCAL layout choice — it decides whether this
 * dialog is full-screen — and is **not** one of the five coupled breakpoint
 * gates in `common/Layout.tsx`.
 */
export function AskAboutMediaDialog({
  open,
  onClose,
  purpose: initialPurpose = 'GENERAL',
  targetType,
  targetId,
  attachment: providedAttachment,
  onAsked,
}: AskAboutMediaDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [purpose, setPurpose] = useState<MediaPurpose>(initialPurpose);
  const [attachment, setAttachment] = useState<MediaAttachment | null>(
    providedAttachment ?? null,
  );
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MediaAskResult | null>(null);
  const [snackbar, setSnackbar] = useState(false);

  // Reopening with a different attachment must not show the previous answer.
  useEffect(() => {
    if (!open) return;
    setAttachment(providedAttachment ?? null);
    setPurpose(providedAttachment?.purpose ?? initialPurpose);
    setQuestion('');
    setResult(null);
    setPending(false);
  }, [open, providedAttachment, initialPurpose]);

  const selected = PURPOSES.find((entry) => entry.value === purpose)!;
  const isReady = attachment?.processingStatus === 'ready';

  const handleAsk = async () => {
    if (!attachment) return;

    setPending(true);
    setResult(null);
    try {
      const answer = await askAboutMedia(attachment.id, question);
      setResult(answer);
      if (answer.ok) {
        onAsked?.({
          ...attachment,
          aiSummary: {
            ...answer.advice,
            askedAt: answer.askedAt,
            question: question.trim() || null,
            invocationId: answer.invocationId,
            promptVersion: 'media_analyst.v1',
            model: answer.model,
          },
        });
      }
    } catch (error) {
      setResult({
        ok: false,
        error: {
          code: 'request_failed',
          message:
            error instanceof Error
              ? error.message
              : 'That did not work. Try again.',
        },
      });
    } finally {
      setPending(false);
    }
  };

  const handleClose = () => {
    // Closing DOES NOT cancel the request. The answer lands on the attachment
    // either way, so cancelling would throw away work the user has paid for —
    // and they can read it in the library.
    if (pending) setSnackbar(true);
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        fullScreen={fullScreen}
        maxWidth="sm"
        fullWidth
        aria-labelledby="ask-about-media-title"
      >
        <DialogTitle id="ask-about-media-title">Ask the coach</DialogTitle>

        <DialogContent dividers>
          {result ? (
            <AnswerSection
              result={result}
              kind={attachment?.kind ?? 'PHOTO'}
              onRetry={() => void handleAsk()}
            />
          ) : (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle2" component="p" gutterBottom>
                  Media
                </Typography>
                {providedAttachment ? (
                  <Typography variant="body2" color="text.secondary">
                    {providedAttachment.kind === 'VIDEO' ? 'Video' : 'Photo'}
                    {providedAttachment.processingStatus === 'processing' &&
                      ' — still processing'}
                  </Typography>
                ) : (
                  <MediaAttachmentPicker
                    purpose={purpose}
                    targetType={targetType}
                    targetId={targetId}
                    maxFiles={1}
                    onAttached={([attached]) => setAttachment(attached)}
                  />
                )}
              </Box>

              <Box>
                <Typography variant="subtitle2" component="p" gutterBottom>
                  What is this?
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  value={purpose}
                  onChange={(_event, next) => next && setPurpose(next)}
                  aria-label="What is this?"
                  sx={{ flexWrap: 'wrap' }}
                >
                  {PURPOSES.map((entry) => (
                    <ToggleButton
                      key={entry.value}
                      value={entry.value}
                      data-testid={`media-purpose-${entry.value}`}
                    >
                      {entry.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 1 }}
                >
                  {selected.helper}
                </Typography>
              </Box>

              <TextField
                label="Question (optional)"
                multiline
                maxRows={4}
                fullWidth
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={selected.placeholder}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Stack>
          )}
        </DialogContent>

        <DialogActions>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button onClick={handleClose}>Cancel</Button>
              <Button
                variant="contained"
                data-testid="media-ask-button"
                disabled={!isReady || pending}
                onClick={() => void handleAsk()}
                startIcon={
                  pending ? <CircularProgress size={16} color="inherit" /> : null
                }
              >
                {pending
                  ? `Looking at your ${attachment?.kind === 'VIDEO' ? 'video' : 'photo'}…`
                  : 'Ask the coach'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar}
        autoHideDuration={6000}
        onClose={() => setSnackbar(false)}
        message="Still looking — check your media library"
      />
    </>
  );
}

/**
 * The answer, or the reason there isn't one.
 *
 * `no_user_key` is the one failure that is the USER'S to fix, so it gets a link
 * rather than a retry — retrying without a key produces the same answer, and
 * the difference between "the coach is unavailable" and "you have not added a
 * key" is the difference between waiting and acting.
 */
function AnswerSection({
  result,
  kind,
  onRetry,
}: {
  result: MediaAskResult;
  kind: MediaAttachment['kind'];
  onRetry: () => void;
}) {
  if (result.ok) {
    return (
      <MediaAdviceCard
        advice={result.advice}
        kind={kind}
        askedAt={result.askedAt}
      />
    );
  }

  if (result.error.code === 'no_user_key') {
    return (
      <Alert severity="info">
        <Typography variant="body2" sx={{ mb: 1 }}>
          The coach needs your own OpenAI key before it can look at this.
        </Typography>
        <Link component={RouterLink} to="/settings/ai-key">
          Add your key
        </Link>
      </Alert>
    );
  }

  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <Typography variant="body2">
        The coach couldn&rsquo;t answer this one.
      </Typography>
      <Typography variant="caption">{result.error.message}</Typography>
    </Alert>
  );
}
