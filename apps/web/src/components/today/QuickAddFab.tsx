import { Fab } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

interface QuickAddFabProps {
  onClick: () => void;
}

/**
 * The quick-add button (PRD §12.1).
 *
 * `bottom: { xs: 80, sm: 24 }` is the one number here that matters: below the
 * `sm` boundary `BottomNav` is mounted and the FAB has to clear it. This READS
 * the same boundary the shell's five coupled gates use rather than introducing a
 * sixth — the FAB does not decide when the bottom bar exists, it just gets out
 * of its way.
 */
export function QuickAddFab({ onClick }: QuickAddFabProps) {
  return (
    <Fab
      color="primary"
      aria-label="Add something to today"
      onClick={onClick}
      data-testid="quick-add-fab"
      sx={{ position: 'fixed', bottom: { xs: 80, sm: 24 }, right: 24 }}
    >
      <AddIcon />
    </Fab>
  );
}
