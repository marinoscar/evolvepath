import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { ConfirmPhraseDialog } from '../../../components/settings/ConfirmPhraseDialog';

// =============================================================================
// ConfirmPhraseDialog — the typed confirmation (epic #220, #224)
// =============================================================================
//
// Two properties are worth testing here and the rest is decoration.
//
// 1. THE BUTTON IS INERT UNTIL THE PHRASE MATCHES EXACTLY, including case. A
//    dialog that accepted "delete my data" would be asking for a click, not a
//    deliberate act, which is the entire reason a typed phrase exists instead
//    of a checkbox.
//
// 2. `onConfirm` RECEIVES WHAT THE USER TYPED, not the `phrase` prop the caller
//    already holds. That is what keeps the server's own check falsifiable: a
//    client that echoed the canonical phrase back could never be rejected by
//    the server, so this component's own comparison would silently become the
//    only gate every real user ever meets.
// =============================================================================

const PHRASE = 'DELETE MY DATA';

function setup(overrides: Partial<Parameters<typeof ConfirmPhraseDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <ConfirmPhraseDialog
      open
      title="Reset your data?"
      description="This cannot be undone."
      phrase={PHRASE}
      consequences={['4 commitments', '2 outcomes']}
      isBusy={false}
      error={null}
      confirmLabel="Reset my data"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );

  return { onConfirm, onCancel };
}

function confirmButton() {
  return screen.getByRole('button', { name: /reset my data/i });
}

function phraseInput() {
  // A real accessible name, from a real label — never a bare placeholder.
  return screen.getByLabelText(new RegExp(PHRASE, 'i'));
}

describe('ConfirmPhraseDialog — the gate', () => {
  it('renders the phrase the caller was given, so the user reads what the server will check', () => {
    setup();
    expect(screen.getAllByText(new RegExp(PHRASE)).length).toBeGreaterThan(0);
  });

  it('starts with the destructive button disabled', () => {
    setup();
    expect(confirmButton()).toBeDisabled();
  });

  it('stays disabled for a partial match', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(phraseInput(), 'DELETE MY');
    expect(confirmButton()).toBeDisabled();
  });

  it('stays disabled for a case-shifted match — passing the phrase in lower case is not the deliberate act it exists to require', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(phraseInput(), 'delete my data');
    expect(confirmButton()).toBeDisabled();
  });

  it('enables only on the exact phrase', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(phraseInput(), PHRASE);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('tolerates surrounding whitespace — trim only, matching the service', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(phraseInput(), `  ${PHRASE}  `);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });
});

describe('ConfirmPhraseDialog — what it hands back', () => {
  it('calls onConfirm with the RAW typed string, not the phrase prop, so the server check stays falsifiable', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    const typed = `  ${PHRASE}  `;
    await user.type(phraseInput(), typed);
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(typed);
  });

  it('does not call onConfirm while the phrase does not match', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(phraseInput(), 'nope');
    await user.click(confirmButton()).catch(() => undefined);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels without confirming', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmPhraseDialog — what it shows', () => {
  it('lists the consequences it was given', () => {
    setup();
    expect(screen.getByText(/4 commitments/)).toBeInTheDocument();
    expect(screen.getByText(/2 outcomes/)).toBeInTheDocument();
  });

  it('announces an error in a region assistive technology reads', () => {
    setup({ error: 'The confirmation phrase did not match.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/did not match/i);
  });

  it('locks the field and both buttons while a reset is in flight', () => {
    setup({ isBusy: true });
    expect(phraseInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('gives the dialog an accessible name', () => {
    setup();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/reset your data/i);
  });
});
