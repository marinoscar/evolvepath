import { beforeEach, describe, it, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import {
  makeProposal,
  makeReview,
  seedReview,
  setNextGenerateTemplate,
  weeklyState,
} from '../mocks/weeklyHandlers';
import WeeklyReviewPage from '../../pages/WeeklyReviewPage';

// =============================================================================
// /progress/week (issue #84, epic E10)
// =============================================================================
//
// Three properties this file exists to hold:
//
//   1. THE SECTIONS ARE IN PRD §51's ORDER. The heading order is asserted
//      directly, because that order is the screen's whole contract — numbers
//      first, then what happened, then a pattern, then at most one change.
//   2. A TEMPLATE SUMMARY IS LABELLED. PRD §120 lets the screen work with the
//      provider down; the notice is what stops that being a silent
//      substitution.
//   3. AN APPROVED WEEK CANNOT BE REGENERATED. It was closed by a plan somebody
//      acted on, and rewriting the review it was approved against would make
//      the record a lie.
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
const DESKTOP = 1280;

function renderPage(route = '/progress/week') {
  return render(
    <Routes>
      <Route path="/progress/week" element={<WeeklyReviewPage />} />
    </Routes>,
    { wrapperOptions: { route } },
  );
}

describe('WeeklyReviewPage (#84)', () => {
  beforeEach(() => {
    act(() => setViewportWidth(DESKTOP));
  });

  it('offers to generate one when there is no review', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/No review for this week yet/i)).toBeInTheDocument();

    await user.click(screen.getByTestId('review-generate'));

    expect(await screen.findByTestId('week-tile-WORK')).toHaveTextContent('4 / 5');
  });

  it('renders the sections in PRD §51 order', async () => {
    seedReview(makeReview());
    renderPage();

    await screen.findByTestId('week-tile-WORK');

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((node) => node.textContent);

    expect(headings).toEqual([
      'What worked',
      'What got in the way',
      'Pattern',
      'Recommendation',
      'Keep unchanged',
      'Next week',
    ]);
  });

  it('renders the pattern with its Observation label', async () => {
    seedReview(makeReview());
    renderPage();

    const pattern = await screen.findByTestId('review-pattern');

    expect(within(pattern).getByText('Observation')).toBeInTheDocument();
    expect(within(pattern).getByText(/morning commitments/i)).toBeInTheDocument();
  });

  it('accepts a proposal and says which version it produced', async () => {
    const user = userEvent.setup();
    seedReview(makeReview({ proposals: [makeProposal() as never] }));
    renderPage();

    const card = await screen.findByTestId('review-proposal');
    expect(within(card).getByText(/Saturday/)).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Accept' }));

    expect(await screen.findByText(/Plan updated \(v2\)/)).toBeInTheDocument();
  });

  it('labels a summary written from the numbers alone', async () => {
    const user = userEvent.setup();
    setNextGenerateTemplate();
    renderPage();

    await user.click(await screen.findByTestId('review-generate'));

    expect(await screen.findByTestId('review-template-notice')).toHaveTextContent(
      /coach was unavailable/i,
    );
    // The numbers are unchanged; only the words are missing.
    expect(screen.getByTestId('week-tile-WORK')).toHaveTextContent('4 / 5');
    expect(screen.queryByTestId('review-proposal')).not.toBeInTheDocument();
  });

  it('refuses to regenerate an approved week', async () => {
    const user = userEvent.setup();
    seedReview(makeReview({ status: 'APPROVED' }));
    renderPage();

    await screen.findByTestId('week-tile-WORK');
    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(screen.getByRole('menuitem', { name: 'Regenerate' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sends the caller to the wizard, and reports an approved week instead', async () => {
    seedReview(makeReview());
    const { unmount } = renderPage();

    expect(
      await screen.findByTestId('review-approve-next-week'),
    ).toBeInTheDocument();

    unmount();
    seedReview(makeReview({ plan: { id: 'plan-1', status: 'APPROVED' } }));
    renderPage();

    expect(await screen.findByText(/Next week approved/)).toBeInTheDocument();
    expect(screen.queryByTestId('review-approve-next-week')).not.toBeInTheDocument();
  });

  it('asks for the week named in the URL', async () => {
    seedReview(makeReview());
    renderPage('/progress/week?weekStart=2026-08-31');

    // The deep link every "your week is ready" notification carries.
    await waitFor(() => expect(screen.getByTestId('week-tile-WORK')).toBeInTheDocument());
  });

  it('shows nothing rather than the wrong week when that week was never reviewed', async () => {
    seedReview(makeReview());
    renderPage('/progress/week?weekStart=2026-07-06');

    expect(await screen.findByText(/No review for this week yet/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    seedReview(makeReview({ proposals: [makeProposal() as never] }));
    const { container } = renderPage();

    await screen.findByTestId('week-tile-WORK');

    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
