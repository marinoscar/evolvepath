import { Alert } from '@mui/material';

/**
 * Shown when `aiSummary.source === 'template'`.
 *
 * PRD §120 requires the screen to work with the provider down; this sentence is
 * what stops that from being a silent substitution. The numbers are the same
 * either way — what is missing is the coach's reading of them, and the user is
 * entitled to know which they are looking at.
 */
export default function TemplateSummaryNotice() {
  return (
    <Alert severity="info" sx={{ mt: 2 }} data-testid="review-template-notice">
      Summary written from your numbers — the coach was unavailable.
    </Alert>
  );
}
