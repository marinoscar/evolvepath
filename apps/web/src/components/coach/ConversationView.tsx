import { useEffect, useRef } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material';

import type { CoachMessage, PlanChange, SuggestedPrompt } from '../../types';
import type { ProposalOutcome } from '../../hooks/useProposals';
import CoachComposer from './CoachComposer';
import MessageBubble from './MessageBubble';
import SuggestedPromptChips from './SuggestedPromptChips';

export interface ConversationViewProps {
  messages: CoachMessage[];
  prompts: SuggestedPrompt[];
  isLoading: boolean;
  thinking: boolean;
  error: string | null;
  outcomes: Record<string, ProposalOutcome>;
  pendingProposalId: string | null;
  onSend: (text: string) => void;
  onRetry: (tempId: string) => void;
  onAcceptProposal: (id: string) => void;
  onEditProposal: (id: string, changes: PlanChange[]) => void;
  onRejectProposal: (id: string) => void;
}

export default function ConversationView({
  messages,
  prompts,
  isLoading,
  thinking,
  error,
  outcomes,
  pendingProposalId,
  onSend,
  onRetry,
  onAcceptProposal,
  onEditProposal,
  onRejectProposal,
}: ConversationViewProps) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll, never focus. Moving focus on every arriving message would yank a
    // keyboard user out of whatever they were reading or typing.
    //
    // Feature-detected: jsdom has no layout and therefore no
    // `scrollIntoView`, and a conversation that threw on every new message
    // would fail every test in this file for a reason that has nothing to do
    // with the conversation.
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, thinking]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        // The live region is the message log itself, additions only: a
        // screen reader should hear the coach's reply arrive, not the whole
        // conversation re-read every time something changes.
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation with the coach"
        sx={{ flex: 1, overflowY: 'auto', px: 2, minHeight: 0 }}
      >
        {isLoading && (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        )}

        {!isLoading && messages.length === 0 && (
          <SuggestedPromptChips prompts={prompts} disabled={thinking} onPick={onSend} />
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            outcomes={outcomes}
            pendingProposalId={pendingProposalId}
            onRetry={onRetry}
            onAnswerFriction={onSend}
            onAcceptProposal={onAcceptProposal}
            onEditProposal={onEditProposal}
            onRejectProposal={onRejectProposal}
          />
        ))}

        {thinking && (
          <Stack
            direction="row"
            spacing={1}
            aria-busy="true"
            sx={{ alignItems: 'center', my: 1 }}
            data-testid="coach-thinking"
          >
            <CircularProgress size={14} />
            <Typography variant="body2" color="text.secondary">
              Thinking…
            </Typography>
          </Stack>
        )}

        {error && (
          <Alert severity="warning" sx={{ my: 1 }}>
            {error}
          </Alert>
        )}

        <div ref={bottom} />
      </Box>

      <CoachComposer disabled={thinking} onSend={onSend} />
    </Box>
  );
}
