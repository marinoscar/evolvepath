import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/mocks/prisma.mock';
import { WorkoutAdaptationService } from './workout-adaptation.service';
import { WorkoutAdaptationTask } from './workout-adaptation.task';

describe('WorkoutAdaptationTask', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let adaptation: { run: jest.Mock };

  async function build(disabled = false): Promise<WorkoutAdaptationTask> {
    prisma = createMockPrismaService();
    adaptation = { run: jest.fn().mockResolvedValue({ created: 1, proposalIds: ['p'] }) };

    const module = await Test.createTestingModule({
      providers: [
        WorkoutAdaptationTask,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkoutAdaptationService, useValue: adaptation },
        { provide: ConfigService, useValue: { get: () => disabled } },
      ],
    }).compile();

    return module.get(WorkoutAdaptationTask);
  }

  it('sweeps only users with an active program', async () => {
    const task = await build();
    prisma.workoutProgram.findMany.mockResolvedValue([
      { userId: 'a' },
      { userId: 'b' },
    ] as never);

    await expect(task.run()).resolves.toEqual({ users: 2, proposals: 2 });
    expect(prisma.workoutProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' }, distinct: ['userId'] }),
    );
  });

  it('keeps going when one user fails', async () => {
    const task = await build();
    prisma.workoutProgram.findMany.mockResolvedValue([
      { userId: 'a' },
      { userId: 'b' },
      { userId: 'c' },
    ] as never);
    adaptation.run.mockRejectedValueOnce(new Error('broken program'));

    // One person's malformed program must not silently stop adaptation for
    // everybody else — nothing would say so until somebody noticed a month
    // later that their plan had never adapted.
    await expect(task.run()).resolves.toEqual({ users: 3, proposals: 2 });
  });

  it('does nothing at all when the sweep is switched off', async () => {
    const task = await build(true);

    await task.handleDailySweep();

    expect(prisma.workoutProgram.findMany).not.toHaveBeenCalled();
  });
});
