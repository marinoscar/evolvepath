import {
  Box,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import type { DiffEntry } from '../../types';

// =============================================================================
// The diff the user reads before deciding (issue #86, epic E06)
// =============================================================================
//
// PRD §15: the product displays a diff and the user approves or edits. This is
// that diff, and it is exported because E10's Weekly Review renders the same
// `DiffEntry[]` from the same protocol — one component, so a plan change looks
// identical wherever the user is asked about it.
//
// TWO LAYOUTS, ONE READING. A four-column table is the clearest form of
// before/after on a wide screen and the worst on a 375 px one, where it either
// scrolls sideways or wraps into porridge. Below `sm` the same rows become
// stacked cards. This is a PAGE-LOCAL layout choice, not one of the five
// coupled breakpoint gates in `Layout`/`BottomNav`/`SettingsHub`/`AppBar` —
// nothing here mounts or unmounts navigation.
// =============================================================================

const OP_LABELS: Record<DiffEntry['op'], string> = {
  move: 'Move',
  reduce: 'Shorten',
  replace: 'Replace',
  add: 'Add',
  remove: 'Remove',
  pause: 'Pause',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Name',
  triggerType: 'Trigger',
  triggerValue: 'Day',
  frequency: 'Frequency',
  daysOfWeek: 'Days',
  preferredTime: 'Time',
  estimatedDurationMin: 'Length',
  minimumDurationMin: 'Minimum',
  fallbackBehavior: 'Fallback',
  active: 'Active',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `null` reads as an em dash, not the word "null". */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'daysOfWeek' && Array.isArray(value)) {
    return value.map((day) => WEEKDAYS[Number(day)] ?? String(day)).join(', ');
  }
  if (field === 'estimatedDurationMin' || field === 'minimumDurationMin') {
    return `${value} min`;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export interface PlanChangeDiffProps {
  entries: DiffEntry[];
  /** True on narrow windows: stacked cards instead of a table. */
  dense?: boolean;
}

export default function PlanChangeDiff({ entries, dense = false }: PlanChangeDiffProps) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No changes to show.
      </Typography>
    );
  }

  if (dense) {
    return (
      <Stack spacing={1} data-testid="plan-change-diff-cards">
        {entries.map((entry) => (
          <Card key={`${entry.op}-${entry.target.id}`} variant="outlined">
            <CardContent sx={{ py: 1.5 }}>
              <Typography variant="subtitle2">
                {OP_LABELS[entry.op]} · {entry.target.title}
              </Typography>

              {entry.fields.map((field) => (
                <Typography key={field.field} variant="body2" sx={{ mt: 0.5 }}>
                  {FIELD_LABELS[field.field] ?? field.field}:{' '}
                  {formatValue(field.field, field.before)} →{' '}
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatValue(field.field, field.after)}
                  </Box>
                </Typography>
              ))}

              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {entry.reason}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" data-testid="plan-change-diff-table">
        <caption style={{ captionSide: 'top', textAlign: 'left' }}>
          Proposed changes
        </caption>
        <TableHead>
          <TableRow>
            <TableCell scope="col">Change</TableCell>
            <TableCell scope="col">Before</TableCell>
            <TableCell scope="col">After</TableCell>
            <TableCell scope="col">Why</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.flatMap((entry) =>
            entry.fields.length === 0
              ? [
                  <TableRow key={`${entry.op}-${entry.target.id}`}>
                    <TableCell>
                      {OP_LABELS[entry.op]} · {entry.target.title}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>{entry.reason}</TableCell>
                  </TableRow>,
                ]
              : entry.fields.map((field, index) => (
                  <TableRow key={`${entry.op}-${entry.target.id}-${field.field}`}>
                    <TableCell>
                      {index === 0
                        ? `${OP_LABELS[entry.op]} · ${entry.target.title}`
                        : ''}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {FIELD_LABELS[field.field] ?? field.field}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatValue(field.field, field.before)}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {formatValue(field.field, field.after)}
                    </TableCell>
                    <TableCell>{index === 0 ? entry.reason : ''}</TableCell>
                  </TableRow>
                )),
          )}
        </TableBody>
      </Table>
    </Box>
  );
}
