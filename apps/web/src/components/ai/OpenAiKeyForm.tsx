/**
 * The OpenAI key form — one component, two variants.
 *
 * Issue #28, epic #20. Used by `/settings/ai-key` (this issue) and by the
 * first-login setup page at `/setup/ai-key` (#29). The two screens ask for the
 * same thing under different circumstances, and a second copy would drift on
 * exactly the details that matter: what the button says, whether Test is
 * offered, and what the confirm dialog warns about.
 *
 * -----------------------------------------------------------------------------
 * TEST IS OFFERED ONLY FOR THE STORED KEY, NEVER FOR A TYPED ONE
 * -----------------------------------------------------------------------------
 *
 * The obvious behaviour — "type a key, press Test, and we will save-then-test
 * it" — is the wrong one, and this component deliberately refuses it. Testing a
 * key means storing it: the API tests what is saved, because a test endpoint
 * that accepted a key in its body would be a way to have this deployment make
 * arbitrary authenticated calls to OpenAI on somebody else's credential. So a
 * "test before saving" button would have to save first, silently, and the user
 * would have replaced a working key with a broken one by pressing a button
 * labelled Test.
 *
 * Instead Test is enabled only when a key is stored AND the field is empty, and
 * the disabled state says so. Save, then test.
 */

import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { formatRelativeTime } from '../../utils/relativeTime';
import type { AiKeySummary, AiTestResult, MyAiKeyStatus } from '../../types';

export interface OpenAiKeyFormProps {
  /** The full status where one is available; `AiKeySummary` is enough to render. */
  status: MyAiKeyStatus | AiKeySummary | null;
  variant: 'setup' | 'settings';
  onSave: (apiKey: string) => Promise<boolean>;
  onTest: () => Promise<void>;
  /** Omitted on the setup page: there is nothing to return to after removing. */
  onRemove?: () => Promise<boolean>;
  isSaving: boolean;
  isTesting: boolean;
  testResult: AiTestResult | null;
  clearTestResult: () => void;
  saveError: string | null;
}

/** `lastTest` only exists on the full status. */
function lastTestOf(
  status: MyAiKeyStatus | AiKeySummary | null,
): MyAiKeyStatus['lastTest'] {
  return status && 'lastTest' in status ? status.lastTest : null;
}

export function OpenAiKeyForm({
  status,
  variant,
  onSave,
  onTest,
  onRemove,
  isSaving,
  isTesting,
  testResult,
  clearTestResult,
  saveError,
}: OpenAiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const configured = status?.configured ?? false;
  const trimmed = apiKey.trim();
  const lastTest = lastTestOf(status);

  const handleSave = async () => {
    if (!trimmed) return;
    // TRIMMED HERE, not server-side. A copy from a terminal or a password
    // manager routinely brings a trailing newline, and the API deliberately
    // rejects internal whitespace rather than altering a secret's bytes — so
    // the one safe normalisation is the one the user can see happening in the
    // field they are looking at.
    const ok = await onSave(trimmed);
    if (ok) {
      setApiKey('');
      setShowKey(false);
    }
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      const ok = await onRemove?.();
      if (ok) setConfirmRemove(false);
    } finally {
      setIsRemoving(false);
    }
  };

  const saveLabel = variant === 'setup' ? 'Save and continue' : 'Save key';

  /** Why Test is unavailable, or null. See the header for the central case. */
  const testBlockedReason = !configured
    ? 'Save a key first, then test it.'
    : trimmed
      ? 'Save the key you have typed, then test it.'
      : null;

  const statusLine = configured
    ? `Configured${status && 'hint' in status && status.hint ? ` · ${status.hint}` : ''}` +
      (lastTest
        ? ` · last tested ${formatRelativeTime(lastTest.attemptedAt)} (${
            lastTest.success ? 'worked' : 'failed'
          })`
        : '')
    : 'No key saved';

  return (
    <Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 2 }}
        // Announced on change: saving a key updates this line and nothing else
        // moves, so a screen-reader user would otherwise get no feedback at all.
        aria-live="polite"
      >
        {statusLine}
      </Typography>

      <TextField
        fullWidth
        type={showKey ? 'text' : 'password'}
        label={configured ? 'Replace key' : 'OpenAI API key'}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        // The browser must not offer to fill or store this: it is a service
        // credential, not the user's own password.
        autoComplete="off"
        spellCheck={false}
        disabled={isSaving}
        helperText={
          trimmed && !trimmed.startsWith('sk-')
            ? 'OpenAI keys usually start with sk- — check you copied the whole value.'
            : 'Stored encrypted. It is never shown again, and never sent anywhere but OpenAI.'
        }
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowKey((v) => !v)}
                  edge="end"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      {saveError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {saveError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!trimmed || isSaving || isTesting}
        >
          {isSaving ? 'Saving…' : saveLabel}
        </Button>

        <Button
          variant="outlined"
          onClick={onTest}
          disabled={isTesting || testBlockedReason !== null}
        >
          {isTesting ? 'Testing…' : 'Test key'}
        </Button>

        {testBlockedReason && (
          <Typography variant="body2" color="text.secondary">
            {testBlockedReason}
          </Typography>
        )}
      </Box>

      {onRemove && configured && (
        <Box sx={{ mt: 3 }}>
          <Button color="error" onClick={() => setConfirmRemove(true)}>
            Remove key
          </Button>
        </Box>
      )}

      {/* THE DIAGNOSTIC SURFACE. Persistent and dismissible, not a snackbar:
          `Incorrect API key provided: sk-***` is the entire reason the button
          exists, and it does not fit in a toast.

          Driven by `testResult.success`, never by "the call resolved" — the
          endpoint answers 200 for a refused key, and that refusal IS the
          answer. */}
      {testResult && (
        <Box
          component="section"
          aria-label="Test result"
          role={testResult.success ? 'status' : 'alert'}
        >
          <Alert
            severity={testResult.success ? 'success' : 'error'}
            sx={{ mt: 3 }}
            onClose={clearTestResult}
          >
            {testResult.success ? (
              <>
                <AlertTitle>Key works</AlertTitle>
                {testResult.checks && (
                  <Box>
                    Checks: models {testResult.checks.listModels} · generate{' '}
                    {testResult.checks.generate}
                    {testResult.checks.generate === 'skipped' && (
                      <>
                        {' '}
                        — your administrator has not chosen a model yet, so there was nothing
                        to generate with. Your key is fine.
                      </>
                    )}
                  </Box>
                )}
              </>
            ) : (
              <>
                <AlertTitle>Test failed</AlertTitle>
                {testResult.checks && (
                  <Box sx={{ mb: 1 }}>
                    Checks: models {testResult.checks.listModels} · generate{' '}
                    {testResult.checks.generate}
                  </Box>
                )}
                {/* VERBATIM, in monospace, wrapping rather than truncating.
                    OpenAI's message carries the actual cause; an ellipsis in
                    the middle of one costs the user the answer. */}
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    fontFamily: 'monospace',
                    fontSize: '0.8125rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {testResult.error ?? 'OpenAI reported a failure with no message.'}
                </Box>
              </>
            )}
          </Alert>
        </Box>
      )}

      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)}>
        <DialogTitle>Remove your OpenAI key?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {/* Says exactly what happens next, because it is not obvious and it
                is not small: the app's own gate (#29) sends the user to the
                setup page immediately after this. */}
            You will be asked for a key again before you can use EvolvePath. The stored key is
            deleted and cannot be recovered — you will need to paste it again or create a new
            one at OpenAI.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button color="error" onClick={handleRemove} disabled={isRemoving}>
            {isRemoving ? 'Removing…' : 'Remove key'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
