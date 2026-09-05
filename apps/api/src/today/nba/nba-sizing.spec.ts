import { chooseVersion, DEFAULT_FALLBACK, fallbackFor } from './nba-sizing';

const versions = (over: Partial<Parameters<typeof chooseVersion>[0]['versions']> = {}) => ({
  full: { title: 'Draft the storyline', minutes: 25 },
  short: null,
  minimum: null,
  ...over,
});

const all = versions({
  short: { title: 'Write the decision statement', minutes: 10 },
  minimum: { title: 'Open the doc and write one sentence', minutes: 5 },
});

describe('chooseVersion (#38)', () => {
  describe('LOW_ENERGY', () => {
    it('prefers the minimum', () => {
      expect(
        chooseVersion({ versions: all, checkIn: 'LOW_ENERGY', availableMinutesRemaining: 600 }),
      ).toEqual({ version: 'minimum', title: all.minimum!.title, durationMinutes: 5 });
    });

    it('falls to the short version when no minimum was declared', () => {
      expect(
        chooseVersion({
          versions: versions({ short: { title: 'Short', minutes: 10 } }),
          checkIn: 'LOW_ENERGY',
          availableMinutesRemaining: 600,
        }).version,
      ).toBe('short');
    });

    // Never invent a size: a smaller commitment the user did not declare is one
    // they never agreed to.
    it('falls to the full version when neither was declared', () => {
      expect(
        chooseVersion({
          versions: versions(),
          checkIn: 'LOW_ENERGY',
          availableMinutesRemaining: 600,
        }).version,
      ).toBe('full');
    });
  });

  describe('PACKED and UNEXPECTED_PROBLEM', () => {
    // The constraint is TIME, not capacity, so the minimum would undersell them.
    it.each(['PACKED', 'UNEXPECTED_PROBLEM'] as const)('%s prefers the short version', (feel) => {
      expect(
        chooseVersion({ versions: all, checkIn: feel, availableMinutesRemaining: 600 }).version,
      ).toBe('short');
    });

    it('falls to the minimum when no short version exists', () => {
      expect(
        chooseVersion({
          versions: versions({ minimum: { title: 'One sentence', minutes: 5 } }),
          checkIn: 'PACKED',
          availableMinutesRemaining: 600,
        }).version,
      ).toBe('minimum');
    });
  });

  describe('no check-in', () => {
    it('offers the full version when it fits', () => {
      expect(
        chooseVersion({ versions: all, checkIn: null, availableMinutesRemaining: 600 }).version,
      ).toBe('full');
    });

    it('steps down to the largest declared version that fits the budget', () => {
      expect(
        chooseVersion({ versions: all, checkIn: null, availableMinutesRemaining: 12 }),
      ).toEqual({ version: 'short', title: all.short!.title, durationMinutes: 10 });
    });

    it('never goes below the minimum, even when nothing fits', () => {
      expect(
        chooseVersion({ versions: all, checkIn: null, availableMinutesRemaining: 1 }).version,
      ).toBe('minimum');
    });

    // A budget is an estimate; it should shrink an offer, not veto one.
    it('still offers the full version when it is the only size, however tight the day', () => {
      expect(
        chooseVersion({ versions: versions(), checkIn: null, availableMinutesRemaining: 1 }),
      ).toEqual({ version: 'full', title: 'Draft the storyline', durationMinutes: 25 });
    });

    it('treats NORMAL like no check-in at all', () => {
      expect(
        chooseVersion({ versions: all, checkIn: 'NORMAL', availableMinutesRemaining: 600 }).version,
      ).toBe('full');
    });
  });
});

describe('fallbackFor (#38)', () => {
  it('offers the next smaller declared version', () => {
    expect(
      fallbackFor({ versions: all }, { version: 'full', title: '', durationMinutes: 25 }),
    ).toEqual({ title: all.short!.title, durationMinutes: 10 });

    expect(
      fallbackFor({ versions: all }, { version: 'short', title: '', durationMinutes: 10 }),
    ).toEqual({ title: all.minimum!.title, durationMinutes: 5 });
  });

  it('skips a size that was never declared', () => {
    const withoutShort = versions({ minimum: { title: 'One sentence', minutes: 5 } });

    expect(
      fallbackFor({ versions: withoutShort }, { version: 'full', title: '', durationMinutes: 25 }),
    ).toEqual({ title: 'One sentence', durationMinutes: 5 });
  });

  // PRD §28: a daily win must be possible in minutes.
  it('falls back to a five-minute start when there is nothing smaller', () => {
    expect(
      fallbackFor({ versions: all }, { version: 'minimum', title: '', durationMinutes: 5 }),
    ).toEqual(DEFAULT_FALLBACK);

    expect(
      fallbackFor({ versions: versions() }, { version: 'full', title: '', durationMinutes: 25 }),
    ).toEqual(DEFAULT_FALLBACK);
  });
});
