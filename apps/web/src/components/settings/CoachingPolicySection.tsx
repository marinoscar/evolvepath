// =============================================================================
// Coaching reminders — the policy the engine obeys (issue #68, epic E12)
// =============================================================================
//
// A SECTION, not a tab and not a new registry card. CLAUDE.md's Settings UI
// rules draw the line precisely: a destination gate is about REACHABILITY, a tab
// gate is about CONTENT, and this is neither — it is more of the same question
// the matrix above already asks ("how should this application interrupt me?").
// A second card would make the user answer that question in two places; a tab
// would make it hierarchical content wearing a tab strip, which is the exact
// mistake epic #90 fixed.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO CONTROL FOR `mutedCategories`
// -----------------------------------------------------------------------------
//
// Because the matrix above IS that control. "Never tell me about upcoming
// commitments" is already expressible by turning off that event's channels, and
// a second surface for the same intent would leave the user with two switches
// that disagree. The field stays API-only.
//
// -----------------------------------------------------------------------------
// WHY THE SLIDERS DEBOUNCE AND THE TIME FIELDS DO NOT
// -----------------------------------------------------------------------------
//
// A slider drag emits a change per pixel; sending each one would be dozens of
// PATCHes for one decision. A time field emits one value when the user finishes
// typing, and `onBlur` is the moment they have finished. Same goal — one request
// per decision — reached differently because the two controls decide
// differently.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { NotificationPolicy, NotificationPolicyPatch } from '../../types';

/** How long a slider must be still before its value is sent. */
export const SLIDER_DEBOUNCE_MS = 600;

interface CapDef {
  key: 'dailyCap' | 'weeklyCap' | 'perCommitmentMax';
  label: string;
  max: number;
  helper: string;
  unit: string;
}

/**
 * The three caps, as a table.
 *
 * The maxima are the API's, minus the headroom nobody needs: the schema allows a
 * weekly cap of 100, and a slider that goes to 100 in steps of one is a slider
 * nobody can set precisely. A user who wants 73 reminders a week is not a user
 * this control is for.
 */
const CAPS: CapDef[] = [
  {
    key: 'dailyCap',
    label: 'Daily cap',
    max: 10,
    unit: 'per day',
    helper: 'The most coaching messages you will get in one day. Zero means none.',
  },
  {
    key: 'weeklyCap',
    label: 'Weekly cap',
    max: 50,
    unit: 'per week',
    helper: 'The same limit across a Monday-to-Sunday week.',
  },
  {
    key: 'perCommitmentMax',
    label: 'Per-commitment maximum',
    max: 5,
    unit: 'per commitment',
    helper: 'How many messages any single commitment may produce.',
  },
];

export interface CoachingPolicySectionProps {
  policy: NotificationPolicy;
  onChange: (patch: NotificationPolicyPatch) => void;
  isSaving?: boolean;
}

export function CoachingPolicySection({
  policy,
  onChange,
  isSaving = false,
}: CoachingPolicySectionProps) {
  const idPrefix = useId();

  // Local mirrors ONLY for the controls that need one to feel right: a slider
  // that snapped back to the server's value mid-drag would be unusable, and a
  // time field that reset while being typed into would be worse. Everything
  // else renders straight from `policy`.
  const [caps, setCaps] = useState({
    dailyCap: policy.dailyCap,
    weeklyCap: policy.weeklyCap,
    perCommitmentMax: policy.perCommitmentMax,
  });
  const [start, setStart] = useState(policy.quietHours?.start ?? '');
  const [end, setEnd] = useState(policy.quietHours?.end ?? '');

  // The server is still the source of truth: when it answers, the mirrors catch
  // up, including for a value it clamped.
  useEffect(() => {
    setCaps({
      dailyCap: policy.dailyCap,
      weeklyCap: policy.weeklyCap,
      perCommitmentMax: policy.perCommitmentMax,
    });
  }, [policy.dailyCap, policy.weeklyCap, policy.perCommitmentMax]);

  useEffect(() => {
    setStart(policy.quietHours?.start ?? '');
    setEnd(policy.quietHours?.end ?? '');
  }, [policy.quietHours]);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => {
      // A pending PATCH for a page the user has left is a write they may not be
      // expecting; the ones they finished have already been sent.
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  const commitCap = useCallback(
    (key: CapDef['key'], value: number) => {
      setCaps((current) => ({ ...current, [key]: value }));

      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        onChange({ [key]: value });
      }, SLIDER_DEBOUNCE_MS);
    },
    [onChange],
  );

  /**
   * Quiet hours are sent only when BOTH bounds are set.
   *
   * The same rule the API reads back with: a window with one bound has no
   * meaning, so a half-typed pair is simply not a change yet. Sending it would
   * produce a 400 the user cannot act on while they are still typing.
   */
  const commitQuietHours = useCallback(
    (nextStart: string, nextEnd: string) => {
      if (!nextStart || !nextEnd) return;
      if (nextStart === policy.quietHours?.start && nextEnd === policy.quietHours?.end) return;

      onChange({ quietHours: { start: nextStart, end: nextEnd } });
    },
    [onChange, policy.quietHours],
  );

  const clearQuietHours = useCallback(() => {
    setStart('');
    setEnd('');
    onChange({ quietHours: null });
  }, [onChange]);

  const headingId = `${idPrefix}-heading`;

  return (
    <Card component="section" aria-labelledby={headingId} sx={{ mt: 3 }}>
      <CardContent>
        <Typography id={headingId} variant="h6" gutterBottom>
          Coaching reminders
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          When the coach may interrupt you, and how often. These limits apply to every
          coaching message above.
        </Typography>

        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Quiet hours
            </Typography>
            {/*
              `flexWrap` and no breakpoint gate: the two fields sit side by side
              when there is room and stack when there is not. Width decides, not
              a gate — none of the five coupled gates is involved here.
            */}
            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <TextField
                type="time"
                label="From"
                size="small"
                data-testid="policy-quiet-start"
                value={start}
                disabled={isSaving}
                onChange={(event) => setStart(event.target.value)}
                onBlur={() => commitQuietHours(start, end)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="time"
                label="Until"
                size="small"
                data-testid="policy-quiet-end"
                value={end}
                disabled={isSaving}
                onChange={(event) => setEnd(event.target.value)}
                onBlur={() => commitQuietHours(start, end)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {(start || end) && (
                <Button size="small" onClick={clearQuietHours} disabled={isSaving}>
                  Clear
                </Button>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {/* The timezone is stated because the whole rule depends on it,
                  and because a user who travels will otherwise wonder why
                  "22:00" stopped meaning what it did. */}
              Quiet hours use your profile timezone ({policy.timezone}). A window that
              crosses midnight — 22:00 until 07:00 — works as you would expect.
            </Typography>
          </Box>

          {CAPS.map((cap) => {
            const sliderId = `${idPrefix}-${cap.key}`;
            return (
              <Box key={cap.key}>
                <Typography id={sliderId} variant="subtitle2" gutterBottom>
                  {cap.label}
                </Typography>
                <Slider
                  data-testid={`policy-${cap.key}`}
                  value={caps[cap.key]}
                  min={0}
                  max={cap.max}
                  step={1}
                  marks
                  valueLabelDisplay="auto"
                  disabled={isSaving}
                  aria-labelledby={sliderId}
                  getAriaValueText={(value) => `${value} ${cap.unit}`}
                  onChange={(_event, value) => commitCap(cap.key, value as number)}
                  sx={{ maxWidth: 420 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {cap.helper}
                </Typography>
              </Box>
            );
          })}

          {/*
            READ-ONLY, and present only when it is in force (#59's PRD §61
            reduction). Without this line a user whose cap has been halved sees a
            slider saying 4 and receives 2, and concludes the setting is broken.
          */}
          {policy.fatigue.active && (
            <Typography variant="body2" color="text.secondary">
              <strong>Fatigue mode is on.</strong> Recent coaching messages went
              unanswered, so the daily cap is temporarily {policy.fatigue.effectiveDailyCap}.
              Acting on one message restores it.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
