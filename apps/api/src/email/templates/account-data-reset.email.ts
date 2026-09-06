import { APP_NAME, SafeHtml, html, plainText, renderLayout } from './layout';
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  type RenderedEmail,
} from './email-template.types';

// =============================================================================
// "Your data was reset" template — `account.data_reset` (epic #220)
// =============================================================================
//
// The second `mandatory: true` message in this application, after
// `role-changed.email.ts`, and it is written for the same reader that one is:
// somebody who may not have done the thing this message describes.
//
// -----------------------------------------------------------------------------
// 1. THERE IS NO BEFORE/AFTER TABLE, AND THAT IS THE DIFFERENCE FROM
//    `role-changed.email.ts`
// -----------------------------------------------------------------------------
//
// The role template shows a delta because the delta is the alertable fact — a
// silent demotion and a silent promotion look identical without it. Here the
// "after" is EMPTY, for thirty-odd tables at once, and a table of thirty rows
// all reading "0" communicates nothing a sentence does not. Worse, it would
// re-present the numbers as an inventory of what the reader has lost, at the
// exact moment they can do nothing about it — which is the shape of message
// VISION forbids. So this states in plain language what went and, more usefully,
// WHAT SURVIVED: the account itself, which is the thing a worried reader is
// actually asking about.
//
// The counts do exist, in the HTTP response the caller already saw and in the
// `account:reset` audit row an operator can read. They do not need to be in an
// email nobody can act on.
//
// -----------------------------------------------------------------------------
// 2. IT DOES NOT NAME THE ACTOR — FOR A STRONGER REASON THAN THE ROLE TEMPLATE
//    HAS
// -----------------------------------------------------------------------------
//
// `role-changed.email.ts` omits the administrator to avoid disclosing an
// internal identity into an adversarial reading. Here there is no third party
// to name at all: `POST /api/account/reset` is resolved entirely from
// `@CurrentUser()`, so "who did this" is always the account holder, and almost
// always means "you, moments ago".
//
// Which is exactly why the closing line matters. The ONE case this message
// exists for is the case where "you" is wrong — a session left open on a shared
// machine, a token somebody else is holding — and that reader needs a sentence
// telling them what to do, not an attribution that would only confirm their own
// name back to them.
//
// -----------------------------------------------------------------------------
// 3. THE KEY SENTENCE IS CONDITIONAL, BECAUSE THE TWO SCOPES DIFFER IN A WAY
//    THE READER WILL NOTICE
// -----------------------------------------------------------------------------
//
// After `data` the application still has their OpenAI key and will work
// immediately; after `data_and_key` it will ask for one before anything else.
// A reader who is not told which happened cannot tell a working application
// from a broken one. Both branches say the key at OpenAI itself is untouched,
// because "my key was deleted" reads as "at OpenAI" to most people, and that
// misreading sends them to revoke and reissue a credential for no reason.
// =============================================================================

/**
 * Everything the data-reset message renders.
 *
 * `resetAt` is PASSED IN rather than read from `new Date()` here, per the same
 * rule the other templates follow: a template that reads the clock is not a
 * pure function of its input, and "what exactly did we send?" stops being
 * answerable after the fact — which for a message about an irreversible action
 * is the whole value of having sent it.
 */
export interface AccountDataResetEmailData {
  /** The account whose data was erased. Stated so a reader with several knows which. */
  recipientEmail: string;

  /** Which scope ran. Decides the OpenAI-key sentence; see note 3 above. */
  scope: 'data' | 'data_and_key';

  /**
   * Whether the stored OpenAI key was actually removed. Carried separately
   * from `scope` rather than derived from it, so the message reports what the
   * reset DID rather than what it was asked to do.
   */
  aiKeyRemoved: boolean;

  /** When the reset ran. Rendered as UTC; see `formatTimestamp`. */
  resetAt: Date;

  /**
   * Absolute URL of the application root, for the CTA. Optional, as everywhere
   * else: with no `APP_URL` configured the layout omits the button rather than
   * rendering one that goes nowhere.
   */
  appUrl?: string;
}

/**
 * ISO 8601, in UTC, with the `Z` left on — the same choice, for the same
 * reason, as every other template here: the server does not know the reader's
 * time zone, and this timestamp's job is to be matched against an audit row or
 * a log line, both of which are UTC.
 */
function formatTimestamp(value: Date): string {
  return value.toISOString();
}

/** One labelled fact. `value` is escaped by the `html` tag. */
function factRow(label: string, value: string): SafeHtml {
  return html`<tr>
    <td
      style="padding:6px 16px 6px 0;font-size:14px;line-height:20px;color:#4b5563;white-space:nowrap;vertical-align:top;"
    >
      ${label}
    </td>
    <td style="padding:6px 0;font-size:14px;line-height:20px;color:#1f2937;vertical-align:top;">
      <strong>${value}</strong>
    </td>
  </tr>`;
}

/**
 * Render the data-reset message.
 */
export function accountDataResetEmail(
  data: AccountDataResetEmailData,
): RenderedEmail {
  const timestamp = formatTimestamp(data.resetAt);

  const keySentence = data.aiKeyRemoved
    ? `Your saved OpenAI key was removed as well, so ${APP_NAME} will ask you for one the next time you open it. Your key at OpenAI itself was not deleted.`
    : `Your saved OpenAI key was kept, so ${APP_NAME} is ready to use straight away.`;

  const subject = `Your ${APP_NAME} data was reset`;

  const rows: SafeHtml[] = [
    factRow('Account', data.recipientEmail),
    factRow('Reset at', timestamp),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">
      Everything you had built in ${APP_NAME} was erased: your Best Self
      profile, your outcomes and plans, your commitments and the evidence
      behind them, your coach conversations and everything the coach
      remembered, your weekly reviews, your family rituals, your workouts, and
      any photos you had uploaded. This cannot be undone.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${rows}
    </table>
    <p style="margin:0 0 16px 0;">
      <strong>Your account was not deleted.</strong> Your sign-in, your email
      address and your access are all unchanged, and you are still signed in on
      every device you were signed in on before. ${keySentence}
    </p>
    <p style="margin:0 0 16px 0;">
      When you are ready, you can start again from the beginning — there is no
      hurry, and nothing here is waiting on you.
    </p>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      If you did not do this, contact an administrator now. This notification
      cannot be turned off, because losing your data should never be silent.
    </p>
  `;

  const htmlDocument = renderLayout({
    title: 'Your data was reset',
    // The preheader carries the one thing a worried reader most needs from the
    // inbox list, without opening anything: the account survived.
    previewText: `Everything you had built was erased at ${timestamp}. Your account itself was not deleted.`,
    bodyHtml,
    ctaLabel: data.appUrl ? `Open ${APP_NAME}` : undefined,
    ctaUrl: data.appUrl,
  });

  const text = plainText({
    title: 'Your data was reset',
    lines: [
      `Everything you had built in ${APP_NAME} was erased: your Best Self profile,`,
      'your outcomes and plans, your commitments and the evidence behind them, your',
      'coach conversations and everything the coach remembered, your weekly reviews,',
      'your family rituals, your workouts, and any photos you had uploaded.',
      'This cannot be undone.',
      '',
      `  Account:   ${data.recipientEmail}`,
      `  Reset at:  ${timestamp}`,
      '',
      'Your account was not deleted. Your sign-in, your email address and your access',
      'are all unchanged, and you are still signed in on every device you were signed',
      'in on before.',
      keySentence,
      '',
      'When you are ready, you can start again from the beginning — there is no hurry,',
      'and nothing here is waiting on you.',
      '',
      'If you did not do this, contact an administrator now. This notification cannot',
      'be turned off, because losing your data should never be silent.',
    ],
    ctaLabel: data.appUrl ? `Open ${APP_NAME}` : undefined,
    ctaUrl: data.appUrl,
  });

  return {
    subject,
    html: htmlDocument,
    text,
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
