import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { HealthPage } from '../../pages/HealthPage';
import { committedBehaviours, seedWeights } from '../mocks/healthHandlers';

function renderPage() {
  return render(
    <MemoryRouter>
      <HealthPage />
    </MemoryRouter>,
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600_000).toISOString().slice(0, 10);
}

describe('HealthPage', () => {
  it('offers the training program, the eating habits and the weight log', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Training' })).toBeInTheDocument();
    expect(await screen.findByText('Vegetables with dinner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weight' })).toBeInTheDocument();
  });

  it('shows the smallest version of every habit up front', async () => {
    renderPage();

    // The minimum version is what makes a habit survivable; hiding it until
    // somebody fails is backwards.
    expect(await screen.findByText(/One vegetable, however easy · 3 min/)).toBeInTheDocument();
  });

  it('puts a habit on the week', async () => {
    const user = userEvent.setup();
    renderPage();

    const card = (await screen.findByText('Vegetables with dinner')).closest('.MuiCard-root')!;
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Add to this week' }));

    await waitFor(() => {
      expect(committedBehaviours()).toEqual([
        { key: 'vegetables_with_dinner', repeatDays: 5 },
      ]);
    });
    expect(await screen.findByText(/Vegetables with dinner — on your next 5 days/)).toBeInTheDocument();
  });

  it('saves a weight and redraws the trend from the server', async () => {
    seedWeights([
      { dateLocal: daysAgo(3), weightKg: 83 },
      { dateLocal: daysAgo(2), weightKg: 82.8 },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('img');

    await user.type(screen.getByLabelText('Weight in kilograms'), '82.4');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: '82.4' })).toBeInTheDocument();
    });
  });

  it('refuses a weight that is not a weight, before asking the server', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Weight' });

    await user.type(screen.getByLabelText('Weight in kilograms'), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a weight in kilograms.',
    );
  });

  it('will not offer a date that has not happened', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Weight' });

    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByLabelText('Date')).toHaveValue(today);
    expect(screen.getByLabelText('Date')).toHaveAttribute('max', today);
  });

  it('links to the workout programs surface', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', '/health/programs');
  });
});
