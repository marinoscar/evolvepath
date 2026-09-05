import { lintBehaviourTitle } from './behaviour-lint';

describe('lintBehaviourTitle — titles that legislate someone else', () => {
  it.each([
    // PRD §32's own "Avoid" examples.
    ['Make spouse happier.'],
    ["Improve daughter's attitude."],
    // The variants the epic calls out.
    ['Make Mia happier'],
    ['get the kids to listen'],
    ["fix Dad's attitude"],
    ['Mia should read more'],
    ["Improve my daughter's grades"],
    ['MAKE MY WIFE CALMER'],
    // A few more of the same sentence shape.
    ['Get my son to respect his bedtime'],
    ['Teach the children better manners'],
    ['Convince my partner to be calmer about it'],
    ['The kids must listen at dinner'],
    ['Change my mother’s mood'],
  ])('rejects %s', (title) => {
    const result = lintBehaviourTitle(title);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGETS_OTHER_PERSON');
    // The match is the offending substring, so the UI can point at it.
    expect(title.toLowerCase()).toContain(result.match.toLowerCase());
    expect(result.match.length).toBeGreaterThan(0);
  });

  it('names the rule that fired', () => {
    expect(lintBehaviourTitle('Make spouse happier')).toMatchObject({ rule: 'A' });
    expect(lintBehaviourTitle("Improve daughter's attitude")).toMatchObject({ rule: 'B' });
    expect(lintBehaviourTitle('Mia should read more')).toMatchObject({ rule: 'C' });
  });
});

describe('lintBehaviourTitle — titles describing the user’s own behaviour', () => {
  it.each([
    // PRD §32's own "Good" examples.
    ['Put phone away during dinner.'],
    ['Spend 20 minutes helping child with project.'],
    ['Plan Saturday outing by Thursday.'],
    // The epic's additional passing cases.
    ['Read with Mia for 15 minutes'],
    ['Call Dad Sunday'],
    ['Help Leo with his project'],
    ['Keep Sunday morning free for the family'],
    ['Make pancakes with the kids'],
    // Ordinary family commitments that must not trip the rules.
    ['Phone-free dinner'],
    ['Sit down phone-free for the first 10 minutes'],
    ['Take the kids to the park'],
    ['Stop working at 18:00 on Tuesdays'],
    ['Get home before dinner'],
    ['Plan the weekend with my partner'],
    ['Ask Mia about her day'],
  ])('accepts %s', (title) => {
    expect(lintBehaviourTitle(title)).toEqual({ ok: true });
  });

  it('accepts a verb and a person with no state word — that is just a plan', () => {
    // "Make pancakes with the kids" is the shape rule A would over-match on if
    // the state word were optional.
    expect(lintBehaviourTitle('Make pancakes with the kids')).toEqual({ ok: true });
    expect(lintBehaviourTitle('Keep Saturday free for the family')).toEqual({ ok: true });
  });

  it('accepts an empty or whitespace-only title — Zod owns that error', () => {
    expect(lintBehaviourTitle('')).toEqual({ ok: true });
    expect(lintBehaviourTitle('   ')).toEqual({ ok: true });
  });

  it('does not treat the capitalised first word of an imperative as a name', () => {
    // Without the first-word exclusion, "Make" itself would be a "name" and
    // every properly written imperative title would look like it named a person.
    expect(lintBehaviourTitle('Make time to listen to music')).toEqual({ ok: true });
  });

  it('does not treat a weekday or month as a person', () => {
    expect(lintBehaviourTitle('Keep Saturday calm')).toEqual({ ok: true });
    expect(lintBehaviourTitle('Keep December calm')).toEqual({ ok: true });
  });
});
