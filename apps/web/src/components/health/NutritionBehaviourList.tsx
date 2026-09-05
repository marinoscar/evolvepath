import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Stack,
  Typography,
} from '@mui/material';

import type { NutritionBehaviour } from '../../types';

interface NutritionBehaviourListProps {
  behaviours: NutritionBehaviour[];
  /** Keys the user picked at onboarding, listed first. */
  chosen?: string[];
  onCommit: (key: string, repeatDays: number) => Promise<void>;
  repeatDays?: number;
}

/**
 * PRD §46's behaviours, as things you can put on the week.
 *
 * Presentational: it takes the registry and a callback, never a hook. And it
 * shows the MINIMUM version on every card, because that is the part that makes
 * the habit survivable — "protein with one meal" is what somebody does on the
 * worst Tuesday of the month, and hiding it until they fail is backwards.
 */
export function NutritionBehaviourList({
  behaviours,
  chosen = [],
  onCommit,
  repeatDays = 5,
}: NutritionBehaviourListProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const ordered = [
    ...behaviours.filter((behaviour) => chosen.includes(behaviour.key)),
    ...behaviours.filter((behaviour) => !chosen.includes(behaviour.key)),
  ];

  const handleCommit = async (key: string) => {
    setBusy(key);
    try {
      await onCommit(key, repeatDays);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack spacing={2}>
      {ordered.map((behaviour) => (
        <Card key={behaviour.key} variant="outlined">
          <CardContent sx={{ pb: 1 }}>
            <Typography variant="subtitle1" component="h3">
              {behaviour.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {behaviour.description}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                On a hard day: {behaviour.minimumVersion.title} ·{' '}
                {behaviour.minimumVersion.minutes} min
              </Typography>
            </Box>
          </CardContent>
          <CardActions>
            <Button
              size="small"
              onClick={() => void handleCommit(behaviour.key)}
              disabled={busy !== null}
            >
              Add to this week
            </Button>
          </CardActions>
        </Card>
      ))}
    </Stack>
  );
}
