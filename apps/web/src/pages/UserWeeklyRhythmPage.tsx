import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  MenuItem,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { useWeeklySettings } from '../hooks/useWeeklySettings';

/** Sunday first, matching `weekly_review_weekday`'s 0–6. */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Settings → Weekly rhythm (`/settings/weekly-rhythm`).
 *
 * Not built on `UserSettingsSection`, like `UserAiMemoryPage`: that wrapper
 * shares one `useUserSettings()` call between the pages that edit the user
 * settings DOCUMENT, and the review rhythm is two columns on `user_profiles`
 * behind `/api/weekly/settings`. Wrapping it anyway would fire a request this
 * page never reads and gate the form behind an unrelated spinner.
 *
 * The chrome below mirrors the `Weekly rhythm` card in
 * `config/userSettingsSections.tsx` so the hub card, the compact AppBar title
 * and this `h1` all name the page identically.
 */
export default function UserWeeklyRhythmPage() {
  const { settings, isLoading, isSaving, error, save } = useWeeklySettings();
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState('17:00');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWeekday(settings.weeklyReviewWeekday);
    setTime(settings.weeklyReviewTime);
  }, [settings]);

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Weekly rhythm
        </Typography>

        <Typography color="text.secondary" gutterBottom>
          Choose the day and time your weekly review is prepared.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <Skeleton variant="rounded" height={180} sx={{ mt: 3 }} />
        ) : (
          <Stack spacing={3} sx={{ mt: 3, maxWidth: 360 }}>
            <TextField
              select
              label="Day"
              value={weekday}
              data-testid="rhythm-weekday"
              onChange={(event) => setWeekday(Number(event.target.value))}
            >
              {WEEKDAYS.map((label, index) => (
                <MenuItem key={label} value={index}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              // The id goes on the INPUT: a test needs something it can type
              // into, and so does E10-05's Playwright spec.
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { step: 3600, 'data-testid': 'rhythm-time' },
              }}
              // The sweep is hourly, so the minutes are recorded faithfully but
              // are not a promise. Saying so is cheaper than a support thread.
              helperText="Reviews are prepared on the hour."
            />

            {settings && (
              <Typography variant="body2" color="text.secondary">
                Next review: {formatNext(settings.nextReviewAt, settings.timezone)} (
                {settings.timezone})
              </Typography>
            )}

            <Box>
              <Button
                variant="contained"
                data-testid="rhythm-save"
                disabled={isSaving}
                onClick={() => {
                  void save({ weeklyReviewWeekday: weekday, weeklyReviewTime: time })
                    .then(() => setSaved(true))
                    .catch(() => undefined);
                }}
              >
                Save
              </Button>
            </Box>
          </Stack>
        )}

        <Snackbar
          open={saved}
          autoHideDuration={4000}
          onClose={() => setSaved(false)}
          message="Weekly rhythm saved"
        />
      </Box>
    </Container>
  );
}

/** "Friday 16:00", in the timezone the review is actually prepared in. */
function formatNext(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
