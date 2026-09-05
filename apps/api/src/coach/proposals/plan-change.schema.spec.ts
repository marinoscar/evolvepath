import { planChangeSchema } from './plan-change.schema';

// =============================================================================
// The per-op rules (issue #76)
// =============================================================================
//
// Each of these rejects a change set that would LOOK right in a diff and do
// the wrong thing — which is the only kind of mistake this schema can prevent.
// A user reading "Reduce Strength workout" and accepting it should not end up
// with a longer session.
// =============================================================================

const base = {
  target: { type: 'routine' as const, id: '11111111-1111-4111-8111-111111111111' },
  before: null,
  after: null,
  reason: 'because',
};

const parse = (value: unknown) => planChangeSchema.safeParse(value);

describe('planChangeSchema (#76)', () => {
  describe('add', () => {
    it('accepts a titled after with no target', () => {
      expect(
        parse({
          ...base,
          op: 'add',
          target: { type: 'routine', id: null },
          after: { title: 'Saturday walk' },
        }).success,
      ).toBe(true);
    });

    it('refuses a target id', () => {
      // An `add` naming a target is a `replace` in disguise, and would apply to
      // something the user did not review.
      expect(parse({ ...base, op: 'add', after: { title: 'x' } }).success).toBe(false);
    });

    it('refuses a missing after', () => {
      expect(
        parse({ ...base, op: 'add', target: { type: 'routine', id: null } }).success,
      ).toBe(false);
    });
  });

  describe('move', () => {
    it('accepts a new preferredTime', () => {
      expect(
        parse({ ...base, op: 'move', after: { preferredTime: '09:00' } }).success,
      ).toBe(true);
    });

    it('accepts a new triggerValue', () => {
      expect(
        parse({ ...base, op: 'move', after: { triggerValue: 'SAT' } }).success,
      ).toBe(true);
    });

    it('refuses a move that moves nothing', () => {
      expect(
        parse({ ...base, op: 'move', after: { title: 'Renamed' } }).success,
      ).toBe(false);
    });

    it('refuses HH:mm that is not HH:mm', () => {
      expect(
        parse({ ...base, op: 'move', after: { preferredTime: '9am' } }).success,
      ).toBe(false);
    });
  });

  describe('reduce', () => {
    it('accepts a genuine reduction', () => {
      expect(
        parse({
          ...base,
          op: 'reduce',
          before: { estimatedDurationMin: 40 },
          after: { estimatedDurationMin: 15 },
        }).success,
      ).toBe(true);
    });

    it('refuses an increase wearing a reduce label', () => {
      // The one wrong answer a user is most likely to accept without reading:
      // it is the op they asked for, so only the number contradicts it.
      expect(
        parse({
          ...base,
          op: 'reduce',
          before: { estimatedDurationMin: 40 },
          after: { estimatedDurationMin: 60 },
        }).success,
      ).toBe(false);
    });

    it('refuses an equal duration', () => {
      expect(
        parse({
          ...base,
          op: 'reduce',
          before: { estimatedDurationMin: 40 },
          after: { estimatedDurationMin: 40 },
        }).success,
      ).toBe(false);
    });

    it('refuses a missing before', () => {
      expect(
        parse({ ...base, op: 'reduce', after: { estimatedDurationMin: 15 } }).success,
      ).toBe(false);
    });
  });

  describe('replace', () => {
    it('requires both snapshots', () => {
      expect(
        parse({ ...base, op: 'replace', after: { title: 'New' } }).success,
      ).toBe(false);
      expect(
        parse({
          ...base,
          op: 'replace',
          before: { title: 'Old' },
          after: { title: 'New' },
        }).success,
      ).toBe(true);
    });
  });

  describe('remove and pause', () => {
    it.each(['remove', 'pause'])('%s needs a target id and nothing else', (op) => {
      expect(parse({ ...base, op }).success).toBe(true);
      expect(
        parse({ ...base, op, target: { type: 'routine', id: null } }).success,
      ).toBe(false);
    });
  });

  it('requires a reason on every change', () => {
    // PRD §80 wants version history to say why, and the only moment the reason
    // exists is when the change is proposed.
    expect(parse({ ...base, op: 'remove', reason: '' }).success).toBe(false);
    expect(parse({ ...base, op: 'remove', reason: '   ' }).success).toBe(false);
    expect(parse({ ...base, op: 'remove', reason: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});
