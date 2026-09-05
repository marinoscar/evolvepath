import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';

import type { ReviewPattern } from '../../types';

/** High / Medium / Low, as text. Never colour alone. */
function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return 'High confidence';
  if (confidence >= 0.5) return 'Medium confidence';
  return 'Low confidence';
}

const ROWS: Array<{ key: keyof ReviewPattern; label: string }> = [
  { key: 'observation', label: 'Observation' },
  { key: 'inference', label: 'Inference' },
  { key: 'recommendation', label: 'Recommendation' },
];

/**
 * One pattern, with its three claims labelled separately (PRD §14.4).
 *
 * "You completed 4 of 5 mornings" is an observation; "evenings are less
 * reliable for you" is an inference; "move it to Saturday" is a
 * recommendation. Collapsing them into one paragraph is how a product states a
 * guess with the authority of a measurement — and labelling them is what lets
 * a user disagree with the middle one while accepting the first.
 *
 * A null field renders no row at all rather than an empty one: a template
 * summary is not allowed to guess, and a blank "Inference:" would read as one
 * the coach declined to share.
 */
export default function PatternCard({ pattern }: { pattern: ReviewPattern }) {
  return (
    <Card variant="outlined" data-testid="review-pattern">
      <CardContent>
        <Stack spacing={1.5}>
          {ROWS.map(({ key, label }) => {
            const value = pattern[key];
            if (typeof value !== 'string' || value.length === 0) return null;

            return (
              <div key={label}>
                {/* A row label, not a heading — see WeekDomainTiles. */}
                <Typography variant="overline" color="text.secondary" component="p">
                  {label}
                </Typography>
                <Typography variant="body2">{value}</Typography>
              </div>
            );
          })}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              size="small"
              variant="outlined"
              label={confidenceLabel(pattern.confidence)}
              aria-label={`confidence ${Math.round(pattern.confidence * 100)}%`}
            />
            {pattern.domain && <Chip size="small" label={pattern.domain} />}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
