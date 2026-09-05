import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../../utils/test-utils';
import { setViewportWidth } from '../../../setup';
import { FormCheckSheet } from '../../../../components/workouts/media/FormCheckSheet';
import { formCheckRequests, setFormCheckResult } from '../../../mocks/workoutHandlers';

const PHONE = 375;
const DESKTOP = 1024;

function renderSheet() {
  return render(
    <FormCheckSheet
      open
      sessionId="session-1"
      exerciseId="exercise-bench"
      exerciseName="Dumbbell Bench Press"
      setNumber={1}
      onClose={() => undefined}
    />,
  );
}

/** Upload a file through the hidden input. */
async function upload(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('Record a video of your set');
  await user.upload(input, new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
}

describe('FormCheckSheet', () => {
  it('opens the camera on a phone rather than a file browser', () => {
    act(() => setViewportWidth(PHONE));
    renderSheet();

    // PRD §123 is mobile-first, and a form check that opens a file browser in a
    // gym is a feature nobody uses.
    expect(screen.getByLabelText('Record a video of your set')).toHaveAttribute(
      'capture',
      'environment',
    );
  });

  it('says it will not diagnose before asking for anything', () => {
    renderSheet();

    expect(screen.getByText(/I do not diagnose anything/)).toBeInTheDocument();
  });

  it('sends the exercise and set with the video', async () => {
    act(() => setViewportWidth(DESKTOP));
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    await waitFor(() => expect(formCheckRequests()).toHaveLength(1));
    expect(formCheckRequests()[0]).toEqual({
      storageObjectId: 'object-1',
      exerciseId: 'exercise-bench',
      setNumber: 1,
    });
  });

  it('renders observations and cues', async () => {
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    expect(await screen.findByText('The bar drifts forward on the way up.')).toBeInTheDocument();
    expect(screen.getByText('Keep it over your mid-foot.')).toBeInTheDocument();
    expect(screen.getByText('Nothing stood out')).toBeInTheDocument();
  });

  it('shows the warning and NO cues on a redirected check', async () => {
    setFormCheckResult({
      ok: true,
      result: {
        observations: ['The knee collapses inward under load.'],
        cues: [],
        riskFlags: ['joint_instability'],
        safetyNote: 'Stop this exercise. Sharp pain is not something to train through.',
        confidence: 'high',
        redirected: true,
      },
    });
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    expect(await screen.findByTestId('form-check-safety')).toHaveTextContent(
      /not something to train through/,
    );
    expect(screen.queryByText('Try this next set')).not.toBeInTheDocument();
  });

  it('labels risk flags with text, not colour alone', async () => {
    setFormCheckResult({
      ok: true,
      result: {
        observations: [],
        cues: [],
        riskFlags: ['spinal_rounding_under_load'],
        safetyNote: null,
        confidence: 'low',
        redirected: false,
      },
    });
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    expect(await screen.findByText('Back rounding under load')).toBeInTheDocument();
  });

  it('points at the key page when the user has no key', async () => {
    setFormCheckResult({
      ok: false,
      error: { code: 'no_user_key', message: 'no key' },
    });
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    expect(await screen.findByRole('link', { name: 'Add a key' })).toHaveAttribute(
      'href',
      '/settings/ai-key',
    );
  });

  it('offers a retry for anything else', async () => {
    setFormCheckResult({ ok: false, error: { code: 'timeout', message: 'no answer' } });
    const user = userEvent.setup();
    renderSheet();

    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Ask the coach' }));

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    act(() => setViewportWidth(DESKTOP));
    const { container } = renderSheet();

    expect(
      await axe(container, { rules: { 'color-contrast': { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
