import { APP_NAME, html, plainText, renderLayout } from './layout';
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  type RenderedEmail,
} from './email-template.types';

// =============================================================================
// "Your week is ready to review" — `coach.weekly_review_ready` (issue #54, E12)
// =============================================================================
//
// THE ONLY COACHING CATEGORY THAT GETS AN EMAIL, and the reason is worth stating
// because it is the rule for every category added later.
//
// N1–N7 and N9 are MOMENT-BOUND. "Your workout starts in 20 minutes" is useful
// for twenty minutes and actively unhelpful after that: an email delivered late,
// or read the next morning, is a message about a moment that has gone, and the
// user cannot tell from the inbox whether it still applies. Browser and push
// deliver inside the moment or not at all, which is the honest behaviour.
//
// The weekly review is the opposite: it is a THING THAT NOW EXISTS and will
// still be there tomorrow. Reading it on a laptop, a day later, on a train, is
// a perfectly good outcome. That is what makes email the right carrier rather
// than a second-best one.
//
// The copy carries no numbers. The review itself has them, and a summary in the
// email would have to be either a duplicate of the screen (drift) or a
// selection (a judgement made before the user has seen the whole picture, which
// is exactly what a weekly review is for).
// =============================================================================

export interface WeeklyReviewReadyEmailData {
  /**
   * The Monday of the week under review, `YYYY-MM-DD`. Rendered as-is: the
   * server does not know the reader's locale conventions and a misread
   * `03/04` costs more than an unfamiliar but unambiguous ISO date.
   */
  weekStart: string;

  /**
   * Absolute URL of the review. Optional, as everywhere else in this directory:
   * with no `APP_URL` configured the layout omits the button rather than
   * rendering one that goes nowhere.
   */
  reviewUrl?: string;
}

export function weeklyReviewReadyEmail(data: WeeklyReviewReadyEmailData): RenderedEmail {
  const subject = 'Your week is ready to review';

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">
      Your review of the week beginning <strong>${data.weekStart}</strong> is
      ready in ${APP_NAME}.
    </p>
    <p style="margin:0 0 16px 0;">
      It shows what you planned against what actually happened, and the one or
      two changes worth making next week.
    </p>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      There is nothing to catch up on. The review is a place to decide what
      next week should look like, not a scorecard for the one that just ended.
    </p>
  `;

  const htmlDocument = renderLayout({
    title: subject,
    previewText: `Planned versus actual for the week of ${data.weekStart}.`,
    bodyHtml,
    ctaLabel: data.reviewUrl ? 'Review the week' : undefined,
    ctaUrl: data.reviewUrl,
  });

  // Hand-written, as the recipe requires: there is deliberately no
  // HTML-to-text helper in this repository, because a generated text part is a
  // second rendering nobody reads and therefore nobody notices breaking.
  const text = plainText({
    title: subject,
    lines: [
      `Your review of the week beginning ${data.weekStart} is ready in ${APP_NAME}.`,
      '',
      'It shows what you planned against what actually happened, and the one or two',
      'changes worth making next week.',
      '',
      'There is nothing to catch up on. The review is a place to decide what next',
      'week should look like, not a scorecard for the one that just ended.',
    ],
    ctaLabel: data.reviewUrl ? 'Review the week' : undefined,
    ctaUrl: data.reviewUrl,
  });

  return {
    subject,
    html: htmlDocument,
    text,
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
