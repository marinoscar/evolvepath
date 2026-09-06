/**
 * Settings → Reset your data (`/settings/reset`) — the "Danger zone".
 *
 * Issue #224, epic #220. A registry card in `USER_SETTINGS_SECTIONS` with NO
 * `permission`, like every card on that surface: `POST /api/account/reset` is
 * `@Auth()` with no permissions and accepts no user id, because every
 * authenticated user owns their own data. It is a destination of its own rather
 * than a tab on `/settings/profile` — see the registry's own note, and
 * CLAUDE.md's Settings UI Pattern rule 2.
 *
 * NOT built on `UserSettingsSection`, for the same reason `UserAiKeyPage` and
 * `UserWeeklyRhythmPage` are not: that wrapper shares one `useUserSettings()`
 * call between the pages that edit the user settings DOCUMENT, and a reset is
 * its own resource behind `/api/account/*`. Wrapping it would fire a request
 * this page never reads.
 *
 * -----------------------------------------------------------------------------
 * REFRESH THE AUTH USER BEFORE NAVIGATING. THE ORDER IS THE WHOLE THING.
 * -----------------------------------------------------------------------------
 *
 * Both of the app's shell gates read their answer off the SINGLE `AuthContext`
 * user — `RequireAiKey` from `user.aiKey.configured`, `RequireOnboarding` from
 * `user.onboarding.completed` — so one `refreshUser()` re-evaluates both, and it
 * must COMPLETE before `navigate()` runs. Navigating first lands the user behind
 * a gate still holding the pre-reset answer: `/onboarding` bounces them straight
 * back into a shell whose data is gone, which reads as the reset not having
 * worked at all rather than as a stale cache.
 *
 * This is the same hazard `useMyAiKey.remove` documents for removing a key, and
 * the handling is deliberately consistent with it — the difference is only that
 * a reset invalidates BOTH gates at once and the destination depends on the
 * scope, which is why the refresh lives here rather than in `useAccountReset`.
 *
 * Where each scope goes, and why:
 *
 *   - `data`         → `/onboarding`. The reset deletes `user_profiles`, which
 *                      is where onboarding completion lives, so the user is
 *                      genuinely un-onboarded now. The wizard is the honest
 *                      destination; the Today screen would be a shell with
 *                      nothing in it.
 *   - `data_and_key` → `/setup/ai-key`. The key gate comes FIRST in the chain
 *                      (`ProtectedRoute → RequireAiKey → RequireOnboarding`),
 *                      so this is where the app would send them anyway — going
 *                      there directly saves a redirect they would otherwise
 *                      watch happen.
 *
 * THE DIALOG DOES NOT NAVIGATE; THIS PAGE DOES. `ConfirmPhraseDialog` is a
 * generic typed-confirmation component that knows a phrase and a list of
 * consequences. Which gates a scope invalidates, and where its post-reset screen
 * is, is knowledge this page has and the dialog has no business acquiring — so
 * the split is deliberate rather than an oversight.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';

import { ConfirmPhraseDialog } from '../components/settings/ConfirmPhraseDialog';
import { describeCounts } from '../components/settings/accountDataLabels';
import { useAccountReset } from '../hooks/useAccountReset';
import { useAuth } from '../contexts/AuthContext';
import type { AccountResetScope } from '../types';

/** The copy for each panel, and for the dialog that panel opens. */
const SCOPES: Array<{
  scope: AccountResetScope;
  heading: string;
  body: string;
  action: string;
  dialogTitle: string;
  dialogDescription: string;
  confirmLabel: string;
}> = [
  {
    scope: 'data',
    heading: 'Reset my data',
    body:
      'Erases everything you have done in EvolvePath: your Best Self, outcomes, plans, routines, commitments, evidence, reflections, coach conversations and uploads. Your account, your sign-in and your saved OpenAI key stay exactly as they are, and you start again from the beginning of the setup wizard.',
    action: 'Reset my data',
    dialogTitle: 'Reset your data?',
    dialogDescription:
      'This cannot be undone. Your sign-in and your saved OpenAI key are not affected — you will be taken back to the setup wizard to build a new Path.',
    confirmLabel: 'Reset my data',
  },
  {
    scope: 'data_and_key',
    heading: 'Reset everything, including my AI key',
    body:
      'Everything above, plus the OpenAI key stored here is removed, so you set the app up again from the very beginning. The key is only removed from EvolvePath — it is not deleted at OpenAI, and it keeps working anywhere else you have used it. Revoke it there too if that is what you want.',
    action: 'Reset everything',
    dialogTitle: 'Reset your data and remove your key?',
    dialogDescription:
      'This cannot be undone. Your stored OpenAI key is removed from EvolvePath as well, so you will be asked for a key before you can use the app again. The key is not deleted at OpenAI.',
    confirmLabel: 'Reset everything',
  },
];

export default function UserDataResetPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { summary, isLoading, error, isResetting, reset } = useAccountReset();

  // A `null | Scope` union rather than two booleans. The two dialogs are
  // mutually exclusive by construction, and a union makes that a fact the
  // compiler holds rather than an invariant two `useState(false)` calls would
  // leave somebody to keep in sync by hand — there is no state in which both
  // are open, because there is no way to express one.
  const [openScope, setOpenScope] = useState<AccountResetScope | null>(null);

  const consequences = summary ? describeCounts(summary.counts) : [];

  // `typedPhrase` is what the user actually typed into the dialog, and it is
  // what goes on the wire — never `summary.phrases[scope]`, which this page
  // also holds. Sending the canonical phrase back would make the server's
  // re-verification unfalsifiable from this client: it could never reject a
  // request the browser sent, so the dialog's own match would silently become
  // the only gate operating for every real user. See `ConfirmPhraseDialog`.
  const handleConfirm = async (scope: AccountResetScope, typedPhrase: string) => {
    if (!summary) return;

    const ok = await reset(scope, typedPhrase);
    // A refusal leaves the dialog open with the server's message in it — see
    // `useAccountReset`, which flattens the error rather than throwing.
    if (!ok) return;

    setOpenScope(null);

    // BEFORE `navigate`, always. See the file header.
    await refreshUser();

    if (scope === 'data_and_key') {
      navigate('/setup/ai-key', { replace: true });
      return;
    }
    navigate('/onboarding', { replace: true });
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `Reset your data` card in
            `config/userSettingsSections.tsx`, so the hub card, the compact
            AppBar title and this `h1` all name the page identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          Reset your data
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Start over with a clean slate. This erases what you have built here and cannot be
          undone. Your account itself stays — your sign-in, your email and your access are
          untouched.
        </Typography>

        {error && !openScope && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <Skeleton variant="rounded" height={280} />
        ) : (
          <Stack spacing={3}>
            {/* What is there right now, stated once above both panels. A user
                deciding between the two scopes is answering "what do I lose?",
                and the answer is the same either way. */}
            {summary && (
              <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="subtitle1" component="h2" gutterBottom>
                  What you have here now
                </Typography>
                {consequences.length > 0 ? (
                  <Typography color="text.secondary">{consequences.join(' · ')}</Typography>
                ) : (
                  <Typography color="text.secondary">
                    Nothing yet — there is no data to erase.
                  </Typography>
                )}
              </Paper>
            )}

            {SCOPES.map((option) => (
              <Paper
                key={option.scope}
                variant="outlined"
                sx={{ p: { xs: 2, sm: 3 }, borderColor: 'error.main' }}
              >
                <Typography variant="h6" component="h2" gutterBottom>
                  {option.heading}
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  {option.body}
                </Typography>
                <Button
                  color="error"
                  variant="outlined"
                  disabled={!summary || isResetting}
                  onClick={() => setOpenScope(option.scope)}
                >
                  {option.action}
                </Button>
              </Paper>
            ))}
          </Stack>
        )}

        {summary &&
          SCOPES.map((option) => (
            <ConfirmPhraseDialog
              key={option.scope}
              open={openScope === option.scope}
              title={option.dialogTitle}
              description={option.dialogDescription}
              // From the server, never a constant here — see the dialog's header.
              phrase={summary.phrases[option.scope]}
              consequences={consequences}
              isBusy={isResetting}
              error={openScope === option.scope ? error : null}
              confirmLabel={option.confirmLabel}
              onCancel={() => setOpenScope(null)}
              onConfirm={(typedPhrase) => handleConfirm(option.scope, typedPhrase)}
            />
          ))}
      </Box>
    </Container>
  );
}
