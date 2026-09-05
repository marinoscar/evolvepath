/**
 * Registers the app-shell service worker — in production builds only.
 *
 * THE `PROD` GUARD IS THE WHOLE ISOLATION STORY. `sw.js` is emitted by
 * `build/appShellServiceWorker.ts`, which is `apply: 'build'` — it does not
 * exist under the Vite dev server, under Vitest, or in the visual harness. A
 * registration attempt in any of those would 404, and a dev-mode worker that
 * DID exist would cache Vite's modules, which is the classic "my change
 * doesn't show up" trap.
 *
 * The guard ORDER matters as much as the guard: `PROD` is checked before
 * `navigator.serviceWorker`, so a jsdom environment never has the property
 * read at all. `registerServiceWorker.test.ts` asserts exactly that.
 *
 * FAILURES ARE WARNINGS, NEVER THROWS. A browser that refuses to register
 * (private mode, a policy, an insecure origin) still has a perfectly working
 * app — the worker is an optimisation and a prerequisite for E12-04's push
 * handler, not a dependency of anything the user does today.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('Service worker registration failed', error);
  });
}
