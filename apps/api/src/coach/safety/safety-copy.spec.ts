import {
  SAFETY_CONSERVATIVE_INSTRUCTIONS,
  SAFETY_CONSERVATIVE_NOTE,
  SAFETY_REDIRECT_COPY,
} from './safety-copy';
import { SAFETY_RULES } from './safety-patterns';

// =============================================================================
// The copy rules, as tests (issue #82)
// =============================================================================
//
// PRD §81 forbids diagnosis and medication advice; §82 forbids claiming to be a
// therapist. Those are constraints on WORDS, and words drift — someone softens
// a sentence, and "you may have tendinitis" appears in a string nobody reviews
// again. These assertions are the review.
// =============================================================================

const FORBIDDEN = ['diagnos', 'prescrib', 'therapist'];

describe('safety copy (#82)', () => {
  const everyString = [
    ...Object.values(SAFETY_REDIRECT_COPY),
    SAFETY_CONSERVATIVE_INSTRUCTIONS,
    SAFETY_CONSERVATIVE_NOTE,
  ];

  it.each(FORBIDDEN)('never claims to %s', (word) => {
    for (const copy of everyString) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });

  it('covers every category a rule can produce', () => {
    // A rule whose category has no copy would redirect a user to a blank
    // message — the exact case where silence is worst.
    for (const rule of SAFETY_RULES) {
      expect(SAFETY_REDIRECT_COPY[rule.category]).toBeTruthy();
    }
  });

  it('says what it is, in every redirect', () => {
    for (const copy of Object.values(SAFETY_REDIRECT_COPY)) {
      expect(copy).toContain('behaviour coach, not a clinician');
    }
  });

  it('names emergency services without inventing a phone number', () => {
    // A wrong hotline number is worse than none, and this product does not
    // know what country the user is in.
    expect(SAFETY_REDIRECT_COPY.crisis).toContain('emergency services');
    expect(SAFETY_REDIRECT_COPY.crisis).toContain('crisis line in your country');
    expect(SAFETY_REDIRECT_COPY.crisis).not.toMatch(/\d{3}/);
  });
});
