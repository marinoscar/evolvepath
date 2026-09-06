import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { acknowledgeMilestone, completeComeback } from '../services/api';
import { useIsMounted } from '../hooks/useIsMounted';
import { COMEBACK_COPY } from '../utils/comebackCopy';
import { FullScreen } from './ComebackPage';
import type { ComebackCompletion } from '../types';

/**
 * "Back on Path." (issue #119, epic E11).
 *
 * The one screen the whole epic exists to be able to show. VISION §32: "The
 * important part was not that you missed. It was that you returned."
 *
 * COMPLETING IS IDEMPOTENT BY REFUSAL, so a reload has to be handled here
 * rather than on the server: the second `POST /comeback/complete` is a 409, and
 * a page that treated that as an error would tell somebody their recovery
 * failed. The completion payload is kept in `sessionStorage` for exactly that
 * case — the celebration survives a refresh, and nothing sensitive is in it.
 */
const DONE_STORAGE_KEY = 'comeback.done';

function readStored(): ComebackCompletion | null {
  try {
    const raw = sessionStorage.getItem(DONE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ComebackCompletion) : null;
  } catch {
    return null;
  }
}

function store(result: ComebackCompletion): void {
  try {
    sessionStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // A private window with storage blocked still gets the screen; only the
    // reload case degrades, and it degrades to the same words.
  }
}

export default function ComebackDonePage() {
  const navigate = useNavigate();
  const isMounted = useIsMounted();
  const [result, setResult] = useState<ComebackCompletion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Guarded against React's double-invoked effects in development: a second
    // POST would be a 409 and, worse, a second `recovery` evidence row if the
    // server ever stopped refusing.
    if (ran.current) return;
    ran.current = true;

    const finish = async () => {
      const completion = await completeComeback().catch(() => null);
      const resolved = completion ?? readStored();

      if (completion) store(completion);
      if (isMounted()) {
        setResult(resolved);
        setIsLoading(false);
      }

      // Acknowledged HERE rather than left to the Progress toast: the user is
      // already reading it, and showing the same milestone again on `/progress`
      // is exactly the repetition PRD §77 rules out.
      if (completion?.milestone) {
        await acknowledgeMilestone(completion.milestone.id).catch(() => undefined);
      }
    };

    void finish();
  }, [isMounted]);

  useEffect(() => {
    if (!isLoading) headingRef.current?.focus();
  }, [isLoading]);

  if (isLoading) {
    return (
      <FullScreen>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="Recording your return" />
        </Box>
      </FullScreen>
    );
  }

  const next = result?.nextCommitment ?? null;

  return (
    <FullScreen>
      <Container maxWidth="sm" sx={{ py: 6 }} data-testid="comeback-done">
        <Typography variant="h4" component="h1" tabIndex={-1} ref={headingRef} gutterBottom>
          {COMEBACK_COPY.done.title}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {COMEBACK_COPY.done.body}
        </Typography>

        {result?.milestone && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {result.milestone.title} — {result.milestone.body}
          </Alert>
        )}

        <Card variant="outlined" sx={{ mb: 3 }} data-testid="comeback-next-commitment">
          <CardContent>
            <Typography variant="overline" color="text.secondary" component="h2">
              {COMEBACK_COPY.done.nextUp}
            </Typography>
            {next ? (
              <>
                {/* `component="p"`: MUI renders `subtitle1` as an `h6` by
                    default, which would jump h2 → h6 and fail heading order. */}
                <Typography variant="subtitle1" component="p">
                  {next.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(next.scheduledStart))}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {COMEBACK_COPY.done.nothingPlanned}
              </Typography>
            )}
          </CardContent>
        </Card>

        <Stack spacing={1.5}>
          {result?.planReviewSuggested && (
            <Button
              size="large"
              variant="outlined"
              color="inherit"
              sx={{ minHeight: 48 }}
              onClick={() =>
                navigate('/coach', { state: { prompt: COMEBACK_COPY.fellOffPrompt } })
              }
            >
              {COMEBACK_COPY.done.reviewPlan}
            </Button>
          )}
          <Button
            variant="contained"
            size="large"
            sx={{ minHeight: 48 }}
            onClick={() => navigate('/')}
          >
            {COMEBACK_COPY.done.backToToday}
          </Button>
        </Stack>
      </Container>
    </FullScreen>
  );
}
