import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Divider,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import ConversationList from '../components/coach/ConversationList';
import ConversationView from '../components/coach/ConversationView';
import { useCoachChat } from '../hooks/useCoachChat';
import { useCoachConversations } from '../hooks/useCoachConversations';
import { useProposals } from '../hooks/useProposals';
import { getSuggestedPrompts } from '../services/api';
import type { SuggestedPrompt } from '../types';

// =============================================================================
// The Coach screen (issue #86, epic E06)
// =============================================================================
//
// PRD §66. Two layouts either side of `sm`, and the `useMediaQuery` below is a
// PAGE-LOCAL layout choice — like `PersonaModelTable`'s — NOT one of the five
// coupled breakpoint gates listed in CLAUDE.md. Nothing here mounts or
// unmounts navigation, changes `<main>`'s padding, or touches the rail; it
// only decides whether the list and the conversation are one screen or two.
//
// The narrow layout is two SCREENS rather than a drawer, because a phone
// conversation wants the whole viewport: a 280 px panel over a 375 px window
// leaves less room for the thing the user came to read than the panel takes.
// =============================================================================

export default function CoachPage() {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();

  const [prompts, setPrompts] = useState<SuggestedPrompt[]>([]);
  const {
    conversations,
    refresh: refreshConversations,
    remove,
  } = useCoachConversations();

  const onConversationCreated = useCallback(
    (id: string) => {
      // `replace`, not `push`: the empty `/coach` the user was on is not a
      // place Back should return them to once the thread exists.
      navigate(`/coach/${id}`, { replace: true });
      void refreshConversations();
    },
    [navigate, refreshConversations],
  );

  const chat = useCoachChat(conversationId, { onConversationCreated });
  const proposals = useProposals();

  useEffect(() => {
    let cancelled = false;
    void getSuggestedPrompts()
      .then((result) => {
        if (!cancelled) setPrompts(result.prompts);
      })
      // The chips are a convenience. A screen that refused to render because a
      // list of seven strings failed to load would be the wrong trade.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const view = (
    <ConversationView
      messages={chat.messages}
      prompts={prompts}
      isLoading={chat.isLoading}
      thinking={chat.thinking}
      error={chat.error}
      outcomes={proposals.outcomes}
      pendingProposalId={proposals.pendingId}
      onSend={(text) => void chat.send(text)}
      onRetry={(tempId) => void chat.retry(tempId)}
      onAcceptProposal={(id) => void proposals.accept(id)}
      onEditProposal={(id, changes) => void proposals.edit(id, changes)}
      onRejectProposal={(id) => void proposals.reject(id)}
    />
  );

  const list = (
    <ConversationList
      items={conversations}
      activeId={conversationId}
      onSelect={(id) => navigate(`/coach/${id}`)}
      onNew={() => navigate('/coach')}
      onDelete={(id) => {
        void remove(id);
        if (id === conversationId) navigate('/coach');
      }}
    />
  );

  if (narrow) {
    // `/coach` is the list; `/coach/:id` is the conversation, full width, with
    // a back arrow. One screen at a time.
    if (!conversationId) {
      return (
        <Box sx={{ height: '100%' }}>
          <Typography variant="h5" component="h1" sx={{ px: 2, pt: 2 }}>
            Coach
          </Typography>
          {list}
        </Box>
      );
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 1 }}>
          <IconButton aria-label="Back to conversations" onClick={() => navigate('/coach')}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="subtitle1" component="h1" noWrap>
            {conversations.find((c) => c.id === conversationId)?.title ?? 'Coach'}
          </Typography>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0 }}>{view}</Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          width: 280,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          overflowY: 'auto',
        }}
      >
        {list}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{view}</Box>
    </Box>
  );
}
