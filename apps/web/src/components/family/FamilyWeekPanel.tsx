import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material';

import type { FamilySummary } from '../../types';

interface FamilyWeekPanelProps {
  summary: FamilySummary | null;
  isLoading?: boolean;
}

/**
 * Planned versus kept, as two integers.
 *
 * NO PROGRESS BAR, NO PERCENTAGE, NO COLOUR SCALE — deliberately, and this is
 * the component where that decision is most tempting to undo. PRD §35 permits
 * "Planned family commitments: 4 / Kept: 3" and says to avoid gamified
 * judgement; VISION §12 forbids a relationship score outright. A bar is a score
 * with a shape: it fills, it empties, and a half-empty one on the Family screen
 * says something about the user's family that this product has no standing to
 * say. The API sends no ratio for the same reason, and a test on both sides
 * fails the build if one appears.
 *
 * "moved" and "skipped" are printed as small text rather than hidden. A week
 * where three dinners moved is information the user asked for by opening this
 * panel — the judgement is what is withheld, not the facts.
 */
export function FamilyWeekPanel({ summary, isLoading = false }: FamilyWeekPanelProps) {
  const week = summary?.weeks[0] ?? null;

  return (
    <Card component="section" aria-label="This week" data-testid="family-week-panel" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          This week
        </Typography>

        {isLoading && !summary ? (
          <Typography variant="body2" color="text.secondary">
            Counting…
          </Typography>
        ) : !week || week.rituals.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing planned with your people this week yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {week.rituals.map((line) => (
              <Box key={line.ritualId ?? 'ungrouped'}>
                <Typography variant="body2">
                  {line.title} · Planned {line.planned} · Kept {line.kept}
                </Typography>

                {(line.moved > 0 || line.skipped > 0) && (
                  <Typography variant="caption" color="text.secondary">
                    {[
                      line.moved > 0 ? `${line.moved} moved` : null,
                      line.skipped > 0 ? `${line.skipped} skipped` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        )}

        {summary?.coachNote && (
          <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
            {summary.coachNote.text}
            {summary.coachNote.source === 'template' && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Written by the app — the coach was unavailable.
              </Typography>
            )}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
