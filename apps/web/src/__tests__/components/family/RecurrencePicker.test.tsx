import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { RecurrencePicker } from '../../../components/family/RecurrencePicker';
import type { RitualRecurrence } from '../../../types';

const base: RitualRecurrence = { weekdays: [2], time: '18:30', everyNWeeks: 1 };

describe('RecurrencePicker', () => {
  it('renders the weekdays Monday-first', () => {
    render(<RecurrencePicker value={base} onChange={vi.fn()} />);

    const labels = screen
      .getAllByRole('button', { pressed: false })
      .concat(screen.getAllByRole('button', { pressed: true }))
      .map((button) => button.getAttribute('aria-label'));

    expect(labels).toContain('Monday');
    expect(labels).toContain('Sunday');
  });

  // The values are `0 = Sunday` even though Sunday renders last.
  it('toggles Sunday on as the value 0', async () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={base} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Sunday'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weekdays: [0, 2] }));
  });

  it('toggles a selected day back off', async () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={base} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Tuesday'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weekdays: [] }));
  });

  it('exposes the selection through aria-pressed, with the full day name', () => {
    render(<RecurrencePicker value={base} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Tuesday')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Thursday')).toHaveAttribute('aria-pressed', 'false');
  });

  it('is operable from the keyboard', async () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={base} onChange={onChange} />);

    screen.getByLabelText('Thursday').focus();
    await userEvent.keyboard(' ');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weekdays: [2, 4] }));
  });

  it('changes the cadence', async () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={base} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Every 2 weeks' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ everyNWeeks: 2 }));
  });

  it('summarises the current value in words', () => {
    render(
      <RecurrencePicker
        value={{ weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 1 }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Tue, Thu, Sun · 18:30')).toBeInTheDocument();
  });

  it('updates the time', async () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={base} onChange={onChange} />);

    const time = screen.getByTestId('recurrence-time');
    await userEvent.clear(time);
    await userEvent.type(time, '19:00');

    expect(onChange).toHaveBeenCalled();
  });
});
