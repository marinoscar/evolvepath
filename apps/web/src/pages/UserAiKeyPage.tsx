/**
 * Settings → OpenAI API Key (`/settings/ai-key`).
 *
 * Issue #28, epic #20. A registry card in `USER_SETTINGS_SECTIONS` with NO
 * `permission`, like every card on that surface: every authenticated user owns
 * their own key, and a Viewer without one cannot use the application at all —
 * gating this would be inventing an authorization rule the API does not enforce
 * and locking a user out of the very thing that unlocks the app for them.
 *
 * NOT WRAPPED IN `UserSettingsSection`, for the same reason `UserTokensPage` is
 * not: that wrapper exists to share one `useUserSettings()` call and its
 * snackbars between the pages that edit the user settings DOCUMENT. A key is
 * not part of that document — it is its own resource behind `/api/me/ai-key`,
 * and `useMyAiKey` already owns its loading state and its error surfaces.
 * Wrapping it anyway would fire a `GET /user-settings` this page never reads and
 * put a second, empty error surface above one that already exists.
 *
 * THIS ROUTE IS DELIBERATELY NOT EXEMPT FROM THE AI-KEY GATE (#29). Removing a
 * key here sends the user to `/setup/ai-key` — which is exactly what the confirm
 * dialog warns will happen, and what makes the promise "you need a key to use
 * this app" true rather than decorative.
 */

import { Alert, Box, Container, Typography } from '@mui/material';
import { OpenAiKeyForm } from '../components/ai/OpenAiKeyForm';
import { OpenAiKeyInstructions } from '../components/ai/OpenAiKeyInstructions';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useMyAiKey } from '../hooks/useMyAiKey';

export default function UserAiKeyPage() {
  const {
    status,
    isLoading,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    save,
    test,
    remove,
    clearTestResult,
  } = useMyAiKey();

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `OpenAI API Key` card in
            `config/userSettingsSections.tsx`, so the hub card, the compact
            AppBar title and this `h1` all name the page identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          OpenAI API Key
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          EvolvePath uses your own OpenAI key for every AI feature. It is stored encrypted and
          never shown again.
        </Typography>

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {/* Collapsed here, open on the setup page: a user replacing a key
            already knows how to make one. */}
        <OpenAiKeyInstructions variant="settings" />

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <OpenAiKeyForm
            status={status}
            variant="settings"
            onSave={save}
            onTest={test}
            onRemove={remove}
            isSaving={isSaving}
            isTesting={isTesting}
            testResult={testResult}
            clearTestResult={clearTestResult}
            saveError={saveError}
          />
        )}
      </Box>
    </Container>
  );
}
