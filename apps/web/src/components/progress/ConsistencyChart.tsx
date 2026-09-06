import { Box, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { BarChart } from '@mui/x-charts/BarChart';

import type { ProgressResponse } from '../../types';
import {
  consistencyAriaLabel,
  consistencyCaption,
  graceCaption,
  weekLabel,
} from '../../utils/momentumCopy';

/**
 * The run, counted in weeks (issue #117, epic E11).
 *
 * PRD §55 counts weeks, not days, and VISION §31 says why: "one missed day
 * should not erase weeks of effort". A daily streak does exactly that, and the
 * product that shows one teaches people that the honest thing to do after a bad
 * Tuesday is to stop looking.
 *
 * The grace is stated OUT LOUD. A week the product quietly forgave is a week
 * the user cannot reconcile against their own memory, which makes the whole
 * number feel invented.
 */
interface Props {
  run: ProgressResponse['consistencyRun'];
}

export default function ConsistencyChart({ run }: Props) {
  const theme = useTheme();
  const grace = graceCaption(run);

  return (
    <Card data-testid="progress-consistency">
      <CardContent>
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography variant="h6" component="p">
            {consistencyCaption(run)}
          </Typography>
          {grace && (
            <Typography variant="body2" color="text.secondary">
              {grace} — a missed week does not erase the ones before it.
            </Typography>
          )}
        </Stack>

        {run.weekly.length > 0 ? (
          <Box role="img" aria-label={consistencyAriaLabel(run)}>
            <BarChart
              height={180}
              xAxis={[
                { scaleType: 'band', data: run.weekly.map(weekLabel) },
              ]}
              series={[
                {
                  id: 'planned',
                  data: run.weekly.map((week) => week.planned),
                  label: 'Planned',
                  color: theme.palette.action.disabledBackground,
                },
                {
                  id: 'completed',
                  data: run.weekly.map((week) => week.completed),
                  label: 'Completed',
                  color: theme.palette.primary.main,
                },
              ]}
              borderRadius={4}
              margin={{ top: 8, bottom: 8, left: 8, right: 8 }}
              slotProps={{ legend: { position: { vertical: 'bottom' } } }}
            />
          </Box>
        ) : (
          <Typography color="text.secondary">
            Weeks appear here once you have planned something.
          </Typography>
        )}

        {/* The chart's numbers, reachable without the chart. */}
        <Box sx={visuallyHidden}>
          <table>
            <caption>Planned and completed by week</caption>
            <thead>
              <tr>
                <th scope="col">Week starting</th>
                <th scope="col">Planned</th>
                <th scope="col">Completed</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {run.weekly.map((week) => (
                <tr key={week.weekStart}>
                  <th scope="row">{week.weekStart}</th>
                  <td>{week.planned}</td>
                  <td>{week.completed}</td>
                  <td>
                    {week.current
                      ? 'In progress'
                      : week.graced
                        ? 'Grace week'
                        : week.success
                          ? 'Kept'
                          : 'Missed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </CardContent>
    </Card>
  );
}
