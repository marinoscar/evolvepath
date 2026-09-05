import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import type {
  Domain,
  DomainModeKind,
  ExtraCommitment,
  ProposedCommitment,
  WeeklyPlanDetail,
} from '../../types';
import ExtraCommitmentDialog, { formatDay } from './ExtraCommitmentDialog';
import LoadWarningAlert from './LoadWarningAlert';

const STEPS = ['Constraints', 'Focus', 'Domain modes', 'Commitments', 'Approve'] as const;

const DOMAINS: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];
const MODES: DomainModeKind[] = ['GROW', 'MAINTAIN', 'RECOVER', 'PAUSE'];

/** PRD §49's one-line meanings, so a posture is a choice rather than a label. */
const MODE_MEANING: Record<DomainModeKind, string> = {
  GROW: 'Push forward here.',
  MAINTAIN: 'Keep it ticking, do not add.',
  RECOVER: 'Ease off while something else takes the load.',
  PAUSE: 'Nothing scheduled here next week.',
};

const EXCLUSION_LABEL: Record<NonNullable<ProposedCommitment['excludedBy']>, string> = {
  travel_day: 'Travel day',
  fixed_event: 'Clashes with a fixed event',
  paused_domain: 'Domain paused',
};

export interface WeeklyPlanWizardProps {
  plan: WeeklyPlanDetail;
  saving: boolean;
  onUpdate: (patch: {
    constraints?: WeeklyPlanDetail['constraints'];
    primaryFocus?: string | null;
    domainModes?: WeeklyPlanDetail['domainModes'];
  }) => Promise<void>;
  onPropose: (extras: ExtraCommitment[]) => Promise<void>;
  onApprove: (acknowledgeWarnings: boolean) => Promise<void>;
}

/**
 * PRD §50's seven steps, collapsed into five screens (issue #84, epic E10).
 *
 * "Review last week" is the screen this wizard was opened from and "check the
 * workload" happens inside the commitments step, where the thing being
 * measured is on screen — a separate step showing a number about a list the
 * user just left would be a step they click through.
 *
 * EVERY STEP PERSISTS BEFORE ADVANCING. Closing the tab on step three costs
 * nothing, which is what makes this a ritual somebody will actually do rather
 * than a form they have to finish in one sitting.
 *
 * The stepper's orientation is a LOCAL layout choice made with
 * `useMediaQuery(down('sm'))`. It is deliberately NOT one of the five coupled
 * breakpoint gates in `CLAUDE.md` — nothing mounts or unmounts here, a
 * horizontal stepper simply does not fit a phone.
 */
export default function WeeklyPlanWizard({
  plan,
  saving,
  onUpdate,
  onPropose,
  onApprove,
}: WeeklyPlanWizardProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));

  const [step, setStep] = useState(0);
  const [travelDays, setTravelDays] = useState<string[]>(plan.constraints.travelDays);
  const [fixedEvents, setFixedEvents] = useState(plan.constraints.fixedEvents);
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventStart, setNewEventStart] = useState('');
  const [newEventEnd, setNewEventEnd] = useState('');
  const [focus, setFocus] = useState(plan.primaryFocus ?? '');
  const [modes, setModes] = useState(plan.domainModes);
  const [extras, setExtras] = useState<ExtraCommitment[]>(plan.proposal?.extras ?? []);
  const [adding, setAdding] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const weekDates = useMemo(() => weekDatesFrom(plan.weekStart), [plan.weekStart]);
  const proposal = plan.proposal;
  const warnings = proposal?.warnings ?? [];

  // Entering the commitments step asks the API what the week would be. The
  // wizard never computes that itself — two implementations of "how many
  // commitments is this week" is two answers, and the wrong one is on screen.
  useEffect(() => {
    if (step === 3 && !proposal) void onPropose(extras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // A warning that appears after the box was ticked must un-tick it, or the
  // user approves an alert they never read.
  useEffect(() => {
    if (warnings.length === 0) setAcknowledged(false);
  }, [warnings.length]);

  const saveAndNext = async (patch: Parameters<typeof onUpdate>[0]) => {
    await onUpdate(patch);
    setStep((current) => current + 1);
  };

  const reproposeWith = async (next: ExtraCommitment[]) => {
    setExtras(next);
    await onPropose(next);
  };

  const grouped = groupByDay(proposal?.items ?? []);

  return (
    <Stepper
      activeStep={step}
      orientation={compact ? 'vertical' : 'horizontal'}
      sx={{ mt: 3 }}
      data-testid="weekly-plan-wizard"
    >
      {STEPS.map((label, index) => (
        <Step key={label} completed={step > index}>
          <StepLabel aria-current={step === index ? 'step' : undefined}>{label}</StepLabel>

          {/* The horizontal stepper has no content slot, so above `sm` the
              panel is rendered underneath the strip instead (see below). */}
          <StepContent>{compact && renderStep(index)}</StepContent>
        </Step>
      ))}

      {!compact && (
        <Box sx={{ width: '100%', mt: 3 }} component="section">
          {renderStep(step)}
        </Box>
      )}
    </Stepper>
  );

  function renderStep(index: number) {
    switch (index) {
      case 0:
        return (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Anything already fixed about next week — days away, and appointments
              nothing else can move around.
            </Typography>

            <div>
              <Typography variant="subtitle2" gutterBottom>
                Travel days
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {weekDates.map((date) => (
                  <Chip
                    key={date}
                    label={formatDay(date)}
                    color={travelDays.includes(date) ? 'primary' : 'default'}
                    variant={travelDays.includes(date) ? 'filled' : 'outlined'}
                    aria-pressed={travelDays.includes(date)}
                    onClick={() =>
                      setTravelDays((current) =>
                        current.includes(date)
                          ? current.filter((day) => day !== date)
                          : [...current, date].sort(),
                      )
                    }
                  />
                ))}
              </Stack>
            </div>

            <div>
              <Typography variant="subtitle2" gutterBottom>
                Fixed events
              </Typography>

              {fixedEvents.length > 0 && (
                <List dense disablePadding>
                  {fixedEvents.map((event, position) => (
                    <ListItem
                      key={`${event.date}-${event.title}`}
                      disableGutters
                      secondaryAction={
                        <IconButton
                          edge="end"
                          aria-label={`Remove ${event.title}`}
                          onClick={() =>
                            setFixedEvents((current) =>
                              current.filter((_, i) => i !== position),
                            )
                          }
                        >
                          <DeleteIcon />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={event.title}
                        secondary={
                          event.startTime
                            ? `${formatDay(event.date)} · ${event.startTime}–${event.endTime ?? ''}`
                            : `${formatDay(event.date)} · all day`
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
                <TextField
                  size="small"
                  label="What"
                  value={newEventTitle}
                  onChange={(event) => setNewEventTitle(event.target.value)}
                />
                <TextField
                  size="small"
                  label="Day"
                  type="date"
                  value={newEventDate}
                  onChange={(event) => setNewEventDate(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: {
                    min: weekDates[0],
                    max: weekDates[6],
                  } }}
                />
                <TextField
                  size="small"
                  label="From"
                  type="time"
                  value={newEventStart}
                  onChange={(event) => setNewEventStart(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  size="small"
                  label="To"
                  type="time"
                  value={newEventEnd}
                  onChange={(event) => setNewEventEnd(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <Button
                  startIcon={<AddIcon />}
                  disabled={!newEventTitle.trim() || !newEventDate}
                  onClick={() => {
                    setFixedEvents((current) => [
                      ...current,
                      {
                        date: newEventDate,
                        title: newEventTitle.trim(),
                        // Leaving both blank means "all day", which is what the
                        // API treats as blocking the whole day.
                        startTime: newEventStart || null,
                        endTime: newEventEnd || null,
                      },
                    ]);
                    setNewEventTitle('');
                    setNewEventStart('');
                    setNewEventEnd('');
                  }}
                >
                  Add
                </Button>
              </Stack>
            </div>

            {nextButton(() =>
              saveAndNext({
                constraints: { travelDays, fixedEvents, notes: plan.constraints.notes },
              }),
            )}
          </Stack>
        );

      case 1:
        return (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              One thing. If next week goes badly and this still happens, it was a good
              week.
            </Typography>

            <TextField
              label="Primary focus"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              // The id goes on the INPUT, not the wrapper: a test (and E10-05's
              // Playwright spec) needs something it can type into.
              slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'wizard-focus' } }}
              fullWidth
            />

            {nextButton(() => saveAndNext({ primaryFocus: focus.trim() || null }))}
          </Stack>
        );

      case 2:
        return (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Not every domain can grow at once. Saying so up front is what makes the
              trade-off deliberate rather than accidental.
            </Typography>

            {DOMAINS.map((domain) => (
              <div key={domain}>
                <Typography variant="subtitle2" id={`mode-${domain}`} gutterBottom>
                  {domain.charAt(0) + domain.slice(1).toLowerCase()}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  aria-labelledby={`mode-${domain}`}
                  value={modes[domain] ?? 'GROW'}
                  onChange={(_event, value: DomainModeKind | null) =>
                    value && setModes((current) => ({ ...current, [domain]: value }))
                  }
                  sx={{ flexWrap: 'wrap' }}
                >
                  {MODES.map((mode) => (
                    <ToggleButton key={mode} value={mode}>
                      {mode.charAt(0) + mode.slice(1).toLowerCase()}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" component="p">
                  {MODE_MEANING[modes[domain] ?? 'GROW']}
                </Typography>
              </div>
            ))}

            {nextButton(() => saveAndNext({ domainModes: modes }))}
          </Stack>
        );

      case 3:
        return (
          <Stack spacing={2}>
            {!proposal && saving && <CircularProgress size={24} />}

            {proposal && (
              <>
                <Typography variant="body2" data-testid="wizard-load-summary">
                  {proposal.summary.recurringCount} recurring{' '}
                  {proposal.summary.recurringCount === 1 ? 'commitment' : 'commitments'} ·{' '}
                  ~{formatDuration(proposal.summary.estimatedMinutes)}
                </Typography>

                {warnings.map((warning) => (
                  <LoadWarningAlert key={warning.code} warning={warning} />
                ))}

                {grouped.map(([date, items]) => (
                  <div key={date}>
                    <Typography variant="subtitle2" gutterBottom>
                      {formatDay(date)}
                    </Typography>
                    <List dense disablePadding>
                      {items.map((item) => (
                        <ListItem key={item.key} disableGutters>
                          <ListItemText
                            primary={`${item.startTime} · ${item.title}`}
                            secondary={
                              item.excludedBy
                                ? EXCLUSION_LABEL[item.excludedBy]
                                : `${item.domain} · ${item.estimatedMinutes} min`
                            }
                            // Greyed rather than absent: a missing Wednesday is
                            // indistinguishable from one the product forgot.
                            sx={{ opacity: item.include ? 1 : 0.5 }}
                          />
                          {item.source === 'extra' && (
                            <IconButton
                              aria-label={`Remove ${item.title}`}
                              onClick={() => {
                                const position = Number(item.key.split(':')[1]);
                                void reproposeWith(
                                  extras.filter((_, i) => i !== position),
                                );
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </ListItem>
                      ))}
                    </List>
                  </div>
                ))}

                <Button
                  startIcon={<AddIcon />}
                  onClick={() => setAdding(true)}
                  data-testid="wizard-add-commitment"
                >
                  Add commitment
                </Button>

                <ExtraCommitmentDialog
                  open={adding}
                  weekDates={weekDates}
                  onClose={() => setAdding(false)}
                  onAdd={(extra) => void reproposeWith([...extras, extra])}
                />
              </>
            )}

            {nextButton(async () => setStep(4), !proposal)}
          </Stack>
        );

      default:
        return (
          <Stack spacing={2}>
            <Typography variant="subtitle2">Next week</Typography>

            <List dense disablePadding>
              <ListItem disableGutters>
                <ListItemText primary="Focus" secondary={focus || 'Nothing named'} />
              </ListItem>
              <ListItem disableGutters>
                <ListItemText
                  primary="Domain modes"
                  secondary={DOMAINS.map((d) => `${d}: ${modes[d] ?? 'GROW'}`).join(' · ')}
                />
              </ListItem>
              <ListItem disableGutters>
                <ListItemText
                  primary="Commitments"
                  secondary={`${(proposal?.items ?? []).filter((i) => i.include).length} planned`}
                />
              </ListItem>
            </List>

            {warnings.map((warning) => (
              <LoadWarningAlert key={warning.code} warning={warning} />
            ))}

            {warnings.length > 0 && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    data-testid="wizard-ack-warnings"
                  />
                }
                label="I have read the load warning and want this week anyway"
              />
            )}

            <Divider />

            <Stack direction="row" spacing={1}>
              <Button onClick={() => setStep(3)}>Back</Button>
              <Button
                variant="contained"
                data-testid="wizard-approve"
                disabled={saving || (warnings.length > 0 && !acknowledged)}
                onClick={() => void onApprove(acknowledged)}
              >
                Approve next week
              </Button>
            </Stack>
          </Stack>
        );
    }
  }

  function nextButton(onNext: () => Promise<unknown>, disabled = false) {
    return (
      <Stack direction="row" spacing={1}>
        {step > 0 && <Button onClick={() => setStep((current) => current - 1)}>Back</Button>}
        <Button
          variant="contained"
          data-testid="wizard-next"
          disabled={saving || disabled}
          onClick={() => void onNext()}
        >
          Next
        </Button>
      </Stack>
    );
  }
}

/** The seven local dates of a week, built without ever parsing a date string. */
export function weekDatesFrom(weekStart: string): string[] {
  const [year, month, day] = weekStart.split('-').map(Number);

  return Array.from({ length: 7 }, (_, offset) =>
    new Date(Date.UTC(year, month - 1, day) + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

function groupByDay(items: ProposedCommitment[]): Array<[string, ProposedCommitment[]]> {
  const byDate = new Map<string, ProposedCommitment[]>();

  for (const item of items) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }

  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
