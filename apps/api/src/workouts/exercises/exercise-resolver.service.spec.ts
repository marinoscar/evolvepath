import { Test } from '@nestjs/testing';
import type { Exercise } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/mocks/prisma.mock';
import { diceCoefficient, ExerciseResolverService } from './exercise-resolver.service';

// =============================================================================
// The resolver decides which row a model's words meant, and getting it wrong is
// not visible: the user just finds a different exercise in their program than
// the coach prescribed. So the near-match threshold is asserted from BOTH
// sides — what it must accept, and what it must never accept.
// =============================================================================

function catalogRow(name: string, overrides: Record<string, unknown> = {}): Exercise {
  return {
    id: `id-${name}`,
    name,
    nameKey: name.toLowerCase(),
    scope: 'catalog',
    equipment: ['DUMBBELL'],
    movementPattern: 'PUSH_H',
    instructions: '',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_push',
    isCustom: false,
    createdByUserId: null,
    createdAt: new Date(),
    ...overrides,
  } as Exercise;
}

describe('diceCoefficient', () => {
  it('is 1 for identical strings', () => {
    expect(diceCoefficient('dumbbell row', 'dumbbell row')).toBe(1);
  });

  it('scores two different pressing movements below the threshold', () => {
    // The whole reason the threshold is 0.85 and not 0.6.
    expect(diceCoefficient('dumbbell bench press', 'dumbbell shoulder press')).toBeLessThan(0.85);
  });
});

describe('ExerciseResolverService', () => {
  const userId = 'user-1';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: ExerciseResolverService;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [ExerciseResolverService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ExerciseResolverService);
  });

  it('resolves an exact name, whatever its spacing and case', async () => {
    prisma.exercise.findMany.mockResolvedValue([catalogRow('Dumbbell Bench Press')]);

    const resolved = await service.resolveMany(['  DUMBBELL   Bench Press '], userId, {
      equipment: ['DUMBBELL'],
    });

    expect(resolved.get('dumbbell bench press')?.name).toBe('Dumbbell Bench Press');
    expect(prisma.exercise.upsert).not.toHaveBeenCalled();
  });

  it('accepts a close spelling of the same movement', async () => {
    prisma.exercise.findMany.mockResolvedValue([catalogRow('Dumbbell Romanian Deadlift')]);

    const resolved = await service.resolveMany(['Dumbell Romanian Deadlift'], userId, {
      equipment: ['DUMBBELL'],
    });

    expect(resolved.size).toBe(1);
    expect(prisma.exercise.upsert).not.toHaveBeenCalled();
  });

  it('creates a custom row scoped to the user for a movement nobody has heard of', async () => {
    prisma.exercise.findMany.mockResolvedValue([catalogRow('Dumbbell Bench Press')]);
    prisma.exercise.upsert.mockImplementation((({ create }: any) =>
      Promise.resolve(catalogRow(create.name, { ...create, id: 'custom-1' }))) as never);

    const resolved = await service.resolveMany(['Sled Push'], userId, {
      equipment: ['MACHINE'],
    });

    expect(prisma.exercise.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope_nameKey: { scope: userId, nameKey: 'sled push' } },
        create: expect.objectContaining({
          scope: userId,
          isCustom: true,
          createdByUserId: userId,
          substitutionGroup: 'custom',
          contraindicationTags: [],
        }),
      }),
    );
    expect(resolved.get('sled push')?.id).toBe('custom-1');
  });

  it('does not map one pressing movement onto another', async () => {
    prisma.exercise.findMany.mockResolvedValue([catalogRow('Dumbbell Shoulder Press')]);
    prisma.exercise.upsert.mockImplementation((({ create }: any) =>
      Promise.resolve(catalogRow(create.name, { ...create, id: 'custom-2' }))) as never);

    await service.resolveMany(['Dumbbell Bench Press'], userId, { equipment: ['DUMBBELL'] });

    expect(prisma.exercise.upsert).toHaveBeenCalled();
  });

  it('asks for one custom row per distinct name, not one per mention', async () => {
    prisma.exercise.findMany.mockResolvedValue([]);
    prisma.exercise.upsert.mockImplementation((({ create }: any) =>
      Promise.resolve(catalogRow(create.name, { ...create, id: 'custom-3' }))) as never);

    await service.resolveMany(['Sled Push', 'sled push', 'SLED PUSH'], userId, {
      equipment: ['MACHINE'],
    });

    expect(prisma.exercise.upsert).toHaveBeenCalledTimes(1);
  });

  it('reads only the catalog and the caller\'s own rows', async () => {
    prisma.exercise.findMany.mockResolvedValue([]);

    await service.list(userId, { q: 'row' });

    expect(prisma.exercise.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ scope: 'catalog' }, { scope: userId }],
          name: { contains: 'row', mode: 'insensitive' },
        }),
      }),
    );
  });
});
