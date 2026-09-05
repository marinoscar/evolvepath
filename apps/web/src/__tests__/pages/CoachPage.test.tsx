import { beforeEach, describe, it, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render, mockAdminUser } from '../utils/test-utils';
import { setViewportWidth } from '../setup';
import {
  coachState,
  degradeNextSend,
  failNextSend,
  seedConversation,
  seedMessage,
} from '../mocks/coachHandlers';
import CoachPage from '../../pages/CoachPage';

// =============================================================================
// /coach (issue #86, epic E06)
// =============================================================================
//
// Three properties this file exists to hold:
//
//   1. THE MESSAGE APPEARS BEFORE THE REPLY DOES. A coaching turn takes
//      seconds, and a user who types a sentence into an empty screen assumes
//      it did not send. The optimistic bubble is the feature, and a failure
//      that discarded the text would make "Retry" a lie.
//   2. A PROPOSAL IS A DECISION, NOT A NOTIFICATION. It renders a diff and
//      three buttons (PRD §15), and Accept is the only thing on this screen
//      that changes a plan.
//   3. "WHY THIS?" SHOWS reasoning_summary AND NOTHING ELSE, and is absent on
//      a fallback — where `structured` is null because there was no model
//      output to explain.
// =============================================================================

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };
const PHONE = 390;
const DESKTOP = 1280;

function renderCoach(route = '/coach') {
  return render(
    <Routes>
      <Route path="/coach" element={<CoachPage />} />
      <Route path="/coach/:conversationId" element={<CoachPage />} />
    </Routes>,
    { wrapperOptions: { route, user: mockAdminUser } },
  );
}

describe('CoachPage (#86)', () => {
  beforeEach(() => {
    act(() => setViewportWidth(DESKTOP));
  });

  it('offers the seven suggested prompts on an empty conversation', async () => {
    renderCoach();

    const chips = await screen.findByTestId('suggested-prompts');

    // The ORDER is the spec: planning → friction → re-deciding.
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([
      'Plan my week',
      "I'm procrastinating",
      'Make today shorter',
      'I fell off',
      'Review my progress',
      'What matters most?',
      'Change my plan',
    ]);
  });

  it('sends a suggested prompt as a message', async () => {
    const user = userEvent.setup();
    renderCoach();

    await user.click(await screen.findByRole('button', { name: "I'm procrastinating" }));

    // Scoped to the log: the same words also become the new conversation's
    // title in the side panel, which is correct and is not what this asserts.
    const log = await screen.findByRole('log');
    expect(await within(log).findByText("I'm procrastinating")).toBeInTheDocument();
    expect(
      await within(log).findByText('Ten minutes now would keep the week alive.'),
    ).toBeInTheDocument();
  });

  it('shows the message immediately and the reply after it arrives', async () => {
    const user = userEvent.setup();
    const conversation = seedConversation();
    renderCoach(`/coach/${conversation.id}`);

    await user.type(
      await screen.findByLabelText('Message the coach'),
      'I keep putting it off',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // Before the handler resolves: the bubble is already there.
    expect(screen.getByText('I keep putting it off')).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText('Ten minutes now would keep the week alive.'),
      ).toBeInTheDocument(),
    );
  });

  it('keeps the text and offers Retry when a send fails', async () => {
    const user = userEvent.setup();
    const conversation = seedConversation();
    renderCoach(`/coach/${conversation.id}`);

    failNextSend();

    await user.type(await screen.findByLabelText('Message the coach'), 'hello there');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const retry = await screen.findByRole('button', { name: 'Retry' });
    // The text survived, which is what makes Retry meaningful.
    expect(screen.getByText('hello there')).toBeInTheDocument();

    await user.click(retry);

    await waitFor(() =>
      expect(
        screen.getByText('Ten minutes now would keep the week alive.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  describe('proposals', () => {
    async function sendPlanChange() {
      const user = userEvent.setup();
      const conversation = seedConversation();
      renderCoach(`/coach/${conversation.id}`);

      await user.type(
        await screen.findByLabelText('Message the coach'),
        "I can't work out Wednesday anymore",
      );
      await user.click(screen.getByRole('button', { name: 'Send' }));

      await screen.findByTestId('proposal-card');
      return user;
    }

    it('renders the diff and the three PRD §15 buttons', async () => {
      await sendPlanChange();

      const card = screen.getByTestId('proposal-card');
      expect(
        within(card).getByText('Move the Wednesday workout to Saturday morning.'),
      ).toBeInTheDocument();

      const table = within(card).getByTestId('plan-change-diff-table');
      expect(within(table).getByText('18:30')).toBeInTheDocument();
      expect(within(table).getByText('09:00')).toBeInTheDocument();

      for (const label of ['Accept', 'Edit', 'Keep current plan']) {
        expect(within(card).getByRole('button', { name: label })).toBeInTheDocument();
      }
    });

    it('accepts and reports the version it produced', async () => {
      const user = await sendPlanChange();

      await user.click(screen.getByRole('button', { name: 'Accept' }));

      // Text, not colour: the chip has to say what happened.
      expect(await screen.findByText('Plan updated (v2)')).toBeInTheDocument();
      expect(coachState().proposals['proposal-1'].status).toBe('ACCEPTED');
      // The decision is made; the buttons are gone rather than disabled.
      expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    });

    it('keeps the current plan without touching it', async () => {
      const user = await sendPlanChange();

      await user.click(screen.getByRole('button', { name: 'Keep current plan' }));

      expect(await screen.findByText('Kept current plan')).toBeInTheDocument();
      expect(coachState().proposals['proposal-1'].status).toBe('REJECTED');
    });

    it('edits, then accepts, in one action', async () => {
      const user = await sendPlanChange();

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      const time = await screen.findByLabelText('Time');
      await user.clear(time);
      await user.type(time, '10:00');
      await user.click(screen.getByRole('button', { name: 'Save and accept' }));

      expect(await screen.findByText('Plan updated (v2)')).toBeInTheDocument();
      expect(coachState().proposals['proposal-1'].edited).toBe(true);
    });
  });

  describe('why this, safety and degradation', () => {
    it('reveals the reasoning summary and nothing else', async () => {
      const user = userEvent.setup();
      const conversation = seedConversation();
      renderCoach(`/coach/${conversation.id}`);

      await user.click(await screen.findByRole('button', { name: 'Plan my week' }));
      await screen.findByText('Ten minutes now would keep the week alive.');

      const expander = screen.getByRole('button', { name: /Why this\?/ });
      await user.click(expander);

      expect(
        await screen.findByText('Wednesday has been missed three weeks running.'),
      ).toBeInTheDocument();
    });

    it('has no "Why this?" on a fallback reply', async () => {
      const user = userEvent.setup();
      const conversation = seedConversation();
      renderCoach(`/coach/${conversation.id}`);

      degradeNextSend();

      await user.type(await screen.findByLabelText('Message the coach'), 'hello');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      // `structured` is null because there was no model output — so there is
      // no reasoning to explain, and the expander is simply absent.
      expect(
        await screen.findByText(/The coach is unavailable right now/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Why this\?/ })).not.toBeInTheDocument();
    });

    it('shows the professional-care note on a safety reply', async () => {
      const conversation = seedConversation();
      seedMessage(conversation.id, {
        role: 'COACH',
        content: 'That sounds like something to get looked at.',
        structured: null,
        safety: {
          decision: 'redirect',
          category: 'injury',
          userFacingNote: 'Please have a qualified health professional check it.',
        },
      });

      renderCoach(`/coach/${conversation.id}`);

      const note = await screen.findByTestId('safety-note');
      expect(note).toHaveTextContent('qualified health professional');
    });
  });

  describe('layout', () => {
    it('puts the list beside the conversation at desktop width', async () => {
      seedConversation({ title: 'Schedule change' });
      renderCoach();

      expect(await screen.findByTestId('conversation-list')).toBeInTheDocument();
      expect(screen.getByLabelText('Message the coach')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Back to conversations' }),
      ).not.toBeInTheDocument();
    });

    it('shows the list alone on a phone, then the conversation alone', async () => {
      act(() => setViewportWidth(PHONE));
      const conversation = seedConversation({ title: 'Schedule change' });

      const { unmount } = renderCoach();

      // One screen at a time: the composer is not on the list screen.
      expect(await screen.findByTestId('conversation-list')).toBeInTheDocument();
      expect(screen.queryByLabelText('Message the coach')).not.toBeInTheDocument();

      unmount();
      renderCoach(`/coach/${conversation.id}`);

      expect(await screen.findByLabelText('Message the coach')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Back to conversations' }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it.each([
      ['desktop', DESKTOP],
      ['phone', PHONE],
    ])('has no axe violations at %s width', async (_label, width) => {
      act(() => setViewportWidth(width));
      seedConversation();

      const { container } = renderCoach();
      await screen.findByTestId('conversation-list');

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });

    it('announces new messages through a live region', async () => {
      const conversation = seedConversation();
      renderCoach(`/coach/${conversation.id}`);

      const log = await screen.findByRole('log');
      expect(log).toHaveAttribute('aria-live', 'polite');
      // Additions only: a screen reader should hear the reply arrive, not the
      // whole conversation re-read.
      expect(log).toHaveAttribute('aria-relevant', 'additions');
    });
  });
});
