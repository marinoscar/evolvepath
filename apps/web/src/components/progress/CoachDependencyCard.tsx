import { Card, CardContent, Stack, Typography } from '@mui/material';

import type { ProgressResponse } from '../../types';
import { independenceCopy } from '../../utils/momentumCopy';

/**
 * Coach dependency (issue #117, epic E11).
 *
 * PRD §75 calls this "percent completed without reminder" and PRD §65 makes
 * reducing it the product's stated goal. It is rendered as a FRACTION, not a
 * percentage: a percentage is the shape a score wears, and this screen is built
 * to not wear one.
 *
 * A null reading is answered with a sentence about the product, not a zero. The
 * user has not failed to be independent — nothing has measured it yet.
 */
interface Props {
  independence: ProgressResponse['independence'];
}

export default function CoachDependencyCard({ independence }: Props) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="p">
            {independenceCopy(independence)}
          </Typography>
          {independence.ratio !== null && (
            <Typography variant="body2" color="text.secondary">
              More of this was you.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
