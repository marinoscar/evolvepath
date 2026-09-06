import { describe, expect, it } from 'vitest';

import { COMEBACK_COPY, isKindEnough, stepIndicator } from '../../utils/comebackCopy';

// =============================================================================
// The words the comeback flow must not say (issue #119, epic E11)
// =============================================================================
//
// The same guard the API holds (`comeback-copy.spec.ts`), on the same list, and
// for the same reason: the screens and the notifications are one voice, and a
// phrase that would shame somebody in a push message shames them on a page too.
//
// This reflects over every export rather than checking a hand-listed sample —
// the failure mode is somebody adding a twelfth string in six months.
// =============================================================================

function everyString(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    try {
      const rendered = (value as (...args: unknown[]) => unknown)(4);
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

describe('comeback copy (#119)', () => {
  const strings = everyString(COMEBACK_COPY);

  it('has something to check', () => {
    expect(strings.length).toBeGreaterThan(15);
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

  it('says the sentences PRD §57 and VISION §32 ask for, verbatim', () => {
    expect(COMEBACK_COPY.step1.title).toBe("You're still on the Path.");
    expect(COMEBACK_COPY.step2.title).toBe('Which area feels most important to restart?');
    expect(COMEBACK_COPY.done.title).toBe('Back on Path.');
    expect(COMEBACK_COPY.done.body).toBe(
      'The important part was not that you missed. It was that you returned.',
    );
    expect(COMEBACK_COPY.banner.title).toBe('Welcome back. No catching up.');
  });

  it('agrees with the API about what is kind', () => {
    for (const text of strings) expect(isKindEnough(text)).toBe(true);

    expect(isKindEnough('You have 16 overdue items')).toBe(false);
    expect(isKindEnough('Time to catch up on your week')).toBe(false);
    expect(isKindEnough('Your streak is broken')).toBe(false);
  });

  it('says the day count in words a person would use', () => {
    expect(COMEBACK_COPY.step1.idle(1)).toContain('The last day');
    expect(COMEBACK_COPY.step1.idle(4)).toContain('The last 4 days');
  });

  it('renders the step as readable text, not only as dots', () => {
    expect(stepIndicator(2)).toBe('Step 2 of 3');
  });
});
