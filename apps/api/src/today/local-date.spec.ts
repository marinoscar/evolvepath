import {
  FALLBACK_TIME_ZONE,
  greetingFor,
  isValidTimeZone,
  localDate,
  localDayBounds,
  localHour,
  localWeekBounds,
  safeTimeZone,
} from './local-date';

const CR = 'America/Costa_Rica'; // UTC-6 year round, no DST
const NY = 'America/New_York'; // DST, for the 23/25-hour days
const KTM = 'Asia/Kathmandu'; // UTC+05:45, the half-hour-offset case

describe('local-date (#38)', () => {
  describe('localDate', () => {
    // The bug this exists to prevent: at 23:30 UTC a Costa Rican user's
    // commitments for tonight would otherwise be filed under tomorrow.
    it('is still the previous day in Costa Rica at 23:30 UTC', () => {
      const at = new Date('2026-03-02T23:30:00.000Z');

      expect(localDate(at, 'UTC')).toBe('2026-03-02');
      expect(localDate(at, CR)).toBe('2026-03-02');

      const justAfterMidnightUtc = new Date('2026-03-03T00:30:00.000Z');
      expect(localDate(justAfterMidnightUtc, 'UTC')).toBe('2026-03-03');
      expect(localDate(justAfterMidnightUtc, CR)).toBe('2026-03-02');
    });

    it('handles a zone whose offset is not a whole hour', () => {
      expect(localDate(new Date('2026-03-02T18:20:00.000Z'), KTM)).toBe('2026-03-03');
    });

    it('zero-pads single-digit months and days', () => {
      expect(localDate(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe('2026-01-05');
    });
  });

  describe('safeTimeZone', () => {
    it('falls back to UTC for a missing or unusable zone', () => {
      expect(safeTimeZone(null)).toBe(FALLBACK_TIME_ZONE);
      expect(safeTimeZone('')).toBe(FALLBACK_TIME_ZONE);
      expect(safeTimeZone('Mars/Olympus_Mons')).toBe(FALLBACK_TIME_ZONE);
      expect(safeTimeZone(CR)).toBe(CR);
    });

    // A stored timezone is user input that survived a migration; a bad one must
    // not 500 the whole Today screen.
    it('never throws for a stored value', () => {
      expect(() => localDate(new Date(), 'nonsense/zone')).not.toThrow();
      expect(isValidTimeZone('nonsense/zone')).toBe(false);
    });
  });

  describe('localDayBounds', () => {
    it('brackets a UTC day exactly', () => {
      const { start, end } = localDayBounds('2026-03-02', 'UTC');

      expect(start.toISOString()).toBe('2026-03-02T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    });

    it('shifts by the zone offset', () => {
      const { start, end } = localDayBounds('2026-03-02', CR);

      expect(start.toISOString()).toBe('2026-03-02T06:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-03T06:00:00.000Z');
    });

    it('produces a 23-hour day when DST starts', () => {
      // 2026-03-08 is the US spring-forward date.
      const { start, end } = localDayBounds('2026-03-08', NY);

      expect((end.getTime() - start.getTime()) / 3600_000).toBe(23);
    });

    it('produces a 25-hour day when DST ends', () => {
      // 2026-11-01 is the US fall-back date.
      const { start, end } = localDayBounds('2026-11-01', NY);

      expect((end.getTime() - start.getTime()) / 3600_000).toBe(25);
    });

    it('brackets an instant that localDate agrees is that day', () => {
      const at = new Date('2026-03-02T23:30:00.000Z');
      const { start, end } = localDayBounds(localDate(at, CR), CR);

      expect(at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(at.getTime()).toBeLessThan(end.getTime());
    });
  });

  describe('greetingFor', () => {
    it.each([
      ['2026-03-02T05:00:00.000Z', 'morning'],
      ['2026-03-02T11:59:00.000Z', 'morning'],
      ['2026-03-02T12:00:00.000Z', 'afternoon'],
      ['2026-03-02T17:59:00.000Z', 'afternoon'],
      ['2026-03-02T18:00:00.000Z', 'evening'],
      ['2026-03-02T04:59:00.000Z', 'evening'],
    ])('at %s UTC says %s', (iso, expected) => {
      expect(greetingFor(new Date(iso), 'UTC')).toBe(expected);
    });

    it('follows the user’s zone, not the server’s', () => {
      // 14:00 UTC is 08:00 in Costa Rica.
      const at = new Date('2026-03-02T14:00:00.000Z');

      expect(greetingFor(at, 'UTC')).toBe('afternoon');
      expect(greetingFor(at, CR)).toBe('morning');
    });
  });

  describe('localHour', () => {
    it('reports midnight as 0, not 24', () => {
      expect(localHour(new Date('2026-03-02T00:00:00.000Z'), 'UTC')).toBe(0);
    });
  });

  describe('localWeekBounds (#49)', () => {
    const MADRID = 'Europe/Madrid'; // DST, for the 167-hour week

    it('starts the week on Monday, not Sunday', () => {
      // 2026-09-05 is a Saturday.
      const { start, end } = localWeekBounds('2026-09-05', CR);

      // Monday 2026-08-31 00:00 in Costa Rica is 06:00 UTC.
      expect(start.toISOString()).toBe('2026-08-31T06:00:00.000Z');
      // Exclusive end: Monday 2026-09-07 00:00 local.
      expect(end.toISOString()).toBe('2026-09-07T06:00:00.000Z');
    });

    it('puts Sunday at the END of its week, six days after the start', () => {
      // 2026-09-06 is a Sunday; it belongs to the week that began 2026-08-31.
      expect(localWeekBounds('2026-09-06', CR).start.toISOString()).toBe(
        '2026-08-31T06:00:00.000Z',
      );
    });

    it('gives a Monday its own week', () => {
      const { start } = localWeekBounds('2026-08-31', CR);
      expect(start.toISOString()).toBe('2026-08-31T06:00:00.000Z');
    });

    it('spans 168 hours in a zone with no DST', () => {
      const { start, end } = localWeekBounds('2026-09-05', CR);
      expect(end.getTime() - start.getTime()).toBe(168 * 3600_000);
    });

    it('spans 167 hours across the spring DST switch in Madrid', () => {
      // Spain springs forward on the last Sunday of March: 2026-03-29.
      const { start, end } = localWeekBounds('2026-03-25', MADRID);

      expect(end.getTime() - start.getTime()).toBe(167 * 3600_000);
    });

    it('spans 169 hours across the autumn DST switch in Madrid', () => {
      // Spain falls back on the last Sunday of October: 2026-10-25.
      const { start, end } = localWeekBounds('2026-10-21', MADRID);

      expect(end.getTime() - start.getTime()).toBe(169 * 3600_000);
    });

    it('agrees with localDayBounds on the first day of the week', () => {
      const week = localWeekBounds('2026-09-05', KTM);
      const monday = localDayBounds('2026-08-31', KTM);

      expect(week.start.toISOString()).toBe(monday.start.toISOString());
    });
  });
});