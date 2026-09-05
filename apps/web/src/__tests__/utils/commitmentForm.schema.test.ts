import { describe, it, expect } from 'vitest';

import {
  commitmentFormSchema,
  defaultScheduledStart,
  toCommitmentInput,
  validateCommitmentForm,
  type CommitmentFormValues,
} from '../../utils/commitmentForm.schema';

const values = (over: Partial<CommitmentFormValues> = {}): CommitmentFormValues => ({
  domain: 'WORK',
  title: 'Draft the proposal storyline',
  outcomeId: null,
  scheduledStart: '2026-03-02T09:00',
  durationMinutes: 25,
  importance: 5,
  short: {},
  minimum: {},
  ...over,
});

describe('commitmentFormSchema', () => {
  it('accepts a commitment with no smaller versions', () => {
    expect(commitmentFormSchema.safeParse(values()).success).toBe(true);
  });

  it('requires a title', () => {
    const errors = validateCommitmentForm(values({ title: '   ' }));

    expect(errors?.title).toBe('Give it a name');
  });

  it('requires a time', () => {
    expect(validateCommitmentForm(values({ scheduledStart: '' }))?.scheduledStart).toBe(
      'Pick a time',
    );
  });

  describe('the smaller versions', () => {
    // The ordering that makes three sizes useful: a "short version" that takes
    // longer than the full one is a typo the sizer would offer to someone who
    // just said they were depleted.
    it('rejects a short version longer than the full one', () => {
      const errors = validateCommitmentForm(
        values({ durationMinutes: 20, short: { title: 'Half of it', minutes: 40 } }),
      );

      expect(errors?.['short.minutes']).toMatch(/cannot take longer than the full one/);
    });

    it('rejects a minimum longer than the short version', () => {
      const errors = validateCommitmentForm(
        values({
          durationMinutes: 40,
          short: { title: 'Half of it', minutes: 15 },
          minimum: { title: 'A sentence', minutes: 20 },
        }),
      );

      expect(errors?.['minimum.minutes']).toMatch(/longer than the short one/);
    });

    it('compares the minimum against the full one when there is no short version', () => {
      const errors = validateCommitmentForm(
        values({ durationMinutes: 10, minimum: { title: 'A sentence', minutes: 20 } }),
      );

      expect(errors?.['minimum.minutes']).toMatch(/longer than the full one/);
    });

    it('accepts a properly ordered ladder', () => {
      expect(
        validateCommitmentForm(
          values({
            durationMinutes: 40,
            short: { title: 'Half of it', minutes: 20 },
            minimum: { title: 'A sentence', minutes: 5 },
          }),
        ),
      ).toBeNull();
    });

    // A title with no duration cannot be sized against the day's budget, and a
    // duration with no title is a number the user never named.
    it('rejects half a version, in either direction', () => {
      expect(
        validateCommitmentForm(values({ short: { title: 'Half of it' } }))?.['short.minutes'],
      ).toBe('Say how long this version takes');

      expect(
        validateCommitmentForm(values({ minimum: { minutes: 5 } }))?.['minimum.title'],
      ).toBe('Give this version a name');
    });
  });

  describe('duration bounds', () => {
    it.each([0, -5, 481, 12.5])('rejects %s minutes', (durationMinutes) => {
      expect(commitmentFormSchema.safeParse(values({ durationMinutes })).success).toBe(false);
    });

    it.each([1, 5, 480])('accepts %i minutes', (durationMinutes) => {
      expect(commitmentFormSchema.safeParse(values({ durationMinutes })).success).toBe(true);
    });
  });

  it('reports one message per field rather than a stack of three', () => {
    const errors = validateCommitmentForm(values({ title: '', durationMinutes: 0 }));

    expect(Object.keys(errors ?? {}).sort()).toEqual(['durationMinutes', 'title']);
  });
});

describe('toCommitmentInput', () => {
  it('sends the local time as an instant', () => {
    const input = toCommitmentInput(values({ scheduledStart: '2026-03-02T09:00' }));

    expect(input.scheduledStart).toBe(new Date('2026-03-02T09:00').toISOString());
  });

  // Repeating the title in a second field would be busywork.
  it('uses the commitment title as the full version', () => {
    const input = toCommitmentInput(values());

    expect(input.fullVersion).toBe('Draft the proposal storyline');
    expect(input.fullMinutes).toBe(25);
  });

  it('sends null rather than empty strings for versions nobody declared', () => {
    const input = toCommitmentInput(values());

    expect(input.shortVersion).toBeNull();
    expect(input.shortMinutes).toBeNull();
    expect(input.minimumVersion).toBeNull();
    expect(input.minimumMinutes).toBeNull();
  });

  it('carries the declared versions through', () => {
    const input = toCommitmentInput(
      values({
        durationMinutes: 40,
        short: { title: 'Half of it', minutes: 20 },
        minimum: { title: 'A sentence', minutes: 5 },
      }),
    );

    expect(input).toMatchObject({
      shortVersion: 'Half of it',
      shortMinutes: 20,
      minimumVersion: 'A sentence',
      minimumMinutes: 5,
    });
  });

  it('trims what the user typed', () => {
    expect(toCommitmentInput(values({ title: '  Draft it  ' })).title).toBe('Draft it');
  });
});

describe('defaultScheduledStart', () => {
  it('is the next full hour', () => {
    expect(defaultScheduledStart(new Date('2026-03-02T09:17:00'))).toBe('2026-03-02T10:00');
  });

  it('rolls into the next day at the end of one', () => {
    expect(defaultScheduledStart(new Date('2026-03-02T23:30:00'))).toBe('2026-03-03T00:00');
  });
});
