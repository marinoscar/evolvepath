import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';

import {
  CoachingPolicySection,
  SLIDER_DEBOUNCE_MS,
} from '../../../components/settings/CoachingPolicySection';
import type { NotificationPolicy } from '../../../types';

/**
 * Issue #68, epic E12. The section under the notification matrix, not a tab and
 * not a second registry card — see the component's header for why.
 */

const policy = (over: Partial<NotificationPolicy> = {}): NotificationPolicy => ({
  timezone: 'America/Costa_Rica',
  quietHours: null,
  dailyCap: 4,
  weeklyCap: 20,
  perCommitmentMax: 2,
  mutedCategories: [],
  fatigue: { active: false, effectiveDailyCap: 4 },
  ...over,
});

describe('CoachingPolicySection (#68)', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it('is a labelled region, so the section is navigable', () => {
    render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

    expect(
      screen.getByRole('region', { name: /coaching reminders/i }),
    ).toBeInTheDocument();
  });

  it('renders the three caps at their stored values', () => {
    render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

    expect(screen.getByRole('slider', { name: /daily cap/i })).toHaveValue('4');
    expect(screen.getByRole('slider', { name: /weekly cap/i })).toHaveValue('20');
    expect(
      screen.getByRole('slider', { name: /per-commitment maximum/i }),
    ).toHaveValue('2');
  });

  // The whole rule depends on it, and a user who travels will otherwise wonder
  // why "22:00" stopped meaning what it did.
  it('states which timezone quiet hours are in', () => {
    render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

    expect(screen.getByText(/America\/Costa_Rica/)).toBeInTheDocument();
  });

  it('shows a stored quiet-hours window in the fields', () => {
    render(
      <CoachingPolicySection
        policy={policy({ quietHours: { start: '22:00', end: '07:00' } })}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText(/from/i)).toHaveValue('22:00');
    expect(screen.getByLabelText(/until/i)).toHaveValue('07:00');
  });

  // There is deliberately no control for it: the matrix above IS that control,
  // and a second surface for the same intent leaves two switches disagreeing.
  it('offers no control for muted categories', () => {
    render(
      <CoachingPolicySection
        policy={policy({ mutedCategories: ['coach.rescue'] })}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText(/coach\.rescue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/muted/i)).not.toBeInTheDocument();
  });

  describe('quiet hours', () => {
    // A window with one bound has no meaning, and sending it would produce a
    // 400 the user cannot act on while they are still typing.
    it('sends nothing until both bounds are set', async () => {
      const user = userEvent.setup();
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      await user.type(screen.getByLabelText(/from/i), '22:00');
      await user.tab();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('sends the window once both are set', async () => {
      const user = userEvent.setup();
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      await user.type(screen.getByLabelText(/from/i), '22:00');
      await user.type(screen.getByLabelText(/until/i), '07:00');
      await user.tab();

      expect(onChange).toHaveBeenCalledWith({
        quietHours: { start: '22:00', end: '07:00' },
      });
    });

    it('sends nothing when the window has not actually changed', async () => {
      const user = userEvent.setup();
      render(
        <CoachingPolicySection
          policy={policy({ quietHours: { start: '22:00', end: '07:00' } })}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByLabelText(/from/i));
      await user.tab();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('clears them explicitly with null', async () => {
      const user = userEvent.setup();
      render(
        <CoachingPolicySection
          policy={policy({ quietHours: { start: '22:00', end: '07:00' } })}
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /clear/i }));

      expect(onChange).toHaveBeenCalledWith({ quietHours: null });
      expect(screen.getByLabelText(/from/i)).toHaveValue('');
    });

    it('offers no Clear button when there is nothing to clear', () => {
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });
  });

  describe('the caps', () => {
    // A drag emits a change per pixel; sending each one would be dozens of
    // PATCHes for one decision. Driven with `fireEvent.change` on the range
    // input rather than a simulated drag: the debounce is what is under test,
    // not MUI's pointer handling.
    it('sends one patch per decision, not one per pixel', async () => {
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      const slider = screen.getByRole('slider', { name: /daily cap/i });
      fireEvent.change(slider, { target: { value: '3' } });
      fireEvent.change(slider, { target: { value: '2' } });

      // Nothing yet: the user is still deciding.
      expect(onChange).not.toHaveBeenCalled();

      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), {
        timeout: SLIDER_DEBOUNCE_MS * 3,
      });
      expect(onChange).toHaveBeenCalledWith({ dailyCap: 2 });
    });

    it('sends only the cap that moved', async () => {
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      fireEvent.change(screen.getByRole('slider', { name: /weekly cap/i }), {
        target: { value: '21' },
      });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith({ weeklyCap: 21 }), {
        timeout: SLIDER_DEBOUNCE_MS * 3,
      });
      expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['weeklyCap']);
    });

    it('shows the value the user is choosing before it is sent', async () => {
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      const slider = screen.getByRole('slider', { name: /daily cap/i });
      fireEvent.change(slider, { target: { value: '7' } });

      // The control must not snap back to the server's value mid-decision.
      expect(slider).toHaveValue('7');
    });
  });

  describe('fatigue', () => {
    // Without this line a user whose cap has been halved sees a slider saying 4
    // and receives 2, and concludes the setting is broken.
    it('explains a cap that has been reduced automatically', () => {
      render(
        <CoachingPolicySection
          policy={policy({ fatigue: { active: true, effectiveDailyCap: 2 } })}
          onChange={onChange}
        />,
      );

      expect(screen.getByText(/fatigue mode is on/i)).toBeInTheDocument();
      expect(screen.getByText(/temporarily 2/i)).toBeInTheDocument();
    });

    it('says nothing when it is not in force', () => {
      render(<CoachingPolicySection policy={policy()} onChange={onChange} />);

      expect(screen.queryByText(/fatigue mode/i)).not.toBeInTheDocument();
    });
  });

  it('disables every control while a save is in flight', () => {
    render(<CoachingPolicySection policy={policy()} onChange={onChange} isSaving />);

    expect(screen.getByLabelText(/from/i)).toBeDisabled();
    expect(screen.getByRole('slider', { name: /daily cap/i })).toBeDisabled();
  });
});
