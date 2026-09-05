// =============================================================================
// Web push, from the browser's side (issue #64, epic E12)
// =============================================================================
//
// Every function here is reachable only from a user gesture, and none of them is
// called on mount. That is the same rule `useBrowserNotificationPermission`
// states at length and for the same reason: subscribing triggers the browser's
// permission prompt, a denial is effectively permanent, and browsers penalise
// gestureless prompts. `getPushState` is the exception, and it is the exception
// precisely because it only ever OBSERVES.

import {
  createPushSubscription,
  deletePushSubscription,
  getPushPublicKey,
} from './api';
import type { PushState } from '../types';

/** Remembered so the SSE handler can stop raising a duplicate native toast. */
export const PUSH_SUBSCRIBED_KEY = 'push.subscribed';

/**
 * Decode a base64url VAPID key into the `Uint8Array` `pushManager.subscribe`
 * demands.
 *
 * `applicationServerKey` accepts a `BufferSource` or a base64url string, but the
 * string form is not accepted everywhere the array is, so the array is what gets
 * sent. Pure, and tested with real vectors: a wrong decode fails at subscribe
 * time with an opaque `InvalidCharacterError` that says nothing about which of
 * the two steps was wrong.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);

  // Backed by a plain `ArrayBuffer` rather than the generic `ArrayBufferLike`,
  // because `applicationServerKey` wants a `BufferSource` over one.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function supportsPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * What this browser can do about push, right now.
 *
 * NEVER PROMPTS and never throws: jsdom has no `PushManager`, a private window
 * may refuse the registration, and a server with no VAPID keys answers `null`.
 * All three are ordinary states with their own sentence on the settings page,
 * not errors.
 */
export async function getPushState(): Promise<PushState> {
  if (!supportsPush()) return 'unsupported';

  let publicKey: string | null = null;
  try {
    publicKey = (await getPushPublicKey()).publicKey;
  } catch {
    // A failed lookup is indistinguishable, from the user's point of view, from
    // a server that has no keys — and the advice is the same either way.
    return 'unconfigured';
  }
  if (!publicKey) return 'unconfigured';

  // Checked AFTER the key, so a deployment with no push configured never tells
  // a user their browser is blocking something that was never offered.
  if (Notification.permission === 'denied') return 'denied';

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'unsubscribed';

    const subscription = await registration.pushManager.getSubscription();
    return subscription ? 'subscribed' : 'unsubscribed';
  } catch {
    return 'unsubscribed';
  }
}

/**
 * Subscribe this browser. Call from a click, never from an effect.
 *
 * `userVisibleOnly: true` is not optional — Chrome refuses a subscription
 * without it, and the promise it makes (every push shows a notification) is one
 * this app keeps anyway.
 */
export async function subscribeToPush(): Promise<PushState> {
  if (!supportsPush()) return 'unsupported';

  const { publicKey } = await getPushPublicKey();
  if (!publicKey) return 'unconfigured';

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    // The browser gave us something we cannot register. Undo the local half so
    // the two sides do not disagree about whether this device is subscribed.
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error('This browser returned an incomplete push subscription.');
  }

  await createPushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  });

  setSubscribedFlag(true);
  return 'subscribed';
}

/**
 * Unsubscribe, browser side first.
 *
 * The server row is deleted second and its failure is swallowed: a stale row
 * costs one dead push that the 410 handler cleans up on its own, whereas a
 * browser still subscribed after the user turned it off is a notification they
 * explicitly declined.
 */
export async function unsubscribeFromPush(): Promise<PushState> {
  if (!supportsPush()) return 'unsupported';

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    if (subscription) {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      await deletePushSubscription(endpoint).catch(() => undefined);
    }
  } finally {
    setSubscribedFlag(false);
  }

  return 'unsubscribed';
}

/** Per-device, per-browser. Never read for anything but the toast dedupe. */
export function setSubscribedFlag(value: boolean): void {
  try {
    if (value) localStorage.setItem(PUSH_SUBSCRIBED_KEY, '1');
    else localStorage.removeItem(PUSH_SUBSCRIBED_KEY);
  } catch {
    // Private mode, or storage disabled. The consequence is one duplicate
    // toast, which is not worth an error path.
  }
}

export function isPushSubscribedOnThisDevice(): boolean {
  try {
    return localStorage.getItem(PUSH_SUBSCRIBED_KEY) === '1';
  } catch {
    return false;
  }
}
