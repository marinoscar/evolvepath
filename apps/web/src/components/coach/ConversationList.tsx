import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

import type { CoachConversation } from '../../types';

export interface ConversationListProps {
  items: CoachConversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function ConversationList({
  items,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: ConversationListProps) {
  const [confirming, setConfirming] = useState<CoachConversation | null>(null);

  return (
    <Box data-testid="conversation-list">
      <Box sx={{ p: 2 }}>
        <Button variant="outlined" fullWidth onClick={onNew}>
          New conversation
        </Button>
      </Box>

      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
          No conversations yet.
        </Typography>
      ) : (
        <List disablePadding>
          {items.map((conversation) => (
            // `ListItem` + `secondaryAction`, not a delete button INSIDE the
            // row button. The nested form renders a focusable control inside
            // another one, which axe flags as `nested-interactive` and which
            // genuinely traps keyboard users: tabbing to Delete also selects
            // the conversation. The `li` wrapper is why the `ul` is a valid
            // list at all.
            <ListItem
              key={conversation.id}
              disablePadding
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  aria-label={`Delete ${conversation.title ?? 'conversation'}`}
                  onClick={() => setConfirming(conversation)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemButton
                selected={conversation.id === activeId}
                onClick={() => onSelect(conversation.id)}
              >
                <ListItemText
                  primary={conversation.title ?? 'Untitled conversation'}
                  secondary={new Date(conversation.lastMessageAt).toLocaleDateString()}
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)}>
        <DialogTitle>Delete this conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The messages are removed. Any plan change you already accepted stays
            in your plan history.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              const target = confirming;
              setConfirming(null);
              if (target) onDelete(target.id);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
