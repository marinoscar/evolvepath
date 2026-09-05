import { Test } from '@nestjs/testing';
import { Prisma, type Ritual } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { RitualMaterializerService } from './ritual-materializer.service';

const USER = 'user-1';
const CR = 'America/Costa_Rica';

/** Monday 1 June 2026, 09:00 in Costa Rica. */
const NOW = new Date('2026-06-01T15:00:00.000Z');

function ritual(over: Partial<Ritual> = {}): Ritual {
  return {
    id: 'ritual-1',
    userId: USER,
    title: 'Phone-free dinner',
    purpose: null,
    familyMemberId: 'member-1',
    recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: 'Sit down phone-free for the first 10 minutes',
    active: true,
    lastMaterializedThrough: null,
    routineId: null,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    ...over,
  } as Ritual;
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('RitualMaterializerService', () => {
  let service: RitualMaterializerService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [RitualMaterializerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RitualMaterializerService);

    prisma.userProfile.findUnique.mockResolvedValue({ timezone: CR } as never);
    prisma.commitment.create.mockImplementation((async () => ({ id: 'c' })) as never);
    prisma.ritual.update.mockResolvedValue(ritual() as never);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit' } as never);
  });

  const created = () => prisma.commitment.create.mock.calls.map((call) => (call[0] as any).data);

  it('creates one PLANNED FAMILY commitment per matching local date in the horizon', async () => {
    const result = await service.materialize(USER, ritual(), NOW);

    // Tue 2, Thu 4, Sun 7 — and Tue 9 is beyond the seven-day horizon.
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(created().map((d) => d.scheduledStart.toISOString())).toEqual([
      '2026-06-03T00:30:00.000Z',
      '2026-06-05T00:30:00.000Z',
      '2026-06-08T00:30:00.000Z',
    ]);

    for (const row of created()) {
      expect(row).toMatchObject({
        userId: USER,
        domain: 'FAMILY',
        status: 'PLANNED',
        ritualId: 'ritual-1',
        familyMemberId: 'member-1',
        importance: 4,
      });
    }
  });

  it('maps the three sizes from the ritual, with the fallback as the minimum title', () => {
    return service.materialize(USER, ritual(), NOW).then(() => {
      expect(created()[0]).toMatchObject({
        fullVersion: 'Phone-free dinner',
        fullMinutes: 45,
        // (45 + 10) / 2, rounded.
        shortVersion: 'Phone-free dinner',
        shortMinutes: 28,
        minimumVersion: 'Sit down phone-free for the first 10 minutes',
        minimumMinutes: 10,
      });
    });
  });

  it('offers no short version when the ideal and the minimum are close together', async () => {
    await service.materialize(USER, ritual({ idealMinutes: 15, minimumMinutes: 10 }), NOW);

    expect(created()[0]).toMatchObject({ shortVersion: null, shortMinutes: null });
  });

  it('titles the minimum version after the ritual when there is no fallback text', async () => {
    await service.materialize(USER, ritual({ fallbackBehavior: null }), NOW);

    expect(created()[0].minimumVersion).toBe('Phone-free dinner');
  });

  it('ends the commitment after the ideal duration', async () => {
    await service.materialize(USER, ritual(), NOW);

    const row = created()[0];
    expect(row.scheduledEnd.getTime() - row.scheduledStart.getTime()).toBe(45 * 60_000);
  });

  it('counts a unique-index collision as skipped rather than failing the run', async () => {
    prisma.commitment.create
      .mockRejectedValueOnce(uniqueViolation() as never)
      .mockResolvedValue({ id: 'c' } as never);

    const result = await service.materialize(USER, ritual(), NOW);

    expect(result).toMatchObject({ created: 2, skipped: 1 });
  });

  it('re-raises anything that is not a unique-index collision', async () => {
    prisma.commitment.create.mockRejectedValue(new Error('connection lost') as never);

    await expect(service.materialize(USER, ritual(), NOW)).rejects.toThrow('connection lost');
  });

  it('creates nothing on a second run over the same horizon', async () => {
    // The first run set `lastMaterializedThrough` to today + 7; the second
    // therefore starts where the first ended and finds no new dates.
    const result = await service.materialize(
      USER,
      ritual({ lastMaterializedThrough: new Date('2026-06-08T00:00:00.000Z') }),
      NOW,
    );

    expect(result).toMatchObject({ created: 0, skipped: 0 });
    expect(prisma.commitment.create).not.toHaveBeenCalled();
  });

  it('creates nothing for a paused ritual and leaves its horizon alone', async () => {
    const result = await service.materialize(USER, ritual({ active: false }), NOW);

    expect(result).toMatchObject({ created: 0, skipped: 0 });
    expect(prisma.commitment.create).not.toHaveBeenCalled();
    expect(prisma.ritual.update).not.toHaveBeenCalled();
  });

  it('advances the horizon to seven local days out', async () => {
    await service.materialize(USER, ritual(), NOW);

    expect((prisma.ritual.update.mock.calls[0][0] as any).data.lastMaterializedThrough)
      .toEqual(new Date('2026-06-08T00:00:00.000Z'));
  });

  it('audits only when something was written', async () => {
    await service.materialize(USER, ritual(), NOW);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect((prisma.auditEvent.create.mock.calls[0][0] as any).data).toMatchObject({
      action: 'ritual:materialize',
      targetType: 'ritual',
      meta: { created: 3, skipped: 0, through: '2026-06-08' },
    });

    prisma.auditEvent.create.mockClear();
    prisma.commitment.create.mockClear();

    // The nightly cron visits every ritual; a no-op run must not add a row.
    await service.materialize(
      USER,
      ritual({ lastMaterializedThrough: new Date('2026-06-08T00:00:00.000Z') }),
      NOW,
    );
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('materializes in the user’s timezone, not the server’s', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({ timezone: 'Pacific/Auckland' } as never);

    await service.materialize(USER, ritual(), NOW);

    // 18:30 in Auckland is 06:30Z the SAME day; in Costa Rica it is 00:30Z the
    // next one. Same rule, same instant in the window, different UTC times.
    expect(created()[0].scheduledStart.toISOString()).toBe('2026-06-02T06:30:00.000Z');
  });

  it('falls back to UTC when the profile has no timezone', async () => {
    prisma.userProfile.findUnique.mockResolvedValue(null as never);

    await service.materialize(USER, ritual(), NOW);

    expect(created()[0].scheduledStart.toISOString()).toBe('2026-06-02T18:30:00.000Z');
  });
});

describe('RitualMaterializerService.materializeAllDue', () => {
  let service: RitualMaterializerService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [RitualMaterializerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RitualMaterializerService);
    prisma.commitment.create.mockResolvedValue({ id: 'c' } as never);
    prisma.ritual.update.mockResolvedValue(ritual() as never);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit' } as never);
  });

  it('keeps going after one ritual throws', async () => {
    const withProfile = (id: string, timezone: string | null) => ({
      ...ritual({ id }),
      user: { profile: timezone === null ? null : { timezone } },
    });

    prisma.ritual.findMany.mockResolvedValueOnce([
      withProfile('bad', CR),
      withProfile('good', CR),
    ] as never);

    // The first ritual's insert blows up; the second must still be visited.
    prisma.commitment.create
      .mockRejectedValueOnce(new Error('boom') as never)
      .mockResolvedValue({ id: 'c' } as never);

    const result = await service.materializeAllDue(NOW);

    expect(result.rituals).toBe(2);
    expect(result.created).toBe(3);
  });

  it('reads each user’s own timezone', async () => {
    prisma.ritual.findMany.mockResolvedValueOnce([
      { ...ritual({ id: 'nz' }), user: { profile: { timezone: 'Pacific/Auckland' } } },
    ] as never);

    await service.materializeAllDue(NOW);

    // Resolved in Auckland, and without a per-ritual profile lookup.
    expect((prisma.commitment.create.mock.calls[0][0] as any).data.scheduledStart.toISOString())
      .toBe('2026-06-02T06:30:00.000Z');
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
  });

  it('stops at the last page', async () => {
    prisma.ritual.findMany.mockResolvedValueOnce([] as never);

    expect(await service.materializeAllDue(NOW)).toEqual({ rituals: 0, created: 0 });
    expect(prisma.ritual.findMany).toHaveBeenCalledTimes(1);
  });
});
