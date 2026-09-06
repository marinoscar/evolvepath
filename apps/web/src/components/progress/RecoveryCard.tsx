import { Card, CardContent, Stack, Typography } from '@mui/material';

import type { ProgressResponse } from '../../types';
import { recoveryCopy, recoverySamplesCopy } from '../../utils/momentumCopy';

/**
 * How fast this person comes back (issue #117, epic E11).
 *
 * PRD §55's recovery measure. The copy never says "failed" and never counts
 * misses: the useful fact about a miss is not that it happened but how long it
 * lasted, and a card that led with the count would be a card about the miss.
 */
interface Props {
  recovery: ProgressResponse['recovery'];
}

export default function RecoveryCard({ recovery }: Props) {
  const samples = recoverySamplesCopy(recovery);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="p">
            {recoveryCopy(recovery)}
          </Typography>
          {samples && (
            <Typography variant="body2" color="text.secondary">
              {samples}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
