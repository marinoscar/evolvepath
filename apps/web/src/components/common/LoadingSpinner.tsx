import { Box, CircularProgress } from '@mui/material';

interface LoadingSpinnerProps {
  fullScreen?: boolean;
  size?: number;
  /**
   * What is loading. Becomes the spinner's accessible name — see the note
   * below on why it is never allowed to be absent.
   */
  label?: string;
}

/**
 * THE LABEL IS NOT OPTIONAL TO THE SCREEN READER (#62).
 *
 * `CircularProgress` renders `role="progressbar"`, and a progressbar with no
 * accessible name is announced as an unnamed live region — the user is told
 * something is happening and not what. axe rates it `serious`, and the E02 e2e
 * suite caught it on whichever route happened to still be resolving its lazy
 * chunk when the snapshot ran: intermittent in the test, permanent for anyone
 * using a screen reader on a slow connection.
 *
 * So the prop has a default rather than being optional in effect. A caller with
 * something better to say ("Loading your plan") passes it; a caller with
 * nothing to add still gets a named progressbar.
 */
export function LoadingSpinner({
  fullScreen = false,
  size = 40,
  label = 'Loading',
}: LoadingSpinnerProps) {
  const spinner = <CircularProgress size={size} aria-label={label} />;

  if (fullScreen) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          width: '100vw',
        }}
      >
        {spinner}
      </Box>
    );
  }

  return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>{spinner}</Box>;
}
