import { useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import EvidenceTimeline from '../components/progress/EvidenceTimeline';
import { useProgressTimeline } from '../hooks/useProgressTimeline';
import { DOMAIN_LABELS, DOMAIN_ORDER } from '../types';
import type { Domain } from '../types';

/**
 * The full evidence timeline (issue #117, epic E11).
 *
 * A drill-down from Progress rather than a sixth destination: PRD §11 fixes
 * five, and "everything that happened" is a longer view of one section rather
 * than another place to go.
 */
export default function ProgressTimelinePage() {
  const [domain, setDomain] = useState<Domain | null>(null);
  const timeline = useProgressTimeline(domain ?? undefined);

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Evidence
        </Typography>

        <ToggleButtonGroup
          size="small"
          exclusive
          value={domain}
          onChange={(_event, next: Domain | null) => setDomain(next)}
          aria-label="Filter evidence by domain"
          sx={{ mb: 3 }}
        >
          <ToggleButton value={null as unknown as string} aria-label="All domains">
            All
          </ToggleButton>
          {DOMAIN_ORDER.map((option) => (
            <ToggleButton key={option} value={option}>
              {DOMAIN_LABELS[option]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {timeline.error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {timeline.error}
          </Alert>
        )}

        {timeline.isLoading ? (
          <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress aria-label="Loading evidence" />
          </Box>
        ) : (
          <EvidenceTimeline
            // The only other heading on this page is the h1, so the day labels
            // are h2 here and h3 inside the Progress page's Evidence section.
            dayHeadingLevel="h2"
            items={timeline.items}
            hasMore={timeline.hasMore}
            isLoadingMore={timeline.isLoadingMore}
            onLoadMore={() => void timeline.loadMore()}
          />
        )}
      </Box>
    </Container>
  );
}
