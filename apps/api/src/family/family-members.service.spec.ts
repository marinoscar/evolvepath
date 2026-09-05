import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { FamilyMembersService } from './family-members.service';
import { FAMILY_MEMBER_RESPONSE_KEYS } from './family.schema';

const USER = 'user-1';
const ID = '11111111-1111-4111-8111-111111111111';

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  nickname: 'Mia',
  relationship: 'CHILD',
  birthday: new Date('2018-05-09T00:00:00.000Z'),
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  ...over,
});

describe('FamilyMembersService', () => {
  let service: FamilyMembersService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module = await Test.createTestingModule({
      providers: [FamilyMembersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FamilyMembersService);
    prisma.auditEvent.create.mockResolvedValue({ id: 'audit' } as never);
  });

  const auditData = () => (prisma.auditEvent.create.mock.calls[0][0] as any).data;

  it('returns exactly the five permitted keys', async () => {
    prisma.familyMember.findMany.mockResolvedValue([row()] as never);

    const [member] = await service.list(USER);

    expect(Object.keys(member).sort()).toEqual([...FAMILY_MEMBER_RESPONSE_KEYS].sort());
  });

  it('scopes the listing to the caller', async () => {
    prisma.familyMember.findMany.mockResolvedValue([] as never);

    await service.list(USER);

    expect((prisma.familyMember.findMany.mock.calls[0][0] as any).where).toEqual({ userId: USER });
  });

  it('stores the birthday as a calendar date', async () => {
    prisma.familyMember.create.mockResolvedValue(row() as never);

    await service.create(USER, {
      nickname: 'Mia',
      relationship: 'CHILD',
      birthday: '2018-05-09',
    } as never);

    expect((prisma.familyMember.create.mock.calls[0][0] as any).data.birthday).toEqual(
      new Date('2018-05-09T00:00:00.000Z'),
    );
  });

  it('accepts a member with no birthday', async () => {
    prisma.familyMember.create.mockResolvedValue(row({ birthday: null }) as never);

    const member = await service.create(USER, { nickname: 'Mia', relationship: 'CHILD' } as never);

    expect(member.birthday).toBeNull();
  });

  // PRD §33: an audit row outlives the record it describes. Putting the
  // nickname or the birthday in one would defeat the deletion the user asked
  // for and rebuild the profile in a table nobody thinks to look at.
  it.each([
    ['create', () => service.create(USER, { nickname: 'Mia', relationship: 'CHILD', birthday: '2018-05-09' } as never)],
    ['update', () => service.update(USER, ID, { nickname: 'Mia' } as never)],
    ['delete', () => service.remove(USER, ID)],
  ])('audits a %s with the relationship and nothing else', async (_label, run) => {
    prisma.familyMember.create.mockResolvedValue(row() as never);
    prisma.familyMember.findFirst.mockResolvedValue(row() as never);
    prisma.familyMember.update.mockResolvedValue(row() as never);
    prisma.familyMember.delete.mockResolvedValue(row() as never);

    await run();

    expect(auditData().meta).toEqual({ relationship: 'CHILD' });
    expect(auditData().targetType).toBe('family_member');
    expect(JSON.stringify(auditData())).not.toContain('Mia');
    expect(JSON.stringify(auditData())).not.toContain('2018');
  });

  it('names the action per operation', async () => {
    prisma.familyMember.findFirst.mockResolvedValue(row() as never);
    prisma.familyMember.delete.mockResolvedValue(row() as never);

    await service.remove(USER, ID);

    expect(auditData().action).toBe('family_member:delete');
  });

  it('patches only the fields supplied', async () => {
    prisma.familyMember.findFirst.mockResolvedValue(row() as never);
    prisma.familyMember.update.mockResolvedValue(row({ nickname: 'Mimi' }) as never);

    await service.update(USER, ID, { nickname: 'Mimi' } as never);

    expect((prisma.familyMember.update.mock.calls[0][0] as any).data).toEqual({ nickname: 'Mimi' });
  });

  it('clears a birthday when the patch sends null', async () => {
    prisma.familyMember.findFirst.mockResolvedValue(row() as never);
    prisma.familyMember.update.mockResolvedValue(row({ birthday: null }) as never);

    await service.update(USER, ID, { birthday: null } as never);

    expect((prisma.familyMember.update.mock.calls[0][0] as any).data).toEqual({ birthday: null });
  });

  // 404, never 403 — a "Forbidden" would confirm the id exists.
  it.each([
    ['update', () => service.update(USER, ID, { nickname: 'x' } as never)],
    ['delete', () => service.remove(USER, ID)],
  ])('answers 404 for another user’s member on %s', async (_label, run) => {
    prisma.familyMember.findFirst.mockResolvedValue(null as never);

    await expect(run()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes the ownership lookup by userId in the query itself', async () => {
    prisma.familyMember.findFirst.mockResolvedValue(row() as never);
    prisma.familyMember.delete.mockResolvedValue(row() as never);

    await service.remove(USER, ID);

    expect((prisma.familyMember.findFirst.mock.calls[0][0] as any).where).toEqual({
      id: ID,
      userId: USER,
    });
  });
});
