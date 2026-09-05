import { describe, it, expect } from 'vitest';

import {
  DEFAULT_RITUAL_FORM,
  ritualFormSchema,
  toRitualForm,
  toRitualInput,
} from '../../utils/ritualForm.schema';

const valid = { ...DEFAULT_RITUAL_FORM, title: 'Phone-free dinner', weekdays: [0, 2, 4] };

describe('ritualFormSchema', () => {
  it('accepts a complete ritual', () => {
    expect(ritualFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a minimum longer than the ideal', () => {
    const result = ritualFormSchema.safeParse({ ...valid, idealMinutes: 10, minimumMinutes: 45 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['minimumMinutes']);
  });

  it('rejects a recurrence with no days', () => {
    expect(ritualFormSchema.safeParse({ ...valid, weekdays: [] }).success).toBe(false);
  });

  it('rejects a cadence that is not 1, 2 or 4 weeks', () => {
    expect(ritualFormSchema.safeParse({ ...valid, everyNWeeks: 3 }).success).toBe(false);
  });

  it('rejects an empty title and a malformed time', () => {
    expect(ritualFormSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(ritualFormSchema.safeParse({ ...valid, time: '6:30' }).success).toBe(false);
  });
});

describe('toRitualInput', () => {
  it('nests the recurrence and sorts the days', () => {
    expect(toRitualInput({ ...valid, weekdays: [4, 0, 2] }).recurrence).toEqual({
      weekdays: [0, 2, 4],
      time: '18:30',
      everyNWeeks: 1,
    });
  });

  it('sends null rather than an empty string for the optional text', () => {
    const input = toRitualInput({ ...valid, purpose: '  ', fallbackBehavior: '' });

    expect(input.purpose).toBeNull();
    expect(input.fallbackBehavior).toBeNull();
  });
});

describe('toRitualForm', () => {
  it('round-trips a stored ritual', () => {
    const form = toRitualForm({
      title: 'Phone-free dinner',
      purpose: 'Be present',
      familyMemberId: 'member-1',
      recurrence: { weekdays: [0, 2, 4], time: '18:30', everyNWeeks: 2 },
      idealMinutes: 45,
      minimumMinutes: 10,
      fallbackBehavior: 'Ten phone-free minutes',
    });

    expect(form).toMatchObject({
      title: 'Phone-free dinner',
      weekdays: [0, 2, 4],
      everyNWeeks: 2,
      familyMemberId: 'member-1',
    });
    expect(ritualFormSchema.safeParse(form).success).toBe(true);
  });
});
