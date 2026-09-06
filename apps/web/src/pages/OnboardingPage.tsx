/**
 * `/onboarding` — the second gate a new user passes (issue #102, epic E04).
 *
 * FULL SCREEN BY ROUTE PLACEMENT, like `/setup/ai-key` and `/start/:id`: it
 * sits inside `ProtectedRoute` and `RequireAiKey` and outside
 * `NotificationProvider` and `Layout`, so there is no app bar, no rail, no
 * bottom bar and no SSE stream. That is the honest rendering of the situation —
 * none of those destinations has anything in it until this flow finishes, and
 * offering them would invite the user to bounce off the gate repeatedly.
 *
 * None of the five coupled breakpoint gates is touched. The dots-versus-labels
 * `useMediaQuery` below is local to this page and is NOT one of them; the page
 * mounts no shell component, so there is nothing to keep in step with.
 *
 * -----------------------------------------------------------------------------
 * THE SERVER IS THE ONLY STORE
 * -----------------------------------------------------------------------------
 * Every step PATCHes before the next one renders (`useOnboarding`), and the
 * wizard opens on `state.step`. Nothing is written to `localStorage`: PRD §19
 * gives this five to eight minutes on a phone, a phone locks, and "where was
 * I?" has to survive a different device as well as a different tab.
 *
 * `Back` moves the local step only and does NOT PATCH. The previous answers are
 * already saved; moving forward again re-saves them. A PATCH on Back would let
 * a user rewind their own `onboarding_step` past answers they had given.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  MobileStepper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import type {
  CoachingStyle,
  Domain,
  DomainReflections,
  HealthBaseline,
  ObstacleKey,
  OnboardingStep,
} from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useIsMounted } from '../hooks/useIsMounted';
import { useOnboarding } from '../hooks/useOnboarding';
import { useBrowserNotificationPermission } from '../hooks/useBrowserNotificationPermission';
import { requestBrowserNotificationPermission } from '../services/browserNotifications';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { CoachingStyleStep } from '../components/onboarding/CoachingStyleStep';
import { DomainsStep } from '../components/onboarding/DomainsStep';
import { HealthBaselineStep } from '../components/onboarding/HealthBaselineStep';
import { NotificationValueStep } from '../components/onboarding/NotificationValueStep';
import { PromiseStep } from '../components/onboarding/PromiseStep';
import { ProposalStep } from '../components/onboarding/ProposalStep';
import { RealityStep } from '../components/onboarding/RealityStep';
import { TimeRealityStep } from '../components/onboarding/TimeRealityStep';
import { VisionStep } from '../components/onboarding/VisionStep';
import { NOTIFICATIONS_FINISH, PROMISE_CTA, VISION_MIN_LENGTH } from '../components/onboarding/copy';

/** The nine screens, in order. Index + 1 is what the stepper announces. */
const STEP_ORDER: OnboardingStep[] = [
  'PROMISE',
  'VISION',
  'DOMAINS',
  'REALITY',
  'TIME',
  'HEALTH_BASELINE',
  'COACHING_STYLE',
  'PROPOSAL',
  'NOTIFICATIONS',
];

const STEP_LABELS: Record<OnboardingStep, string> = {
  PROMISE: 'Start',
  VISION: 'Vision',
  DOMAINS: 'Areas',
  REALITY: 'Reality',
  TIME: 'Time',
  HEALTH_BASELINE: 'Health',
  COACHING_STYLE: 'Style',
  PROPOSAL: 'Your Path',
  NOTIFICATIONS: 'Reminders',
  DONE: 'Done',
};

const DEFAULT_BASELINE: HealthBaseline = {
  experience: 'BEGINNER',
  daysPerWeek: 3,
  minutesPerSession: 30,
  equipment: [],
};

const DEFAULT_WEEKDAY_MINUTES = 30;

export default function OnboardingPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const isMounted = useIsMounted();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const compact = useMediaQuery(theme.breakpoints.down('sm'));

  const {
    state,
    step,
    isLoading,
    isSaving,
    error,
    clearError,
    goTo,
    start,
    saveAnswers,
    propose,
    skipAi,
    submitConfidence,
    approve,
  } = useOnboarding();

  // ---- local answer drafts -------------------------------------------------
  //
  // Seeded from the server on load and thereafter owned by the inputs. The
  // server copy is authoritative for RESUMING; while a step is on screen the
  // draft is what the user is typing, and re-seeding on every state change
  // would fight the keyboard.

  const [vision, setVision] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [reflections, setReflections] = useState<DomainReflections>({});
  const [obstacles, setObstacles] = useState<ObstacleKey[]>([]);
  const [minutes, setMinutes] = useState(DEFAULT_WEEKDAY_MINUTES);
  const [baseline, setBaseline] = useState<HealthBaseline>(DEFAULT_BASELINE);
  const [coachingStyle, setCoachingStyle] = useState<CoachingStyle>('BALANCED');
  const [seeded, setSeeded] = useState(false);

  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [declinedNotifications, setDeclinedNotifications] = useState(false);
  const { permission, refresh: refreshPermission } = useBrowserNotificationPermission();

  useEffect(() => {
    if (!state || seeded) return;

    setVision(state.answers.sixMonthVision ?? '');
    setDomains(state.answers.domains);
    setReflections(state.answers.domainReflections ?? {});
    setObstacles(state.answers.obstacles);
    setMinutes(state.answers.weekdayMinutes ?? DEFAULT_WEEKDAY_MINUTES);
    setBaseline(state.answers.healthBaseline ?? DEFAULT_BASELINE);
    setCoachingStyle(state.answers.coachingStyle);
    setSeeded(true);
  }, [state, seeded]);

  // Focus the heading on every step change. Without it a screen reader stays
  // where the Next button used to be and announces nothing — nine silent
  // transitions on a nine-screen flow.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const healthSelected = domains.includes('HEALTH');

  /** The steps this user actually sees — step 6 only when Health is selected. */
  const visibleSteps = useMemo(
    () => STEP_ORDER.filter((s) => s !== 'HEALTH_BASELINE' || healthSelected),
    [healthSelected],
  );

  const index = Math.max(visibleSteps.indexOf(step), 0);

  const goBack = useCallback(() => {
    const previous = visibleSteps[index - 1];
    if (previous) goTo(previous);
  }, [goTo, index, visibleSteps]);

  /** The next VISIBLE step. `DONE` is unreachable here — approve declares it. */
  const nextOf = useCallback(
    (current: OnboardingStep): Exclude<OnboardingStep, 'DONE'> => {
      const position = visibleSteps.indexOf(current);
      const next = visibleSteps[position + 1] ?? 'NOTIFICATIONS';

      return next as Exclude<OnboardingStep, 'DONE'>;
    },
    [visibleSteps],
  );

  // ---- the primary action, per step ---------------------------------------
  //
  // Every failure is swallowed here: the hook has already set the inline error
  // and reverted the optimistic step, and an unhandled rejection would be the
  // only other outcome.

  const advance = useCallback(
    (run: () => Promise<unknown>) => {
      void run().catch(() => undefined);
    },
    [],
  );

  const handlePrimary = useCallback(() => {
    switch (step) {
      case 'PROMISE':
        return advance(() =>
          start(
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            typeof navigator !== 'undefined' ? navigator.language : undefined,
          ),
        );
      case 'VISION':
        return advance(() =>
          saveAnswers({ step: 'DOMAINS', sixMonthVision: vision.trim() }),
        );
      case 'DOMAINS':
        return advance(() =>
          saveAnswers({ step: 'REALITY', domains, domainReflections: reflections }),
        );
      case 'REALITY':
        return advance(() => saveAnswers({ step: 'TIME', obstacles }));
      case 'TIME':
        return advance(() =>
          saveAnswers({ step: nextOf('TIME'), weekdayMinutes: minutes }),
        );
      case 'HEALTH_BASELINE':
        return advance(() =>
          saveAnswers({ step: 'COACHING_STYLE', healthBaseline: baseline }),
        );
      case 'COACHING_STYLE':
        return advance(() => saveAnswers({ step: 'PROPOSAL', coachingStyle }));
      default:
        return undefined;
    }
  }, [
    advance,
    baseline,
    coachingStyle,
    domains,
    minutes,
    nextOf,
    obstacles,
    reflections,
    saveAnswers,
    start,
    step,
    vision,
  ]);

  const primaryDisabled =
    isSaving ||
    (step === 'VISION' && vision.trim().length < VISION_MIN_LENGTH) ||
    (step === 'DOMAINS' && domains.length === 0);

  const primaryLabel = step === 'PROMISE' ? PROMISE_CTA : 'Next';

  const handleRequestPermission = useCallback(async () => {
    setIsRequestingPermission(true);
    try {
      await requestBrowserNotificationPermission();
    } finally {
      // Guarded: the prompt is modal and the user can navigate away while it is
      // open, so both of these can land after unmount.
      if (isMounted()) {
        setIsRequestingPermission(false);
        refreshPermission();
      }
    }
  }, [isMounted, refreshPermission]);

  const handleFinish = useCallback(async () => {
    // `refreshUser()` BEFORE `navigate('/')`, always. `RequireOnboarding`
    // (#106) reads `user.onboarding.completed`, so navigating on a stale user
    // bounces straight back here.
    await refreshUser();
    if (isMounted()) navigate('/', { replace: true });
  }, [isMounted, navigate, refreshUser]);

  // A completed user has no business here — a bookmark or a back button, not a
  // request to redo onboarding. The redirect lives in the page rather than in
  // the route so `/onboarding`'s exemption from `RequireOnboarding` cannot be
  // used to re-run the flow.
  const completed = state?.completed || user?.onboarding?.completed;

  if (!isLoading && completed && step !== 'NOTIFICATIONS') {
    return <RedirectHome navigate={navigate} />;
  }

  if (isLoading) return <LoadingSpinner fullScreen />;

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: { xs: 12, sm: 6 } }}>
      <Container maxWidth="sm" disableGutters={compact} sx={{ pt: { xs: 2, sm: 6 } }}>
        {compact ? (
          <MobileStepper
            variant="dots"
            steps={visibleSteps.length}
            position="static"
            activeStep={index}
            sx={{ bgcolor: 'transparent', justifyContent: 'center' }}
            nextButton={null}
            backButton={null}
            aria-label={`Step ${index + 1} of ${visibleSteps.length}`}
          />
        ) : (
          <Stepper activeStep={index} sx={{ mb: 4 }}>
            {visibleSteps.map((s) => (
              <Step key={s}>
                <StepLabel>{STEP_LABELS[s]}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}

        <Box aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {`Step ${index + 1} of ${visibleSteps.length}`}
        </Box>

        <Card variant={compact ? 'elevation' : 'outlined'} elevation={compact ? 0 : undefined}
          sx={{ bgcolor: compact ? 'transparent' : undefined, border: compact ? 'none' : undefined }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 4 } }}>
            {error && (
              <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {step === 'PROMISE' && <PromiseStep ref={headingRef} />}

            {step === 'VISION' && (
              <VisionStep ref={headingRef} value={vision} onChange={setVision} />
            )}

            {step === 'DOMAINS' && (
              <DomainsStep
                ref={headingRef}
                domains={domains}
                reflections={reflections}
                onToggle={(domain) =>
                  setDomains((current) =>
                    current.includes(domain)
                      ? current.filter((d) => d !== domain)
                      : [...current, domain],
                  )
                }
                onReflectionChange={(domain, value) =>
                  setReflections((current) => ({
                    ...current,
                    [domain.toLowerCase() as keyof DomainReflections]: value,
                  }))
                }
              />
            )}

            {step === 'REALITY' && (
              <RealityStep
                ref={headingRef}
                obstacles={obstacles}
                onToggle={(obstacle) =>
                  setObstacles((current) =>
                    current.includes(obstacle)
                      ? current.filter((o) => o !== obstacle)
                      : [...current, obstacle],
                  )
                }
              />
            )}

            {step === 'TIME' && (
              <TimeRealityStep ref={headingRef} minutes={minutes} onChange={setMinutes} />
            )}

            {step === 'HEALTH_BASELINE' && (
              <HealthBaselineStep ref={headingRef} baseline={baseline} onChange={setBaseline} />
            )}

            {step === 'COACHING_STYLE' && (
              <CoachingStyleStep
                ref={headingRef}
                value={coachingStyle}
                onChange={setCoachingStyle}
              />
            )}

            {step === 'PROPOSAL' && (
              <ProposalStep
                ref={headingRef}
                pendingProposal={state?.pendingProposal ?? null}
                proposalSource={state?.proposalSource ?? null}
                onPropose={propose}
                onSkipAi={skipAi}
                onSubmitConfidence={submitConfidence}
                onApprove={approve}
                onApproved={() => goTo('NOTIFICATIONS')}
                onAlreadyCompleted={() => navigate('/', { replace: true })}
              />
            )}

            {step === 'NOTIFICATIONS' && (
              <NotificationValueStep
                ref={headingRef}
                permission={permission}
                isRequesting={isRequestingPermission}
                declined={declinedNotifications}
                onRequestPermission={() => void handleRequestPermission()}
                onDecline={() => setDeclinedNotifications(true)}
              />
            )}
          </CardContent>
        </Card>

        {/* The primary action. Pinned to the bottom below `sm` (a thumb reaches
            it without scrolling past the keyboard) and inline above it. The
            proposal step owns its own actions — approving is not "Next". */}
        {step !== 'PROPOSAL' && (
          <Box
            sx={{
              position: { xs: 'fixed', sm: 'static' },
              bottom: 0,
              left: 0,
              right: 0,
              p: { xs: 2, sm: 0 },
              pt: { sm: 3 },
              pb: { xs: 'calc(16px + env(safe-area-inset-bottom))', sm: 0 },
              bgcolor: { xs: 'background.paper', sm: 'transparent' },
              borderTop: { xs: 1, sm: 0 },
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              {index > 0 && (
                <Button startIcon={<ArrowBackIcon />} onClick={goBack} disabled={isSaving}>
                  Back
                </Button>
              )}
              {step === 'NOTIFICATIONS' ? (
                <Button
                  variant="contained"
                  fullWidth={compact}
                  onClick={() => void handleFinish()}
                  sx={{ ml: 'auto' }}
                >
                  {NOTIFICATIONS_FINISH}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  fullWidth={compact}
                  onClick={handlePrimary}
                  disabled={primaryDisabled}
                  sx={{ ml: 'auto' }}
                >
                  {primaryLabel}
                </Button>
              )}
            </Stack>
          </Box>
        )}
      </Container>
    </Box>
  );
}

/** A redirect expressed as a render, so it happens after commit rather than during. */
function RedirectHome({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  useEffect(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  return <LoadingSpinner fullScreen />;
}
