import { Box, Typography, useTheme } from '@mui/material';

import type { WeightTrend } from '../../types';

// =============================================================================
// The weight trend (issue #113, epic E09)
// =============================================================================
//
// PRD §47 fixes what this may say, and most of the rules are prohibitions:
//
//   • ONE TREND LINE, muted points. Not a bar per day, not a marker per
//     reading, and above all no colour that means anything. Body weight moves
//     two kilos on salt and sleep; a green day and a red day would be the
//     product teaching somebody to be afraid of a scale.
//   • NO JUDGMENT COPY. A test asserts no string here matches
//     /bad|good|great|oops|guilt/i, because the copy is the part most likely to
//     drift back towards encouragement that is really evaluation.
//   • MEANING IS NEVER CARRIED BY COLOUR ALONE. The line and the points differ
//     in SHAPE, and the caption states the number in words — which is what a
//     screen reader, a printout and a colour-blind reader all get.
//
// Inline SVG rather than a chart library. None is installed, and one line does
// not justify one — a dependency here would be 40 kB to draw a polyline.
//
// The hidden table is not a nicety: a chart is a picture of numbers, and the
// numbers are the content. `role="img"` plus an `aria-label` gives the summary;
// the table gives the data.
// =============================================================================

interface WeightTrendChartProps {
  trend: WeightTrend;
}

const HEIGHT = 160;
const WIDTH = 640;
const PADDING = { top: 12, right: 12, bottom: 24, left: 12 };
/** Breathing room above and below the data, in kilograms. */
const Y_PADDING_KG = 1;

const visuallyHidden = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};

function formatDelta(deltaKg: number): string {
  const rounded = Math.abs(deltaKg).toFixed(1);

  if (deltaKg === 0) return 'no change';

  return `${deltaKg < 0 ? '−' : '+'}${rounded} kg`;
}

export function WeightTrendChart({ trend }: WeightTrendChartProps) {
  const theme = useTheme();
  const { items, trend: series, summary } = trend;

  const caption = summary
    ? `7-day trend: ${formatDelta(summary.deltaKg)} over ${summary.days} logged ${
        summary.days === 1 ? 'day' : 'days'
      }`
    : 'Log a few more days to see a trend';

  if (series.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {caption}
      </Typography>
    );
  }

  const values = [
    ...items.map((item) => item.weightKg),
    ...series.map((point) => point.rolling7Kg).filter((value): value is number => value !== null),
  ];

  const min = values.length > 0 ? Math.min(...values) - Y_PADDING_KG : 0;
  const max = values.length > 0 ? Math.max(...values) + Y_PADDING_KG : 1;
  const span = max - min || 1;

  const xFor = (index: number) =>
    PADDING.left +
    (index / Math.max(1, series.length - 1)) * (WIDTH - PADDING.left - PADDING.right);
  const yFor = (value: number) =>
    PADDING.top + (1 - (value - min) / span) * (HEIGHT - PADDING.top - PADDING.bottom);

  const indexByDate = new Map(series.map((point, index) => [point.dateLocal, index]));

  // Broken into runs, so a gap in the data is a gap in the line rather than a
  // straight segment across a fortnight nobody logged.
  const runs: string[] = [];
  let current: string[] = [];

  series.forEach((point, index) => {
    if (point.rolling7Kg === null) {
      if (current.length > 1) runs.push(current.join(' '));
      current = [];
      return;
    }

    current.push(`${current.length === 0 ? 'M' : 'L'}${xFor(index)},${yFor(point.rolling7Kg)}`);
  });

  if (current.length > 1) runs.push(current.join(' '));

  return (
    <Box>
      <Box
        component="svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Weight over the last ${series.length} days. ${caption}.`}
        sx={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {items.map((item) => {
          const index = indexByDate.get(item.dateLocal);

          if (index === undefined) return null;

          return (
            <circle
              key={item.dateLocal}
              cx={xFor(index)}
              cy={yFor(item.weightKg)}
              r={3}
              fill={theme.palette.text.disabled}
              data-testid="weight-point"
            />
          );
        })}

        {runs.map((path) => (
          <path
            key={path}
            d={path}
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            strokeLinecap="round"
            data-testid="weight-trend-line"
          />
        ))}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {caption}
      </Typography>

      <Box component="table" sx={visuallyHidden}>
        <caption>Weight readings</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Weight in kilograms</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.dateLocal}>
              <th scope="row">{item.dateLocal}</th>
              <td>{item.weightKg}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
