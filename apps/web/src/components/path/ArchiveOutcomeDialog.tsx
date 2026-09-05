import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface ArchiveOutcomeDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Archiving is reversible in the sense that matters — nothing is deleted — and
 * the copy says so, because a confirm dialog that does not tell you what
 * happens next just makes you guess.
 */
export function ArchiveOutcomeDialog({
  open,
  title,
  onClose,
  onConfirm,
}: ArchiveOutcomeDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="archive-outcome-title">
      <DialogTitle id="archive-outcome-title">Archive “{title}”?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Archived outcomes stay in your history and can be shown with “Show archived”. Their plans,
          routines and past commitments are kept.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color="warning" variant="contained">
          Archive
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ArchiveOutcomeDialog;
