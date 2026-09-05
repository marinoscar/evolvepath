/**
 * Settings → AI Memory (`/settings/ai-memory`).
 *
 * Issue #90, epic E06. Like `UserTokensPage`, it does NOT use
 * `UserSettingsSection`: that wrapper shares one `useUserSettings()` call
 * between the pages that edit the user settings DOCUMENT, and memory insights
 * are their own resource behind `/api/memory-insights`. Wrapping it anyway
 * would fire a `GET /user-settings` this page never reads and gate the list
 * behind an unrelated request's spinner.
 *
 * The chrome below is only what the wrapper would have contributed visually,
 * mirroring the `AI Memory` card in `config/userSettingsSections.tsx` so the
 * hub card, the compact AppBar title and this `h1` all name the page
 * identically.
 */

import { Box, Container, Typography } from '@mui/material';

import AiMemorySettings from '../components/settings/AiMemorySettings';

export default function UserAiMemoryPage() {
  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          AI Memory
        </Typography>

        <AiMemorySettings />
      </Box>
    </Container>
  );
}
