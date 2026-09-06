import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { recordNotificationInteraction } from '../services/api';
import {
  parseSentInteractionId,
  stripAttributionParams,
} from '../utils/notificationLinks';

import { useStartSession } from '../hooks/useStartSession';
import { Countdown } from '../components/start/Countdown';
import { StepsList } from '../components/start/StepsList';
import { TIMER_PRESETS, TimerPicker } from '../components/start/TimerPicker';
import { CompleteDialog } from '../components/today/dialogs/CompleteDialog';
import { elapsedSeconds, formatDuration } from '../utils/commitmentTimer';

/** The "Continue another N?" offer when a session runs out (PRD §27). */
const CONTINUE_MINUTES = 15;

/** Fallback target when the commitment's own size is not one of the presets. */
const DEFAULT_MINUTES = 10;

/**
 * The Start screen (VISION §10, PRD §27/§28).
 *
 * FULL SCREEN, OUTSIDE `Layout` — no rail, no AppBar, no bottom bar, exactly
 * like `/activate`. PRD §11 allows an execution screen to replace the
 * navigation, and this is the one screen where anything else on it is a way out
 * of the thing the user just committed to.
 *
 * Leaving does NOT stop the timer, and there is deliberately no `beforeunload`
 * prompt. The server holds the session; Today shows the row with `Continue`.
 * A dialog asking "are you sure you want to leave?" would be the product
 * arguing with someone who has already decided.
 */
export default function StartFlowPage() {
  const { commitmentId } = useParams<{ commitmentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/';
  const session = useStartSession(commitmentId);

  /**
   * The coaching notification that sent the user here, if one did (#68).
   *
   * Read ONCE into a ref rather than from the params on every render, because
   * the params are stripped immediately below — otherwise the value would
   * vanish before the user pressed Begin, which is the only moment it is
   * actually needed.
   */
  const sentInteractionId = useRef<string | null>(
    parseSentInteractionId(`?${searchParams.toString()}`),
  );

  const [minutes, setMinutes] = useState<number>(DEFAULT_MINUTES);
  const [note, setNote] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);

  const commitment = session.commitment;

  // Seed the picker from the commitment's own size when that is one of the
  // presets — most starts are "the thing as planned", and making the user
  // re-pick it is a decision the screen already has the answer to.
  useEffect(() => {
    if (!commitment || chosen) return;

    const own = commitment.durationMinutes;
    setMinutes(
      (TIMER_PRESETS as readonly number[]).includes(own) ? own : DEFAULT_MINUTES,
    );
  }, [commitment, chosen]);

  useEffect(() => {
    if (session.error) setToast(session.error);
  }, [session.error]);

  /**
   * Landing here IS the open (#68).
   *
   * Recorded once, on mount, and the attribution params are stripped straight
   * afterwards so a refresh or a back navigation does not record a second open
   * for the same message. The ACTIONED is deliberately NOT recorded here — the
   * user has arrived at a timer, not started one, and counting an arrival as an
   * action would make every notification look like it worked.
   */
  useEffect(() => {
    const id = sentInteractionId.current;
    if (!id) return;

    void recordNotificationInteraction({ sentInteractionId: id, kind: 'OPENED' }).catch(
      () => {
        console.warn('Could not record a notification interaction');
      },
    );

    setSearchParams(stripAttributionParams(searchParams), { replace: true });
    // Mount only: the ref is read once and the params are cleared here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Begin, and record the action if a notification brought the user here.
   *
   * THIS is the honest moment for an ACTIONED on a start: the timer is running,
   * which is the behaviour the reminder was asking for.
   */
  const begin = useCallback(
    async (chosenMinutes: number) => {
      await session.begin(chosenMinutes);

      const id = sentInteractionId.current;
      if (!id) return;

      void recordNotificationInteraction({
        sentInteractionId: id,
        kind: 'ACTIONED',
        action: 'start',
      }).catch(() => {
        console.warn('Could not record a notification interaction');
      });
    },
    [session],
  );

  const elapsed = useMemo(
    () => elapsedSeconds(commitment?.timer ?? null, new Date()),
    // Recomputed whenever the countdown moves, which is what actually ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commitment?.timer, session.remaining],
  );

  if (session.isLoading) {
    return (
      <FullScreen>
        <CircularProgress aria-label="Loading" />
      </FullScreen>
    );
  }

  if (session.notFound || !commitment) {
    return (
      <FullScreen>
        <Container maxWidth="sm">
          <Typography variant="h5" component="h1" gutterBottom>
            That commitment is not here
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            It may have been completed, moved or removed.
          </Typography>
          <Button component={Link} to="/" variant="contained">
            Back to Today
          </Button>
        </Container>
      </FullScreen>
    );
  }

  const isStarted = commitment.status === 'STARTED';
  const outOfTime = session.remaining === 0;

  const finish = async (which: 'complete' | 'partial', body: { notes?: string | null; minutesSpent?: number | null }) => {
    const card = await session.finish(which, {
      ...body,
      // The distraction note rides along on the completion rather than becoming
      // its own record: focus-session data is E07's, and inventing half of it
      // here would leave a shape that epic has to migrate.
      notes: [body.notes, note.trim() ? `Distractions: ${note.trim()}` : null]
        .filter(Boolean)
        .join('\n') || null,
    });

    if (!card) return;

    // Where a finished session goes. Defaults to Today, which is every existing
    // caller and every deep link; the comeback flow (#119) sets it to its own
    // celebration screen. A one-line generalisation rather than a second copy
    // of this page.
    navigate(returnTo, {
      replace: true,
      state: {
        toast: `Recorded: ${card.minutesSpent ?? 0} minutes on ${card.title}`,
      },
    });
  };

  return (
    <FullScreen>
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <IconButton
            aria-label="Leave this session"
            onClick={() => navigate('/')}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <Typography variant="h5" component="h1" gutterBottom>
          {commitment.title}
        </Typography>

        {commitment.whyItMatters && (
          <Typography color="text.secondary" sx={{ mb: 2 }} data-testid="why-it-matters">
            Why it matters: {commitment.whyItMatters}
          </Typography>
        )}

        <StepsList steps={commitment.steps} instruction={commitment.versions.full.title} />

        {!isStarted ? (
          <>
            <TimerPicker
              minutes={minutes}
              onChange={(value) => {
                setChosen(true);
                setMinutes(value);
              }}
            />
            <Button
              variant="contained"
              size="large"
              fullWidth
              disabled={session.pending}
              onClick={() => void begin(minutes)}
              sx={{ minHeight: 48 }}
            >
              Begin {formatDuration(minutes * 60)}
            </Button>
          </>
        ) : (
          <>
            <Countdown
              remaining={session.remaining}
              elapsed={elapsed}
              running={session.running}
            />

            {outOfTime && (
              <Alert severity="success" sx={{ mb: 2 }} data-testid="time-is-up">
                Time is up. Keep going, or call it done — both count.
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {session.running ? (
                <Button
                  variant="outlined"
                  disabled={session.pending}
                  onClick={() => void session.pause()}
                  sx={{ minHeight: 44 }}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  disabled={session.pending}
                  onClick={() => void session.resume()}
                  sx={{ minHeight: 44 }}
                >
                  Continue
                </Button>
              )}

              {outOfTime && (
                <Button
                  variant="contained"
                  disabled={session.pending}
                  onClick={() => void session.resume(CONTINUE_MINUTES)}
                  sx={{ minHeight: 44 }}
                >
                  Continue another {CONTINUE_MINUTES}
                </Button>
              )}

              <Button
                variant={outOfTime ? 'outlined' : 'contained'}
                disabled={session.pending}
                onClick={() => setFinishOpen(true)}
                sx={{ minHeight: 44 }}
              >
                Done for now
              </Button>
            </Box>

            <TextField
              label="Anything pulling you away? (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              multiline
              minRows={2}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </>
        )}
      </Container>

      <CompleteDialog
        open={finishOpen}
        commitment={commitment}
        onClose={() => setFinishOpen(false)}
        onComplete={(body) => finish('complete', body)}
        onPartial={(body) => finish('partial', body)}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </FullScreen>
  );
}

/** The whole viewport, because this screen replaces the navigation. */
function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 600 }}>{children}</Box>
    </Box>
  );
}
