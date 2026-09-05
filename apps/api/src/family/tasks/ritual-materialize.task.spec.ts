import { Test } from '@nestjs/testing';

import { RitualMaterializerService } from '../ritual-materializer.service';
import { RitualMaterializeTask } from './ritual-materialize.task';

describe('RitualMaterializeTask', () => {
  let task: RitualMaterializeTask;
  let materializer: { materializeAllDue: jest.Mock };

  beforeEach(async () => {
    materializer = {
      materializeAllDue: jest.fn().mockResolvedValue({ rituals: 12, created: 34 }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RitualMaterializeTask,
        { provide: RitualMaterializerService, useValue: materializer },
      ],
    }).compile();

    task = module.get(RitualMaterializeTask);
  });

  it('sweeps every due ritual exactly once', async () => {
    await task.handleCron();

    expect(materializer.materializeAllDue).toHaveBeenCalledTimes(1);
  });

  it('logs the counts, which is the only observability this job has', async () => {
    const lines: string[] = [];
    jest
      .spyOn((task as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation((message: string) => void lines.push(message));

    await task.handleCron();

    expect(lines).toEqual(['ritual.materialize rituals=12 created=34']);
  });
});
