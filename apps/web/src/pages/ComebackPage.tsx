import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';

import { useComeback } from '../hooks/useComeback';
import { COMEBACK_COPY, stepIndicator } from '../utils/comebackCopy';
import { DOMAIN_LABELS } from '../types';
import type { Domain } from '../types';

/**
 * The comeback flow (issue #119, epic E11).
 *
 * PRD §57's three screens, full-screen and OUTSIDE `Layout` — like
 * `/start/:commitmentId` and `/activate`. PRD §11 lets a flow replace the
 * navigation, and "replace" is achieved by never mounting it rather than by a
 * gate that remembers to turn it off; none of the five coupled breakpoint gates
 * is touched.
 *
 * THERE IS NOTHING ON THIS PAGE THAT LISTS WHAT THE USER MISSED. The API has no
 * field for it (PRD §109), and this screen is the reason: somebody returning
 * after four days is met with one small thing, not a reckoning.
 *
 * The step is DERIVED from the server's state on load, so a reload lands where
 * the user was rather than at the beginning of an apology.
 */
export default function ComebackPage() {
  const navigate = useNavigate();
  const { status, isLoading, error, choose, start, dismiss } = useComeback();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [initialised, setInitialised] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!status || initialised) return;
    setStep(status.state === 'IN_PROGRESS' ? 3 : 1);
    setInitialised(true);
  }, [status, initialised]);

  // Focus follows the step, so a keyboard or screen-reader user is put at the
  // new question rather than left at the button they just pressed.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (isLoading) {
    return (
      <FullScreen>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      </FullScreen>
    );
  }

  if (!status || status.state === 'NONE') {
    return (
      <FullScreen>
        <Container maxWidth="sm" sx={{ py: 6 }}>
          <Typography variant="h5" component="h1" gutterBottom>
            {COMEBACK_COPY.nothingToRestart}
          </Typography>
          <Button component={Link} to="/" variant="contained">
            {COMEBACK_COPY.done.backToToday}
          </Button>
        </Container>
      </FullScreen>
    );
  }

  const restart = status.restart;

  return (
    <FullScreen>
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Typography variant="overline" color="text.secondary" component="p">
          {stepIndicator(step)}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* One live region for the whole flow: it announces the question the
            user has just been moved to, once, rather than every card. */}
        <Box aria-live="polite">
          {step === 1 && (
            <Box data-testid="comeback-step-1">
              <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef} gutterBottom>
                {COMEBACK_COPY.step1.title}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 1 }}>
                {COMEBACK_COPY.step1.body}
              </Typography>
              {status.trigger === 'INACTIVITY' && status.idleDays !== null && (
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                  {COMEBACK_COPY.step1.idle(status.idleDays)}
                </Typography>
              )}

              <Stack spacing={1.5} sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => setStep(2)}
                  sx={{ minHeight: 48 }}
                >
                  {COMEBACK_COPY.step1.continueLabel}
                </Button>
                {/* `color="inherit"`: MUI's primary blue on the default
                    background is 4.22:1, under WCAG AA. A secondary action
                    reading in body ink is both accessible and more honest
                    about its weight. */}
                <Button
                  size="large"
                  color="inherit"
                  onClick={async () => {
                    await dismiss();
                    navigate('/');
                  }}
                  sx={{ minHeight: 48 }}
                >
                  {COMEBACK_COPY.step1.dismissLabel}
                </Button>
              </Stack>
            </Box>
          )}

          {step === 2 && (
            <Box data-testid="comeback-step-2">
              <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef} gutterBottom>
                {COMEBACK_COPY.step2.title}
              </Typography>

              <Stack spacing={2} sx={{ mt: 3 }}>
                {status.recommendation && restart && (
                  <Card variant="outlined" data-testid="comeback-recommended">
                    <CardContent>
                      <Stack spacing={1}>
                        {/* The chip's TEXT is what says "recommended"; the
                            outline alone would be colour-only (PRD §122). */}
                        <Box>
                          <Chip size="small" label={COMEBACK_COPY.step2.recommendedChip} />
                        </Box>
                        <Typography variant="h6" component="h2">
                          {restart.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {status.recommendation.reason}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {status.alternatives.map((alternative) => (
                  <Card key={alternative.domain} variant="outlined">
                    <CardActionArea
                      onClick={async () => {
                        await choose(alternative.domain as Domain);
                        await start();
                        setStep(3);
                      }}
                      sx={{ minHeight: 48 }}
                      data-testid={`comeback-choose-${alternative.domain}`}
                      aria-label={`${COMEBACK_COPY.step2.chooseLabel} ${
                        DOMAIN_LABELS[alternative.domain]
                      }`}
                    >
                      <CardContent>
                        <Typography variant="subtitle1" component="h2">
                          {DOMAIN_LABELS[alternative.domain]}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {alternative.title} · {alternative.minutes} min
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}

                <Button
                  variant="contained"
                  size="large"
                  onClick={async () => {
                    await start();
                    setStep(3);
                  }}
                  sx={{ minHeight: 48 }}
                  data-testid="comeback-take-recommendation"
                >
                  {COMEBACK_COPY.step2.takeRecommendation}
                </Button>
              </Stack>
            </Box>
          )}

          {step === 3 && restart && (
            <Box data-testid="comeback-step-3">
              <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef} gutterBottom>
                {restart.title}
              </Typography>
              <Typography color="text.secondary">
                {restart.durationMinutes} min · {DOMAIN_LABELS[restart.domain]}
              </Typography>

              {/* "Why it matters" lives on the Start screen, which fetches the
                  outcome's motivation; repeating it here would be a second
                  source for the same sentence. */}
              <Typography color="text.secondary" sx={{ mt: 2 }}>
                {status.wording.note}
              </Typography>

              <Stack spacing={1.5} sx={{ mt: 4 }}>
                <Button
                  variant="contained"
                  size="large"
                  sx={{ minHeight: 48 }}
                  data-testid="comeback-start"
                  onClick={() =>
                    navigate(`/start/${restart.id}`, {
                      // The Start flow is the ordinary execution screen; the
                      // only comeback-specific thing about it is where it goes
                      // afterwards.
                      state: { returnTo: '/comeback/done' },
                    })
                  }
                >
                  {COMEBACK_COPY.step3.startLabel}
                </Button>
                <Button
                  size="large"
                  color="inherit"
                  sx={{ minHeight: 48 }}
                  onClick={() => setStep(2)}
                >
                  {COMEBACK_COPY.step3.changeLabel}
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Container>
    </FullScreen>
  );
}

/** The same shell `StartFlowPage` uses — full viewport, no shell, centred. */
export function FullScreen({ children }: { children: React.ReactNode }) {
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
