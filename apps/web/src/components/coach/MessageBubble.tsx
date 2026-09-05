import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import type { CoachMessage, DiffEntry, PlanChange } from '../../types';
import type { ProposalOutcome } from '../../hooks/useProposals';
import FrictionQuestion from './FrictionQuestion';
import ProposalCard, { diffFromChanges } from './ProposalCard';
import RecommendedActionCard from './RecommendedActionCard';
import SafetyNote from './SafetyNote';
import WhyThisExpander from './WhyThisExpander';

export interface MessageBubbleProps {
  message: CoachMessage;
  outcomes: Record<string, ProposalOutcome>;
  pendingProposalId: string | null;
  onRetry: (tempId: string) => void;
  onAnswerFriction: (option: string) => void;
  onAcceptProposal: (id: string) => void;
  onEditProposal: (id: string, changes: PlanChange[]) => void;
  onRejectProposal: (id: string) => void;
}

export default function MessageBubble({
  message,
  outcomes,
  pendingProposalId,
  onRetry,
  onAnswerFriction,
  onAcceptProposal,
  onEditProposal,
  onRejectProposal,
}: MessageBubbleProps) {
  // A SYSTEM turn is not somebody talking. It is the app reporting what the
  // conversation caused ("Plan updated to v2."), so it sits centred and muted
  // rather than on either side.
  if (message.role === 'SYSTEM') {
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: 'center', my: 1 }}
        data-testid="system-message"
      >
        {message.content}
      </Typography>
    );
  }

  const isUser = message.role === 'USER';
  const reply = message.structured;
  const proposal = reply?.proposal ?? null;
  const diff: DiffEntry[] = proposal ? diffFromChanges(proposal.changes) : [];

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        my: 1,
      }}
    >
      <Box sx={{ maxWidth: { xs: '100%', sm: '85%' } }}>
        <Paper
          variant={isUser ? 'elevation' : 'outlined'}
          elevation={isUser ? 1 : 0}
          sx={{
            p: 1.5,
            bgcolor: isUser ? 'action.hover' : 'background.paper',
            opacity: message.status === 'pending' ? 0.7 : 1,
          }}
          data-testid={isUser ? 'user-message' : 'coach-message'}
        >
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Typography>

          {message.status === 'pending' && (
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
              <CircularProgress size={12} />
              <Typography variant="caption" color="text.secondary">
                Sending…
              </Typography>
            </Stack>
          )}

          {message.status === 'failed' && (
            <Alert
              severity="error"
              sx={{ mt: 1 }}
              action={
                // The text is still in the bubble, so Retry has something to
                // retry. A failure that discarded what the user wrote would
                // make this button a lie.
                <Button color="inherit" size="small" onClick={() => onRetry(message.id)}>
                  Retry
                </Button>
              }
            >
              Not sent.
            </Alert>
          )}
        </Paper>

        {!isUser && reply?.recommended_action && (
          <RecommendedActionCard
            action={reply.recommended_action}
            fallback={reply.fallback_action}
          />
        )}

        {!isUser && reply?.friction_question && (
          <FrictionQuestion
            question={reply.friction_question}
            onAnswer={onAnswerFriction}
          />
        )}

        {!isUser && proposal && (
          <ProposalCard
            proposal={proposal}
            outcome={proposal.proposalId ? outcomes[proposal.proposalId] : undefined}
            diff={diff}
            busy={
              proposal.proposalId !== undefined &&
              pendingProposalId === proposal.proposalId
            }
            onAccept={onAcceptProposal}
            onEdit={onEditProposal}
            onReject={onRejectProposal}
          />
        )}

        {!isUser && message.safety && <SafetyNote safety={message.safety} />}

        {/* Absent on a fallback reply: a template has no reasoning to explain,
            and `structured` is null exactly when there was no model output. */}
        {!isUser && reply && <WhyThisExpander summary={reply.reasoning_summary} />}
      </Box>
    </Box>
  );
}
