import { useEffect, useState } from 'react';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { WorkoutVariant } from '../../../types';

interface RunnerHeaderProps {
  title: string;
  sessionIndex: number;
  sessionTotal: number;
  startedAt: string;
  variant: WorkoutVariant;
  availableVariants: WorkoutVariant[];
  onSwitchVariant: (variant: WorkoutVariant) => void;
  onEnd: () => void;
}

const VARIANT_LABEL: Record<WorkoutVariant, string> = {
  FULL: 'Use full version',
  SHORT: 'Use short version',
  MINIMUM: 'Use minimum version',
};

/**
 * PRD §41's header, and the only navigation this screen has.
 *
 * Elapsed time is derived from `startedAt` on every render rather than counted,
 * for the same reason the rest timer is: a phone that sleeps mid-workout would
 * otherwise come back believing the session was shorter than it was.
 */
export function RunnerHeader({
  title,
  sessionIndex,
  sessionTotal,
  startedAt,
  variant,
  availableVariants,
  onSwitchVariant,
  onEnd,
}: RunnerHeaderProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h5" component="h1" data-testid="runner-header">
          {title} · Workout {sessionIndex} of {sessionTotal}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {minutes} min in
        </Typography>
      </Box>

      <IconButton aria-label="Workout options" onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertIcon />
      </IconButton>

      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {availableVariants
          .filter((candidate) => candidate !== variant)
          .map((candidate) => (
            <MenuItem
              key={candidate}
              onClick={() => {
                setAnchor(null);
                onSwitchVariant(candidate);
              }}
            >
              {VARIANT_LABEL[candidate]}
            </MenuItem>
          ))}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onEnd();
          }}
        >
          End workout
        </MenuItem>
      </Menu>
    </Stack>
  );
}
