import { Box, Paper, Stack, Typography } from '@mui/material';

import type { WeeklyStructureEntry, WorkoutTemplate } from '../../types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface WeeklyStructureProps {
  weeklyStructure: WeeklyStructureEntry[];
  templates: WorkoutTemplate[];
}

/**
 * The week, as seven cells.
 *
 * All seven, including the rest days. A list of only the training days would
 * make a four-day week and a four-day week with the days bunched together look
 * identical, and the spacing is most of what makes a programme survivable.
 */
export function WeeklyStructure({ weeklyStructure, templates }: WeeklyStructureProps) {
  const nameFor = (weekday: number) => {
    const entry = weeklyStructure.find((row) => row.weekday === weekday);

    return entry
      ? (templates.find((template) => template.id === entry.templateId)?.name ?? null)
      : null;
  };

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ overflowX: 'auto', pb: 1 }}
      aria-label="Training week"
      component="ul"
      role="list"
    >
      {WEEKDAYS.map((label, weekday) => {
        const name = nameFor(weekday);

        return (
          <Paper
            key={label}
            component="li"
            variant="outlined"
            sx={{
              p: 1,
              minWidth: 84,
              flex: '1 0 auto',
              textAlign: 'center',
              bgcolor: name ? 'action.hover' : 'transparent',
            }}
          >
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
              {label}
            </Typography>
            <Box sx={{ minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2">{name ?? 'Rest'}</Typography>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}
