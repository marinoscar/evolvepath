import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PersonaModelTable } from '../../../components/ai/PersonaModelTable';
import type { AiPersona } from '../../../types';

const personas: AiPersona[] = [
  {
    key: 'coach',
    label: 'Coach',
    description: 'Day-to-day coaching replies.',
    tier: 'fast',
    capabilities: ['text'],
  },
  {
    key: 'media_analyst',
    label: 'Media analyst',
    description: 'Describes form and meals from photos.',
    tier: 'fast',
    capabilities: ['text', 'vision'],
  },
];

const models = [
  { id: 'gpt-5.4', created: 1 },
  { id: 'gpt-5.4-mini', created: 2 },
];

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * `matches` is driven by a flag so one suite can render both treatments.
 */
function mockViewport(compact: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      // MUI's `down('sm')` compiles to a `max-width` query.
      matches: compact && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderTable(props: Partial<React.ComponentProps<typeof PersonaModelTable>> = {}) {
  const onChange = vi.fn();
  render(
    <PersonaModelTable
      personas={personas}
      models={models}
      personaModels={{}}
      defaultModel="gpt-5.4"
      disabled={false}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe('PersonaModelTable', () => {
  beforeEach(() => {
    mockViewport(false);
  });

  it('renders a table at and above 600px', () => {
    renderTable();

    expect(screen.getByTestId('persona-model-table')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-model-cards')).not.toBeInTheDocument();
  });

  it('renders one card per persona below 600px', () => {
    // A five-column table on a phone either scrolls sideways — so the
    // comparison a table exists for is impossible anyway — or crushes the
    // labels.
    mockViewport(true);
    renderTable();

    expect(screen.getByTestId('persona-model-cards')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-model-table')).not.toBeInTheDocument();
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText('Media analyst')).toBeInTheDocument();
  });

  it('names the current default in the "Use default" option', () => {
    renderTable({ defaultModel: 'gpt-5.4-mini' });

    expect(screen.getAllByText('Use default (gpt-5.4-mini)').length).toBeGreaterThan(0);
  });

  it('says "none" when no default has been chosen', () => {
    renderTable({ defaultModel: null });

    expect(screen.getAllByText('Use default (none)').length).toBeGreaterThan(0);
  });

  it('reports null when a persona is set back to the default', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTable({ personaModels: { coach: 'gpt-5.4-mini' } });

    await user.click(screen.getByLabelText('Model for Coach'));
    await user.click(screen.getByRole('option', { name: 'Use default (gpt-5.4)' }));

    expect(onChange).toHaveBeenCalledWith('coach', null);
  });

  it('reports the chosen model id', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTable();

    await user.click(screen.getByLabelText('Model for Coach'));
    await user.click(screen.getByRole('option', { name: 'gpt-5.4-mini' }));

    expect(onChange).toHaveBeenCalledWith('coach', 'gpt-5.4-mini');
  });

  it('still offers a stored model the catalog no longer lists', async () => {
    // Otherwise the Select's value matches no option, MUI renders it blank, and
    // the administrator silently overwrites a deliberate choice on the next
    // save.
    const user = userEvent.setup();
    renderTable({ personaModels: { coach: 'gpt-9.9-private' } });

    await user.click(screen.getByLabelText('Model for Coach'));

    expect(
      screen.getByRole('option', { name: 'gpt-9.9-private (not in catalog)' }),
    ).toBeInTheDocument();
  });

  it('marks the vision persona and only that one', () => {
    renderTable();

    expect(screen.getAllByText('vision')).toHaveLength(1);
  });

  it('says so plainly when the server returned no personas', () => {
    renderTable({ personas: [] });

    expect(screen.getByText(/No personas were returned/)).toBeInTheDocument();
  });
});
