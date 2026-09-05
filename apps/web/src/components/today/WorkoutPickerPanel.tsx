import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';

import { getWorkoutProgram, listWorkoutPrograms, startWorkoutSession } from '../../services/api';
import type { WorkoutTemplate } from '../../types';

interface WorkoutPickerPanelProps {
  onDone: () => void;
}

/**
 * "Workout", from Today's quick add (issue #111, epic E09).
 *
 * Replaces the disabled button E05-06 left behind. With no active program it
 * still says something useful rather than being greyed out: the reason it
 * cannot start a workout is that there is nothing to start, and the fix is one
 * tap away.
 */
export function WorkoutPickerPanel({ onDone }: WorkoutPickerPanelProps) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WorkoutTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listWorkoutPrograms('ACTIVE')
      .then(async (programs) => {
        if (programs.length === 0) {
          if (!cancelled) setTemplates([]);
          return;
        }

        const program = await getWorkoutProgram(programs[0].id);

        if (!cancelled) {
          setTemplates(program.templates.filter((template) => template.variant === 'FULL'));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load your program.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const start = async (templateId: string) => {
    setStarting(true);

    try {
      const session = await startWorkoutSession({ templateId });
      onDone();
      navigate(`/workout/${session.id}`);
    } catch (err) {
      const openId = (err as { details?: { sessionId?: string } }).details?.sessionId;

      if (openId) {
        onDone();
        navigate(`/workout/${openId}`);
        return;
      }

      setError(err instanceof Error ? err.message : 'Could not start that workout.');
      setStarting(false);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;

  if (templates === null) return <CircularProgress size={24} />;

  if (templates.length === 0) {
    return (
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You have no active program yet. A program schedules itself onto your days and remembers
          what you lifted.
        </Typography>
        <Button component={RouterLink} to="/health/programs/new" variant="contained">
          Build a program
        </Button>
      </Box>
    );
  }

  return (
    <List>
      {templates.map((template) => (
        <ListItemButton
          key={template.id}
          disabled={starting}
          onClick={() => void start(template.id)}
          sx={{ minHeight: 56 }}
        >
          <ListItemText
            primary={template.name}
            secondary={`About ${template.targetMinutes} minutes`}
          />
        </ListItemButton>
      ))}
    </List>
  );
}
