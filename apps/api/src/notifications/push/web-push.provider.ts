// =============================================================================
// The `web-push` library, behind one seam (issue #64, epic E12)
// =============================================================================
//
// The channel never imports `web-push` directly, for two reasons that are worth
// more than the indirection costs:
//
//   1. VAPID IS PROCESS-GLOBAL. `setVapidDetails` mutates module state in the
//      library, so calling it per send would make configuration a race and
//      calling it at import time would make an unconfigured deployment throw at
//      boot. Doing it once, in a constructor, with a guard, is the only shape
//      that behaves for all three of "configured", "not configured" and "tests".
//   2. PUSH IS OPTIONAL. A deployment with no VAPID keys must run normally, with
//      the push channel simply unable to reach anybody. `isConfigured()` is the
//      one place that question is asked.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription, type RequestOptions } from 'web-push';

export interface WebPushSendResult {
  ok: boolean;
  /** 404 or 410 mean the endpoint is gone for good and the row should go too. */
  gone: boolean;
  statusCode: number | null;
  error?: string;
}

@Injectable()
export class WebPushProvider {
  private readonly logger = new Logger(WebPushProvider.name);
  private readonly publicKey: string | null;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    this.publicKey = config.get<string>('webPush.publicKey') ?? null;
    const privateKey = config.get<string>('webPush.privateKey') ?? null;
    const subject = config.get<string>('webPush.subject') ?? null;

    this.configured = Boolean(this.publicKey && privateKey && subject);

    if (this.configured) {
      // `subject!` etc. are safe under the guard; the library validates the
      // shape and throws on a malformed subject, which is a boot failure we
      // want rather than a per-send surprise.
      try {
        webpush.setVapidDetails(subject as string, this.publicKey as string, privateKey as string);
      } catch (error) {
        // A malformed key pair must not take the whole API down — every other
        // channel still works. Push simply stays inactive.
        this.logger.error(
          `Web push is misconfigured and will stay inactive: ${(error as Error).message}`,
        );
        this.configured = false;
      }
    } else {
      this.logger.log(
        'Web push is not configured (WEB_PUSH_PUBLIC_KEY / _PRIVATE_KEY / _SUBJECT); ' +
          'the push channel will report no address.',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** The public key the browser needs to subscribe. Never the private one. */
  getPublicKey(): string | null {
    return this.configured ? this.publicKey : null;
  }

  async send(
    subscription: PushSubscription,
    payload: string,
    options: RequestOptions,
  ): Promise<WebPushSendResult> {
    if (!this.configured) {
      return { ok: false, gone: false, statusCode: null, error: 'Web push is not configured' };
    }

    try {
      await webpush.sendNotification(subscription, payload, options);
      return { ok: true, gone: false, statusCode: 201 };
    } catch (error) {
      const statusCode =
        typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? ((error as { statusCode: number }).statusCode)
          : null;

      return {
        ok: false,
        // 404/410 is the push service saying the endpoint will never work
        // again — the browser was uninstalled, the profile wiped, the
        // subscription revoked. Anything else may be transient.
        gone: statusCode === 404 || statusCode === 410,
        statusCode,
        error: (error as Error).message,
      };
    }
  }
}
