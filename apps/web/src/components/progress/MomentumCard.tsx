import { Box, Card, CardContent, Chip, Typography, useTheme } from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ReplayIcon from '@mui/icons-material/Replay';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { visuallyHidden } from '@mui/utils';
import { LineChart } from '@mui/x-charts/LineChart';

import type { Momentum, MomentumState } from '../../types';
import {
  domainLabel,
  MOMENTUM_STATE_LABELS,
  momentumAriaLabel,
  trendAriaLabel,
  weekLabel,
} from '../../utils/momentumCopy';

/**
 * One domain's momentum (issue #117, epic E11).
 *
 * PRD §54 fixes the presentation: a state WORD plus evidence sentences. There
 * is no number on this card that is not a count inside a sentence, and there is
 * deliberately nothing to render a percentage from — the API does not serialise
 * a ratio.
 *
 * Three things carry the state, and none of them is colour alone (PRD §122):
 * the word, the icon beside it, and the line's shape. Planned is DASHED and
 * completed is SOLID, so the two series survive greyscale, a printout and
 * forced-colors mode.
 */

const STATE_ICONS: Record<MomentumState, typeof TrendingUpIcon> = {
  BUILDING: TrendingUpIcon,
  IMPROVING: TrendingUpIcon,
  STEADY: TrendingFlatIcon,
  SLIPPING: TrendingDownIcon,
  RECOVERING: ReplayIcon,
  INSUFFICIENT_DATA: HourglassEmptyIcon,
};

interface Props {
  momentum: Momentum;
}

export default function MomentumCard({ momentum }: Props) {
  const theme = useTheme();
  const StateIcon = STATE_ICONS[momentum.state];

  const labels = momentum.trend.map((point) =>
    point.weekStart ? weekLabel(point) : '—',
  );

  return (
    <Card sx={{ height: '100%' }} data-testid={`momentum-${momentum.domain}`}>
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          {domainLabel(momentum.domain)} Momentum
        </Typography>

        <Chip
          size="small"
          // The icon is decoration; the label is the fact. A reader who cannot
          // see the arrow still reads "Improving".
          icon={<StateIcon fontSize="small" aria-hidden />}
          label={MOMENTUM_STATE_LABELS[momentum.state]}
          aria-label={momentumAriaLabel(momentum)}
        />

        <Box sx={{ mt: 2 }} aria-label={trendAriaLabel(momentum)} role="img">
          <LineChart
            height={120}
            xAxis={[{ scaleType: 'point', data: labels }]}
            series={[
              {
                id: 'planned',
                data: momentum.trend.map((point) => point.planned),
                label: 'Planned (dashed)',
                color: theme.palette.text.disabled,
                showMark: false,
                curve: 'linear',
              },
              {
                id: 'completed',
                data: momentum.trend.map((point) => point.completed),
                label: 'Completed (solid)',
                color: theme.palette.primary.main,
                showMark: true,
                curve: 'linear',
              },
            ]}
            // The dash is the accessible half of the encoding, not decoration.
            sx={{
              '& .MuiLineElement-series-planned': {
                strokeDasharray: '5 4',
                strokeWidth: 2,
              },
              '& .MuiLineElement-series-completed': { strokeWidth: 2 },
              '& .MuiMarkElement-root': { scale: '0.7' },
            }}
            slotProps={{ legend: { position: { vertical: 'bottom' } } }}
            margin={{ top: 8, bottom: 8, left: 8, right: 8 }}
          />
        </Box>

        {/* The same numbers, for a reader the chart cannot reach. */}
        <Box sx={visuallyHidden}>
          <table>
            <caption>{domainLabel(momentum.domain)} planned and completed by week</caption>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Planned</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {momentum.trend.map((point, index) => (
                <tr key={`${point.weekStart}-${index}`}>
                  <th scope="row">{point.weekStart || '—'}</th>
                  <td>{point.planned}</td>
                  <td>{point.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>

        <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Why
        </Typography>
        <Box component="ul" data-testid="momentum-evidence" sx={{ m: 0, pl: 2.5 }}>
          {momentum.evidence.map((bullet) => (
            <Typography key={bullet} component="li" variant="body2" color="text.secondary">
              {bullet}
            </Typography>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
