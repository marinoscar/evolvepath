import { isQuietNow, localTimeOfDay } from './quiet-hours';

const CR = 'America/Costa_Rica'; // UTC-6, no DST
const TOKYO = 'Asia/Tokyo'; // UTC+9
const at = (iso: string) => new Date(iso);

describe('localTimeOfDay (#59)', () => {
  it('reads the user’s wall clock, not the server’s', () => {
    // 03:00 UTC is 21:00 the previous evening in Costa Rica and noon in Tokyo.
    expect(localTimeOfDay(at('2026-09-08T03:00:00.000Z'), CR)).toBe('21:00');
    expect(localTimeOfDay(at('2026-09-08T03:00:00.000Z'), TOKYO)).toBe('12:00');
  });

  // The h23 hour cycle exists for exactly this: without it midnight formats as
  // "24:00" in some zones, which sorts after every other time and puts the user
  // outside a window that should contain them.
  it('calls midnight 00:00, never 24:00', () => {
    expect(localTimeOfDay(at('2026-09-08T06:00:00.000Z'), CR)).toBe('00:00');
  });

  it('falls back to UTC for an unusable zone rather than throwing', () => {
    expect(localTimeOfDay(at('2026-09-08T03:00:00.000Z'), 'Not/AZone')).toBe('03:00');
  });
});

describe('isQuietNow (#59)', () => {
  it('is never quiet when no window is configured', () => {
    expect(isQuietNow(at('2026-09-08T09:00:00.000Z'), CR, null)).toBe(false);
  });

  // The case everybody actually configures, and the one `start <= t < end`
  // silently gets wrong — with 22:00-07:00 it matches nothing at all.
  describe('a window that crosses midnight (22:00-07:00)', () => {
    const window = { start: '22:00', end: '07:00' };

    it.each([
      ['23:30 local', '2026-09-09T05:30:00.000Z', true],
      ['22:00 local, the first quiet minute', '2026-09-09T04:00:00.000Z', true],
      ['02:00 local, the far side of midnight', '2026-09-09T08:00:00.000Z', true],
      ['06:59 local, the last quiet minute', '2026-09-09T12:59:00.000Z', true],
      ['07:00 local, awake again', '2026-09-09T13:00:00.000Z', false],
      ['21:59 local, one minute early', '2026-09-09T03:59:00.000Z', false],
      ['noon', '2026-09-09T18:00:00.000Z', false],
    ])('%s -> %s', (_label, iso, expected) => {
      expect(isQuietNow(at(iso), CR, window)).toBe(expected);
    });
  });

  describe('a window inside one day (12:00-13:00)', () => {
    const window = { start: '12:00', end: '13:00' };

    it.each([
      ['12:00 local', '2026-09-09T18:00:00.000Z', true],
      ['12:59 local', '2026-09-09T18:59:00.000Z', true],
      ['13:00 local, the half-open end', '2026-09-09T19:00:00.000Z', false],
      ['11:59 local', '2026-09-09T17:59:00.000Z', false],
      ['midnight, outside it', '2026-09-09T06:00:00.000Z', false],
    ])('%s -> %s', (_label, iso, expected) => {
      expect(isQuietNow(at(iso), CR, window)).toBe(expected);
    });
  });

  // The same instant, two users, two answers. This is the whole reason the
  // window is evaluated per-user rather than once per run.
  it('answers differently for two users at the same instant', () => {
    const window = { start: '22:00', end: '07:00' };
    const instant = at('2026-09-08T03:00:00.000Z'); // 21:00 in CR, 12:00 in Tokyo

    expect(isQuietNow(instant, CR, window)).toBe(false);
    expect(isQuietNow(instant, TOKYO, window)).toBe(false);

    const later = at('2026-09-08T05:00:00.000Z'); // 23:00 in CR, 14:00 in Tokyo
    expect(isQuietNow(later, CR, window)).toBe(true);
    expect(isQuietNow(later, TOKYO, window)).toBe(false);
  });
});
