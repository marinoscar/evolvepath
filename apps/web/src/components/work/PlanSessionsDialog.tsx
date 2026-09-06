import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

import type { Outcome, WorkSessionPlan, WorkSessionPlanProposal } from '../../types';
import { ApiError } from '../../services/api';
import {
  applyOutcomeSessionPlan,
  planOutcomeSessions,
  planOutcomeSessionsTemplate,
} from '../../services/api';

interface PlanSessionsDialogProps {
  open: boolean;
  outcome: Outcome;
  hasSessions: boolean;
  onClose: () => void;
  onApplied: (created: number) => void;
}

const MIN_MINUTES = 15;
const MAX_MINUTES = 120;
const DEFAULT_MINUTES = 45;

const CADENCES = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'TWICE_WEEKLY', label: 'Twice weekly' },
  { value: 'WEEKLY', label: 'Weekly' },
] as const;

/** `2026-09-08T09:00` — what a `datetime-local` input expects. */
function toLocalInput(iso: string): string {
  const at = new Date(iso);
  const offset = at.getTimezoneOffset() * 60_000;

  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Propose → review → apply (PRD §15, §24).
 *
 * THE REVIEW STEP IS THE PRODUCT. The coach's plan arrives editable and nothing
 * is written until `Apply`, which is the approval PRD §15 requires. An edited
 * session goes back to the server and is re-validated against the same
 * guardrails the model was held to — so a plan the user broke comes back with
 * readable reasons rather than being silently corrected.
 *
 * `fullScreen` below `sm` is a LOCAL layout choice, not one of CLAUDE.md's five
 * coupled breakpoint gates.
 */
export function PlanSessionsDialog({
  open,
  outcome,
  hasSessions,
  onClose,
  onApplied,
}: PlanSessionsDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [targetDate, setTargetDate] = useState(outcome.targetDate ?? '');
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [proposal, setProposal] = useState<WorkSessionPlanProposal | null>(null);
  const [draft, setDraft] = useState<WorkSessionPlan | null>(null);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState<'ai' | 'key' | null>(null);

  useEffect(() => {
    if (!open) return;

    setTargetDate(outcome.targetDate ?? '');
    setMinutes(DEFAULT_MINUTES);
    setProposal(null);
    setDraft(null);
    setError(null);
    setDetails([]);
    setUnavailable(null);
    // Opening is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // "Still thinking…" rather than a spinner that says nothing. A planner call
  // is a real wait, and twenty seconds of silence reads as a broken button.
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }

    const id = window.setTimeout(() => setSlow(true), 20_000);
    return () => window.clearTimeout(id);
  }, [pending]);

  const body = () => ({
    ...(targetDate ? { targetDate } : {}),
    availableMinutesPerDay: minutes,
  });

  const propose = async (useTemplate: boolean) => {
    setPending(true);
    setError(null);
    setDetails([]);
    setUnavailable(null);

    try {
      const result = useTemplate
        ? await planOutcomeSessionsTemplate(outcome.id, body())
        : await planOutcomeSessions(outcome.id, body());

      setProposal(result);
      setDraft(result.proposal);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setUnavailable('key');
      else if (err instanceof ApiError && err.status === 503) setUnavailable('ai');
      else setError(err instanceof Error ? err.message : 'Could not plan sessions');
    } finally {
      setPending(false);
    }
  };

  const apply = async () => {
    if (!proposal || !draft) return;

    setPending(true);
    setError(null);
    setDetails([]);

    try {
      const created = await applyOutcomeSessionPlan(outcome.id, {
        proposalId: proposal.proposalId,
        proposal: draft,
      });

      onApplied(created.commitmentIds.length);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const rules = (err.details as { rules?: string[] } | undefined)?.rules;
        setDetails(rules ?? []);
        setError('This plan does not fit your week yet.');
      } else if (err instanceof ApiError && err.status === 409) {
        // The proposal was applied or superseded elsewhere. Asking again is the
        // only useful move, and it costs the user one click rather than a
        // message they cannot act on.
        setError('That plan is no longer pending. Here is a fresh one.');
        await propose(proposal.source === 'template');
      } else {
        setError(err instanceof Error ? err.message : 'Could not apply this plan');
      }
    } finally {
      setPending(false);
    }
  };

  const editSession = (index: number, patch: Partial<WorkSessionPlan['sessions'][number]>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.map((session, i) =>
              i === index ? { ...session, ...patch } : session,
            ),
          }
        : current,
    );
  };

  const sessionRows = draft?.sessions ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="md"
      fullWidth
      aria-labelledby="plan-sessions-title"
    >
      <DialogTitle id="plan-sessions-title">
        {draft ? 'Review the plan' : hasSessions ? 'Plan more sessions' : 'Plan sessions'}
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
            {details.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {details.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {unavailable === 'key' && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            You need your own OpenAI key for this.{' '}
            <RouterLink to="/settings/ai-key">Add one</RouterLink>, or use a standard plan.
          </Alert>
        )}

        {unavailable === 'ai' && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="coach-unavailable">
            The coach is unavailable right now.
          </Alert>
        )}

        {!draft && (
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label="Target date"
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />

            <Box>
              <Typography id="minutes-per-day-label" gutterBottom>
                Minutes per day: {minutes}
              </Typography>
              <Slider
                value={minutes}
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={5}
                marks
                onChange={(_event, value) => setMinutes(value as number)}
                aria-labelledby="minutes-per-day-label"
                data-testid="minutes-per-day"
              />
            </Box>

            {pending && (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress size={20} aria-label="Planning" />
                <Typography variant="body2" color="text.secondary">
                  {slow ? 'Still thinking…' : 'Asking the coach…'}
                </Typography>
              </Stack>
            )}
          </Stack>
        )}

        {draft && (
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Milestones
              </Typography>
              <Stack spacing={1}>
                {draft.milestones.map((milestone, index) => (
                  <TextField
                    key={index}
                    size="small"
                    fullWidth
                    label={`Milestone ${index + 1}`}
                    value={milestone.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        milestones: draft.milestones.map((m, i) =>
                          i === index ? { ...m, title: event.target.value } : m,
                        ),
                      })
                    }
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Sessions
              </Typography>

              {/* A table above `sm`, stacked cards below — the same rows either way. */}
              {fullScreen ? (
                <Stack spacing={2}>
                  {sessionRows.map((session, index) => (
                    <Stack key={index} spacing={1}>
                      <TextField
                        size="small"
                        label="Session"
                        value={session.title}
                        onChange={(event) => editSession(index, { title: event.target.value })}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        type="datetime-local"
                        label="When"
                        value={toLocalInput(session.scheduledStart)}
                        onChange={(event) =>
                          editSession(index, {
                            scheduledStart: fromLocalInput(event.target.value),
                          })
                        }
                        slotProps={{ inputLabel: { shrink: true } }}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        type="number"
                        label="Minutes"
                        value={session.durationMinutes}
                        onChange={(event) =>
                          editSession(index, { durationMinutes: Number(event.target.value) })
                        }
                        slotProps={{
                          htmlInput: { 'data-testid': `session-minutes-${index}` },
                        }}
                        fullWidth
                      />
                      <Typography variant="caption" color="text.secondary">
                        Minimum: {session.minimumStart.title} ({session.minimumStart.minutes} min)
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Session</TableCell>
                      <TableCell>When</TableCell>
                      <TableCell>Minutes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sessionRows.map((session, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField
                            size="small"
                            value={session.title}
                            onChange={(event) =>
                              editSession(index, { title: event.target.value })
                            }
                            fullWidth
                            helperText={`Minimum: ${session.minimumStart.title} (${session.minimumStart.minutes} min)`}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="datetime-local"
                            value={toLocalInput(session.scheduledStart)}
                            onChange={(event) =>
                              editSession(index, {
                                scheduledStart: fromLocalInput(event.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            value={session.durationMinutes}
                            onChange={(event) =>
                              editSession(index, {
                                durationMinutes: Number(event.target.value),
                              })
                            }
                            slotProps={{
                              htmlInput: { 'data-testid': `session-minutes-${index}` },
                            }}
                            sx={{ width: 96 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                When this happens
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="After…"
                  value={draft.implementationIntention.when}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      implementationIntention: {
                        ...draft.implementationIntention,
                        when: event.target.value,
                      },
                    })
                  }
                  fullWidth
                />
                <Typography aria-hidden>→</Typography>
                <TextField
                  size="small"
                  label="I…"
                  value={draft.implementationIntention.then}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      implementationIntention: {
                        ...draft.implementationIntention,
                        then: event.target.value,
                      },
                    })
                  }
                  fullWidth
                />
              </Stack>
            </Box>

            <TextField
              select
              size="small"
              label="Review cadence"
              value={draft.reviewCadence}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  reviewCadence: event.target.value as WorkSessionPlan['reviewCadence'],
                })
              }
              sx={{ maxWidth: 240 }}
            >
              {CADENCES.map((cadence) => (
                <MenuItem key={cadence.value} value={cadence.value}>
                  {cadence.label}
                </MenuItem>
              ))}
            </TextField>

            <Typography variant="body2" color="text.secondary">
              {draft.rationale}
            </Typography>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>

        {!draft && (
          <>
            {unavailable && (
              <Button
                variant="outlined"
                disabled={pending}
                data-testid="use-standard-plan"
                onClick={() => void propose(true)}
              >
                Use a standard plan
              </Button>
            )}
            <Button
              variant="contained"
              disabled={pending}
              data-testid="plan-sessions-propose"
              onClick={() => void propose(false)}
            >
              {unavailable ? 'Try again' : 'Propose'}
            </Button>
          </>
        )}

        {draft && (
          <Button
            variant="contained"
            disabled={pending}
            data-testid="plan-sessions-apply"
            onClick={() => void apply()}
          >
            Apply
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
