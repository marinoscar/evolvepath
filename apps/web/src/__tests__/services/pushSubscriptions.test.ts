import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/api', () => ({
  getPushPublicKey: vi.fn(),
  createPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}));

import {
  createPushSubscription,
  deletePushSubscription,
  getPushPublicKey,
} from '../../services/api';
import {
  getPushState,
  isPushSubscribedOnThisDevice,
  PUSH_SUBSCRIBED_KEY,
  setSubscribedFlag,
  subscribeToPush,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from '../../services/pushSubscriptions';

const mockGetPublicKey = vi.mocked(getPushPublicKey);
const mockCreate = vi.mocked(createPushSubscription);
const mockDelete = vi.mocked(deletePushSubscription);

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/ABC';

/**
 * Undo `installPushCapableBrowser`.
 *
 * `vi.unstubAllGlobals()` cannot reach `navigator.serviceWorker` — it was
 * defined with `defineProperty`, not stubbed — so leaving it in place would let
 * one test's browser leak into the next and quietly turn `unsupported` into
 * something else.
 */
function uninstallPushBrowser() {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  localStorage.clear();
  vi.clearAllMocks();
}

/**
 * jsdom has neither `PushManager` nor a service worker container, which is
 * exactly the `unsupported` case — so every test that wants a working browser
 * has to build one.
 */
function installPushCapableBrowser(options: {
  permission?: NotificationPermission;
  existingSubscription?: unknown;
  registration?: unknown;
} = {}) {
  const subscription = options.existingSubscription ?? null;

  const registration = options.registration ?? {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn().mockResolvedValue({
        endpoint: ENDPOINT,
        toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
        unsubscribe: vi.fn().mockResolvedValue(true),
      }),
    },
  };

  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: options.permission ?? 'granted' });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });

  return registration as {
    pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  };
}

describe('urlBase64ToUint8Array (#64)', () => {
  // A wrong decode fails at subscribe time with an opaque
  // `InvalidCharacterError` that says nothing about which step was wrong, so
  // real vectors are worth having.
  it('decodes an unpadded base64url string', () => {
    expect(Array.from(urlBase64ToUint8Array('AQAB'))).toEqual([1, 0, 1]);
  });

  it('restores the padding base64url strips', () => {
    // 'aGk' is 'hi' with the trailing '=' removed.
    expect(Array.from(urlBase64ToUint8Array('aGk'))).toEqual([104, 105]);
  });

  it('maps the two base64url substitutions back', () => {
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('produces a real ArrayBuffer, which is what applicationServerKey wants', () => {
    expect(urlBase64ToUint8Array('AQAB').buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe('getPushState (#64)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(uninstallPushBrowser);

  // The default in jsdom, and the honest answer for an old browser.
  it('is unsupported when the browser has no PushManager', async () => {
    await expect(getPushState()).resolves.toBe('unsupported');
    expect(mockGetPublicKey).not.toHaveBeenCalled();
  });

  it('is unconfigured when the server has no VAPID key', async () => {
    installPushCapableBrowser();
    mockGetPublicKey.mockResolvedValue({ publicKey: null });

    await expect(getPushState()).resolves.toBe('unconfigured');
  });

  it('is unconfigured, not an error, when the lookup fails', async () => {
    installPushCapableBrowser();
    mockGetPublicKey.mockRejectedValue(new Error('offline'));

    await expect(getPushState()).resolves.toBe('unconfigured');
  });

  // Checked AFTER the key, so a deployment with no push never tells a user
  // their browser is blocking something that was never offered.
  it('reports a denial only once push is actually configured', async () => {
    installPushCapableBrowser({ permission: 'denied' });
    mockGetPublicKey.mockResolvedValue({ publicKey: null });
    await expect(getPushState()).resolves.toBe('unconfigured');

    mockGetPublicKey.mockResolvedValue({ publicKey: 'BKey' });
    await expect(getPushState()).resolves.toBe('denied');
  });

  it('is unsubscribed when everything is ready and nothing is registered', async () => {
    installPushCapableBrowser();
    mockGetPublicKey.mockResolvedValue({ publicKey: 'BKey' });

    await expect(getPushState()).resolves.toBe('unsubscribed');
  });

  it('is subscribed when the browser already holds a subscription', async () => {
    installPushCapableBrowser({ existingSubscription: { endpoint: ENDPOINT } });
    mockGetPublicKey.mockResolvedValue({ publicKey: 'BKey' });

    await expect(getPushState()).resolves.toBe('subscribed');
  });

  it('never throws — a private window that refuses the registration is unsubscribed', async () => {
    installPushCapableBrowser({
      registration: {
        pushManager: {
          getSubscription: vi.fn().mockRejectedValue(new Error('denied by policy')),
        },
      },
    });
    mockGetPublicKey.mockResolvedValue({ publicKey: 'BKey' });

    await expect(getPushState()).resolves.toBe('unsubscribed');
  });
});

describe('subscribeToPush (#64)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicKey.mockResolvedValue({ publicKey: 'AQAB' });
    mockCreate.mockResolvedValue({ id: 'sub-1' });
  });

  afterEach(uninstallPushBrowser);

  it('registers the browser and posts the shape the API expects', async () => {
    installPushCapableBrowser();

    await expect(subscribeToPush()).resolves.toBe('subscribed');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: ENDPOINT,
        keys: { p256dh: 'p', auth: 'a' },
      }),
    );
  });

  // Chrome refuses a subscription without it, and the promise it makes — every
  // push shows a notification — is one this app keeps anyway.
  it('always asks for a user-visible subscription', async () => {
    const registration = installPushCapableBrowser();

    await subscribeToPush();

    expect(registration.pushManager.subscribe.mock.calls[0][0]).toMatchObject({
      userVisibleOnly: true,
    });
  });

  it('remembers the device so the SSE handler stops raising a duplicate toast', async () => {
    installPushCapableBrowser();

    await subscribeToPush();

    expect(isPushSubscribedOnThisDevice()).toBe(true);
  });

  it('does nothing on a browser that cannot do it', async () => {
    await expect(subscribeToPush()).resolves.toBe('unsupported');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the server has no key', async () => {
    installPushCapableBrowser();
    mockGetPublicKey.mockResolvedValue({ publicKey: null });

    await expect(subscribeToPush()).resolves.toBe('unconfigured');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Otherwise the two sides disagree about whether this device is subscribed,
  // and the browser keeps a subscription nothing can ever deliver to.
  it('undoes the browser half when the subscription is unusable', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    installPushCapableBrowser({
      registration: {
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(null),
          subscribe: vi.fn().mockResolvedValue({
            endpoint: ENDPOINT,
            toJSON: () => ({ endpoint: ENDPOINT }),
            unsubscribe,
          }),
        },
      },
    });

    await expect(subscribeToPush()).rejects.toThrow(/incomplete/i);
    expect(unsubscribe).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('unsubscribeFromPush (#64)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(uninstallPushBrowser);

  it('unsubscribes the browser and removes the server row', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    installPushCapableBrowser({
      existingSubscription: { endpoint: ENDPOINT, unsubscribe },
    });
    mockDelete.mockResolvedValue(undefined);
    setSubscribedFlag(true);

    await expect(unsubscribeFromPush()).resolves.toBe('unsubscribed');

    expect(unsubscribe).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(ENDPOINT);
    expect(localStorage.getItem(PUSH_SUBSCRIBED_KEY)).toBeNull();
  });

  // A stale server row costs one dead push that the 410 handler cleans up. A
  // browser still subscribed after the user turned it off is a notification
  // they explicitly declined.
  it('clears the local flag even when the server call fails', async () => {
    installPushCapableBrowser({
      existingSubscription: {
        endpoint: ENDPOINT,
        unsubscribe: vi.fn().mockResolvedValue(true),
      },
    });
    mockDelete.mockRejectedValue(new Error('offline'));
    setSubscribedFlag(true);

    await expect(unsubscribeFromPush()).resolves.toBe('unsubscribed');
    expect(isPushSubscribedOnThisDevice()).toBe(false);
  });

  it('is harmless when there was no subscription', async () => {
    installPushCapableBrowser();

    await expect(unsubscribeFromPush()).resolves.toBe('unsubscribed');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
