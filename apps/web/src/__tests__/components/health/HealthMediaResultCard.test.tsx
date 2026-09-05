import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import { render } from '../../utils/test-utils';
import {
  EquipmentCheckResultCard,
  FormCheckResultCard,
  HABITS_NOT_CALORIES,
  MealCheckResultCard,
} from '../../../components/health/media/HealthMediaResultCard';

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

describe('HealthMediaResultCard', () => {
  it('renders a clean form check with its cues', async () => {
    const { container } = render(
      <FormCheckResultCard
        result={{
          observations: ['The bar drifts forward.'],
          cues: ['Keep it over your mid-foot.'],
          riskFlags: ['none'],
          safetyNote: null,
          confidence: 'medium',
          redirected: false,
        }}
      />,
    );

    expect(screen.getByText('Try this next set')).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('renders the equipment check without a proposal note when there is none', () => {
    render(
      <EquipmentCheckResultCard
        result={{
          equipmentDetected: ['DUMBBELL'],
          notes: ['A small room.'],
          substitutions: [],
          proposalId: null,
        }}
      />,
    );

    expect(screen.getByText('dumbbell')).toBeInTheDocument();
    expect(screen.queryByText(/until you accept it/)).not.toBeInTheDocument();
  });

  it('says out loud that it is not counting', () => {
    render(
      <MealCheckResultCard
        result={{
          observations: ['A protein source and a green vegetable.'],
          behaviorSuggestions: [
            { key: 'vegetables_with_dinner', text: 'Keep the greens on the plate.' },
          ],
        }}
      />,
    );

    // A photograph of food invites the assumption; PRD §46 says answer it.
    expect(screen.getByText(HABITS_NOT_CALORIES)).toBeInTheDocument();
  });

  it('never renders a calorie, a macro or a gram', () => {
    const { container } = render(
      <MealCheckResultCard
        result={{
          observations: ['A protein source and a green vegetable.'],
          behaviorSuggestions: [
            { key: 'protein_with_meals', text: 'Put a protein source on every plate.' },
          ],
        }}
      />,
    );

    // Everything except the disclaimer, which says the word on purpose.
    const rendered = (container.textContent ?? '').replace(HABITS_NOT_CALORIES, '');

    expect(rendered).not.toMatch(/kcal|calorie|macro|grams? of/i);
  });

  it('offers to turn a suggestion into a commitment when the caller can', () => {
    render(
      <MealCheckResultCard
        result={{
          observations: [],
          behaviorSuggestions: [
            { key: 'vegetables_with_dinner', text: 'Keep the greens on the plate.' },
          ],
        }}
        onAddBehaviour={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add to today' })).toBeInTheDocument();
  });
});
