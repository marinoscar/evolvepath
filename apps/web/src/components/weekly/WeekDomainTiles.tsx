import { Card, CardContent, Grid, Typography } from '@mui/material';

import type { Domain, WeekAggregates } from '../../types';

const DOMAIN_LABEL: Record<Domain, string> = {
  WORK: 'Work',
  FAMILY: 'Family',
  HEALTH: 'Health',
};

const DOMAINS: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

/**
 * Planned versus done, per domain (PRD §51).
 *
 * THE NUMBER IS NEVER COLOURED. VISION §30: this product does not signal worth,
 * and a "2 / 3" in red is a verdict on a person's week dressed as data
 * visualisation. The tiles are identical whatever the numbers say; the reader
 * does the interpreting.
 *
 * The secondary line appears only when there is something in it, so a clean
 * week is not padded with three zeroes.
 */
export default function WeekDomainTiles({ aggregates }: { aggregates: WeekAggregates }) {
  return (
    <Grid container spacing={2}>
      {DOMAINS.map((domain) => {
        const counts = aggregates.domains[domain];
        const detail = [
          counts.partial > 0 ? `${counts.partial} partial` : null,
          counts.rescheduled > 0 ? `${counts.rescheduled} moved` : null,
          counts.skipped > 0 ? `${counts.skipped} skipped` : null,
        ].filter(Boolean);

        return (
          <Grid key={domain} size={{ xs: 12, sm: 4 }}>
            <Card variant="outlined" data-testid={`week-tile-${domain}`}>
              <CardContent>
                {/* A label on a statistic, not a section heading: nothing
                    navigates to "Work", and as an <h3> straight after the page
                    <h1> it also skipped a level. The aria-label below carries
                    the meaning for a screen reader. */}
                <Typography variant="overline" color="text.secondary" component="p">
                  {DOMAIN_LABEL[domain]}
                </Typography>

                <Typography
                  variant="h4"
                  component="p"
                  aria-label={`${DOMAIN_LABEL[domain]}: ${counts.completed} of ${counts.planned} commitments done`}
                >
                  {counts.completed} / {counts.planned}
                </Typography>

                {detail.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {detail.join(' · ')}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        );
      })}

      {aggregates.coverage.partial && (
        <Grid size={12}>
          {/* Not a flaw, a fact. A Wednesday review is half a week, and saying
              so is the difference between information and an accusation. */}
          <Typography variant="caption" color="text.secondary">
            Week in progress — these are the days so far.
          </Typography>
        </Grid>
      )}
    </Grid>
  );
}
