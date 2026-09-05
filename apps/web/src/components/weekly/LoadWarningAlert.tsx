import { Alert, AlertTitle } from '@mui/material';

import type { LoadWarning } from '../../types';

/**
 * One load warning (PRD §48).
 *
 * `severity="warning"` and `role="alert"`, never `error`: nothing is wrong.
 * The product is recommending, and the user is entitled to say no — VISION §26
 * is about preventing overload, and refusing to let somebody plan the week they
 * want is a different kind of overload.
 */
export default function LoadWarningAlert({ warning }: { warning: LoadWarning }) {
  return (
    <Alert severity="warning" role="alert" data-testid="wizard-load-warning" sx={{ mt: 2 }}>
      <AlertTitle>{warning.message}</AlertTitle>
      {warning.suggestion}
    </Alert>
  );
}
