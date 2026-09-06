import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { setMilestones, setProgress } from '../mocks/progressHandlers';
import ProgressPage from '../../pages/ProgressPage';

// =============================================================================
// The Progress screen (issue #117, epic E11)
// =============================================================================
//
// The property this file exists to hold: THERE IS NO SCORE ON THIS PAGE.
// PRD P13 and §54 forbid "Health Score: 77/100", and a screen full of counts is
// exactly one careless PR away from growing a percentage badge — so the whole
// rendered text is swept for `/100`, `%` and the word "score" in several states,
// including the one where a ratio IS available.
// =============================================================================

const NO_SCORE = /\b\d{1,3}\s*\/\s*100\b/;
const NO_PERCENT = /\d+\s*%/;
const NO_SCORE_WORD = /\bscore\b/i;

async function renderPage() {
  const view = render(<ProgressPage />, { user: mockAdminUser });
  await screen.findByRole('heading', { level: 1, name: 'Progress' });
  return view;
}

describe('ProgressPage (#117)', () => {
  beforeEach(() => {
    // No stubbing: the MSW handlers are the fixture, and they answer the same
    // shape the API's Zod schema does.
  });

  describe('PRD §75 layout', () => {
    it('renders every section, in order, as a navigable heading', async () => {
      await renderPage();

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2, name: 'Momentum' })).toBeInTheDocument(),
      );

      const headings = screen
        .getAllByRole('heading', { level: 2 })
        .map((node) => node.textContent);

      expect(headings).toEqual([
        // E10's weekly-review entry card keeps its place at the top: it IS the
        // weekly view of progress, and E11 was asked to leave it alone.
        'Your Week',
        'Your evolution',
        'Momentum',
        'Evidence',
        'Consistency',
        'Recovery',
        'Coach dependency',
        'Insights',
      ]);
    });

    it('shows one momentum card per domain, with its state word and its bullets', async () => {
      await renderPage();

      const health = await screen.findByTestId('momentum-HEALTH');
      expect(within(health).getByText('Health Momentum')).toBeInTheDocument();
      expect(within(health).getByText('Steady')).toBeInTheDocument();
      expect(
        within(health).getByText('5 of 6 planned workouts completed'),
      ).toBeInTheDocument();

      const work = screen.getByTestId('momentum-WORK');
      expect(within(work).getByText('Slipping')).toBeInTheDocument();

      const family = screen.getByTestId('momentum-FAMILY');
      expect(within(family).getByText('Not enough yet')).toBeInTheDocument();
    });
  });

  describe('the no-score rule (PRD P13, §54)', () => {
    it('renders no percentage, no /100 and no "score" in the default state', async () => {
      const { container } = await renderPage();
      await screen.findByTestId('momentum-HEALTH');

      const text = container.textContent ?? '';
      expect(text).not.toMatch(NO_SCORE);
      expect(text).not.toMatch(NO_PERCENT);
      expect(text).not.toMatch(NO_SCORE_WORD);
    });

    it('renders coach dependency as a fraction even when a ratio exists', async () => {
      // The one state where a percentage is genuinely available. PRD §75 calls
      // it "percent completed without reminder"; the screen says "7 of 10".
      setProgress({
        independence: { ratio: 0.7, completedWithoutReminder: 7, sampleSize: 10 },
      });

      const { container } = await renderPage();

      await screen.findByText('7 of 10 completed without a reminder');
      const text = container.textContent ?? '';
      expect(text).not.toMatch(NO_PERCENT);
      expect(text).not.toMatch(NO_SCORE);
    });
  });

  describe('the sections that say something when there is nothing', () => {
    it('names the run in weeks and admits the grace out loud', async () => {
      await renderPage();

      expect(await screen.findByText('3 weeks building momentum')).toBeInTheDocument();
      expect(screen.getByText(/1 grace week used/)).toBeInTheDocument();
    });

    it('says there is nothing to recover from rather than showing a zero', async () => {
      setProgress({ recovery: { medianDays: null, samples: 0 } });

      await renderPage();

      expect(await screen.findByText('No misses to recover from yet')).toBeInTheDocument();
    });

    it('explains why coach dependency is unavailable instead of reporting zero', async () => {
      await renderPage();

      expect(
        await screen.findByText('Available once notifications learn your rhythm.'),
      ).toBeInTheDocument();
    });

    it('points an empty insights list at the place the user controls it', async () => {
      await renderPage();

      const link = await screen.findByRole('link', { name: 'What the coach remembers' });
      expect(link).toHaveAttribute('href', '/settings/ai-memory');
    });
  });

  describe('the evidence strip', () => {
    it('shows the recent events and a way to the full list', async () => {
      await renderPage();

      expect(await screen.findByText('Protected family dinner')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute(
        'href',
        '/progress/timeline',
      );
    });
  });

  describe('milestone celebration (PRD §77)', () => {
    it('shows one toast, and acknowledging it takes it away', async () => {
      const user = userEvent.setup();
      await renderPage();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('First comeback');

      await user.click(within(alert).getByRole('button', { name: /close/i }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('shows nothing when there is nothing left to celebrate', async () => {
      setMilestones([]);

      await renderPage();
      await screen.findByTestId('momentum-HEALTH');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = await renderPage();
    await screen.findByTestId('momentum-HEALTH');

    expect(await axe(container)).toHaveNoViolations();
  });
});
