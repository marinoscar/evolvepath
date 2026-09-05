import {
  domainReflectionsSchema,
  healthBaselineSchema,
  obstaclesSchema,
  quietHoursTime,
  weekdayMinutesSchema,
} from './user-profile.schema';

describe('user profile schemas (#100)', () => {
  describe('healthBaselineSchema', () => {
    const valid = {
      experience: 'BEGINNER' as const,
      daysPerWeek: 3,
      minutesPerSession: 30,
      equipment: ['dumbbells'],
    };

    it('accepts a complete baseline', () => {
      expect(healthBaselineSchema.parse(valid)).toEqual(valid);
    });

    it('rejects daysPerWeek 8 — there is no eighth day', () => {
      expect(healthBaselineSchema.safeParse({ ...valid, daysPerWeek: 8 }).success).toBe(false);
    });

    it('rejects a 5-minute session — below the floor a session means anything', () => {
      expect(
        healthBaselineSchema.safeParse({ ...valid, minutesPerSession: 5 }).success,
      ).toBe(false);
    });

    it('rejects an unknown experience level', () => {
      expect(healthBaselineSchema.safeParse({ ...valid, experience: 'PRO' }).success).toBe(
        false,
      );
    });
  });

  describe('quietHoursTime', () => {
    it.each(['00:00', '09:30', '23:59'])('accepts %s', (value) => {
      expect(quietHoursTime.parse(value)).toBe(value);
    });

    it.each(['9:00', '24:00', '23:60', '0900', ''])('rejects %s', (value) => {
      expect(quietHoursTime.safeParse(value).success).toBe(false);
    });
  });

  describe('obstaclesSchema', () => {
    it('accepts stable keys', () => {
      expect(obstaclesSchema.parse(['PROCRASTINATE', 'FORGET'])).toEqual([
        'PROCRASTINATE',
        'FORGET',
      ]);
    });

    it('rejects free text — E07 groups on these keys', () => {
      expect(obstaclesSchema.safeParse(['I get distracted']).success).toBe(false);
    });

    it('rejects more entries than there are options worth grouping', () => {
      expect(obstaclesSchema.safeParse(Array(9).fill('OTHER')).success).toBe(false);
    });
  });

  describe('domainReflectionsSchema', () => {
    it('accepts a partial answer — a user may skip a domain', () => {
      expect(domainReflectionsSchema.parse({ work: 'too many meetings' })).toEqual({
        work: 'too many meetings',
      });
    });

    it('rejects an essay', () => {
      expect(
        domainReflectionsSchema.safeParse({ work: 'x'.repeat(1001) }).success,
      ).toBe(false);
    });
  });

  describe('weekdayMinutesSchema', () => {
    it.each([5, 60, 720])('accepts %i', (value) => {
      expect(weekdayMinutesSchema.parse(value)).toBe(value);
    });

    it.each([0, 4, 721, 30.5])('rejects %s', (value) => {
      expect(weekdayMinutesSchema.safeParse(value).success).toBe(false);
    });
  });
});
