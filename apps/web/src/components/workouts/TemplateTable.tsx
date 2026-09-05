import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import type { WorkoutTemplate, WorkoutVariant } from '../../types';

/**
 * PRD §44's promise, said out loud on every workout.
 *
 * A fixed caption rather than a tooltip: the whole point is that the small
 * versions are legitimate AND not equivalent, and a user who only ever reads
 * the tab labels would learn the first half and not the second.
 */
export const NON_EQUIVALENCE_CAPTION =
  'Short and minimum versions keep you on the path — they are not the same training stimulus.';

const VARIANT_ORDER: WorkoutVariant[] = ['FULL', 'SHORT', 'MINIMUM'];
const VARIANT_LABEL: Record<WorkoutVariant, string> = {
  FULL: 'Full',
  SHORT: 'Short',
  MINIMUM: 'Minimum',
};

interface TemplateTableProps {
  /** The FULL template and its two siblings, in any order. */
  variants: WorkoutTemplate[];
  /** The catalog text per exercise id, when the caller has it. */
  instructions?: Record<string, string>;
}

/**
 * One workout, at all three of its sizes (VISION §14's table).
 *
 * TABS ARE LEGITIMATE HERE and the settings-UI rule says why: these are
 * PARALLEL content — three views of one workout — rather than a hierarchy. The
 * gate is about content inside one destination, not about reachability.
 *
 * Below `sm` the rows become cards. That is this component's own layout choice
 * and NOT a sixth entry in the shell's five coupled breakpoint gates: it
 * decides what a table looks like, never which navigation is mounted.
 */
export function TemplateTable({ variants, instructions = {} }: TemplateTableProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [variant, setVariant] = useState<WorkoutVariant>('FULL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const available = VARIANT_ORDER.filter((candidate) =>
    variants.some((template) => template.variant === candidate),
  );
  const active = variants.find((template) => template.variant === variant) ?? variants[0];

  if (!active) return null;

  // `aria-controls` is an ID REFERENCE, and an id with a space in it is not
  // one — axe rejects it, and a screen reader silently loses the association.
  const slug = active.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const target = (exercise: { repMin: number; repMax: number }) =>
    exercise.repMin === exercise.repMax
      ? `${exercise.repMin}`
      : `${exercise.repMin}–${exercise.repMax}`;

  return (
    <Box>
      <Tabs
        value={variant}
        onChange={(_event, next: WorkoutVariant) => setVariant(next)}
        aria-label={`Versions of ${active.name}`}
        sx={{ mb: 1 }}
      >
        {available.map((candidate) => (
          <Tab
            key={candidate}
            value={candidate}
            label={VARIANT_LABEL[candidate]}
            id={`${slug}-tab-${candidate}`}
            aria-controls={`${slug}-panel-${candidate}`}
          />
        ))}
      </Tabs>

      <Box
        role="tabpanel"
        id={`${slug}-panel-${variant}`}
        aria-labelledby={`${slug}-tab-${variant}`}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          About {active.targetMinutes} minutes
        </Typography>

        {compact ? (
          <Stack spacing={1}>
            {active.exercises.map((exercise) => (
              <Card key={exercise.id} variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" sx={{ alignItems: 'center' }}>
                    {/* `component="p"`: MUI maps subtitle2 to <h6>, which puts
                        a heading three levels deeper than its section and fails
                        heading-order. This is a card label, not a heading. */}
                    <Typography variant="subtitle2" component="p" sx={{ flex: 1 }}>
                      {exercise.name}
                    </Typography>
                    {instructions[exercise.exerciseId] ? (
                      <IconButton
                        size="small"
                        aria-label={`How to do ${exercise.name}`}
                        aria-expanded={expanded === exercise.id}
                        onClick={() =>
                          setExpanded(expanded === exercise.id ? null : exercise.id)
                        }
                      >
                        <ExpandMoreIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {exercise.sets} × {target(exercise)} · {exercise.restSeconds} s rest
                  </Typography>
                  {exercise.notes ? (
                    <Typography variant="caption" color="text.secondary">
                      {exercise.notes}
                    </Typography>
                  ) : null}
                  <Collapse in={expanded === exercise.id} unmountOnExit>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {instructions[exercise.exerciseId]}
                    </Typography>
                  </Collapse>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <caption>
                {active.name} · {VARIANT_LABEL[variant].toLowerCase()} version
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell>Exercise</TableCell>
                  <TableCell align="right">Sets</TableCell>
                  <TableCell align="right">Target</TableCell>
                  <TableCell align="right">Rest</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {active.exercises.map((exercise) => (
                  <TableRow key={exercise.id}>
                    <TableCell>
                      {exercise.name}
                      {exercise.notes ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {exercise.notes}
                        </Typography>
                      ) : null}
                      {instructions[exercise.exerciseId] ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {instructions[exercise.exerciseId]}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{exercise.sets}</TableCell>
                    <TableCell align="right">{target(exercise)}</TableCell>
                    <TableCell align="right">{exercise.restSeconds} s</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}
