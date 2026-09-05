import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { BestSelfInput, BestSelfProfile } from '../../types';
import { ChipListInput } from './ChipListInput';

interface BestSelfDialogProps {
  open: boolean;
  initial: BestSelfProfile | null;
  onClose: () => void;
  onSave: (input: BestSelfInput) => Promise<unknown>;
}

/**
 * The form's own value type: every field present and non-null.
 *
 * `BestSelfInput`'s fields are `string | null` because that is what the wire
 * accepts, but a controlled `TextField` cannot hold null — it would flip to
 * uncontrolled the moment a field was cleared. The conversion between the two
 * happens once, in `handleSave`.
 */
interface BestSelfFormValues {
  identityStatement: string;
  workIdentity: string;
  familyIdentity: string;
  healthIdentity: string;
  sixMonthVision: string;
  motivations: string[];
  reasons: string[];
}

const EMPTY: BestSelfFormValues = {
  identityStatement: '',
  workIdentity: '',
  familyIdentity: '',
  healthIdentity: '',
  sixMonthVision: '',
  motivations: [],
  reasons: [],
};

/**
 * Replaces the whole profile — the API has no PATCH for it, deliberately: a
 * Best Self statement is one thought, and a half-updated one is not a state
 * the user asked for. So this form always shows every field, populated.
 */
export function BestSelfDialog({ open, initial, onClose, onSave }: BestSelfDialogProps) {
  const theme = useTheme();
  // A dialog that fills a phone screen; a modal above it. Local layout, not one
  // of the five coupled navigation gates.
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [values, setValues] = useState<BestSelfFormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded on every open so a cancelled edit does not persist into the next.
  useEffect(() => {
    if (!open) return;
    setValues({
      identityStatement: initial?.identityStatement ?? '',
      workIdentity: initial?.workIdentity ?? '',
      familyIdentity: initial?.familyIdentity ?? '',
      healthIdentity: initial?.healthIdentity ?? '',
      sixMonthVision: initial?.sixMonthVision ?? '',
      motivations: initial?.motivations ?? [],
      reasons: initial?.reasons ?? [],
    });
    setError(null);
  }, [open, initial]);

  const set = <K extends keyof BestSelfFormValues>(key: K, value: BestSelfFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        // Empty strings are sent as null: "" and "not set" mean the same thing
        // to a user and should not be two different states in the database.
        identityStatement: values.identityStatement.trim() || null,
        workIdentity: values.workIdentity.trim() || null,
        familyIdentity: values.familyIdentity.trim() || null,
        healthIdentity: values.healthIdentity.trim() || null,
        sixMonthVision: values.sixMonthVision.trim() || null,
        motivations: values.motivations,
        reasons: values.reasons,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      aria-labelledby="best-self-dialog-title"
    >
      <DialogTitle id="best-self-dialog-title">Your Best Self</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Identity statement"
            placeholder="Focused, present, healthy"
            value={values.identityStatement}
            onChange={(event) => set('identityStatement', event.target.value)}
            fullWidth
            multiline
            helperText="One sentence. Who are you becoming?"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="Six-month vision"
            value={values.sixMonthVision}
            onChange={(event) => set('sixMonthVision', event.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="What does the next six months look like if this goes well?"
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            label="At work"
            value={values.workIdentity}
            onChange={(event) => set('workIdentity', event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="With family"
            value={values.familyIdentity}
            onChange={(event) => set('familyIdentity', event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <TextField
            label="In health"
            value={values.healthIdentity}
            onChange={(event) => set('healthIdentity', event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <ChipListInput
            label="What drives you"
            value={values.motivations}
            onChange={(next) => set('motivations', next)}
          />
          <ChipListInput
            label="Why it matters"
            value={values.reasons}
            onChange={(next) => set('reasons', next)}
          />
          {/* `role="alert"` so a save failure is announced, not just drawn. */}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default BestSelfDialog;
