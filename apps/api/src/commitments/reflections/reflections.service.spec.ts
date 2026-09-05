import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { ReflectionsService } from './reflections.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { createReflectionSchema } from './dto/create-reflection.dto';

describe('reflection validation', () => {
  const failsAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    result.success ? [] : result.error!.issues.map((issue) => issue.path.join('.'));

  it('accepts a day reflection with no relatedId', () => {
    expect(
      createReflectionSchema.safeParse({ relatedType: 'day', mood: 4 }).success,
    ).toBe(true);
  });

  it.each([['commitment'], ['outcome'], ['plan_version']])(
    'requires relatedId for a %s reflection',
    (relatedType) => {
      const result = createReflectionSchema.safeParse({ relatedType, mood: 4 });
      expect(failsAt(result)).toContain('relatedId');
    },
  );

  // An empty reflection is a row with nothing in it; refusing it keeps
  // "how many times did you reflect?" a meaningful number.
  it('rejects a reflection with no note, tag or score', () => {
    expect(createReflectionSchema.safeParse({ relatedType: 'day' }).success).toBe(false);
  });

  it('accepts a reflection carrying only a friction tag', () => {
    expect(
      createReflectionSchema.safeParse({ relatedType: 'day', frictionTags: ['too tired'] }).success,
    ).toBe(true);
  });
});

describe('ReflectionsService', () => {
  let service: ReflectionsService;
  let prisma: MockPrismaService;

  const userId = 'user-123';
  const commitmentId = '55555555-5555-4555-8555-555555555555';
  const at = new Date('2026-02-10T20:00:00.000Z');

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'ref-1',
    userId,
    relatedType: 'commitment',
    relatedId: commitmentId,
    commitmentId,
    userText: 'Harder than expected',
    aiSummary: null,
    frictionTags: [],
    mood: 3,
    perceivedDifficulty: 4,
    satisfaction: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReflectionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReflectionsService>(ReflectionsService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit-1' } as never);
  });

  // relatedId is a soft pointer, so nothing in the database checks it. Without
  // this the user could attach a reflection to someone else's outcome.
  it("answers 404 when the related row is another user's", async () => {
    prisma.commitment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.create(userId, {
        relatedType: 'commitment',
        relatedId: commitmentId,
        userText: 'x',
        frictionTags: [],
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('denormalises commitmentId so the common join is a real foreign key', async () => {
    prisma.commitment.findFirst.mockResolvedValue({ id: commitmentId } as never);
    prisma.reflection.create.mockResolvedValue(row() as never);

    await service.create(userId, {
      relatedType: 'commitment',
      relatedId: commitmentId,
      userText: 'Harder than expected',
      frictionTags: [],
    } as never);

    const { data } = prisma.reflection.create.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.commitmentId).toBe(commitmentId);
  });

  it('leaves commitmentId null for a non-commitment reflection', async () => {
    prisma.outcome.findFirst.mockResolvedValue({ id: 'o-1' } as never);
    prisma.reflection.create.mockResolvedValue(row({ relatedType: 'outcome' }) as never);

    await service.create(userId, {
      relatedType: 'outcome',
      relatedId: 'o-1',
      mood: 4,
      frictionTags: [],
    } as never);

    const { data } = prisma.reflection.create.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.commitmentId).toBeNull();
  });

  it('audits the relation, never the note', async () => {
    prisma.reflection.create.mockResolvedValue(row({ relatedType: 'day', relatedId: null }) as never);

    await service.create(userId, {
      relatedType: 'day',
      userText: 'A long private note',
      frictionTags: [],
    } as never);

    const { data } = prisma.auditEvent.create.mock.calls[0]?.[0] ?? { data: {} };
    expect(data.meta).toEqual({ relatedType: 'day', relatedId: null });
    expect(JSON.stringify(data.meta)).not.toContain('private');
  });

  it('caps a listing rather than exporting everything', async () => {
    prisma.reflection.findMany.mockResolvedValue([] as never);

    await service.list(userId, {} as never);

    expect(prisma.reflection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId }, take: 200 }),
    );
  });
});
