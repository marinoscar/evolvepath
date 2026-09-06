import { Box, Chip, Stack, Typography } from '@mui/material';

import type {
  Domain,
  OnboardingProposalCommitment,
  OnboardingProposalOutcome,
  OnboardingProposalRoutine,
} from '../../types';
import { CommitmentEditRow } from './CommitmentEditRow';
import { DOMAIN_LABELS } from './copy';

export interface ProposalSectionProps {
  domain: Domain;
  outcome: OnboardingProposalOutcome | null;
  routines: OnboardingProposalRoutine[];
  commitments: OnboardingProposalCommitment[];
  editing: boolean;
  /** Guardrail sentences the server returned for this section, if any. */
  problems: string[];
  min: string;
  max: string;
  canRemoveCommitment: boolean;
  onCommitmentChange: (index: number, next: OnboardingProposalCommitment) => void;
  onCommitmentRemove: (index: number) => void;
}

/**
 * One domain's slice of the first Path (issue #104, epic E04).
 *
 * Outcomes and routines are READ-ONLY here, deliberately. The user is agreeing
 * to a direction, and the thing they realistically need to change before
 * pressing the button is when it happens — editing the outcome belongs on the
 * Path screen (#56), where there is room to think about it.
 *
 * Every string comes from the model. It is rendered as TEXT — there is no
 * `dangerouslySetInnerHTML` anywhere in this tree, and there must never be.
 */
export function ProposalSection({
  domain,
  outcome,
  routines,
  commitments,
  editing,
  problems,
  min,
  max,
  canRemoveCommitment,
  onCommitmentChange,
  onCommitmentRemove,
}: ProposalSectionProps) {
  const headingId = `proposal-${domain.toLowerCase()}`;

  return (
    <Box component="section" aria-labelledby={headingId}>
      <Typography id={headingId} variant="overline" color="text.secondary">
        {DOMAIN_LABELS[domain]}
      </Typography>

      {outcome && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="h6" component="h2">
            {outcome.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {outcome.whyItMatters}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {outcome.successDefinition}
          </Typography>
        </Box>
      )}

      <Stack spacing={1} sx={{ mb: 1.5 }}>
        {routines.map((routine) => (
          <Box key={routine.title}>
            <Typography variant="subtitle2" component="p">
              {routine.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`${routine.triggerValue} · ${routine.idealMinutes} min, ${routine.minimumMinutes} on a bad day`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`If it does not happen: ${routine.fallbackBehavior}`}
            </Typography>
          </Box>
        ))}
      </Stack>

      <Stack spacing={editing ? 1.5 : 0.5}>
        {commitments.map((commitment, index) =>
          editing ? (
            <CommitmentEditRow
              key={`${commitment.title}-${index}`}
              commitment={commitment}
              min={min}
              max={max}
              canRemove={canRemoveCommitment}
              onChange={(next) => onCommitmentChange(index, next)}
              onRemove={() => onCommitmentRemove(index)}
            />
          ) : (
            <Typography key={`${commitment.title}-${index}`} variant="body2">
              {`${formatWhen(commitment.scheduledStart)} · ${commitment.title} · ${commitment.durationMinutes} min`}
            </Typography>
          ),
        )}
      </Stack>

      {problems.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
          {problems.map((problem) => (
            <Chip key={problem} label={problem} color="error" variant="outlined" size="small" />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** "Mon 07:30", in the reader's own zone. */
function formatWhen(iso: string): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return iso;

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}
