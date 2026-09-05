// =============================================================================
// The copywriter (issue #59, epic E12)
// =============================================================================
//
// PRD §14.7: this persona "does not decide whether notification limits may be
// violated". It is called ONLY on a decision that already said yes, it receives
// none of the inputs that decision was made from, and its output is used only
// if it survives three checks. The strongest statement of that boundary is the
// signature: `write()` takes a candidate and a context, and there is no
// parameter through which it could express an opinion about sending.
//
// WHAT IT IS ACTUALLY FOR. The deterministic copy is already specific and
// useful — see `copy-templates.ts`. What it cannot be is PERSONAL: it does not
// know that this user asked for a direct tone, that the last two reminders for
// this commitment said the same thing, or that they are three days into a
// comeback. Those are the inputs here, and they are the whole justification for
// spending a model call on a two-line message.
//
// THREE GATES ON THE OUTPUT, and the failure of any one is silent:
//
//   1. `ok: false` from the gateway — no key, provider down, timeout. The
//      commonest by far is `no_user_key`, which is the NORMAL state for a user
//      who has not brought a key; it is not an error and is not logged as one.
//   2. Schema failure — the gateway validates, including the length caps.
//   3. A banned phrase (PRD §129). Prompting a model not to shame someone is a
//      request; checking is the guarantee.
//
// Every failure yields the template copy with `source: 'template'`, so a
// notification always goes out. PRD §120 in its narrowest form: the coach's
// words are the optional part, never the message.

import { Injectable, Logger } from '@nestjs/common';

import { AiGatewayService } from '../../ai/gateway/ai-gateway.service';
import type { CoachingCategory, CoachingCopy, CoachingEventKey } from '../coaching-events';
import { findBannedPhrase } from './banned-phrases';
import { defaultCopyFor } from './copy-templates';
import {
  NOTIFICATION_COPY_PROMPT_VERSION,
  NOTIFICATION_COPY_SCHEMA_NAME,
  notificationCopySchema,
} from './notification-copy.schema';

export interface CopywriterContext {
  userId: string;
  /** E04-01's per-user tone. The single biggest lever on this copy. */
  coachingStyle: string;
  domainMode: string | null;
  /**
   * The last few titles this commitment has already produced. Given so the
   * model can avoid saying the same thing a third time — the specific failure
   * that makes a reminder channel feel automated.
   */
  priorTitles: string[];
  journeyState: string | null;
}

export interface WrittenCopy {
  copy: CoachingCopy;
  source: 'ai' | 'template';
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  GENTLE: 'Warm and unhurried. No imperatives. Never imply the user is behind.',
  BALANCED: 'Plain and friendly. No cheerleading, no lecturing.',
  DIRECT: 'Short and imperative. No softeners, no encouragement, no exclamation marks.',
};

export function buildCopyInstructions(coachingStyle: string): string {
  return [
    'You rewrite one already-approved notification into shorter, more personal copy.',
    'The decision to send has already been made by a separate deterministic system.',
    'Keep the same meaning and the same action as the default copy you are given.',
    'Use only facts present in the input. Never invent commitments, numbers or history.',
    'Never imply disappointment, never threaten, never guilt the user about people they',
    'love, never frame opting out as failure, never create urgency that is not real, and',
    'never imply that the app is hurt or offended when it is ignored.',
    'Do not mention notifications, reminders, limits or settings.',
    'No emoji.',
    'Return a title of at most 60 characters, a body of at most 140, and an action label',
    'of at most 20.',
    STYLE_INSTRUCTIONS[coachingStyle] ?? STYLE_INSTRUCTIONS.BALANCED,
  ].join(' ');
}

@Injectable()
export class NotificationCopywriterService {
  private readonly logger = new Logger(NotificationCopywriterService.name);

  constructor(private readonly ai: AiGatewayService) {}

  async write(
    eventKey: CoachingEventKey,
    category: CoachingCategory,
    payload: Record<string, unknown>,
    context: CopywriterContext,
  ): Promise<WrittenCopy> {
    const fallback = defaultCopyFor(eventKey, payload);

    const result = await this.ai.invoke({
      persona: 'notification_copywriter',
      userId: context.userId,
      promptVersion: NOTIFICATION_COPY_PROMPT_VERSION,
      instructions: buildCopyInstructions(context.coachingStyle),
      input: JSON.stringify({
        category,
        eventKey,
        // Deliberately NOT the policy, the caps, the history counts or anything
        // about other users. The model gets the message and the person's tone,
        // and nothing it could use to argue about whether to send.
        payload,
        domainMode: context.domainMode,
        priorTitles: context.priorTitles,
        journeyState: context.journeyState,
        defaultCopy: fallback,
      }),
      schema: notificationCopySchema,
      schemaName: NOTIFICATION_COPY_SCHEMA_NAME,
      maxOutputTokens: 200,
    });

    if (!result.ok) {
      // `no_user_key` is the normal state for a user who has not brought a key,
      // so this is debug, not warn. A channel that logged a warning per
      // notification for every BYOK-less user would drown the real failures.
      this.logger.debug(
        `notification copy fell back to the template for '${eventKey}': ${result.error.code}`,
      );
      return { copy: fallback, source: 'template' };
    }

    const banned =
      findBannedPhrase(result.output.title) ??
      findBannedPhrase(result.output.body) ??
      findBannedPhrase(result.output.actionLabel);

    if (banned) {
      // Worth a warning: the model produced something the product has said it
      // will never say, and the prompt version is what makes that actionable.
      this.logger.warn(
        `Rejected AI notification copy for '${eventKey}' (${NOTIFICATION_COPY_PROMPT_VERSION}): ` +
          `banned phrase '${banned}'.`,
      );
      return { copy: fallback, source: 'template' };
    }

    return { copy: result.output, source: 'ai' };
  }
}
