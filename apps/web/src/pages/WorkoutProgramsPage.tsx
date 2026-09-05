import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Fab,
  Grid,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { useWorkoutPrograms } from '../hooks/useWorkoutPrograms';
import type { WorkoutProgramSummary } from '../types';

const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'warning',
  ARCHIVED: 'default',
};

function ProgramCard({ program }: { program: WorkoutProgramSummary }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea component={RouterLink} to={`/health/programs/${program.id}`}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
              {program.name}
            </Typography>
            <Chip
              size="small"
              label={program.status === 'DRAFT' ? 'Not started' : program.status.toLowerCase()}
              color={STATUS_COLOR[program.status] ?? 'default'}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {program.weeklyStructure.length} days a week · {program.durationWeeks} weeks
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/**
 * `/health/programs` — what training you have (PRD §106).
 *
 * The empty state is the important one: somebody arriving here has no program,
 * and the screen's whole job is one obvious way to get one.
 */
export function WorkoutProgramsPage() {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const { programs, isLoading, error } = useWorkoutPrograms();

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" component="h1" sx={{ flex: 1 }}>
          Programs
        </Typography>
        {!compact ? (
          <Button component={RouterLink} to="/health/programs/new" variant="contained">
            Build a program
          </Button>
        ) : null}
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {isLoading ? (
        <CircularProgress size={24} />
      ) : programs.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography variant="h6" component="p" gutterBottom>
            No program yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            A structured program schedules itself onto your days, remembers what you lifted, and
            adapts when it stops working.
          </Typography>
          <Button component={RouterLink} to="/health/programs/new" variant="contained">
            Build a program
          </Button>
        </Box>
      ) : (
        <Grid container spacing={2} data-testid="program-grid">
          {programs.map((program) => (
            <Grid key={program.id} size={{ xs: 12, sm: 6 }}>
              <ProgramCard program={program} />
            </Grid>
          ))}
        </Grid>
      )}

      {compact && programs.length > 0 ? (
        <Fab
          component={RouterLink}
          to="/health/programs/new"
          color="primary"
          aria-label="Build a program"
          sx={{ position: 'fixed', right: 16, bottom: 88 }}
        >
          <AddIcon />
        </Fab>
      ) : null}
    </Container>
  );
}

export default WorkoutProgramsPage;
