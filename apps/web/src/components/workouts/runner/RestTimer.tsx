import { useEffect, useState } from 'react';
import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';

interface RestTimerProps {
  /** When the set that started this rest was completed, as epoch millis. */
  startedAt: number;
  seconds: number;
  onSkip: () => void;
  onExtend: (seconds: number) => void;
}

/**
 * Rest, computed from timestamps rather than counted (issue #109, epic E09).
 *
 * THE SAME RULE THE SERVER-DERIVED COMMITMENT TIMER FOLLOWS, for the same
 * reason: a counter that decrements on an interval is wrong the moment the tab
 * is backgrounded, the phone sleeps, or the browser throttles timers — which is
 * every single set of a real workout, because people put the phone down. The
 * interval here only triggers a re-render; the remaining time is always
 * `seconds - (now - startedAt)`.
 *
 * `visibilitychange` is subscribed for the same reason: coming back to the tab
 * must show the truth immediately rather than on the next tick.
 */
export function RestTimer({ startedAt, seconds, onSkip, onExtend }: RestTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 250);

    document.addEventListener('visibilitychange', tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const remaining = Math.max(0, Math.ceil(seconds - (now - startedAt) / 1000));
  const done = remaining === 0;

  useEffect(() => {
    if (done && typeof navigator.vibrate === 'function') navigator.vibrate(200);
  }, [done]);

  return (
    <Box sx={{ mt: 2 }} data-testid="rest-timer">
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h6" component="p" aria-live="polite" sx={{ flex: 1 }}>
          {done ? 'Rest over' : `Rest ${remaining} s`}
        </Typography>
        <Button onClick={() => onExtend(30)} sx={{ minHeight: 44 }}>
          +30 s
        </Button>
        <Button onClick={onSkip} sx={{ minHeight: 44 }}>
          Skip rest
        </Button>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, ((seconds - remaining) / seconds) * 100)}
        sx={{ mt: 1 }}
        aria-hidden="true"
      />
    </Box>
  );
}
