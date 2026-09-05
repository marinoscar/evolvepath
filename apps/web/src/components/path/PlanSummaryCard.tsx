import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';

import type { Plan, PlanVersionSummary } from '../../types';

interface PlanSummaryCardProps {
  plan: Plan | null;
  activeVersion: PlanVersionSummary | null;
  disabled?: boolean;
  onCreatePlan: () => void;
  onNewVersion: () => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function PlanSummaryCard({
  plan,
  activeVersion,
  disabled = false,
  onCreatePlan,
  onNewVersion,
}: PlanSummaryCardProps) {
  if (!plan) {
    return (
      <Card data-testid="plan-summary">
        <CardContent>
          <Typography variant="h6" component="h2" gutterBottom>
            No plan yet
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            A plan is how this outcome becomes something you actually do.
          </Typography>
          <Button
            variant="contained"
            onClick={onCreatePlan}
            disabled={disabled}
            data-testid="create-plan"
          >
            Create plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="plan-summary">
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}
        >
          <Typography variant="h6" component="h2">
            {activeVersion ? `Plan v${activeVersion.version}` : 'Plan'}
          </Typography>
          {activeVersion ? (
            <Chip label={activeVersion.status} size="small" color="success" />
          ) : (
            // A plan whose only version is a draft: real, and not yet in force.
            <Chip label="No active version" size="small" variant="outlined" />
          )}
        </Stack>

        {activeVersion?.activeFrom && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Active since {formatDate(activeVersion.activeFrom)}
          </Typography>
        )}

        {activeVersion?.rationale && (
          <Typography sx={{ mb: 2 }}>{activeVersion.rationale}</Typography>
        )}

        <Button
          variant="outlined"
          onClick={onNewVersion}
          disabled={disabled}
          sx={{ mt: 1 }}
          data-testid="new-plan-version"
        >
          New version
        </Button>
      </CardContent>
    </Card>
  );
}

export default PlanSummaryCard;
