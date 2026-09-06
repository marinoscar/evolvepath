import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../utils/test-utils';
import { setViewportWidth } from '../../setup';
import {
  askQuestions,
  seedAttachment,
  setAskOutcome,
} from '../../mocks/mediaHandlers';
import { AskAboutMediaDialog } from '../../../components/media/AskAboutMediaDialog';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AskAboutMediaDialog', () => {
  it('asks with the typed question and renders the answer', async () => {
    const attachment = seedAttachment({ purpose: 'MEAL' });
    render(
      <AskAboutMediaDialog
        open
        onClose={vi.fn()}
        attachment={attachment}
      />,
    );

    await userEvent.type(
      screen.getByLabelText(/Question/),
      'Is this a decent breakfast?',
    );
    await userEvent.click(screen.getByTestId('media-ask-button'));

    expect(
      await screen.findByTestId('media-advice-summary'),
    ).toHaveTextContent('Your setup looks steady');
    expect(askQuestions()).toEqual(['Is this a decent breakfast?']);
  });

  it('asks without a question when none is typed', async () => {
    // `question` is optional on the wire; sending an empty string would make
    // "the user asked nothing" indistinguishable from "the user asked ''".
    render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );

    await userEvent.click(screen.getByTestId('media-ask-button'));

    await screen.findByTestId('media-advice-summary');
    expect(askQuestions()).toEqual([undefined]);
  });

  it('disables Ask while the media is still processing', () => {
    render(
      <AskAboutMediaDialog
        open
        onClose={vi.fn()}
        attachment={seedAttachment({ processingStatus: 'processing' })}
      />,
    );

    expect(screen.getByTestId('media-ask-button')).toBeDisabled();
  });

  it('links to the key page for no_user_key rather than offering a retry', async () => {
    // The one failure that is the USER'S to fix. Retrying without a key
    // produces the same answer, and the difference between "unavailable" and
    // "you have not added a key" is the difference between waiting and acting.
    setAskOutcome({
      body: {
        data: {
          ok: false,
          error: { code: 'no_user_key', message: 'Add your OpenAI key' },
        },
      },
    });

    render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );
    await userEvent.click(screen.getByTestId('media-ask-button'));

    const link = await screen.findByRole('link', { name: 'Add your key' });
    expect(link).toHaveAttribute('href', '/settings/ai-key');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers a retry when the coach is simply unavailable', async () => {
    setAskOutcome({
      body: {
        data: {
          ok: false,
          error: { code: 'provider', message: 'The provider timed out' },
        },
      },
    });

    render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );
    await userEvent.click(screen.getByTestId('media-ask-button'));

    expect(
      await screen.findByText(/couldn’t answer this one/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    setAskOutcome(null);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('media-advice-summary')).toBeInTheDocument();
  });

  it('renders the professional-care alert when the coach flags one', async () => {
    setAskOutcome({
      body: {
        data: {
          ok: true,
          advice: {
            summary: 'I can see the bar moving, but something is off.',
            observations: ['Your left knee gives way at the bottom.'],
            advice: ['Stop here for today.'],
            safetyFlag: {
              level: 'seek_professional',
              reason: 'A joint giving way under load.',
            },
          },
          invocationId: 'inv-1',
          model: 'gpt-test',
          latencyMs: 10,
          askedAt: new Date().toISOString(),
        },
      },
    });

    render(
      <AskAboutMediaDialog
        open
        onClose={vi.fn()}
        attachment={seedAttachment({ kind: 'VIDEO' })}
      />,
    );
    await userEvent.click(screen.getByTestId('media-ask-button'));

    expect(await screen.findByTestId('media-advice-safety')).toHaveTextContent(
      'see a qualified professional',
    );
  });

  it('offers the four purposes when no attachment is given', async () => {
    render(<AskAboutMediaDialog open onClose={vi.fn()} />);

    for (const purpose of ['WORKOUT_FORM', 'EQUIPMENT', 'MEAL', 'GENERAL']) {
      expect(screen.getByTestId(`media-purpose-${purpose}`)).toBeInTheDocument();
    }
    // Nothing to ask about yet.
    expect(screen.getByTestId('media-ask-button')).toBeDisabled();
  });

  it('says out loud that a meal check is about habits', async () => {
    render(<AskAboutMediaDialog open onClose={vi.fn()} purpose="MEAL" />);

    expect(screen.getByText(/Habits, not calories/)).toBeInTheDocument();
  });

  it('is full screen below sm and a dialog above it', async () => {
    act(() => setViewportWidth(375));
    const { unmount } = render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );

    expect(
      document.querySelector('.MuiDialog-paperFullScreen'),
    ).not.toBeNull();
    unmount();

    act(() => setViewportWidth(1024));
    render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );

    expect(document.querySelector('.MuiDialog-paperFullScreen')).toBeNull();
  });

  it('has no accessibility violations in either layout', async () => {
    act(() => setViewportWidth(375));
    const first = render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );
    expect(
      await axe(document.body, AXE_OPTIONS),
    ).toHaveNoViolations();
    first.unmount();

    act(() => setViewportWidth(1024));
    render(
      <AskAboutMediaDialog open onClose={vi.fn()} attachment={seedAttachment()} />,
    );
    expect(await axe(document.body, AXE_OPTIONS)).toHaveNoViolations();
  });
});
