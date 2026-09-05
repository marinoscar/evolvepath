import type { ReactNode } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  SwipeableDrawer,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface EditorShellProps {
  open: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A bottom sheet on a phone, a dialog on anything wider.
 *
 * The `sm` here is a LOCAL PRESENTATION CHOICE — the same one `QuickAddSheet`
 * makes — and is deliberately NOT one of the shell's five coupled breakpoint
 * gates. Those decide which navigation is mounted and move together or not at
 * all; this one decides whether a form slides up or appears in the middle, and
 * changing it affects nothing but this form.
 */
export function EditorShell({ open, title, titleId, onClose, children }: EditorShellProps) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));

  const heading = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography variant="h6" component="h2" id={titleId}>
        {title}
      </Typography>
      <IconButton aria-label="Close" onClick={onClose} size="small">
        <CloseIcon />
      </IconButton>
    </Box>
  );

  if (isCompact) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        onOpen={() => undefined}
        disableSwipeToOpen
        slotProps={{
          paper: {
            'aria-labelledby': titleId,
            sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '92vh' },
          },
        }}
      >
        <Box sx={{ p: 2, pb: 4 }}>
          {heading}
          {children}
        </Box>
      </SwipeableDrawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={titleId}>
      <DialogTitle component="div" sx={{ pb: 1 }}>
        {heading}
      </DialogTitle>
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}
