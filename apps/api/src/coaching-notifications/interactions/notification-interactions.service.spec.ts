import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationInteractionsService } from './notification-interactions.service';

const USER = 'user-1';
const OTHER = 'user-2';
const SENT_ID = 'sent-1';
const CR = 'America/Costa_Rica';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('NotificationInteractionsService (#49)', () => {
  let service: NotificationInteractionsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module = await Test.createTestingModule({
      providers: [
        NotificationInteractionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(NotificationInteractionsService);
  });

  describe('recordSent', () => {
    it('writes one SENT row', async () => {
      prisma.notificationInteraction.create.mockResolvedValue({ id: 'i1' } as never);

      const result = await service.recordSent({
        userId: USER,
        eventKey: 'coach.commitment_upcoming',
        commitmentId: 'c1',
        dedupeKey: 'c1:upcoming',
        meta: { leadMinutes: 20 },
      });

      expect(result).toEqual({ id: 'i1', duplicate: false });
      const data = (prisma.notificationInteraction.create.mock.calls[0][0] as any).data;
      expect(data.kind).toBe('SENT');
      expect(data.dedupeKey).toBe('c1:upcoming');
    });

    it('returns the existing decision when the unique index already holds one', async () => {
      prisma.notificationInteraction.create.mockRejectedValue(uniqueViolation() as never);
      prisma.notificationInteraction.findFirst.mockResolvedValue({ id: 'i0' } as never);

      const result = await service.recordSent({
        userId: USER,
        eventKey: 'coach.commitment_upcoming',
        dedupeKey: 'c1:upcoming',
      });

      expect(result).toEqual({ id: 'i0', duplicate: true });
    });

    it('does not swallow a failure that is not a unique violation', async () => {
      prisma.notificationInteraction.create.mockRejectedValue(new Error('boom') as never);

      await expect(
        service.recordSent({ userId: USER, eventKey: 'coach.x', dedupeKey: 'k' }),
      ).rejects.toThrow('boom');
    });
  });

  describe('recordSuppressed', () => {
    it('carries the reason the policy gave', async () => {
      prisma.notificationInteraction.create.mockResolvedValue({ id: 'i2' } as never);

      await service.recordSuppressed({
        userId: USER,
        eventKey: 'coach.commitment_upcoming',
        dedupeKey: 'c1:upcoming',
        suppressReason: 'QUIET_HOURS',
      });

      const data = (prisma.notificationInteraction.create.mock.calls[0][0] as any).data;
      expect(data.kind).toBe('SUPPRESSED');
      expect(data.suppressReason).toBe('QUIET_HOURS');
    });
  });

  describe('recordResponse', () => {
    const sentRow = (over: Record<string, unknown> = {}) => ({
      id: SENT_ID,
      userId: USER,
      eventKey: 'coach.commitment_upcoming',
      commitmentId: 'c1',
      notificationId: 'n1',
      ...over,
    });

    it('copies the event key and commitment from the SENT row rather than trusting the caller', async () => {
      prisma.notificationInteraction.findUnique.mockResolvedValue(sentRow() as never);
      prisma.notificationInteraction.findFirst.mockResolvedValue(null as never);
      prisma.notificationInteraction.create.mockResolvedValue({ id: 'r1' } as never);

      await service.recordResponse({
        userId: USER,
        kind: 'ACTIONED',
        sentInteractionId: SENT_ID,
        action: 'START',
      });

      const data = (prisma.notificationInteraction.create.mock.calls[0][0] as any).data;
      expect(data.eventKey).toBe('coach.commitment_upcoming');
      expect(data.commitmentId).toBe('c1');
      expect(data.sentInteractionId).toBe(SENT_ID);
      expect(data.action).toBe('START');
    });

    it('resolves the SENT row from an inbox notification id', async () => {
      prisma.notificationInteraction.findFirst
        .mockResolvedValueOnce(sentRow() as never) // resolveSentRow
        .mockResolvedValueOnce(null as never); // the already-opened check
      prisma.notificationInteraction.create.mockResolvedValue({ id: 'r2' } as never);

      await service.recordResponse({ userId: USER, kind: 'OPENED', notificationId: 'n1' });

      expect(prisma.notificationInteraction.create).toHaveBeenCalled();
    });

    it('counts a second OPENED as the first one', async () => {
      prisma.notificationInteraction.findUnique.mockResolvedValue(sentRow() as never);
      prisma.notificationInteraction.findFirst.mockResolvedValue({ id: 'r-open' } as never);

      const result = await service.recordResponse({
        userId: USER,
        kind: 'OPENED',
        sentInteractionId: SENT_ID,
      });

      expect(result).toEqual({ id: 'r-open' });
      expect(prisma.notificationInteraction.create).not.toHaveBeenCalled();
    });

    it('still records a second ACTIONED — acting twice is two actions', async () => {
      prisma.notificationInteraction.findUnique.mockResolvedValue(sentRow() as never);
      prisma.notificationInteraction.create.mockResolvedValue({ id: 'r3' } as never);

      await service.recordResponse({
        userId: USER,
        kind: 'ACTIONED',
        sentInteractionId: SENT_ID,
        action: 'MOVE',
      });

      expect(prisma.notificationInteraction.create).toHaveBeenCalled();
    });

    it("answers 404, never 403, for another user's SENT row", async () => {
      prisma.notificationInteraction.findUnique.mockResolvedValue(
        sentRow({ userId: OTHER }) as never,
      );

      await expect(
        service.recordResponse({ userId: USER, kind: 'OPENED', sentInteractionId: SENT_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns null when neither id resolves to a SENT row', async () => {
      prisma.notificationInteraction.findUnique.mockResolvedValue(null as never);

      const result = await service.recordResponse({
        userId: USER,
        kind: 'OPENED',
        sentInteractionId: 'nope',
      });

      expect(result).toBeNull();
    });
  });

  describe('linkNotification', () => {
    it('never lets a bookkeeping failure escape into the dispatch', async () => {
      prisma.notificationInteraction.update.mockRejectedValue(new Error('gone') as never);

      await expect(service.linkNotification(SENT_ID, 'n1')).resolves.toBeUndefined();
    });
  });

  describe('history', () => {
    const now = new Date('2026-09-05T18:00:00.000Z'); // Saturday, 12:00 in CR

    beforeEach(() => {
      prisma.notificationInteraction.count.mockResolvedValue(0 as never);
      prisma.notificationInteraction.findFirst.mockResolvedValue(null as never);
      prisma.notificationInteraction.findMany.mockResolvedValue([] as never);
    });

    it('counts only SENT rows, inside the user’s local day and Monday-start week', async () => {
      await service.history(USER, { now, timeZone: CR, commitmentId: 'c1' });

      const [day, week, commitment] = prisma.notificationInteraction.count.mock.calls.map(
        (call) => (call[0] as any).where,
      );

      expect(day.kind).toBe('SENT');
      expect(day.createdAt.gte.toISOString()).toBe('2026-09-05T06:00:00.000Z');
      expect(day.createdAt.lt.toISOString()).toBe('2026-09-06T06:00:00.000Z');

      expect(week.kind).toBe('SENT');
      expect(week.createdAt.gte.toISOString()).toBe('2026-08-31T06:00:00.000Z');

      expect(commitment.commitmentId).toBe('c1');
      expect(commitment.kind).toBe('SENT');
    });

    it('does not query per-commitment history when there is no commitment', async () => {
      await service.history(USER, { now, timeZone: CR });

      expect(prisma.notificationInteraction.count).toHaveBeenCalledTimes(2);
    });

    it('counts an unanswered SENT row older than two hours as ignored', async () => {
      prisma.notificationInteraction.findMany.mockResolvedValue([
        { id: 'a', responses: [] },
        { id: 'b', responses: [{ id: 'opened' }] },
        { id: 'c', responses: [] },
      ] as never);

      const history = await service.history(USER, { now, timeZone: CR });

      expect(history.consecutiveIgnored).toBe(2);
    });

    it('excludes anything sent within the last two hours from the ignored count', async () => {
      await service.history(USER, { now, timeZone: CR });

      const where = (prisma.notificationInteraction.findMany.mock.calls[0][0] as any).where;
      expect(where.createdAt.lte.toISOString()).toBe('2026-09-05T16:00:00.000Z');
    });

    it('restarts the ignored streak at the last ACTIONED row', async () => {
      const lastActioned = new Date('2026-09-05T12:00:00.000Z');
      prisma.notificationInteraction.findFirst.mockResolvedValue({
        createdAt: lastActioned,
      } as never);

      const history = await service.history(USER, { now, timeZone: CR });

      const where = (prisma.notificationInteraction.findMany.mock.calls[0][0] as any).where;
      expect(where.createdAt.gt.toISOString()).toBe(lastActioned.toISOString());
      expect(history.lastActionedAt).toEqual(lastActioned);
    });

    it('never looks back further than the fatigue window', async () => {
      prisma.notificationInteraction.findFirst.mockResolvedValue({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      } as never);

      await service.history(USER, { now, timeZone: CR });

      const where = (prisma.notificationInteraction.findMany.mock.calls[0][0] as any).where;
      expect(where.createdAt.gt.toISOString()).toBe('2026-08-29T18:00:00.000Z');
    });
  });

  describe('hasDecision', () => {
    it('is true once any decision exists for the candidate', async () => {
      prisma.notificationInteraction.findFirst.mockResolvedValue({ id: 'x' } as never);
      await expect(service.hasDecision(USER, 'coach.x', 'k')).resolves.toBe(true);
    });

    it('is false otherwise', async () => {
      prisma.notificationInteraction.findFirst.mockResolvedValue(null as never);
      await expect(service.hasDecision(USER, 'coach.x', 'k')).resolves.toBe(false);
    });
  });
});
