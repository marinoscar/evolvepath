import { Box, Typography } from '@mui/material';

interface TodayGreetingProps {
  greeting: 'morning' | 'afternoon' | 'evening';
  stateLine: string;
  name: string | null;
}

/**
 * "Good morning, Alex" and one line about the shape of the day.
 *
 * The greeting word comes from the API, not from `new Date()`: the server
 * resolves it in the user's stored timezone, and a browser on a laptop still set
 * to another zone would otherwise disagree with every other date on the screen.
 * That is also why `utils/greeting.ts` is gone — a second, client-side answer to
 * the same question is a second answer that can be wrong.
 *
 * "there" rather than nothing when the name is missing: "Good morning," with a
 * dangling comma reads as a bug, and a bare "Good morning" reads as a sign.
 */
export function TodayGreeting({ greeting, stateLine, name }: TodayGreetingProps) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Good {greeting}, {name ?? 'there'}
      </Typography>
      <Typography color="text.secondary" data-testid="today-state-line">
        {stateLine}
      </Typography>
    </Box>
  );
}
