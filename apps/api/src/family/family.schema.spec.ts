import {
  FAMILY_MEMBER_RESPONSE_KEYS,
  createFamilyMemberSchema,
  familyMemberResponseSchema,
  ritualRecurrenceSchema,
} from './family.schema';

describe('ritualRecurrenceSchema', () => {
  it('accepts Tue/Thu/Sun at 18:30 every week', () => {
    const parsed = ritualRecurrenceSchema.parse({
      weekdays: [2, 4, 0],
      time: '18:30',
      everyNWeeks: 1,
    });

    expect(parsed).toEqual({ weekdays: [2, 4, 0], time: '18:30', everyNWeeks: 1 });
  });

  it.each([
    ['a weekday above Saturday', { weekdays: [7], time: '18:30', everyNWeeks: 1 }],
    ['a negative weekday', { weekdays: [-1], time: '18:30', everyNWeeks: 1 }],
    ['duplicate weekdays', { weekdays: [2, 2], time: '18:30', everyNWeeks: 1 }],
    ['no weekdays at all', { weekdays: [], time: '18:30', everyNWeeks: 1 }],
    ['an unpadded hour', { weekdays: [2], time: '6:30', everyNWeeks: 1 }],
    ['an hour of 24', { weekdays: [2], time: '24:00', everyNWeeks: 1 }],
    ['a minute of 60', { weekdays: [2], time: '18:60', everyNWeeks: 1 }],
    ['a cadence of 3 weeks', { weekdays: [2], time: '18:30', everyNWeeks: 3 }],
    ['a cadence of 0 weeks', { weekdays: [2], time: '18:30', everyNWeeks: 0 }],
  ])('rejects %s', (_label, value) => {
    expect(ritualRecurrenceSchema.safeParse(value).success).toBe(false);
  });

  it('accepts exactly 1, 2 and 4 as the cadence', () => {
    for (const everyNWeeks of [1, 2, 4]) {
      expect(
        ritualRecurrenceSchema.safeParse({ weekdays: [1], time: '09:00', everyNWeeks }).success,
      ).toBe(true);
    }
  });
});

describe('familyMemberResponseSchema', () => {
  const valid = {
    id: '11111111-1111-4111-8111-111111111111',
    nickname: 'Mia',
    relationship: 'CHILD' as const,
    birthday: '2018-05-09',
    createdAt: '2026-09-05T00:00:00.000Z',
  };

  it('accepts the five-key record', () => {
    expect(familyMemberResponseSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a null birthday', () => {
    expect(familyMemberResponseSchema.parse({ ...valid, birthday: null }).birthday).toBeNull();
  });

  // PRD §33 / VISION §50: the privacy boundary is the ABSENCE of these keys,
  // and `.strict()` is what makes adding one a failure rather than a diff.
  it.each(['notes', 'mood', 'score', 'sentiment', 'quality', 'userId'])(
    'rejects an extra `%s` key',
    (key) => {
      expect(familyMemberResponseSchema.safeParse({ ...valid, [key]: 'x' }).success).toBe(false);
    },
  );

  it('exposes exactly FAMILY_MEMBER_RESPONSE_KEYS', () => {
    expect(Object.keys(familyMemberResponseSchema.shape).sort()).toEqual(
      [...FAMILY_MEMBER_RESPONSE_KEYS].sort(),
    );
  });
});

describe('createFamilyMemberSchema', () => {
  it('rejects a nickname longer than 40 characters', () => {
    const result = createFamilyMemberSchema.safeParse({
      nickname: 'x'.repeat(41),
      relationship: 'CHILD',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a 40-character nickname and no birthday', () => {
    const result = createFamilyMemberSchema.safeParse({
      nickname: 'x'.repeat(40),
      relationship: 'PARTNER',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown relationship', () => {
    expect(
      createFamilyMemberSchema.safeParse({ nickname: 'Mia', relationship: 'COUSIN' }).success,
    ).toBe(false);
  });

  it('rejects a birthday that is not a calendar date', () => {
    expect(
      createFamilyMemberSchema.safeParse({
        nickname: 'Mia',
        relationship: 'CHILD',
        birthday: '2018-05-09T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
