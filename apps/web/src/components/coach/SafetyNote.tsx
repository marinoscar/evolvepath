import { Alert } from '@mui/material';

import type { SafetyInfo } from '../../types';

/**
 * The professional-care line, under (or instead of) the reply.
 *
 * `severity="info"`, not `warning` or `error`. The message is "this belongs
 * with someone qualified", and an alarming banner around it would read as the
 * app being broken rather than as the app being careful.
 */
export default function SafetyNote({ safety }: { safety: SafetyInfo }) {
  if (!safety.userFacingNote) return null;

  return (
    <Alert severity="info" sx={{ mt: 1 }} data-testid="safety-note">
      {safety.userFacingNote}
    </Alert>
  );
}
