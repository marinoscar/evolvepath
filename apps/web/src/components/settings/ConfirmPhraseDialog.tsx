/**
 * A destructive confirmation that asks the user to TYPE a phrase.
 *
 * Issue #224, epic #220. There was no typed-confirmation pattern in this
 * codebase before this: the two destructive confirmations that exist —
 * `OpenAiKeyForm`'s remove dialog and the DataTable's `useRowActionConfirm` —
 * are both plain yes/no, which is the right weight for "you will have to paste
 * your key again" and the wrong weight for "everything you have built is gone".
 *
 * ONE PARAMETERISED COMPONENT, never a second copy per scope. The reset page
 * opens this twice with different props rather than rendering two dialogs, for
 * the same reason `SettingsHub` takes `sections` as a prop instead of closing
 * over one registry: a second copy drifts on exactly the details that matter —
 * whether the button stays disabled, whether the comparison trims, what the
 * error region announces.
 *
 * -----------------------------------------------------------------------------
 * THE PHRASE IS A PROP, READ FROM THE SERVER — NEVER A CONSTANT IN THIS APP
 * -----------------------------------------------------------------------------
 *
 * `GET /api/account/data-summary` returns the phrases alongside the counts, and
 * they arrive here through the page. A hardcoded copy would keep matching the
 * user's typing on the day the server's phrase changed — the button would
 * enable, the request would go, and the API would refuse it. The dialog's only
 * real gate would have been silently disabled, and the symptom would be a
 * confusing 400 rather than anything pointing at the stale constant.
 *
 * -----------------------------------------------------------------------------
 * THE DISABLED BUTTON IS A CONVENIENCE, NOT THE CONTROL
 * -----------------------------------------------------------------------------
 *
 * The confirm button stays disabled until the typed text matches exactly (trim
 * only — the comparison is case-sensitive, because "delete my data" typed in
 * passing is not the deliberate act the phrase exists to require), and no
 * request is sent before then. That is a courtesy to somebody who half-meant
 * it. The control is the server, which re-verifies the phrase on every call:
 * nothing stops a direct POST from a script, so nothing here is load-bearing
 * for correctness.
 *
 * Which is exactly why `onConfirm` hands the caller WHAT THE USER TYPED rather
 * than nothing, and why the caller must send that string on the wire instead of
 * the `phrase` prop it already holds. Sending the canonical phrase back would
 * make the server's check unfalsifiable from this client — it could never
 * reject a request the browser sent, so a bug in `matches` above would be the
 * only gate operating for every real user, undetected, with the server's
 * re-verification quietly reduced to theatre for scripts alone. The typed text
 * is the input the control exists to check; it is the input that gets checked.
 *
 * `fullScreen` below `sm` is a LOCAL layout choice inside this component, as in
 * every other dialog in this app. It is not one of the five coupled breakpoint
 * gates in CLAUDE.md and it touches none of them.
 */

import { useEffect, useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

export interface ConfirmPhraseDialogProps {
  open: boolean;
  title: string;
  /** What is about to happen, in the user's terms. Rendered above the list. */
  description: string;
  /** The exact string the user must type. Comes from the API — see the header. */
  phrase: string;
  /** One sentence fragment per thing that will be erased; already non-zero only. */
  consequences: string[];
  /** The request is in flight: the field and both buttons lock. */
  isBusy: boolean;
  /** The server's own message, or null. Announced when it appears. */
  error: string | null;
  confirmLabel: string;
  onCancel: () => void;
  /**
   * Called with the text the user actually typed, NOT with `phrase`. The caller
   * sends this string to the server verbatim — see the header for why handing
   * back the canonical phrase would defeat the server-side check.
   */
  onConfirm: (typedPhrase: string) => void;
}

export function ConfirmPhraseDialog({
  open,
  title,
  description,
  phrase,
  consequences,
  isBusy,
  error,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmPhraseDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  // `useId` rather than literal ids: this component is opened twice on the
  // reset page, and two dialogs sharing an id would point every `aria-*`
  // reference at whichever mounted first.
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  const consequencesId = `${idPrefix}-consequences`;
  const inputId = `${idPrefix}-phrase`;

  const [typed, setTyped] = useState('');

  // A fresh field each time it opens. Carrying the previous attempt's text
  // over would leave a dialog for the WIDER scope already armed with the
  // narrower one's phrase still on screen.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = typed.trim() === phrase;

  return (
    <Dialog
      open={open}
      onClose={isBusy ? undefined : onCancel}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>

      <DialogContent>
        <DialogContentText id={descriptionId}>{description}</DialogContentText>

        {/* THE REAL COUNTS, not an abstract warning. "This will delete your
            data" is something a person can agree to without picturing any of
            it; "4 commitments · 1 photo or video · 2 coach conversations" is
            the same sentence with the part they can actually weigh. */}
        {consequences.length > 0 && (
          <Box
            component="section"
            aria-label="What will be erased"
            sx={{ mt: 2 }}
          >
            <Typography variant="subtitle2" component="h3">
              This will erase
            </Typography>
            <List id={consequencesId} dense disablePadding>
              {consequences.map((line) => (
                <ListItem key={line} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText primary={line} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {/* A REAL `<label>`, never a placeholder. The phrase is quoted in the
            label itself so a screen-reader user hears what to type at the
            moment focus lands in the field, rather than having to go looking
            for it in the prose above. */}
        <TextField
          id={inputId}
          label={`Type ${phrase} to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          fullWidth
          autoFocus
          disabled={isBusy}
          autoComplete="off"
          spellCheck={false}
          sx={{ mt: 3 }}
          slotProps={{
            htmlInput: {
              'aria-describedby': consequences.length > 0 ? consequencesId : undefined,
            },
          }}
        />

        {error && (
          <Alert severity="error" role="alert" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => onConfirm(typed)}
          disabled={!matches || isBusy}
        >
          {isBusy ? 'Erasing…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
