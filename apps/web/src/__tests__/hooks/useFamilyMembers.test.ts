import { describe, it, expect } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '../utils/hook-utils';
import { getFamilyState, makeMember, seedFamilyState } from '../mocks/familyHandlers';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';

describe('useFamilyMembers', () => {
  it('loads members on mount', async () => {
    seedFamilyState({ members: [makeMember()] });

    const { result } = renderHookWithProviders(() => useFamilyMembers());

    await waitFor(() => expect(result.current.members).toHaveLength(1));
  });

  it('creates, updates and removes, refetching each time', async () => {
    const { result } = renderHookWithProviders(() => useFamilyMembers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const created = await result.current.create({ nickname: 'Mia', relationship: 'CHILD' });
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    await result.current.update(created.id, { nickname: 'Mimi' });
    await waitFor(() => expect(result.current.members[0].nickname).toBe('Mimi'));

    await result.current.remove(created.id);
    await waitFor(() => expect(result.current.members).toHaveLength(0));
  });

  // VISION §50: these are other people's names, recorded without their
  // knowledge. They live in memory for a session and nowhere else.
  it('stores nothing about a member in localStorage', async () => {
    seedFamilyState({ members: [makeMember({ nickname: 'Mia' })] });

    const { result } = renderHookWithProviders(() => useFamilyMembers());
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    const stored = Object.keys(window.localStorage).map((key) =>
      window.localStorage.getItem(key),
    );
    expect(stored.join('|')).not.toContain('Mia');
    expect(getFamilyState().members).toHaveLength(1);
  });
});
