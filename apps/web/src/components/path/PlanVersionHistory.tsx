import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import type { PlanVersion, PlanVersionStatus, PlanVersionSummary, Routine } from '../../types';
import { getPlanVersion } from '../../services/api';
import { RoutineRow } from './RoutineList';

interface PlanVersionHistoryProps {
  planId: string | null;
  versions: PlanVersionSummary[];
  disabled?: boolean;
  onActivate: (version: number) => void;
  onReject: (version: number) => void;
}

const STATUS_COLORS: Record<PlanVersionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'default',
  REJECTED: 'error',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

/**
 * The plan's history, newest first — PRD §80/§103's "the user can inspect why
 * the plan changed", as a screen.
 *
 * EVERY version is here, including superseded and rejected ones, and every one
 * shows its rationale in full. A history that hid the versions that lost would
 * answer "what is the plan now?" while leaving "why did it become that?"
 * unanswerable — which is the half the PRD actually asks for.
 *
 * A version's routines are fetched on demand, when its row is expanded. They
 * are read-only for anything but the active version: a superseded version's
 * routines are the record of what the plan used to say, and the API refuses to
 * change them.
 */
export function PlanVersionHistory({
  planId,
  versions,
  disabled = false,
  onActivate,
  onReject,
}: PlanVersionHistoryProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Record<number, PlanVersion>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExpand = async (version: number, isExpanded: boolean) => {
    setExpanded(isExpanded ? version : null);
    if (!isExpanded || !planId || loaded[version]) return;

    setLoading(version);
    setError(null);
    try {
      const full = await getPlanVersion(planId, version);
      setLoaded((current) => ({ ...current, [version]: full }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load that version');
    } finally {
      setLoading(null);
    }
  };

  if (versions.length === 0) {
    return null;
  }

  return (
    <Card data-testid="plan-version-history">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Plan history
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {versions.map((version) => {
          const routines: Routine[] = loaded[version.version]?.routines ?? [];

          return (
            <Accordion
              key={version.id}
              expanded={expanded === version.version}
              onChange={(_, isExpanded) => void handleExpand(version.version, isExpanded)}
              data-testid={`plan-version-${version.version}`}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-label={`Version ${version.version}, ${version.status}`}
              >
                <Stack spacing={0.5} sx={{ width: '100%' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 600 }}>v{version.version}</Typography>
                    <Chip
                      label={version.status}
                      size="small"
                      color={STATUS_COLORS[version.status]}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(version.createdAt)} by{' '}
                      {version.createdBy === 'AI' ? 'your coach' : 'you'}
                    </Typography>
                  </Stack>

                  {/* The rationale IS the history. Shown in full, never truncated. */}
                  {version.rationale && (
                    <Typography variant="body2" color="text.secondary">
                      {version.rationale}
                    </Typography>
                  )}

                  <Typography variant="caption" color="text.secondary">
                    {version.routineCount} routine{version.routineCount === 1 ? '' : 's'}
                    {version.activeFrom && ` · active from ${formatDate(version.activeFrom)}`}
                    {version.activeUntil && ` until ${formatDate(version.activeUntil)}`}
                  </Typography>
                </Stack>
              </AccordionSummary>

              <AccordionDetails>
                {loading === version.version ? (
                  <CircularProgress size={20} />
                ) : (
                  <Box>
                    {routines.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No routines in this version.
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {routines.map((routine) => (
                          <RoutineRow key={routine.id} routine={routine} editable={false} />
                        ))}
                      </Stack>
                    )}

                    {version.status === 'DRAFT' && (
                      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={disabled}
                          onClick={() => onActivate(version.version)}
                        >
                          Activate v{version.version}
                        </Button>
                        <Button
                          size="small"
                          color="inherit"
                          disabled={disabled}
                          onClick={() => onReject(version.version)}
                        >
                          Reject
                        </Button>
                      </Stack>
                    )}
                  </Box>
                )}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default PlanVersionHistory;
