import { weeklyReviewReadyEmail } from './weekly-review-ready.email';

describe('weeklyReviewReadyEmail (#54, epic E12)', () => {
  const data = {
    weekStart: '2026-08-31',
    reviewUrl: 'https://app.example.com/progress/week',
  };

  it('states what it is in the subject line', () => {
    expect(weeklyReviewReadyEmail(data).subject).toBe('Your week is ready to review');
  });

  it('names the week in both parts', () => {
    const rendered = weeklyReviewReadyEmail(data);

    expect(rendered.html).toContain('2026-08-31');
    expect(rendered.text).toContain('2026-08-31');
  });

  it('carries the CTA URL into the text part, where there is no button', () => {
    expect(weeklyReviewReadyEmail(data).text).toContain(
      'https://app.example.com/progress/week',
    );
  });

  // Every template in this directory is optional-URL, for the same reason: with
  // no APP_URL configured, a button that goes nowhere is worse than no button.
  it('omits the CTA when there is no URL', () => {
    const rendered = weeklyReviewReadyEmail({ weekStart: '2026-08-31' });

    expect(rendered.text).not.toContain('Review the week');
    expect(rendered.subject).toBe('Your week is ready to review');
  });

  it('escapes a hostile week value rather than emitting it as markup', () => {
    const rendered = weeklyReviewReadyEmail({
      weekStart: '<script>alert(1)</script>',
      reviewUrl: 'https://app.example.com/progress/week',
    });

    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  // PRD §108 and §129: the review is where you decide what next week looks
  // like, not a tally of what you missed. The copy says so out loud, because
  // this is the one coaching message a user may read a day late, out of
  // context, in an inbox next to work email.
  it('says there is nothing to catch up on', () => {
    const rendered = weeklyReviewReadyEmail(data);

    expect(rendered.text).toContain('nothing to catch up on');
    expect(rendered.text).toContain('not a scorecard');
  });

  it('marks itself transactional', () => {
    expect(weeklyReviewReadyEmail(data).headers).toBeDefined();
  });
});
