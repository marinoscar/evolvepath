import { Box, Typography } from '@mui/material';

import { formatDuration } from '../../utils/commitmentTimer';

interface CountdownProps {
  /** Null for an open-ended session: the elapsed time is shown instead. */
  remaining: number | null;
  elapsed: number;
  running: boolean;
}

/**
 * The number.
 *
 * `aria-live` is on a SEPARATE, minute-resolution element rather than on the
 * digits. A polite region that changed every second would make a screen reader
 * read the clock aloud continuously and nothing else — the thing a silent timer
 * exists to avoid (PRD §28).
 *
 * "Paused" is spelled out rather than signalled by colour alone.
 */
export function Countdown({ remaining, elapsed, running }: CountdownProps) {
  const display = remaining === null ? formatDuration(elapsed) : formatDuration(remaining);
  const minutesLeft = remaining === null ? null : Math.ceil(remaining / 60);

  return (
    <Box sx={{ textAlign: 'center', my: 4 }}>
      <Typography
        role="timer"
        aria-label={remaining === null ? 'Time elapsed' : 'Time remaining'}
        data-testid="countdown"
        sx={{
          fontSize: 'clamp(3rem, 12vw, 6rem)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 300,
          lineHeight: 1,
          color: running ? 'text.primary' : 'text.secondary',
        }}
      >
        {display}
      </Typography>

      {/* Minute resolution, so assistive technology is told the state rather
          than read the clock. */}
      <Typography
        aria-live="polite"
        variant="body2"
        color="text.secondary"
        sx={{ mt: 1 }}
        data-testid="countdown-status"
      >
        {running
          ? minutesLeft === null
            ? 'Running'
            : `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} left`
          : 'Paused'}
      </Typography>
    </Box>
  );
}
