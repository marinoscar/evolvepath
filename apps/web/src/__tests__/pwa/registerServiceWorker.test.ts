import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerServiceWorker } from '../../pwa/registerServiceWorker';

// =============================================================================
// The worker must not register outside a production build (#58)
// =============================================================================
//
// `sw.js` is emitted by a build-only Vite plugin, so it does not exist under
// the dev server, under Vitest, or in the visual harness. A registration
// attempt in any of those is a 404 in the console at best; a dev worker that
// DID exist would cache Vite's modules and produce the "my change doesn't show
// up" trap.
//
// The assertion is deliberately about `navigator.serviceWorker` never being
// TOUCHED, not merely about `register` never being called: the `PROD` check
// runs first precisely so a jsdom environment without service-worker support
// never has the property read.
// =============================================================================

describe('registerServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not touch navigator.serviceWorker when PROD is false', () => {
    const read = vi.fn();
    const stubNavigator = {} as Navigator;
    Object.defineProperty(stubNavigator, 'serviceWorker', {
      get: read,
      configurable: true,
    });
    vi.stubGlobal('navigator', stubNavigator);
    vi.stubEnv('PROD', false);

    expect(() => registerServiceWorker()).not.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  // Vitest itself runs with PROD false, so this is the state every other spec
  // in the suite is in — asserted so a future change to the guard cannot
  // silently start registering during tests.
  it('is a no-op under Vitest, where PROD is false by default', () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { register } } as unknown as Navigator);

    registerServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('registers at the root scope in a production build', () => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { serviceWorker: { register } } as unknown as Navigator);
    vi.stubEnv('PROD', true);

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('warns rather than throwing when the browser refuses to register', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const register = vi.fn().mockRejectedValue(new Error('insecure origin'));
    vi.stubGlobal('navigator', { serviceWorker: { register } } as unknown as Navigator);
    vi.stubEnv('PROD', true);

    expect(() => registerServiceWorker()).not.toThrow();
    // The rejection is handled on a microtask; let it settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith('Service worker registration failed', expect.any(Error));
  });

  it('does nothing in a production build on a browser with no support', () => {
    vi.stubGlobal('navigator', {} as Navigator);
    vi.stubEnv('PROD', true);

    expect(() => registerServiceWorker()).not.toThrow();
  });
});
