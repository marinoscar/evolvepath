import { DISPLACEMENT_THRESHOLD, renderDisplacementNote } from './summary-copy';

describe('renderDisplacementNote', () => {
  it('renders PRD §35’s sentence with the real numbers', () => {
    expect(renderDisplacementNote({ count: 2, eveningCount: 2, weeks: 1 })).toBe(
      'Work displaced 2 evening family commitments this week. ' +
        'Do you want to protect those times more aggressively, or is the current trade-off intentional?',
    );
  });

  // "two evening family commitments" when one of them was a Saturday lunch is a
  // small lie, and the point of this sentence is that the user can check it.
  it('drops "evening" unless every displaced commitment was one', () => {
    expect(renderDisplacementNote({ count: 3, eveningCount: 1, weeks: 4 })).toContain(
      'Work displaced 3 family commitments over the last 4 weeks.',
    );
  });

  it('names the period from the number of weeks', () => {
    expect(renderDisplacementNote({ count: 2, eveningCount: 0, weeks: 1 })).toContain('this week');
    expect(renderDisplacementNote({ count: 2, eveningCount: 0, weeks: 12 })).toContain(
      'over the last 12 weeks',
    );
  });

  // The service never calls it below the threshold, but a sentence that reads
  // "1 family commitments" the day somebody lowers it is a bug waiting.
  it('is grammatical in the singular the service does not currently use', () => {
    expect(renderDisplacementNote({ count: 1, eveningCount: 1, weeks: 1 })).toContain(
      'Work displaced 1 evening family commitment this week.',
    );
  });

  it('asks rather than tells', () => {
    // "is the current trade-off intentional?" leaves room for the answer "yes",
    // which a user who chose to work late deserves (PRD §35).
    expect(renderDisplacementNote({ count: 2, eveningCount: 2, weeks: 1 })).toMatch(/\?$/);
  });

  it('fits the 280-character contract at every input the service can produce', () => {
    for (const weeks of [1, 4, 12]) {
      for (const count of [2, 99]) {
        expect(renderDisplacementNote({ count, eveningCount: count, weeks }).length)
          .toBeLessThanOrEqual(280);
      }
    }
  });

  it('keeps the threshold at two', () => {
    expect(DISPLACEMENT_THRESHOLD).toBe(2);
  });
});
