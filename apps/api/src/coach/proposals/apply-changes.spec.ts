import {
  applyChanges,
  tempRoutineId,
  type PlanVersionSnapshot,
} from './apply-changes';
import type { PlanChange } from './plan-change.schema';

// =============================================================================
// applyChanges (issue #76, epic E06)
// =============================================================================
//
// This function is called twice per proposal — once to render the preview and
// once to apply what the user accepted — so the two properties that matter
// most are the boring ones: it is deterministic, and it does not touch its
// input. A snapshot mutated here would corrupt rows the caller is about to
// re-read inside a transaction.
// =============================================================================

const ROUTINE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const snapshot = (over: Partial<PlanVersionSnapshot> = {}): PlanVersionSnapshot => ({
  routines: [
    {
      id: ROUTINE_ID,
      title: 'Strength workout',
      domain: 'HEALTH',
      sortOrder: 0,
      triggerType: 'TIME',
      triggerValue: 'WED',
      frequency: 'WEEKLY',
      daysOfWeek: [3],
      preferredTime: '18:30',
      estimatedDurationMin: 40,
      minimumDurationMin: 10,
      fallbackBehavior: 'Ten minutes of mobility',
      active: true,
    },
  ],
  futureCommitments: [
    {
      id: 'c1',
      routineId: ROUTINE_ID,
      title: 'Strength workout',
      scheduledStart: '2026-09-09T18:30:00.000Z',
    },
    {
      id: 'c2',
      routineId: ROUTINE_ID,
      title: 'Strength workout',
      scheduledStart: '2026-09-16T18:30:00.000Z',
    },
  ],
  expectedWeeklyLoad: 120,
  fallbackStrategy: null,
  ...over,
});

const change = (over: Partial<PlanChange>): PlanChange =>
  ({
    op: 'move',
    target: { type: 'routine', id: ROUTINE_ID },
    before: null,
    after: null,
    reason: 'The schedule changed',
    ...over,
  }) as PlanChange;

describe('applyChanges (#76)', () => {
  describe('move', () => {
    const moveToSaturday = change({
      op: 'move',
      after: { preferredTime: '09:00', triggerValue: 'SAT', daysOfWeek: [6] },
      reason: 'Wednesday evenings stopped working',
    });

    it('produces one diff entry naming the fields that actually move', () => {
      const result = applyChanges(snapshot(), [moveToSaturday]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].target.title).toBe('Strength workout');
      expect(result.diff[0].fields).toEqual([
        { field: 'triggerValue', before: 'WED', after: 'SAT' },
        { field: 'daysOfWeek', before: [3], after: [6] },
        { field: 'preferredTime', before: '18:30', after: '09:00' },
      ]);
    });

    it('reschedules every future commitment of the routine', () => {
      const result = applyChanges(snapshot(), [moveToSaturday]);
      if (!result.ok) throw new Error('expected ok');

      // Rescheduled, not cancelled-and-recreated: the ids carry any evidence
      // and reflections already attached to them (PRD §103).
      expect(result.commitmentEffects).toEqual([
        {
          commitmentId: 'c1',
          effect: 'reschedule',
          to: { preferredTime: '09:00', triggerValue: 'SAT' },
        },
        {
          commitmentId: 'c2',
          effect: 'reschedule',
          to: { preferredTime: '09:00', triggerValue: 'SAT' },
        },
      ]);
    });

    it('leaves commitments belonging to other routines alone', () => {
      const withOther = snapshot({
        futureCommitments: [
          { id: 'c9', routineId: OTHER_ID, title: 'Other', scheduledStart: '2026-09-10T09:00:00.000Z' },
        ],
      });

      const result = applyChanges(withOther, [moveToSaturday]);
      if (!result.ok) throw new Error('expected ok');

      expect(result.commitmentEffects).toEqual([]);
    });
  });

  it('reduces a routine and reports the new duration', () => {
    const result = applyChanges(snapshot(), [
      change({
        op: 'reduce',
        before: { estimatedDurationMin: 40 },
        after: { estimatedDurationMin: 15 },
        reason: 'Shorter sessions are getting done',
      }),
    ]);
    if (!result.ok) throw new Error('expected ok');

    expect(result.next.routines[0].estimatedDurationMin).toBe(15);
    expect(result.diff[0].fields).toEqual([
      { field: 'estimatedDurationMin', before: 40, after: 15 },
    ]);
    // A shorter session is still a session: nothing is cancelled.
    expect(result.commitmentEffects).toEqual([]);
  });

  it('removes a routine and cancels what it had scheduled', () => {
    const result = applyChanges(snapshot(), [
      change({ op: 'remove', reason: 'Not doing this any more' }),
    ]);
    if (!result.ok) throw new Error('expected ok');

    expect(result.next.routines).toEqual([]);
    expect(result.commitmentEffects.map((e) => e.effect)).toEqual([
      'cancel',
      'cancel',
    ]);
  });

  it('pauses a routine without removing it', () => {
    const result = applyChanges(snapshot(), [
      change({ op: 'pause', reason: 'Back in a few weeks' }),
    ]);
    if (!result.ok) throw new Error('expected ok');

    // The routine survives so the plan still says what the user intends to
    // return to; only its occurrences go.
    expect(result.next.routines).toHaveLength(1);
    expect(result.next.routines[0].active).toBe(false);
    expect(result.commitmentEffects.map((e) => e.effect)).toEqual([
      'cancel',
      'cancel',
    ]);
  });

  it('adds a routine under a placeholder id the service replaces', () => {
    const result = applyChanges(snapshot(), [
      change({
        op: 'add',
        target: { type: 'routine', id: null },
        after: { title: 'Saturday walk', preferredTime: '09:00', estimatedDurationMin: 30 },
        reason: 'Something easy to keep the week alive',
      }),
    ]);
    if (!result.ok) throw new Error('expected ok');

    // A placeholder rather than a generated uuid: the preview must be the same
    // object on a refresh, and a uuid would change under the reader.
    expect(result.next.routines[1].id).toBe(tempRoutineId(0));
    expect(result.next.routines[1].domain).toBe('HEALTH');
  });

  describe('errors', () => {
    it('reports an unknown target with its index', () => {
      const result = applyChanges(snapshot(), [
        change({ op: 'reduce', target: { type: 'routine', id: OTHER_ID }, before: { estimatedDurationMin: 40 }, after: { estimatedDurationMin: 20 } }),
      ]);

      expect(result).toEqual({
        ok: false,
        errors: [
          {
            index: 0,
            code: 'target_not_found',
            message: `No routine ${OTHER_ID} in the active version`,
          },
        ],
      });
    });

    it('refuses two changes to the same routine', () => {
      const result = applyChanges(snapshot(), [
        change({ op: 'move', after: { preferredTime: '09:00' } }),
        change({ op: 'reduce', before: { estimatedDurationMin: 40 }, after: { estimatedDurationMin: 20 } }),
      ]);

      // Two ops on one routine cannot be shown as one reviewable sentence, and
      // the order they would apply in is not something the user chose.
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].code).toBe('duplicate_target');
      expect(result.errors[0].index).toBe(1);
    });

    it('refuses a change that would change nothing', () => {
      const result = applyChanges(snapshot(), [
        change({ op: 'move', after: { preferredTime: '18:30' } }),
      ]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].code).toBe('nothing_changes');
    });

    it('refuses an add with no title', () => {
      const result = applyChanges(snapshot(), [
        change({
          op: 'add',
          target: { type: 'routine', id: null },
          after: { preferredTime: '09:00' },
        }),
      ]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].code).toBe('invalid_after');
    });

    it('returns every error before writing anything, not just the first', () => {
      const result = applyChanges(snapshot(), [
        change({ op: 'reduce', target: { type: 'routine', id: OTHER_ID }, before: { estimatedDurationMin: 40 }, after: { estimatedDurationMin: 20 } }),
        change({ op: 'add', target: { type: 'routine', id: null }, after: {} }),
      ]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.index)).toEqual([0, 1]);
    });
  });

  it('is deterministic', () => {
    const changes = [
      change({ op: 'move', after: { preferredTime: '09:00', triggerValue: 'SAT' } }),
    ];

    expect(applyChanges(snapshot(), changes)).toEqual(
      applyChanges(snapshot(), changes),
    );
  });

  it('never mutates the snapshot it was given', () => {
    const input = snapshot();
    const before = JSON.parse(JSON.stringify(input));

    applyChanges(input, [
      change({ op: 'remove', reason: 'gone' }),
    ]);

    // The caller re-reads these rows inside a transaction; a mutation here
    // would silently rewrite what accept is about to persist.
    expect(input).toEqual(before);
  });

  it('preserves the order of the changes it was given', () => {
    const withTwo = snapshot({
      routines: [
        ...snapshot().routines,
        { ...snapshot().routines[0], id: OTHER_ID, title: 'Evening walk', sortOrder: 1 },
      ],
    });

    const result = applyChanges(withTwo, [
      change({ op: 'pause', target: { type: 'routine', id: OTHER_ID }, reason: 'later' }),
      change({ op: 'move', after: { preferredTime: '09:00' }, reason: 'earlier' }),
    ]);
    if (!result.ok) throw new Error('expected ok');

    expect(result.diff.map((d) => d.op)).toEqual(['pause', 'move']);
  });
});
