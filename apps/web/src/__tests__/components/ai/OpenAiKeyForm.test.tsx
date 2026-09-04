import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { OpenAiKeyForm } from '../../../components/ai/OpenAiKeyForm';
import type { MyAiKeyStatus } from '../../../types';

const configuredStatus: MyAiKeyStatus = {
  configured: true,
  hint: '••••e2e1',
  updatedAt: '2026-09-01T00:00:00.000Z',
  lastTest: {
    attemptedAt: new Date(Date.now() - 60_000).toISOString(),
    success: true,
    model: 'gpt-5.4',
    error: null,
  },
  platform: { provider: 'openai', enabled: true, hasDefaultModel: true },
};

const emptyStatus: MyAiKeyStatus = {
  configured: false,
  hint: null,
  updatedAt: null,
  lastTest: null,
  platform: { provider: 'openai', enabled: true, hasDefaultModel: true },
};

function renderForm(
  props: Partial<React.ComponentProps<typeof OpenAiKeyForm>> = {},
) {
  const onSave = vi.fn().mockResolvedValue(true);
  const onTest = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(true);
  const clearTestResult = vi.fn();

  const result = render(
    <OpenAiKeyForm
      status={emptyStatus}
      variant="settings"
      onSave={onSave}
      onTest={onTest}
      onRemove={onRemove}
      isSaving={false}
      isTesting={false}
      testResult={null}
      clearTestResult={clearTestResult}
      saveError={null}
      {...props}
    />,
  );

  return { onSave, onTest, onRemove, clearTestResult, ...result };
}

describe('OpenAiKeyForm', () => {
  describe('the key field', () => {
    it('trims a pasted value before saving', async () => {
      // A copy from a terminal or a password manager routinely brings a
      // trailing newline. The API deliberately rejects internal whitespace
      // rather than altering a secret's bytes, so trimming the ends is the one
      // safe normalisation — and it happens where the user can see it.
      const user = userEvent.setup();
      const { onSave } = renderForm();

      await user.type(
        screen.getByLabelText('OpenAI API key'),
        '  sk-padded-key-000000000  ',
      );
      await user.click(screen.getByRole('button', { name: 'Save key' }));

      expect(onSave).toHaveBeenCalledWith('sk-padded-key-000000000');
    });

    it('disables Save while the field is empty', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled();
    });

    it('toggles visibility', async () => {
      const user = userEvent.setup();
      renderForm();

      const field = () => screen.getByLabelText('OpenAI API key') as HTMLInputElement;
      expect(field().type).toBe('password');

      await user.click(screen.getByRole('button', { name: 'Show key' }));
      expect(field().type).toBe('text');

      await user.click(screen.getByRole('button', { name: 'Hide key' }));
      expect(field().type).toBe('password');
    });

    it('does not offer the browser autofill', () => {
      renderForm();
      expect(screen.getByLabelText('OpenAI API key')).toHaveAttribute(
        'autocomplete',
        'off',
      );
    });

    it('hints softly about the sk- prefix without blocking the save', async () => {
      // A soft hint costs nothing when it is wrong — and it will be wrong the
      // day OpenAI changes its key format, which is exactly why the server does
      // not enforce a prefix either.
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText('OpenAI API key'), 'not-an-sk-key-000000');

      expect(screen.getByText(/usually start with sk-/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save key' })).toBeEnabled();
    });

    it('drops the hint once the value looks right', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText('OpenAI API key'), 'sk-looks-right-00000');

      expect(screen.queryByText(/usually start with sk-/)).not.toBeInTheDocument();
    });

    it('clears the field after a successful save', async () => {
      const user = userEvent.setup();
      renderForm({ status: configuredStatus });

      await user.type(screen.getByLabelText('Replace key'), 'sk-replacement-000000');
      await user.click(screen.getByRole('button', { name: 'Save key' }));

      await waitFor(() =>
        expect((screen.getByLabelText('Replace key') as HTMLInputElement).value).toBe(''),
      );
    });
  });

  describe('the Test button', () => {
    it('is offered only for a stored key with the field empty', () => {
      // Testing means storing: the API tests what is SAVED, so a "test before
      // saving" button would have to save silently first.
      renderForm({ status: configuredStatus });

      expect(screen.getByRole('button', { name: 'Test key' })).toBeEnabled();
    });

    it('says why it is unavailable with no key stored', () => {
      renderForm({ status: emptyStatus });

      expect(screen.getByRole('button', { name: 'Test key' })).toBeDisabled();
      expect(screen.getByText('Save a key first, then test it.')).toBeInTheDocument();
    });

    it('says why it is unavailable while a key is typed', async () => {
      const user = userEvent.setup();
      renderForm({ status: configuredStatus });

      await user.type(screen.getByLabelText('Replace key'), 'sk-typed-key-00000000');

      expect(screen.getByRole('button', { name: 'Test key' })).toBeDisabled();
      expect(
        screen.getByText('Save the key you have typed, then test it.'),
      ).toBeInTheDocument();
    });
  });

  describe('the status line', () => {
    it('reports the mask and the last test', () => {
      renderForm({ status: configuredStatus });

      expect(screen.getByText(/Configured · ••••e2e1/)).toBeInTheDocument();
      expect(screen.getByText(/worked/)).toBeInTheDocument();
    });

    it('says plainly when nothing is stored', () => {
      renderForm({ status: emptyStatus });
      expect(screen.getByText('No key saved')).toBeInTheDocument();
    });
  });

  describe('the test result', () => {
    it('renders a failure verbatim in a <pre>', () => {
      const verbose =
        'Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys.';
      renderForm({
        status: configuredStatus,
        testResult: {
          success: false,
          error: verbose,
          checks: { listModels: 'failed', generate: 'skipped' },
        },
      });

      expect(screen.getByText('Test failed')).toBeInTheDocument();
      const pre = screen.getByText(verbose);
      expect(pre.tagName).toBe('PRE');
      expect(pre.textContent).toBe(verbose);
    });

    it('renders success with the checks', () => {
      renderForm({
        status: configuredStatus,
        testResult: {
          success: true,
          error: null,
          checks: { listModels: 'passed', generate: 'passed' },
        },
      });

      expect(screen.getByText('Key works')).toBeInTheDocument();
      expect(screen.getByText(/models passed · generate passed/)).toBeInTheDocument();
    });

    it("says a skipped generate is not the user's problem", () => {
      renderForm({
        status: configuredStatus,
        testResult: {
          success: true,
          error: null,
          checks: { listModels: 'passed', generate: 'skipped' },
        },
      });

      expect(screen.getByText(/administrator has not chosen a model/)).toBeInTheDocument();
      expect(screen.getByText(/Your key is fine/)).toBeInTheDocument();
    });
  });

  describe('removal', () => {
    it('only offers Remove for a stored key', () => {
      renderForm({ status: emptyStatus });
      expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument();
    });

    it('is not offered at all without an onRemove handler', () => {
      // The setup variant (#29): there is nothing to return to.
      renderForm({ status: configuredStatus, onRemove: undefined });
      expect(screen.queryByRole('button', { name: 'Remove key' })).not.toBeInTheDocument();
    });

    it('warns what happens next, and removes only after confirming', async () => {
      const user = userEvent.setup();
      const { onRemove } = renderForm({ status: configuredStatus });

      await user.click(screen.getByRole('button', { name: 'Remove key' }));

      expect(
        screen.getByText(/asked for a key again before you can use EvolvePath/),
      ).toBeInTheDocument();
      expect(onRemove).not.toHaveBeenCalled();

      // Scoped to the dialog: the trigger behind it carries the same label,
      // and a page-wide query would silently re-click the trigger.
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove key' }),
      );

      await waitFor(() => expect(onRemove).toHaveBeenCalled());
    });

    it('does nothing when the dialog is cancelled', async () => {
      const user = userEvent.setup();
      const { onRemove } = renderForm({ status: configuredStatus });

      await user.click(screen.getByRole('button', { name: 'Remove key' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  it('surfaces a save error', () => {
    renderForm({ saveError: 'That key looks too short.' });
    expect(screen.getByText('That key looks too short.')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    // jsdom performs no layout, so `color-contrast` is a known false-negative
    // trap — the same exclusion the datatable conformance suite documents.
    const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

    it.each([
      ['settings', configuredStatus],
      ['setup', emptyStatus],
    ] as const)('has no violations in the %s variant', async (variant, status) => {
      const { container } = renderForm({
        variant,
        status,
        onRemove: variant === 'setup' ? undefined : vi.fn().mockResolvedValue(true),
      });

      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  });
});
