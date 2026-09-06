import { Alert, Box, Button, Stack, Typography } from '@mui/material';

import type { CommitmentCard, FrictionIntervention } from '../../types';

interface InterventionCardProps {
  intervention: FrictionIntervention;
  commitment: Pick<CommitmentCard, 'id' | 'title' | 'versions'>;
  pending?: boolean;
  onStart: (minutes: number, instruction: string) => void;
  onUseMinimum: () => void;
  onProtectedReschedule: (slot: { scheduledStart: string; scheduledEnd: string }) => void;
  onDismiss: () => void;
}

/**
 * What the coach (or the template) suggests doing about the friction the user
 * just named (VISION §9, epic E07).
 *
 * The buttons are the point. A message with no move attached is the sympathy a
 * user closes the app over — every branch here ends in something they can press
 * that starts a timer within the next ten minutes.
 */
export function InterventionCard({
  intervention,
  commitment,
  pending = false,
  onStart,
  onUseMinimum,
  onProtectedReschedule,
  onDismiss,
}: InterventionCardProps) {
  const action = intervention.recommendedAction;
  const minimum = commitment.versions.minimum;
  const slot = intervention.suggestedReschedule;

  return (
    <Box data-testid="intervention-card">
      <Typography sx={{ mb: 2 }}>{intervention.userMessage}</Typography>

      {action && (
        <Alert severity="info" icon={false} sx={{ mb: 2 }}>
          <Typography variant="subtitle2">{action.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {action.durationMinutes} min
          </Typography>
        </Alert>
      )}

      <Stack spacing={1}>
        {action && (
          <Button
            variant="contained"
            disabled={pending}
            data-testid="intervention-start"
            onClick={() => onStart(action.durationMinutes, action.title)}
            sx={{ minHeight: 44 }}
          >
            Start {action.durationMinutes} minutes
          </Button>
        )}

        {slot && (
          <Button
            variant="contained"
            disabled={pending}
            data-testid="intervention-protected-reschedule"
            onClick={() => onProtectedReschedule(slot)}
            sx={{ minHeight: 44 }}
          >
            Move it (protected)
          </Button>
        )}

        {minimum && (
          <Button
            variant="outlined"
            disabled={pending}
            data-testid="intervention-minimum"
            onClick={onUseMinimum}
            sx={{ minHeight: 44 }}
          >
            Use minimum version ({minimum.minutes} min)
          </Button>
        )}

        <Button variant="text" disabled={pending} onClick={onDismiss} sx={{ minHeight: 44 }}>
          Not now
        </Button>
      </Stack>

      {/*
        Said out loud rather than hidden. A template answer is a complete one
        (PRD §120), and a user who thinks a coach wrote this sentence would read
        more into it than is there.
      */}
      {intervention.source === 'template' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Standard suggestion — the coach is unavailable.
        </Typography>
      )}
    </Box>
  );
}
