import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../../../utils/test-utils';
import { EquipmentPhotoStep } from '../../../../components/workouts/media/EquipmentPhotoStep';
import { setEquipmentCheckResult } from '../../../mocks/workoutHandlers';

async function photograph(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText('Photograph your equipment'),
    new File(['x'], 'gym.jpg', { type: 'image/jpeg' }),
  );
}

describe('EquipmentPhotoStep', () => {
  it('says the photo can be overruled before taking one', () => {
    render(<EquipmentPhotoStep />);

    // A picture of one corner of a garage is evidence, not an inventory.
    expect(screen.getByText(/You can still change anything I get wrong/)).toBeInTheDocument();
  });

  it('reports what it found to the caller', async () => {
    const onDetected = vi.fn();
    const user = userEvent.setup();
    render(<EquipmentPhotoStep onDetected={onDetected} />);

    await photograph(user);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith(['DUMBBELL', 'BENCH']));
    expect(await screen.findByText('dumbbell')).toBeInTheDocument();
  });

  it('lists the swaps and says the change is only a proposal', async () => {
    setEquipmentCheckResult({
      ok: true,
      result: {
        equipmentDetected: ['BODYWEIGHT'],
        notes: [],
        substitutions: [
          {
            exerciseId: 'te-1',
            exerciseName: 'Goblet Squat',
            alternativeExerciseId: 'ex-2',
            alternativeName: 'Bodyweight Squat',
            reason: 'No dumbbell detected',
          },
        ],
        proposalId: 'proposal-1',
      },
    });
    const user = userEvent.setup();
    render(<EquipmentPhotoStep programId="program-1" />);

    await photograph(user);

    expect(await screen.findByText('Goblet Squat → Bodyweight Squat')).toBeInTheDocument();
    expect(screen.getByText(/changes nothing until you accept it/)).toBeInTheDocument();
  });

  it('says nothing about swaps when the room already fits', async () => {
    const user = userEvent.setup();
    render(<EquipmentPhotoStep programId="program-1" />);

    await photograph(user);

    await screen.findByText('dumbbell');
    expect(screen.queryByText('What I would swap')).not.toBeInTheDocument();
  });

  it('offers a retry when the check fails', async () => {
    setEquipmentCheckResult({ ok: false, error: { code: 'timeout', message: 'no answer' } });
    const user = userEvent.setup();
    render(<EquipmentPhotoStep />);

    await photograph(user);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
