import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import type {
  EquipmentCheckResult,
  FormCheckResult,
  MealCheckResult,
  RiskFlag,
} from '../../../types';

/** PRD §46, said out loud, because a photograph of food invites the assumption. */
export const HABITS_NOT_CALORIES = 'I look at habits, not calories.';

const RISK_LABELS: Record<RiskFlag, string> = {
  pain_reported: 'Pain reported',
  joint_instability: 'Joint looks unstable',
  spinal_rounding_under_load: 'Back rounding under load',
  loss_of_control: 'Loss of control',
  unclear_footage: 'Footage unclear',
  none: 'Nothing stood out',
};

/**
 * Whatever the coach saw, rendered by kind.
 *
 * RISK FLAGS CARRY AN ICON AND TEXT, never colour alone. A warning that only a
 * sighted user with full colour vision can read is not a warning, and this is
 * the one card in the epic where that matters most.
 */
export function FormCheckResultCard({ result }: { result: FormCheckResult }) {
  return (
    <Box data-testid="form-check-result">
      {result.redirected && result.safetyNote ? (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="form-check-safety">
          {result.safetyNote}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {result.riskFlags.map((flag) => (
          <Chip
            key={flag}
            size="small"
            icon={flag === 'none' ? <CheckCircleIcon /> : <ReportProblemIcon />}
            color={flag === 'none' ? 'default' : 'warning'}
            label={RISK_LABELS[flag]}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2" component="h3">
        What I saw
      </Typography>
      <List dense>
        {result.observations.map((observation) => (
          <ListItem key={observation} sx={{ px: 0 }}>
            <ListItemText primary={observation} />
          </ListItem>
        ))}
      </List>

      {/* Withheld on a redirect, deliberately: cues beside "get this looked at"
          read as permission to keep going. */}
      {result.cues.length > 0 ? (
        <>
          <Typography variant="subtitle2" component="h3">
            Try this next set
          </Typography>
          <Box component="ol" sx={{ pl: 3, m: 0 }}>
            {result.cues.map((cue) => (
              <Typography component="li" variant="body2" key={cue}>
                {cue}
              </Typography>
            ))}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

export function EquipmentCheckResultCard({ result }: { result: EquipmentCheckResult }) {
  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        What I can see
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {result.equipmentDetected.map((item) => (
          <Chip key={item} size="small" label={item.toLowerCase()} />
        ))}
      </Stack>

      {result.notes.length > 0 ? (
        <List dense>
          {result.notes.map((note) => (
            <ListItem key={note} sx={{ px: 0 }}>
              <ListItemText primary={note} />
            </ListItem>
          ))}
        </List>
      ) : null}

      {result.substitutions.length > 0 ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" component="h3">
            What I would swap
          </Typography>
          <List dense>
            {result.substitutions.map((substitution) => (
              <ListItem key={substitution.exerciseId} sx={{ px: 0 }}>
                <ListItemText
                  primary={`${substitution.exerciseName} → ${substitution.alternativeName}`}
                  secondary={substitution.reason}
                />
              </ListItem>
            ))}
          </List>
          {result.proposalId ? (
            <Alert severity="info">
              Proposed change sent to your coach — it changes nothing until you accept it.
            </Alert>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function MealCheckResultCard({
  result,
  onAddBehaviour,
}: {
  result: MealCheckResult;
  onAddBehaviour?: (key: string, text: string) => void;
}) {
  return (
    <Box data-testid="meal-check-result">
      <Typography variant="subtitle2" component="h3">
        What I can see
      </Typography>
      <List dense>
        {result.observations.map((observation) => (
          <ListItem key={observation} sx={{ px: 0 }}>
            <ListItemText primary={observation} />
          </ListItem>
        ))}
      </List>

      {result.behaviorSuggestions.length > 0 ? (
        <>
          <Typography variant="subtitle2" component="h3">
            One thing you could try
          </Typography>
          <List dense>
            {result.behaviorSuggestions.map((suggestion) => (
              <ListItem
                key={suggestion.key}
                sx={{ px: 0 }}
                secondaryAction={
                  onAddBehaviour ? (
                    <Button
                      size="small"
                      onClick={() => onAddBehaviour(suggestion.key, suggestion.text)}
                    >
                      Add to today
                    </Button>
                  ) : undefined
                }
              >
                <ListItemText primary={suggestion.text} />
              </ListItem>
            ))}
          </List>
        </>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        {HABITS_NOT_CALORIES}
      </Typography>
    </Box>
  );
}
