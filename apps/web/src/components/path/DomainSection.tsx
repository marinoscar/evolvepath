import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import type { Domain, DomainMode, DomainModeKind, Outcome } from '../../types';
import { DOMAIN_LABELS } from '../../types';
import { DomainModeChip } from './DomainModeChip';
import { OutcomeCard } from './OutcomeCard';

interface DomainSectionProps {
  domain: Domain;
  mode: DomainMode;
  outcomes: Outcome[];
  onAddOutcome: (domain: Domain) => void;
  onChangeMode: (domain: Domain, mode: DomainModeKind) => void;
  onOpenOutcome: (outcome: Outcome) => void;
}

export function DomainSection({
  domain,
  mode,
  outcomes,
  onAddOutcome,
  onChangeMode,
  onOpenOutcome,
}: DomainSectionProps) {
  return (
    <Card
      component="section"
      aria-labelledby={`domain-${domain}-heading`}
      data-testid={`domain-section-${domain}`}
      sx={{ height: '100%' }}
    >
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}
        >
          <Typography id={`domain-${domain}-heading`} variant="h6" component="h2">
            {DOMAIN_LABELS[domain]}
          </Typography>
          <DomainModeChip
            domain={domain}
            mode={mode}
            onChange={(next) => onChangeMode(domain, next)}
          />
        </Stack>

        {outcomes.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            No {DOMAIN_LABELS[domain]} outcome yet.
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ mb: 2 }}>
            {outcomes.map((outcome) => (
              <OutcomeCard key={outcome.id} outcome={outcome} onOpen={onOpenOutcome} />
            ))}
          </Stack>
        )}

        <Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => onAddOutcome(domain)}
            // Four "Add outcome" buttons on one screen need four names.
            aria-label={`Add ${DOMAIN_LABELS[domain]} outcome`}
            data-testid={`add-outcome-${domain}`}
          >
            Add outcome
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

export default DomainSection;
