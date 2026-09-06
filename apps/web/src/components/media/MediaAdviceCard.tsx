import { Alert, AlertTitle, Box, Stack, Typography } from '@mui/material';

import type { MediaAdvice, MediaKind } from '../../types';

/**
 * The fixed professional-care copy (PRD §45, §81).
 *
 * A CONSTANT, not the model's `reason`. The sentence a person reads when they
 * are told to see a professional has to be the same sentence every time —
 * including on the day the provider is having a bad one — and it contains no
 * programming advice, because coaching alongside "get this looked at" reads as
 * permission to keep going. The model's reason is shown beside it, not instead
 * of it.
 */
export const SEEK_PROFESSIONAL_COPY =
  "I can't assess injuries from a video. If you have sharp pain, numbness, or " +
  'instability, see a qualified professional before continuing.';

interface MediaAdviceCardProps {
  advice: MediaAdvice;
  kind: MediaKind;
  askedAt: string;
}

/**
 * The coach's read of one photo or video (issue #96, epic #67).
 *
 * Presentational: it takes data and renders it. Every safety level renders
 * text as well as colour (PRD §122) — an alert a colour-blind reader cannot
 * distinguish from a neutral one is not a warning.
 */
export function MediaAdviceCard({ advice, kind, askedAt }: MediaAdviceCardProps) {
  const level = advice.safetyFlag?.level ?? 'none';

  return (
    <Stack spacing={2}>
      {level === 'seek_professional' && (
        <Alert severity="error" data-testid="media-advice-safety">
          <AlertTitle>Please get this checked</AlertTitle>
          {advice.safetyFlag?.reason && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              {advice.safetyFlag.reason}
            </Typography>
          )}
          <Typography variant="body2">{SEEK_PROFESSIONAL_COPY}</Typography>
        </Alert>
      )}

      {level === 'caution' && (
        <Alert severity="warning" data-testid="media-advice-safety">
          {advice.safetyFlag?.reason || 'Take this one carefully.'}
        </Alert>
      )}

      <Typography variant="body1" data-testid="media-advice-summary">
        {advice.summary}
      </Typography>

      {/* `component="p"`, not a heading. MUI's `subtitle2` renders an <h6>,
          and this card is mounted inside a Dialog whose title is an <h2> and
          on a page whose title is an <h1> — either way the jump is a
          `heading-order` violation axe catches. These are labels introducing a
          list, not document structure, so a paragraph is the honest element. */}
      {advice.observations.length > 0 && (
        <Box>
          <Typography variant="subtitle2" component="p" gutterBottom>
            What I noticed
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {advice.observations.map((observation) => (
              <Typography component="li" variant="body2" key={observation}>
                {observation}
              </Typography>
            ))}
          </Box>
        </Box>
      )}

      {advice.advice.length > 0 && (
        <Box>
          <Typography variant="subtitle2" component="p" gutterBottom>
            Try this
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {advice.advice.map((item) => (
              <Typography component="li" variant="body2" key={item}>
                {item}
              </Typography>
            ))}
          </Box>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary">
        Coach&rsquo;s read of this {kind === 'VIDEO' ? 'video' : 'photo'} &middot;{' '}
        {formatAskedAt(askedAt)}
      </Typography>
    </Stack>
  );
}

/** "2 hours ago". Relative, because "when did I ask?" is the useful question. */
function formatAskedAt(iso: string): string {
  const asked = new Date(iso).getTime();
  if (Number.isNaN(asked)) return 'just now';

  const minutes = Math.round((Date.now() - asked) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
