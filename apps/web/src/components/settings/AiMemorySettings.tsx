import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';

import { useMemoryInsights } from '../../hooks/useMemoryInsights';
import { ApiError } from '../../services/api';
import type { MemoryInsightCategory } from '../../types';
import AddMemoryInsightDialog from './AddMemoryInsightDialog';
import MemoryInsightRow from './MemoryInsightRow';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './memoryCategories';

// =============================================================================
// Settings → AI Memory (issue #90, epic E06)
// =============================================================================
//
// PRD §85's three controls, on one page: Edit, Forget, Don't use for coaching.
// The intro copy states the two rules that are otherwise invisible — the coach
// plans only with CONFIRMED insights, and an excluded insight stays here for
// the user while leaving every prompt — because a settings page whose switches
// have no stated effect teaches nothing.
//
// EXCLUDED INSIGHTS ARE LISTED. This is the one place they must remain
// visible: "don't use this for coaching" hides a sentence from the coach, not
// from the person it is about.
// =============================================================================

const SKIP_MESSAGES: Record<string, string> = {
  insufficient_data:
    'Not enough history yet. Keep using the app and try again in a week or so.',
  ai_unavailable: 'The coach is unavailable right now. Nothing was changed.',
};

export default function AiMemorySettings() {
  const memory = useMemoryInsights();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: memory.insights.filter((insight) => insight.category === category),
  })).filter((group) => group.items.length > 0);

  const propose = async () => {
    try {
      const result = await memory.propose();

      if (result.skipped) {
        setNotice(SKIP_MESSAGES[result.skipped] ?? 'Nothing to propose right now.');
        return;
      }

      setNotice(
        result.created.length === 0
          ? 'Nothing new to propose — the coach already knows what it has noticed.'
          : `${result.created.length} new insight${result.created.length === 1 ? '' : 's'} to review.`,
      );
    } catch (err) {
      // The one rejection worth its own copy: the run is bounded to once per
      // ten minutes, and clicking again cannot produce a different answer.
      // Branch on the STATUS, not on the message text — a copy change on the
      // server would silently turn this into the generic line.
      const throttled = err instanceof ApiError && err.status === 429;
      setNotice(
        throttled
          ? 'Insights were proposed recently. Try again in a few minutes.'
          : 'Could not ask the coach right now.',
      );
    }
  };

  const add = async (input: {
    category: MemoryInsightCategory;
    statement: string;
  }) => {
    setAdding(false);
    await memory.create(input);
    setNotice('Insight added.');
  };

  return (
    <Box>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        The coach only plans with insights you have confirmed. Anything marked
        &ldquo;Don&apos;t use for coaching&rdquo; stays here for you but is never sent
        to the AI. Forget removes it permanently.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <Button variant="contained" onClick={() => setAdding(true)}>
          Add insight
        </Button>
        <Button
          variant="outlined"
          disabled={memory.proposing}
          onClick={() => void propose()}
        >
          {memory.proposing ? 'Asking the coach…' : 'Propose insights'}
        </Button>
      </Stack>

      {memory.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {memory.error}
        </Alert>
      )}

      {memory.isLoading ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Stack>
      ) : grouped.length === 0 ? (
        <Typography color="text.secondary" data-testid="memory-empty">
          Nothing remembered yet. Confirmed insights appear here as the coach
          notices patterns, or add your own.
        </Typography>
      ) : (
        grouped.map((group) => (
          <Box key={group.category} sx={{ mb: 3 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              {CATEGORY_LABELS[group.category]}
            </Typography>

            <List disablePadding>
              {group.items.map((insight) => (
                <MemoryInsightRow
                  key={insight.id}
                  insight={insight}
                  onConfirm={(id) => {
                    void memory.confirm(id).then(() => setNotice('Insight confirmed.'));
                  }}
                  onEdit={(id, statement) => {
                    void memory.edit(id, statement).then(() => setNotice('Insight saved.'));
                  }}
                  onSetDoNotUse={(id, doNotUse) => {
                    void memory
                      .setDoNotUse(id, doNotUse)
                      .then(() =>
                        setNotice(
                          doNotUse
                            ? 'The coach will not use this.'
                            : 'The coach will use this again.',
                        ),
                      );
                  }}
                  onForget={(id) => {
                    void memory.forget(id).then(() => setNotice('Insight forgotten.'));
                  }}
                />
              ))}
            </List>
          </Box>
        ))
      )}

      <AddMemoryInsightDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(input) => void add(input)}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={4000}
        message={notice ?? ''}
        onClose={() => setNotice(null)}
      />
    </Box>
  );
}
