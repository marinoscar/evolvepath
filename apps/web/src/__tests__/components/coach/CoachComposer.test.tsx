import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import CoachComposer from '../../../components/coach/CoachComposer';

describe('CoachComposer (#86)', () => {
  it('sends on Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<CoachComposer onSend={onSend} />);

    await user.type(screen.getByLabelText('Message the coach'), 'hello{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('leaves a newline on Shift+Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<CoachComposer onSend={onSend} />);

    const input = screen.getByLabelText('Message the coach');
    await user.type(input, 'first{Shift>}{Enter}{/Shift}second');

    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue('first\nsecond');
  });

  it('trims, and refuses to send whitespace', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<CoachComposer onSend={onSend} />);

    const input = screen.getByLabelText('Message the coach');
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(input, '  spaced  {Enter}');
    expect(onSend).toHaveBeenCalledWith('spaced');
  });

  it('clears the field after sending', async () => {
    const user = userEvent.setup();
    render(<CoachComposer onSend={vi.fn()} />);

    const input = screen.getByLabelText('Message the coach');
    await user.type(input, 'hello{Enter}');

    expect(input).toHaveValue('');
  });

  it('is disabled while a reply is outstanding', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<CoachComposer disabled onSend={onSend} />);

    await user.type(screen.getByLabelText('Message the coach'), 'hello{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });
});
