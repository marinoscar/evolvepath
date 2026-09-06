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
    >
      <Alert severity="success" onClose={onClose} variant="filled">
        {milestone ? `${milestone.title} — ${milestone.body}` : ''}
      </Alert>
    </Snackbar>
  );
}
