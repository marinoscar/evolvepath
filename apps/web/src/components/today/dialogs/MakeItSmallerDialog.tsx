import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { DecompositionProposal } from '../../../types';

interface MakeItSmallerDialogProps {
  open: boolean;
  title: string;
  proposal: DecompositionProposal | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (proposal: DecompositionProposal) => Promise<unknown>;
}

/**
 * "Break this down."
 *
 * THE FIRST STEP IS EDITABLE, and that is the point of the screen. PRD §15 says
 * AI output is not persisted without the user's approval, and approval that
 * cannot change anything is just a confirm button — so the field the user is
 * about to commit to is a text input, not a label.
 *
 * When the coach is unavailable the API still answers with a real five-minute
 * first move (`source: 'template'`). The dialog says so plainly rather than
 * showing an error: a stuck user who reached for help should get help, not a
 * status report about a provider.
 */
export function MakeItSmallerDialog({
  open,
  title,
  proposal,
  isLoading,
  error,
  onClose,
  onApply,
}: MakeItSmallerDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [firstStepTitle, setFirstStepTitle] = useState('');
  const [firstStepMinutes, setFirstStepMinutes] = useState('5');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!proposal) return;
    setFirstStepTitle(proposal.firstStep.title);
    setFirstStepMinutes(String(proposal.firstStep.minutes));
  }, [proposal]);

  const submit = async () => {
    if (!proposal || !firstStepTitle.trim()) return;

    setSaving(true);
    try {
      await onApply({
        ...proposal,
        firstStep: {
          title: firstStepTitle.trim(),
          minutes: Math.min(15, Math.max(1, Number(firstStepMinutes) || 5)),
        },
      });
      onClose();
    } catch {
      // STAY OPEN — the edited first step is not lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>Make “{title}” smaller</DialogTitle>
      <DialogContent>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress data-testid="decompose-loading" />
          </Box>
        )}

        {!isLoading && error && <Alert severity="error">{error}</Alert>}

        {!isLoading && proposal && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>{proposal.message}</Typography>

            {proposal.source === 'template' && (
              <Chip
                size="small"
                variant="outlined"
                label="The coach is unavailable"
                data-testid="decompose-template"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Start with this
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="First step"
                  value={firstStepTitle}
                  onChange={(event) => setFirstStepTitle(event.target.value)}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
                <TextField
                  label="Minutes"
                  type="number"
                  value={firstStepMinutes}
                  onChange={(event) => setFirstStepMinutes(event.target.value)}
                  sx={{ width: 110 }}
                  slotProps={{ htmlInput: { min: 1, max: 15 } }}
                />
              </Stack>
            </Box>

            {proposal.steps.length > 1 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Then
                </Typography>
                <List dense disablePadding data-testid="decompose-steps">
                  {proposal.steps.slice(1).map((step, index) => (
                    <ListItem key={`${step.title}-${index}`} sx={{ px: 0 }}>
                      <ListItemText primary={step.title} secondary={`${step.minutes} min`} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Not now
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={saving || isLoading || !proposal || !firstStepTitle.trim()}
        >
          Use this
        </Button>
      </DialogActions>
    </Dialog>
  );
}
