import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import type { Routine, RoutineFrequency } from '../../types';

const FREQUENCY_LABELS: Record<RoutineFrequency, string> = {
  DAILY: 'Every day',
  WEEKDAYS: 'Weekdays',
  WEEKENDS: 'Weekends',
  WEEKLY: 'Weekly',
  CUSTOM: 'Custom days',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "after morning coffee" or "06:30", plus the frequency and the two durations. */
function describe(routine: Routine): string {
  const trigger =
    routine.triggerType === 'EVENT' && routine.triggerValue
      ? `after ${routine.triggerValue.replace(/^after\s+/i, '')}`
      : (routine.triggerValue ?? routine.preferredTime ?? 'any time');

  const when =
    routine.frequency === 'CUSTOM' && routine.daysOfWeek.length > 0
      ? routine.daysOfWeek.map((day) => DAY_NAMES[day]).join(', ')
      : FREQUENCY_LABELS[routine.frequency];

  return `${when} · ${trigger} · ${routine.estimatedDurationMin} min (min ${routine.minimumDurationMin})`;
}

interface RoutineRowProps {
  routine: Routine;
  editable: boolean;
  onEdit?: (routine: Routine) => void;
  onToggleActive?: (routine: Routine) => void;
  onDelete?: (routine: Routine) => void;
}

/**
 * One routine. Exported because `PlanVersionHistory` renders the same shape
 * read-only for a superseded version — two components would be two chances for
 * the historical view to describe a routine differently from the live one.
 */
export function RoutineRow({
  routine,
  editable,
  onEdit,
  onToggleActive,
  onDelete,
}: RoutineRowProps) {
  return (
    <Box
      data-testid={`routine-${routine.id}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        py: 1,
        opacity: routine.active ? 1 : 0.6,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" component="h3">
            {routine.title}
          </Typography>
          {/* The word "Paused", not a faded row alone — opacity is not a state
              a screen reader can report. */}
          {!routine.active && <Chip label="Paused" size="small" variant="outlined" />}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {describe(routine)}
        </Typography>
        {routine.fallbackBehavior && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Fallback: {routine.fallbackBehavior}
          </Typography>
        )}
      </Box>

      {editable && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={routine.active ? 'Pause this routine' : 'Resume this routine'}>
            <Switch
              size="small"
              checked={routine.active}
              onChange={() => onToggleActive?.(routine)}
              slotProps={{
                input: {
                  'aria-label': `${routine.active ? 'Pause' : 'Resume'} ${routine.title}`,
                },
              }}
            />
          </Tooltip>
          <IconButton
            size="small"
            onClick={() => onEdit?.(routine)}
            aria-label={`Edit ${routine.title}`}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onDelete?.(routine)}
            aria-label={`Delete ${routine.title}`}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
}

interface RoutineListProps {
  routines: Routine[];
  editable: boolean;
  onAdd: () => void;
  onEdit: (routine: Routine) => void;
  onToggleActive: (routine: Routine) => void;
  onDelete: (routine: Routine) => void;
}

export function RoutineList({
  routines,
  editable,
  onAdd,
  onEdit,
  onToggleActive,
  onDelete,
}: RoutineListProps) {
  return (
    <Card data-testid="routine-list">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Routines
        </Typography>

        {routines.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            No routines yet. A routine is the behaviour this plan is made of — what starts it, how
            often, and the smallest version that still counts.
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            {routines.map((routine) => (
              <RoutineRow
                key={routine.id}
                routine={routine}
                editable={editable}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
              />
            ))}
          </Box>
        )}

        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={!editable}
          data-testid="add-routine"
        >
          Add routine
        </Button>
      </CardContent>
    </Card>
  );
}

export default RoutineList;
