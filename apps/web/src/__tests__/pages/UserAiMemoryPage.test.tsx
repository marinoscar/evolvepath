import { beforeEach, describe, it, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import {
  makeInsight,
  memoryState,
  seedInsights,
  setNextPropose,
} from '../mocks/memoryHandlers';
import UserAiMemoryPage from '../../pages/UserAiMemoryPage';

// =============================================================================
// /settings/ai-memory (issue #90, epic E06)
// =============================================================================
//
// Three properties this file exists to hold:
//
//   1. AN EXCLUDED INSIGHT IS STILL LISTED. "Don't use for coaching" hides a
//      sentence from the coach, not from the person it is about, and the page
//      has to ask for `includeDoNotUse` to keep that true.
//   2. CONFIDENCE IS WORDS. A number invites the reader to treat a heuristic
//      as a measurement; the assertion is that no digits reach the chips.
//   3. FORGET ASKS FIRST, because the server delete is hard and there is no
//      undo to fall back on.
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
const PHONE = 390;
const DESKTOP = 1280;

function renderPage() {
  return render(
    <Routes>
      <Route path="/settings/ai-memory" element={<UserAiMemoryPage />} />
    </Routes>,
    { wrapperOptions: { route: '/settings/ai-memory', user: mockAdminUser } },
  );
}

describe('UserAiMemoryPage (#90)', () => {
  beforeEach(() => {
    act(() => setViewportWidth(DESKTOP));
  });

  it('says what is remembered, and nothing when nothing is', async () => {
    renderPage();

    expect(await screen.findByTestId('memory-empty')).toBeInTheDocument();
    // The two rules the switches would otherwise not explain.
    expect(
      screen.getByText(/only plans with insights you have confirmed/i),
    ).toBeInTheDocument();
  });

  it('groups insights under category headings', async () => {
    seedInsights([
      makeInsight({ id: 'a', category: 'HEALTH', statement: 'Trains best before 9am.' }),
      makeInsight({ id: 'b', category: 'PATTERN', statement: 'Wednesday evenings slip.' }),
    ]);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Patterns the coach noticed' }),
    ).toBeInTheDocument();
  });

  it('lists an excluded insight rather than hiding it', async () => {
    seedInsights([
      makeInsight({ id: 'a', statement: 'Excluded thing.', doNotUse: true, userConfirmed: true }),
    ]);

    renderPage();

    // The page asks for `includeDoNotUse`; hiding it here would mean the user
    // could neither see nor undo their own decision.
    expect(await screen.findByText('Excluded thing.')).toBeInTheDocument();
    expect(screen.getByText('Not used for coaching')).toBeInTheDocument();
  });

  it('shows confidence as a word, never as a number', async () => {
    seedInsights([
      makeInsight({ id: 'a', confidence: 0.82, statement: 'Likely thing.' }),
      makeInsight({ id: 'b', confidence: 0.5, statement: 'Possible thing.', category: 'WORK' }),
      makeInsight({ id: 'c', confidence: 0.1, statement: 'Tentative thing.', category: 'FAMILY' }),
    ]);

    renderPage();

    expect(await screen.findByText('likely')).toBeInTheDocument();
    expect(screen.getByText('possible')).toBeInTheDocument();
    expect(screen.getByText('tentative')).toBeInTheDocument();
    expect(screen.queryByText('0.82')).not.toBeInTheDocument();
    expect(screen.queryByText('82%')).not.toBeInTheDocument();
  });

  describe('the controls', () => {
    it('confirms an unconfirmed insight', async () => {
      const user = userEvent.setup();
      seedInsights([makeInsight({ id: 'a', userConfirmed: false })]);
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(memoryState().insights[0].userConfirmed).toBe(true));
      expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    });

    it('excludes an insight from coaching', async () => {
      const user = userEvent.setup();
      seedInsights([
        makeInsight({ id: 'a', statement: 'Morning thing.', userConfirmed: true }),
      ]);
      renderPage();

      // `role="switch"`, and the name carries the statement: eight identical
      // "Use for coaching" toggles would be unusable without it.
      const toggle = await screen.findByRole('switch', {
        name: 'Use "Morning thing." for coaching',
      });
      await user.click(toggle);

      await waitFor(() => expect(memoryState().insights[0].doNotUse).toBe(true));
      expect(await screen.findByText('Not used for coaching')).toBeInTheDocument();
    });

    it('asks before forgetting, and then forgets', async () => {
      const user = userEvent.setup();
      seedInsights([makeInsight({ id: 'a', statement: 'Doomed thing.' })]);
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Forget' }));

      // Hard delete on the server: saying so is the difference between an
      // informed choice and a surprise.
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/can't be undone/i)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Forget' }));

      await waitFor(() => expect(memoryState().insights).toHaveLength(0));
      expect(screen.queryByText('Doomed thing.')).not.toBeInTheDocument();
    });

    it('cancels a forget without deleting anything', async () => {
      const user = userEvent.setup();
      seedInsights([makeInsight({ id: 'a', statement: 'Spared thing.' })]);
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Forget' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(memoryState().insights).toHaveLength(1);
      expect(screen.getByText('Spared thing.')).toBeInTheDocument();
    });

    it('edits inline, which also confirms', async () => {
      const user = userEvent.setup();
      seedInsights([
        makeInsight({ id: 'a', statement: 'Coach words.', userConfirmed: false }),
      ]);
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Edit' }));

      const field = await screen.findByLabelText('Statement');
      await user.clear(field);
      await user.type(field, 'My words.');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(memoryState().insights[0].statement).toBe('My words.'));
      // "This, but in my words" is agreement.
      expect(memoryState().insights[0].userConfirmed).toBe(true);
    });

    it('adds an insight of the user’s own', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Add insight' }));

      const dialog = await screen.findByRole('dialog');
      await user.type(
        within(dialog).getByLabelText('Statement'),
        'I plan better on Sunday evenings.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Add' }));

      await waitFor(() => expect(memoryState().insights).toHaveLength(1));
      expect(memoryState().insights[0]).toMatchObject({
        source: 'USER',
        userConfirmed: true,
      });
      expect(
        await screen.findByText('I plan better on Sunday evenings.'),
      ).toBeInTheDocument();
    });
  });

  describe('propose', () => {
    it('adds what the coach noticed', async () => {
      const user = userEvent.setup();
      setNextPropose({
        created: [makeInsight({ id: 'new', statement: 'Mornings are more reliable.' })],
        skipped: null,
      });
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Propose insights' }));

      expect(await screen.findByText('Mornings are more reliable.')).toBeInTheDocument();
      expect(screen.getByText(/1 new insight to review/)).toBeInTheDocument();
    });

    it('explains why there is nothing yet', async () => {
      const user = userEvent.setup();
      setNextPropose({ created: [], skipped: 'insufficient_data' });
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Propose insights' }));

      // A proposer that cannot run is not a broken screen; it is a sentence.
      expect(await screen.findByText(/Not enough history yet/)).toBeInTheDocument();
    });

    it('explains an unavailable coach', async () => {
      const user = userEvent.setup();
      setNextPropose({ created: [], skipped: 'ai_unavailable' });
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Propose insights' }));

      expect(await screen.findByText(/coach is unavailable/i)).toBeInTheDocument();
    });

    it('explains the ten-minute bound', async () => {
      const user = userEvent.setup();
      setNextPropose('throttled');
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Propose insights' }));

      expect(await screen.findByText(/Try again in a few minutes/)).toBeInTheDocument();
    });
  });

  describe('layout and accessibility', () => {
    it('moves the actions into an overflow menu on a phone', async () => {
      act(() => setViewportWidth(PHONE));
      const user = userEvent.setup();
      seedInsights([makeInsight({ id: 'a', userConfirmed: false })]);
      renderPage();

      const overflow = await screen.findByRole('button', { name: 'More actions' });
      expect(screen.queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument();

      await user.click(overflow);

      const menu = await screen.findByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: 'Confirm' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Forget' })).toBeInTheDocument();
    });

    it.each([
      ['desktop', DESKTOP],
      ['phone', PHONE],
    ])('has no axe violations at %s width', async (_label, width) => {
      act(() => setViewportWidth(width));
      seedInsights([makeInsight({ id: 'a' })]);

      const { container } = renderPage();
      await screen.findByRole('heading', { name: 'Patterns the coach noticed' });

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });
});
