import * as copy from './comeback-copy';
import { isKindEnough } from './comeback-copy';

// =============================================================================
// The words this feature must not say (issue #112, epic E11)
// =============================================================================
//
// PRD §56-§57 and §129. This spec reads EVERY exported string in the copy
// module rather than a hand-listed sample, because the failure mode is somebody
// adding a twelfth template six months from now and nobody noticing that it
// says "you're behind".
//
// The deterministic copy ships on every provider outage, so a shaming template
// would reach users silently and forever.
// =============================================================================

function everyString(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    // Templates are functions; call them with plausible arguments.
    try {
      const rendered = (value as (...args: unknown[]) => unknown)('HEALTH', 'Feel strong again');
      return typeof rendered === 'string' ? [rendered] : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(everyString);
  }
  return [];
}

describe('comeback copy (#112)', () => {
  const strings = everyString(copy);

  it('has something to check', () => {
    expect(strings.length).toBeGreaterThan(5);
  });

  it.each([['overdue'], ['behind'], ['failed'], ['streak'], ['lazy'], ['guilt']])(
    'never says "%s"',
    (word) => {
      for (const text of strings) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    },
  );

  it('mentions catching up only to rule it out', () => {
    for (const text of strings) {
      if (/catch/i.test(text)) expect(text).toMatch(/no catching up/i);
    }
  });

  it('says the two sentences the epic exists to be able to say', () => {
    expect(copy.CELEBRATION_TITLE).toBe('Back on Path.');
    expect(copy.CELEBRATION_BODY).toContain('It was that you returned.');
    expect(copy.OFFER_NOTE).toBe('No catching up. We start from today.');
  });

  describe('isKindEnough, which also gates model output', () => {
    it('accepts the product’s own copy', () => {
      for (const text of strings) expect(isKindEnough(text)).toBe(true);
    });

    it('rejects the sentences a model reaches for unprompted', () => {
      expect(isKindEnough('You have 16 overdue items')).toBe(false);
      expect(isKindEnough('Time to catch up on your week')).toBe(false);
      expect(isKindEnough('Your streak is broken')).toBe(false);
      expect(isKindEnough("You're behind on Health")).toBe(false);
    });
  });
});
