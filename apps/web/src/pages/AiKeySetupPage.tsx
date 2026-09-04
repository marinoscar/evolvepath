/**
 * `/setup/ai-key` — the first thing a new user sees (issue #29, epic #20).
 *
 * RENDERED OUTSIDE `Layout` AND OUTSIDE `NotificationProvider`, the same shape
 * `/activate` uses. There is no app bar, no rail, no bottom bar and no bell,
 * and that is the honest rendering of the situation: none of those destinations
 * work yet, so offering them would be inviting the user to bounce off the gate
 * repeatedly. Leaving the notification provider out also means no SSE stream is
 * opened for a session that cannot use the app.
 *
 * The only way out other than supplying a key is Sign out, which is why that
 * link is here rather than in a menu the user cannot reach.
 *
 * THE FORM AND THE INSTRUCTIONS ARE THE SETTINGS PAGE'S, unchanged — the same
 * `OpenAiKeyForm` and `OpenAiKeyInstructions` (#28) in their `setup` variant.
 * The setup screen differs in exactly three ways, all expressed as props:
 * instructions open rather than collapsed, "Save and continue" rather than
 * "Save key", and no Remove (there is nothing to return to).
 */

import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Container, Paper, Typography, useTheme } from '@mui/material';

import { useAuth } from '../contexts/AuthContext';
import { useMyAiKey } from '../hooks/useMyAiKey';
import { OpenAiKeyForm } from '../components/ai/OpenAiKeyForm';
import { OpenAiKeyInstructions } from '../components/ai/OpenAiKeyInstructions';

interface FromState {
  from?: { pathname?: string };
}

export default function AiKeySetupPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const {
    status,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    save,
    test,
    clearTestResult,
  } = useMyAiKey();

  const from = (location.state as FromState | null)?.from?.pathname;

  // After a save, `useMyAiKey` has already called `refreshUser()`, so
  // `user.aiKey.configured` flips and this effect carries the user onward —
  // to the route they originally asked for, or home.
  //
  // A NAVIGATION IN AN EFFECT rather than in the save handler, because it must
  // ALSO fire for the bookmark case: a user who already has a key and lands
  // here typed the URL or followed a stale link, and the right answer is the
  // same one.
  useEffect(() => {
    if (user?.aiKey.configured) {
      navigate(from ?? '/', { replace: true });
    }
  }, [user?.aiKey.configured, from, navigate]);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Belt and braces alongside the effect: without this the page renders one
  // frame of its form for a user who already has a key, which reads as being
  // asked for something they have already given.
  if (user?.aiKey.configured) {
    return <Navigate to={from ?? '/'} replace />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: 2,
      }}
    >
      <Container maxWidth="sm" disableGutters>
        <Paper sx={{ p: { xs: 3, sm: 4 }, boxShadow: theme.shadows[10] }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Connect your OpenAI API key
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            EvolvePath runs every AI feature with your own key. It is encrypted, never shown
            again, and used only for your account.
          </Typography>

          {loadError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {loadError}
            </Alert>
          )}

          {/* Open, not collapsed: the user has never done this before and
              cannot proceed without it. */}
          <OpenAiKeyInstructions variant="setup" />

          <Box sx={{ mt: 3 }}>
            <OpenAiKeyForm
              status={status}
              variant="setup"
              onSave={save}
              onTest={test}
              // No `onRemove`: there is nothing to return to from here.
              isSaving={isSaving}
              isTesting={isTesting}
              testResult={testResult}
              clearTestResult={clearTestResult}
              saveError={saveError}
            />
          </Box>

          <Box sx={{ mt: 4, textAlign: 'center' }}>
            {/* The only other way out. Without it a user who cannot get a key
                is stuck on this screen with no route back to login. */}
            <Button variant="text" onClick={handleSignOut}>
              Sign out
            </Button>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
