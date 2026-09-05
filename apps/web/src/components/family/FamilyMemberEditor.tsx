import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';

import type { FamilyMember, FamilyMemberInput, FamilyRelationship } from '../../types';
import { EditorShell } from './EditorShell';
import { RELATIONSHIPS, RELATIONSHIP_LABELS } from './familyLabels';

interface FamilyMemberEditorProps {
  open: boolean;
  initial?: FamilyMember | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (input: FamilyMemberInput) => Promise<void>;
}

/** What the editor sends when the user does not know the year (PRD §33). */
export const PLACEHOLDER_YEAR = '1900';

const NICKNAME_MAX = 40;

/**
 * The whole family member record, and there is nothing else to put here.
 *
 * PRD §33 fixes the fields at nickname, relationship and an optional birthday;
 * VISION §50 says why — the people in it never consented to being modeled, and
 * a "notes" field about a child becomes a hidden assessment the moment the
 * coach reads it back. A future request for one belongs in that conversation,
 * not in this form.
 */
export function FamilyMemberEditor({
  open,
  initial = null,
  submitting = false,
  onClose,
  onSubmit,
}: FamilyMemberEditorProps) {
  const [nickname, setNickname] = useState('');
  const [relationship, setRelationship] = useState<FamilyRelationship>('PARTNER');
  const [birthday, setBirthday] = useState('');
  const [yearUnknown, setYearUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setNickname(initial?.nickname ?? '');
    setRelationship(initial?.relationship ?? 'PARTNER');
    setBirthday(initial?.birthday ?? '');
    setYearUnknown(initial?.birthday?.startsWith(PLACEHOLDER_YEAR) ?? false);
    setError(null);
  }, [open, initial]);

  const submit = async () => {
    const trimmed = nickname.trim();
    if (trimmed.length === 0) {
      setError('Give them a name to go by');
      return;
    }

    let value: string | null = birthday.trim() ? birthday.trim() : null;
    if (value && yearUnknown) value = `${PLACEHOLDER_YEAR}${value.slice(4)}`;

    setError(null);
    try {
      await onSubmit({ nickname: trimmed, relationship, birthday: value });
    } catch (err) {
      // The sheet stays open with the values intact — the server's message says
      // what to change, and re-typing the form is not part of that.
      setError(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  return (
    <EditorShell
      open={open}
      title={initial ? 'Edit family member' : 'Add a family member'}
      titleId="family-member-editor-title"
      onClose={onClose}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="What you call them"
          value={nickname}
          autoFocus
          error={error !== null}
          helperText={error ?? `${nickname.length}/${NICKNAME_MAX}`}
          onChange={(event) => setNickname(event.target.value.slice(0, NICKNAME_MAX))}
          slotProps={{ htmlInput: { maxLength: NICKNAME_MAX, 'data-testid': 'member-nickname' } }}
        />

        <TextField
          select
          label="Relationship"
          value={relationship}
          onChange={(event) => setRelationship(event.target.value as FamilyRelationship)}
          slotProps={{ htmlInput: { 'data-testid': 'member-relationship' } }}
        >
          {RELATIONSHIPS.map((value) => (
            <MenuItem key={value} value={value}>
              {RELATIONSHIP_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>

        <Box>
          <TextField
            label="Birthday (optional)"
            type="date"
            fullWidth
            value={birthday}
            onChange={(event) => setBirthday(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { 'data-testid': 'member-birthday' },
            }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={yearUnknown}
                onChange={(event) => setYearUnknown(event.target.checked)}
              />
            }
            // The year is never displayed anywhere, so an unknown one costs
            // nothing — but forcing a guess would put a wrong fact on the record.
            label="I don’t know the year"
          />
        </Box>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={submitting}
            data-testid="member-save"
            onClick={() => void submit()}
          >
            Save
          </Button>
        </Stack>
      </Stack>
    </EditorShell>
  );
}
