import { Alert, Snackbar } from '@mui/material';

import type { Milestone } from '../../types';

/**
 * One celebration, once (issue #117, epic E11).
 *
 * PRD §77: "avoid constant confetti". So this is a `Snackbar` with a sentence —
 * no confetti, no sound, no animation beyond the default slide. The milestone
 * copy names the evidence ("20 workouts completed") rather than praising the
 * person, which is the difference between a record and a slot machine.
 *
 * Closing it is what marks it seen, on the server, so it does not come back on
 * the next device.
 */
export const MILESTONE_TOAST_MS = 8000;

interface Props {
  milestone: Milestone | null;
  onClose: () => void;
}

export default function MilestoneToast({ milestone, onClose }: Props) {
  return (
    <Snackbar
      open={milestone !== null}
      autoHideDuration={MILESTONE_TOAST_MS}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      role="status"
      // Above the bottom bar on a phone, exactly as `QuickAddFab` is: at the
      // default 24px the celebration sits UNDER the navigation, where it is
      // both unreadable and unclosable. Same numbers as that component; this
      // is a local accommodation of the bar's height, not one of the five
      // coupled breakpoint gates.
      sx={{ bottom: { xs: 80, sm: 24 } }}
    >
      <Alert
        severity="success"
        onClose={onClose}
        variant="filled"
        data-testid="milestone-toast"
      >
        {milestone ? `${milestone.title} — ${milestone.body}` : ''}
      </Alert>
    </Snackbar>
  );
}
