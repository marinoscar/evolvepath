import type { ReactNode } from 'react';
import { Card, CardContent, Chip, List, Typography, Box } from '@mui/material';

import type { CommitmentCard, Domain, DomainModeKind } from '../../types';
import type { FamilyRowAction } from '../family/familyLabels';
import { CommitmentRow } from './CommitmentRow';
import {
  DOMAIN_EMPTY_COPY,
  DOMAIN_LABELS,
  DOMAIN_MODE_LABELS,
} from './todayLabels';

interface DomainCardProps {
  domain: Domain;
  mode: DomainModeKind;
  commitments: CommitmentCard[];
  pendingId?: string | null;
  /**
   * Rendered beside the heading. The Family card puts a birthday cue here
   * (epic E08); an optional slot rather than a domain-specific branch, so the
   * card stays one component that knows nothing about any particular domain.
   */
  headerExtra?: ReactNode;
  onAction: (action: FamilyRowAction, commitment: CommitmentCard) => void;
}

/**
 * One life domain's section.
 *
 * Rendered even when empty and even when PAUSED. A section that disappeared
 * because nothing was scheduled would read as data loss, and one that
 * disappeared because the user paused it would hide a decision they made — the
 * mode tag says it out loud instead.
 */
export function DomainCard({
  domain,
  mode,
  commitments,
  pendingId,
  headerExtra,
  onAction,
}: DomainCardProps) {
  const modeLabel = DOMAIN_MODE_LABELS[mode];

  return (
    <Card
      component="section"
      aria-label={`${DOMAIN_LABELS[domain]} commitments`}
      data-testid={`domain-card-${domain}`}
      sx={{ mb: 2 }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h6" component="h2">
            {DOMAIN_LABELS[domain]}
          </Typography>
          {modeLabel && (
            <Chip
              size="small"
              variant="outlined"
              label={modeLabel}
              color={mode === 'PAUSE' ? 'default' : 'info'}
            />
          )}
          {headerExtra}
        </Box>

        {commitments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {DOMAIN_EMPTY_COPY[domain]}
          </Typography>
        ) : (
          <List disablePadding>
            {commitments.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                disabled={pendingId === commitment.id}
                onAction={onAction}
              />
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
