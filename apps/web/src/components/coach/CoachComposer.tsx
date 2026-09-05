import { useState, type KeyboardEvent } from 'react';
import { Box, IconButton, TextField } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

/**
 * Enter sends; Shift+Enter is a newline.
 *
 * The composer keeps focus after a send, because the next thing a user does in
 * a conversation is usually type again — and a send that stole focus back to
 * the page would make a keyboard-only conversation a chore.
 */
export default function CoachComposer({
  disabled = false,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText('');
    onSend(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        p: 2,
        borderTop: 1,
        borderColor: 'divider',
        alignItems: 'flex-end',
      }}
    >
      <TextField
        fullWidth
        multiline
        maxRows={6}
        size="small"
        value={text}
        placeholder="Message the coach"
        // On the INPUT, not the FormControl root. `aria-label` passed to
        // `TextField` lands on the wrapper, where a screen reader reading the
        // textbox never sees it.
        slotProps={{ htmlInput: { 'aria-label': 'Message the coach' } }}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <IconButton
        color="primary"
        aria-label="Send"
        disabled={disabled || text.trim().length === 0}
        onClick={submit}
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
