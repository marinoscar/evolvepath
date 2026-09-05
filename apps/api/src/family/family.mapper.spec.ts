import type { FamilyMember, Ritual } from '@prisma/client';

import { FAMILY_MEMBER_RESPONSE_KEYS, ritualRecurrenceSchema } from './family.schema';
import { toDateOnly, toFamilyMemberDto, toRitualDto } from './family.mapper';

function memberRow(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nickname: 'Mia',
    relationship: 'CHILD',
    birthday: new Date('2018-05-09T00:00:00.000Z'),
    createdAt: new Date('2026-09-05T12:00:00.000Z'),
    ...overrides,
  } as FamilyMember;
}

describe('toFamilyMemberDto', () => {
  it('returns exactly the five permitted keys', () => {
    const dto = toFamilyMemberDto(memberRow());

    expect(Object.keys(dto).sort()).toEqual([...FAMILY_MEMBER_RESPONSE_KEYS].sort());
  });

  it('never leaks userId, even when the row carries it', () => {
    const dto = toFamilyMemberDto(memberRow());

    expect(dto).not.toHaveProperty('userId');
  });

  it('drops a column the row grows that the boundary does not permit', () => {
    // Simulates the realistic failure: somebody adds a column and a service
    // starts selecting it. The projection is explicit, so it does not travel.
    const row = { ...memberRow(), notes: 'she seemed quiet today' } as unknown as FamilyMember;

    expect(toFamilyMemberDto(row)).not.toHaveProperty('notes');
  });

  it('renders the birthday as a calendar date, not an instant', () => {
    expect(toFamilyMemberDto(memberRow()).birthday).toBe('2018-05-09');
  });

  it('keeps a null birthday null', () => {
    expect(toFamilyMemberDto(memberRow({ birthday: null })).birthday).toBeNull();
  });

  it('renders the 1900 placeholder year unchanged — consumers ignore it', () => {
    const dto = toFamilyMemberDto(memberRow({ birthday: new Date('1900-02-29T00:00:00.000Z') }));

    // 1900 was not a leap year, so the placeholder normalises to 1 March.
    expect(dto.birthday).toMatch(/^1900-03-01$/);
  });
});

describe('toDateOnly', () => {
  it('returns null for null', () => {
    expect(toDateOnly(null)).toBeNull();
  });

  it('slices without applying an offset', () => {
    expect(toDateOnly(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
});

function ritualRow(overrides: Partial<Ritual> = {}): Ritual {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Phone-free dinner',
    purpose: 'Be present at the table',
    familyMemberId: '11111111-1111-4111-8111-111111111111',
    recurrence: { weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 },
    idealMinutes: 45,
    minimumMinutes: 10,
    fallbackBehavior: 'Sit down phone-free for the first 10 minutes',
    active: true,
    lastMaterializedThrough: new Date('2026-09-12T00:00:00.000Z'),
    routineId: null,
    createdAt: new Date('2026-09-05T12:00:00.000Z'),
    updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    ...overrides,
  } as Ritual;
}

describe('toRitualDto', () => {
  it('round-trips the recurrence through its schema', () => {
    const dto = toRitualDto(ritualRow());

    expect(ritualRecurrenceSchema.parse(dto.recurrence)).toEqual({
      weekdays: [2, 4, 0],
      time: '18:30',
      everyNWeeks: 1,
    });
  });

  it('renders the horizon as a calendar date', () => {
    expect(toRitualDto(ritualRow()).lastMaterializedThrough).toBe('2026-09-12');
  });

  it('does not leak userId', () => {
    expect(toRitualDto(ritualRow())).not.toHaveProperty('userId');
  });

  it('throws on a corrupt recurrence rather than passing it on', () => {
    expect(() => toRitualDto(ritualRow({ recurrence: { weekdays: [9] } as never }))).toThrow();
  });
});
