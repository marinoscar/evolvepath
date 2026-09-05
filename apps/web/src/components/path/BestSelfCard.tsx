import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';

import type { BestSelfProfile, Domain } from '../../types';
import { DOMAIN_LABELS } from '../../types';

interface BestSelfCardProps {
  profile: BestSelfProfile | null;
  onEdit: () => void;
}

const DOMAIN_FIELDS: Array<{ domain: Domain; key: keyof BestSelfProfile }> = [
  { domain: 'WORK', key: 'workIdentity' },
  { domain: 'FAMILY', key: 'familyIdentity' },
  { domain: 'HEALTH', key: 'healthIdentity' },
];

/**
 * The top of the PRD §9 hierarchy: who the user is trying to become.
 *
 * The empty state asks a QUESTION rather than describing a missing record.
 * "Who are you becoming?" is the thing the user came here to answer; "No Best
 * Self profile" is a database row's opinion of itself.
 */
export function BestSelfCard({ profile, onEdit }: BestSelfCardProps) {
  const hasContent =
    profile !== null &&
    Boolean(
      profile.identityStatement ??
        profile.sixMonthVision ??
        profile.workIdentity ??
        profile.familyIdentity ??
        profile.healthIdentity,
    );

  return (
    <Card data-testid="best-self-card">
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Typography variant="overline" color="text.secondary">
            Best Self
          </Typography>
          <Button size="small" startIcon={<EditIcon />} onClick={onEdit}>
            Edit Best Self
          </Button>
        </Stack>

        {!hasContent ? (
          <Box sx={{ mt: 1 }} data-testid="best-self-empty">
            <Typography variant="h6" component="p" gutterBottom>
              Who are you becoming?
            </Typography>
            <Typography color="text.secondary">
              Write it down once. Everything below hangs off it.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ mt: 1 }}>
            {profile?.identityStatement && (
              <Typography variant="h6" component="p" gutterBottom>
                {profile.identityStatement}
              </Typography>
            )}

            {profile?.sixMonthVision && (
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {profile.sixMonthVision}
              </Typography>
            )}

            <Stack spacing={0.5} sx={{ mb: 2 }}>
              {DOMAIN_FIELDS.map(({ domain, key }) => {
                const value = profile?.[key];
                if (typeof value !== 'string' || !value) return null;
                return (
                  <Typography key={domain} variant="body2">
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {DOMAIN_LABELS[domain]}:
                    </Box>{' '}
                    {value}
                  </Typography>
                );
              })}
            </Stack>

            {(profile?.motivations.length ?? 0) > 0 && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                {profile?.motivations.map((motivation) => (
                  <Chip key={motivation} label={motivation} size="small" />
                ))}
              </Stack>
            )}

            {profile?.lastReviewedAt && (
              <Typography variant="caption" color="text.secondary">
                Last reviewed{' '}
                {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                  new Date(profile.lastReviewedAt),
                )}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default BestSelfCard;
