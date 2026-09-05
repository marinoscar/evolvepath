import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';

import type { NextBestAction } from '../../types';
import { DOMAIN_LABELS } from './todayLabels';

interface NextBestActionCardProps {
  nba: NextBestAction | null;
  disabled?: boolean;
  onStart: (nba: NextBestAction) => void;
  onMakeSmaller: (nba: NextBestAction) => void;
  onAddSomething: () => void;
}

/**
 * The one recommendation (PRD §12/§13).
 *
 * The RATIONALE is the part that makes this a recommendation rather than the
 * first row of a to-do list, so it is rendered as prominently as the title. It
 * arrives from the deterministic engine, which is why this card is complete even
 * when the coach's sentence below it never loads.
 *
 * `RECOVER` relabels the primary button to "Restart". Someone coming back after
 * a gap is not starting the same thing a consistent week starts; naming it makes
 * the screen sound like it noticed.
 */
export function NextBestActionCard({
  nba,
  disabled = false,
  onStart,
  onMakeSmaller,
  onAddSomething,
}: NextBestActionCardProps) {
  if (!nba) {
    return (
      <Card
        component="section"
        aria-labelledby="nba-empty-heading"
        data-testid="nba-empty"
        sx={{ mb: 2 }}
      >
        <CardContent>
          <Typography variant="h6" component="h2" id="nba-empty-heading" gutterBottom>
            Nothing planned
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            An empty day is fine. If it was not the plan, one small thing is enough to
            restart.
          </Typography>
          <Button variant="contained" onClick={onAddSomething}>
            Add something small
          </Button>
        </CardContent>
      </Card>
    );
  }

  const startLabel =
    nba.interventionMode === 'RECOVER'
      ? `Restart · ${nba.durationMinutes} min`
      : `Start ${nba.durationMinutes} min`;

  return (
    <Card
      component="section"
      aria-labelledby="nba-heading"
      data-testid="next-best-action"
      sx={{ mb: 2 }}
    >
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Next best action
        </Typography>

        <Typography variant="h6" component="h2" id="nba-heading" gutterBottom>
          {nba.title}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5, alignItems: 'center' }}>
          <Chip size="small" label={`${nba.durationMinutes} min`} />
          <Chip size="small" variant="outlined" label={DOMAIN_LABELS[nba.domain]} />
          {nba.version !== 'full' && (
            <Chip
              size="small"
              variant="outlined"
              color="info"
              label={nba.version === 'short' ? 'Short version' : 'Minimum version'}
            />
          )}
        </Box>

        <Typography sx={{ mb: 2 }} data-testid="nba-rationale">
          {nba.rationale}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button variant="contained" disabled={disabled} onClick={() => onStart(nba)}>
            {startLabel}
          </Button>
          <Button variant="outlined" disabled={disabled} onClick={() => onMakeSmaller(nba)}>
            Make it smaller
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Or just: {nba.fallback.title} · {nba.fallback.durationMinutes} min
        </Typography>
      </CardContent>
    </Card>
  );
}
