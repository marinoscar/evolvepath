import { Box, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';

import { DOMAIN_ORDER } from '../../types';
import type { BestSelfProfile, ProgressResponse } from '../../types';
import {
  domainLabel,
  evolutionSentence,
  trendAriaLabel,
} from '../../utils/momentumCopy';

/**
 * "Your evolution" — PRD §75's first section (issue #117, epic E11).
 *
 * The headline is the user's OWN identity statement, not a summary the product
 * wrote about them. VISION §57's thirty-day payoff is "Thirty days ago those
 * were intentions. Now there is evidence." — the evidence is the three
 * sentences below, one per domain.
 *
 * NO TOTAL ACROSS DOMAINS. Adding work sessions to family dinners produces a
 * number that means nothing and invites exactly the ranking PRD P13 forbids.
 */
interface Props {
  progress: ProgressResponse;
  bestSelf: BestSelfProfile | null;
}

export default function EvolutionCard({ progress, bestSelf }: Props) {
  const theme = useTheme();
  const identity = bestSelf?.identityStatement ?? null;

  return (
    <Card>
      <CardContent>
        {identity ? (
          <Typography variant="h6" component="p" sx={{ mb: 2 }}>
            {identity}
          </Typography>
        ) : (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Four weeks of evidence, in your own three areas.
          </Typography>
        )}

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={3}
          divider={<Box sx={{ borderLeft: { sm: 1 }, borderColor: 'divider' }} />}
        >
          {DOMAIN_ORDER.map((domain) => {
            const momentum = progress.momentum[domain];

            return (
              <Box key={domain} sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" gutterBottom>
                  {evolutionSentence(momentum)}
                </Typography>

                <Box role="img" aria-label={trendAriaLabel(momentum)}>
                  <SparkLineChart
                    height={40}
                    data={momentum.trend.map((point) => point.completed)}
                    color={theme.palette.primary.main}
                    showHighlight
                    showTooltip
                  />
                </Box>

                <Box sx={visuallyHidden}>
                  <table>
                    <caption>{domainLabel(domain)} completions by week</caption>
                    <tbody>
                      {momentum.trend.map((point, index) => (
                        <tr key={`${point.weekStart}-${index}`}>
                          <th scope="row">{point.weekStart || '—'}</th>
                          <td>{point.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
