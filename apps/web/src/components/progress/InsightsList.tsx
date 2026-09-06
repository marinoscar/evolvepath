import {
  Box,
  Card,
  CardContent,
  Chip,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import type { ProgressResponse } from '../../types';

/**
 * What the coach has learned, and the user has confirmed (issue #117, epic E11).
 *
 * Confirmed rows only — the API filters, this list does not. PRD §85 gives the
 * user control over what the coach remembers, and the link is to the place they
 * exercise it rather than to a control invented here.
 */
interface Props {
  insights: ProgressResponse['insights'];
}

export default function InsightsList({ insights }: Props) {
  if (insights.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            Confirmed patterns appear here.{' '}
            <MuiLink component={RouterLink} to="/settings/ai-memory">
              What the coach remembers
            </MuiLink>
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          {insights.map((insight) => (
            <Box
              key={insight.id}
              sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
            >
              <Chip size="small" label={insight.category} />
              <Typography variant="body2">{insight.statement}</Typography>
            </Box>
          ))}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          <MuiLink component={RouterLink} to="/settings/ai-memory">
            Manage what the coach remembers
          </MuiLink>
        </Typography>
      </CardContent>
    </Card>
  );
}
