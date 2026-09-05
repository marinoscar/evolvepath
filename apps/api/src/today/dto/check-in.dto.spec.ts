import { upsertCheckInSchema } from './check-in.dto';
import {
  createDayReflectionSchema,
  REFLECTION_QUICK_OPTIONS,
} from './day-reflection.dto';
import { SKIP_REASONS } from '../../commitments/dto/commitment-action.dtos';

describe('upsertCheckInSchema (#43)', () => {
  it.each(['NORMAL', 'PACKED', 'LOW_ENERGY', 'UNEXPECTED_PROBLEM'])('accepts %s', (feel) => {
    expect(upsertCheckInSchema.parse({ feel })).toEqual({ feel });
  });

  it('rejects the lowercase spelling', () => {
    expect(upsertCheckInSchema.safeParse({ feel: 'low_energy' }).success).toBe(false);
  });

  it('rejects an unknown feeling and a missing one', () => {
    expect(upsertCheckInSchema.safeParse({ feel: 'EXHAUSTED' }).success).toBe(false);
    expect(upsertCheckInSchema.safeParse({}).success).toBe(false);
  });

  // PRD §73 warns against "daily emotional interrogation"; the guard is that
  // there is nowhere in this body to put a follow-up question.
  it('has exactly one field', () => {
    expect(Object.keys(upsertCheckInSchema.shape)).toEqual(['feel']);
  });
});

describe('createDayReflectionSchema (#43)', () => {
  it('accepts an option with no text', () => {
    expect(createDayReflectionSchema.parse({ quickOption: 'PLAN_WORKED' })).toMatchObject({
      quickOption: 'PLAN_WORKED',
    });
  });

  it('rejects text longer than 1000 characters', () => {
    expect(
      createDayReflectionSchema.safeParse({ quickOption: 'TOO_MUCH', text: 'x'.repeat(1001) })
        .success,
    ).toBe(false);
  });

  it('rejects an option outside the list', () => {
    expect(createDayReflectionSchema.safeParse({ quickOption: 'TIRED' }).success).toBe(false);
  });

  // Merging the two enums would either smuggle PLAN_WORKED into the skip menu or
  // lose it here.
  it('keeps PLAN_WORKED out of the skip reasons', () => {
    expect(REFLECTION_QUICK_OPTIONS).toContain('PLAN_WORKED');
    expect(SKIP_REASONS as readonly string[]).not.toContain('PLAN_WORKED');
  });

  it('otherwise shares the vocabulary a skip uses', () => {
    for (const reason of SKIP_REASONS) {
      expect(REFLECTION_QUICK_OPTIONS as readonly string[]).toContain(reason);
    }
  });
});
