import { Alert, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';

import type { GenerateProgramResult } from '../../../types';
import { NON_EQUIVALENCE_CAPTION, TemplateTable } from '../TemplateTable';
import { WeeklyStructure } from '../WeeklyStructure';

// =============================================================================
// The draft, before anybody agrees to it (issue #95, epic E09)
// =============================================================================
//
// PRD §15: nothing here is a plan yet. The program exists as DRAFT rows and the
// screen's job is to make it refusable — which means showing the whole thing,
// including the parts a user would rather not read.
//
// THE STARTER ALERT IS NOT AN ERROR STATE. Each of the four reasons is a
// different sentence because they are four different situations, and only one
// of them is "something went wrong". A single "couldn't generate" would tell
// somebody whose limitation triggered the safety redirect exactly the wrong
// thing about what just happened.
// =============================================================================

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STARTER_REASONS: Record<string, { severity: 'info' | 'warning'; copy: string }> = {
  ai_unavailable: {
    severity: 'info',
    copy: 'The coach is unavailable right now, so this is a starter program. It is a real program — you can start it today and rebuild it later.',
  },
  invalid_output: {
    severity: 'warning',
    copy: "The coach's draft broke one of our safety rules, so here is a conservative starter program instead.",
  },
  safety_redirect: {
    severity: 'warning',
    copy: 'Based on what you told us, this is a general starter program rather than something built around it. Please talk to a professional about anything painful before training around it.',
  },
  requested: {
    severity: 'info',
    copy: 'A starter program, as you asked. Straightforward, and it works with what you have.',
  },
};

interface ProgramProposalReviewProps {
  result: GenerateProgramResult;
  submitting: boolean;
  onApprove: () => void;
  onRegenerate: () => void;
}

export function ProgramProposalReview({
  result,
  submitting,
  onApprove,
  onRegenerate,
}: ProgramProposalReviewProps) {
  const { program } = result;
  const fullTemplates = program.templates.filter((template) => template.variant === 'FULL');
  const starter =
    result.source === 'starter' ? (STARTER_REASONS[result.reason ?? 'requested'] ?? null) : null;

  return (
    <Stack spacing={3}>
      {starter ? (
        <Alert severity={starter.severity}>{result.message ?? starter.copy}</Alert>
      ) : null}

      <Box>
        <Typography variant="h6" component="h2">
          {program.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {program.durationWeeks} weeks · {program.weeklyStructure.length} days a week
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
          {program.weeklyStructure
            .slice()
            .sort((a, b) => a.weekday - b.weekday)
            .map((entry) => (
              <Chip key={entry.weekday} size="small" label={WEEKDAY_LABELS[entry.weekday]} />
            ))}
        </Stack>
      </Box>

      <WeeklyStructure
        weeklyStructure={program.weeklyStructure}
        templates={program.templates}
      />

      <Typography variant="body2" color="text.secondary">
        {NON_EQUIVALENCE_CAPTION}
      </Typography>

      {fullTemplates.map((template) => (
        <Box key={template.id} component="section" aria-label={template.name}>
          <Typography variant="subtitle1" component="h3" gutterBottom>
            {template.name}
          </Typography>
          <TemplateTable
            variants={program.templates.filter((row) => row.name === template.name)}
          />
        </Box>
      ))}

      {program.substitutions.length > 0 ? (
        <Box component="section" aria-labelledby="substitutions-heading">
          <Typography variant="subtitle1" component="h3" id="substitutions-heading">
            If something is taken
          </Typography>
          <Stack component="ul" sx={{ pl: 3, m: 0 }}>
            {program.substitutions.map((substitution) => (
              <Typography component="li" variant="body2" key={substitution.exerciseId}>
                {nameOf(substitution.exerciseId)} →{' '}
                {substitution.alternativeExerciseIds.map(nameOf).join(', ')}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}

      {program.rationale ? (
        <Box component="blockquote" sx={{ m: 0, pl: 2, borderLeft: 3, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {program.rationale}
          </Typography>
        </Box>
      ) : null}

      <Divider />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Button variant="contained" onClick={onApprove} disabled={submitting}>
          Approve
        </Button>
        <Button onClick={onRegenerate} disabled={submitting}>
          Regenerate
        </Button>
      </Stack>
    </Stack>
  );

  /** Substitutions arrive as ids; the templates are where the names live. */
  function nameOf(exerciseId: string): string {
    for (const template of program.templates) {
      const match = template.exercises.find((exercise) => exercise.exerciseId === exerciseId);

      if (match) return match.name;
    }

    return 'Another movement';
  }
}
