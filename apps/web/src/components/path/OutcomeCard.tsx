import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';

import type { Outcome } from '../../types';
import { ImportanceDots } from './ImportanceDots';

interface OutcomeCardProps {
  outcome: Outcome;
  onOpen: (outcome: Outcome) => void;
}

const STATE_COLORS: Record<Outcome['state'], 'default' | 'success' | 'warning' | 'info'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'info',
  ARCHIVED: 'default',
};

function formatTargetDate(value: string): string {
  // `targetDate` is a plain YYYY-MM-DD with no time of day. Parsing it with
  // `new Date('2026-03-14')` would treat it as UTC midnight and render the
  // PREVIOUS day for anyone west of Greenwich — so the parts are split by hand.
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(year, month - 1, day),
  );
}

export function OutcomeCard({ outcome, onOpen }: OutcomeCardProps) {
  const planLine = outcome.activePlanVersion
    ? `Plan v${outcome.activePlanVersion.version} · active`
    : outcome.planId
      ? 'Plan drafted'
      : 'No plan yet';

  return (
    <Card variant="outlined" data-testid={`outcome-card-${outcome.id}`}>
      {/* A CardActionArea rather than an onClick div: it is a real button, so
          it takes focus, responds to Enter and Space, and reports itself as
          actionable. Its default height clears the 44px touch target. */}
      <CardActionArea onClick={() => onOpen(outcome)} aria-label={`Open ${outcome.title}`}>
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}
          >
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {outcome.title}
            </Typography>
            {/* The state is a WORD, not just a colour. */}
            <Chip
              label={outcome.state}
              size="small"
              color={STATE_COLORS[outcome.state]}
              variant={outcome.state === 'ARCHIVED' ? 'outlined' : 'filled'}
            />
          </Stack>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <ImportanceDots value={outcome.importance} />
            {outcome.targetDate && (
              <Typography variant="caption" color="text.secondary">
                by {formatTargetDate(outcome.targetDate)}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {planLine}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default OutcomeCard;
