import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Container,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

import type { Domain, DomainMode, DomainModeKind, Outcome, OutcomeInput } from '../types';
import { DOMAIN_ORDER } from '../types';
import { useBestSelf } from '../hooks/useBestSelf';
import { useDomainModes } from '../hooks/useDomainModes';
import { useOutcomes } from '../hooks/useOutcomes';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { BestSelfCard } from '../components/path/BestSelfCard';
import { BestSelfDialog } from '../components/path/BestSelfDialog';
import { DomainSection } from '../components/path/DomainSection';
import { OutcomeFormDialog } from '../components/path/OutcomeFormDialog';

/** A domain the user has never set reports GROW with no stored row. */
const DEFAULT_MODE = (domain: Domain): DomainMode => ({
  domain,
  mode: 'GROW',
  reason: null,
  effectiveFrom: null,
});

/**
 * The Path screen — the PRD §9 hierarchy made visible.
 *
 * ONE ROUTING MODEL, TWO LAYOUTS. An outcome opens at `/path/outcomes/:id` at
 * every width; only the LAYOUT changes across breakpoints (one column of
 * stacked domain cards below `sm`, two at `sm`, three at `md`). The tempting
 * alternative — a master/detail split above `sm` and a route below it — means
 * the same click produces a different URL depending on the window, so a link
 * shared from a laptop lands somewhere else on a phone, and Back means two
 * different things. Layout is a rendering decision; navigation is not.
 */
export default function PathPage() {
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [bestSelfOpen, setBestSelfOpen] = useState(false);
  const [outcomeDialogDomain, setOutcomeDialogDomain] = useState<Domain | null>(null);

  const bestSelf = useBestSelf();
  const domainModes = useDomainModes();
  const outcomes = useOutcomes({ includeArchived: showArchived });

  // Returning from an outcome should land where the user left, not at the top.
  useScrollRestoration('path');

  const byDomain = useMemo(() => {
    const grouped = new Map<Domain, Outcome[]>(DOMAIN_ORDER.map((domain) => [domain, []]));
    for (const outcome of outcomes.outcomes) {
      grouped.get(outcome.domain)?.push(outcome);
    }
    return grouped;
  }, [outcomes.outcomes]);

  const modeFor = (domain: Domain): DomainMode =>
    domainModes.modes.find((mode) => mode.domain === domain) ?? DEFAULT_MODE(domain);

  const handleChangeMode = (domain: Domain, mode: DomainModeKind) => {
    void domainModes.setMode(domain, mode);
  };

  const handleCreateOutcome = async (input: OutcomeInput) => {
    await outcomes.create(input);
  };

  // The first load only. A refetch triggered by "Show archived" must not blank
  // the screen the user is looking at.
  const isFirstLoad = outcomes.isLoading && outcomes.outcomes.length === 0 && !outcomes.error;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap' }}
        >
          <Typography variant="h4" component="h1">
            Path
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                data-testid="show-archived"
              />
            }
            label="Show archived"
          />
        </Stack>

        {(bestSelf.error || domainModes.error || outcomes.error) && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {bestSelf.error ?? domainModes.error ?? outcomes.error}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <BestSelfCard profile={bestSelf.profile} onEdit={() => setBestSelfOpen(true)} />
        </Box>

        {isFirstLoad ? (
          <LoadingSpinner />
        ) : (
          <Grid container spacing={2}>
            {DOMAIN_ORDER.map((domain) => (
              <Grid key={domain} size={{ xs: 12, sm: 6, md: 4 }}>
                <DomainSection
                  domain={domain}
                  mode={modeFor(domain)}
                  outcomes={byDomain.get(domain) ?? []}
                  onAddOutcome={setOutcomeDialogDomain}
                  onChangeMode={handleChangeMode}
                  onOpenOutcome={(outcome) => navigate(`/path/outcomes/${outcome.id}`)}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      <BestSelfDialog
        open={bestSelfOpen}
        initial={bestSelf.profile}
        onClose={() => setBestSelfOpen(false)}
        onSave={bestSelf.save}
      />

      {outcomeDialogDomain && (
        <OutcomeFormDialog
          open
          mode="create"
          domain={outcomeDialogDomain}
          onClose={() => setOutcomeDialogDomain(null)}
          onSave={handleCreateOutcome}
        />
      )}
    </Container>
  );
}
