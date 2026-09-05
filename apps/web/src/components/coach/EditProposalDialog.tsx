import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { PlanChange } from '../../types';

/**
 * Edit a proposal, then accept it.
 *
 * DELIBERATELY NOT A JSON EDITOR. The fields here are the ones a user actually
 * disagrees with — when, and how long — because the point of PRD §15's Edit is
 * "yes, but at ten" rather than "let me author a change set". Anything the
 * dialog cannot express is a conversation with the coach, not a form.
 */
export interface EditProposalDialogProps {
  open: boolean;
  changes: PlanChange[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (changes: PlanChange[]) => void;
}

export default function EditProposalDialog({
  open,
  changes,
  saving = false,
  onClose,
  onSubmit,
}: EditProposalDialogProps) {
  const [draft, setDraft] = useState<PlanChange[]>(changes);

  const patch = (index: number, after: Partial<NonNullable<PlanChange['after']>>) => {
    setDraft((current) =>
      current.map((change, i) =>
        i === index ? { ...change, after: { ...change.after, ...after } } : change,
      ),
    );
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit this change</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {draft.map((change, index) => (
            <Stack key={`${change.op}-${change.target.id ?? index}`} spacing={2}>
              <Typography variant="subtitle2">{change.reason}</Typography>

              <TextField
                label="Time"
                type="time"
                size="small"
                value={change.after?.preferredTime ?? ''}
                onChange={(event) => patch(index, { preferredTime: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />

              <TextField
                label="Day"
                size="small"
                value={change.after?.triggerValue ?? ''}
                onChange={(event) => patch(index, { triggerValue: event.target.value })}
              />

              <TextField
                label="Length (minutes)"
                type="number"
                size="small"
                value={change.after?.estimatedDurationMin ?? ''}
                onChange={(event) =>
                  patch(index, {
                    estimatedDurationMin: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => onSubmit(draft)}
        >
          Save and accept
        </Button>
      </DialogActions>
    </Dialog>
  );
}
