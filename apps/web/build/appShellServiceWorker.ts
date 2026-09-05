import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

// =============================================================================
// The app-shell service worker, generated from the real build output (#58)
// =============================================================================
//
// WHY THIS IS A LOCAL PLUGIN AND NOT `vite-plugin-pwa`.
//
// The plugin was the first choice, and its central argument is right: a
// precache list has to name the build's HASHED asset filenames, and those
// change every build — so a hand-written list is stale the first time anybody
// deploys. That argument is honoured below by DERIVING the list from the
// finished bundle, which is exactly what the plugin does.
//
// What could not be honoured is the plugin itself. It pulls in `workbox-build`,
// whose bundling step reaches `@rollup/plugin-replace` and
// `@trickfilm400/rollup-plugin-off-main-thread`; both are CommonJS and both
// `require('magic-string')`. This repo's root `package.json` carries a
// tree-wide `"magic-string": "^1.2.0"` override, and magic-string 1.x is
// ESM-ONLY — so `require()` hands those two packages a module namespace where
// they expect a constructor, and the build dies with `MagicString is not a
// constructor`. Narrowing the override to `workbox-build`'s subtree does not
// help: npm's top-level rule wins over the nested one. Removing it entirely
// would change the dependency tree for the API and CLI builds too, which is a
// far larger change than a PWA baseline should make. Issue #58 anticipates
// this case and says to fall back to a small Vite plugin, which is this file.
//
// WHAT THIS WORKER DOES, AND WHAT IT REFUSES TO DO
// -----------------------------------------------
//
//   * PRECACHE: the app shell only — `index.html` plus the hashed JS, CSS and
//     WOFF2 the build emitted, plus the manifest and icons.
//   * NAVIGATIONS: network first, falling back to the cached `index.html`.
//     Network-first (rather than cache-first) is deliberate: a cache-first
//     navigation serves the OLD shell for one more load after every deploy,
//     and the user experiences that as "the update didn't apply".
//   * SAME-ORIGIN STATIC ASSETS: cache first. They are content-hashed, so a
//     hit can never be stale.
//   * EVERYTHING ELSE, `/api/*` INCLUDED: passthrough. Never read from the
//     cache, never written to it.
//
// That last rule is a SECURITY property, not a performance choice. A cached
// API response is a user's own data sitting in a shared browser cache: it
// survives logout, it is served to whoever opens the app next on that device,
// and it is invisible to every session check the app makes. Offline DATA is
// E09-08's problem and will be solved deliberately — a worker that quietly
// starts answering `/api/auth/me` from disk is not a feature anybody reviewed.
//
// UPDATE SEMANTICS. `CACHE_NAME` embeds a hash of the precache list, so a
// build that changes any shell asset produces a new cache name; `activate`
// deletes every cache that is not the current one, and `skipWaiting` +
// `clients.claim()` make the new worker take over immediately. Combined with
// nginx serving `/sw.js` as `no-cache` (see `nginx.conf`), a deploy reaches
// the user on their next navigation.
//
// E12-04 (#64) EXTENDS THIS FILE by adding `push` and `notificationclick`
// listeners to the template below. There is no build-tool configuration to
// change for that, which is the one thing a hand-written worker is better at
// than a generated one.
// =============================================================================

/** Shell assets worth precaching. Deliberately not images or source maps. */
const PRECACHE_EXTENSIONS = ['.js', '.css', '.html', '.woff2'];

/**
 * Files that are NOT part of the Rollup graph and so never appear in
 * `generateBundle`'s output — `index.html` (emitted by Vite's own HTML
 * handling) and everything copied verbatim from `public/`.
 *
 * `/index.html` is the load-bearing one: it is what the navigation fallback
 * serves when the network is gone, so a worker without it precached is a
 * worker that does nothing useful offline. `swPrecacheIncludes` in the spec
 * asserts it is present for exactly that reason.
 */
const EXTRA_PRECACHE = [
  '/',
  '/index.html',
  '/fonts/Inter-latin-variable.woff2',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/fonts/inter.css',
];

function renderWorker(precache: string[], cacheName: string): string {
  return `/*
 * GENERATED FILE — do not edit.
 *
 * Produced at build time by \`apps/web/build/appShellServiceWorker.ts\`, which
 * is where the behaviour below is explained. The precache list is derived from
 * the actual bundle, so it can never name an asset this build did not emit.
 */
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // \`{ cache: 'reload' }\` so the install fetches from the network rather
      // than from the HTTP cache, which may still hold the previous deploy.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is ever cacheable, and only our own origin.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // THE API IS NEVER CACHED AND NEVER SERVED FROM CACHE. See the generator's
  // header: a cached API response is the user's data outliving their session.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, cached shell as the offline fallback. Serving
  // the cached shell first would show the previous deploy for one more load.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html', { cacheName: CACHE_NAME }).then(
          (cached) =>
            cached ??
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
        ),
      ),
    );
    return;
  }

  // Static assets: cache first. They are content-hashed, so a hit is never
  // stale. A miss falls through to the network and is not written back —
  // anything worth caching was precached at install.
  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cached) => cached ?? fetch(request)),
  );
});

// ===========================================================================
// Web push (#64, epic E12)
// ===========================================================================
//
// PRD §123: the moment of action is rarely one with the app open. Everything
// above serves a page that is being looked at; everything below is what reaches
// somebody who is not looking.
//
// Three handlers, and the third is the one that is easy to leave out:
// \`notificationclose\` is the only place a user's "no, not this" is observable
// at all, and it fires with no page, no session and no token — which is why the
// endpoint it calls is the one public route in the epic.

function isInternalPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  );
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    // A malformed payload is not something the user can act on and not
    // something a notification can usefully say. Dropping it is better than
    // showing "undefined".
    return;
  }

  if (!payload || typeof payload.title !== 'string') return;

  const actions = Array.isArray(payload.actions) ? payload.actions : [];

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      // The decision's id, so a re-send about the same moment REPLACES the
      // banner rather than stacking a second one beside it.
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      renotify: false,
      data: {
        link: payload.link,
        actions,
        sentInteractionId: payload.sentInteractionId,
      },
      actions: actions
        .slice(0, 2)
        .map((action) => ({ action: action.action, title: action.label })),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const chosen = event.action
    ? (data.actions || []).find((action) => action.action === event.action)
    : null;
  const link = chosen ? chosen.link : data.link;

  // The server validates this on the way in (\`sanitizeLink\`), and the worker
  // validates it again on the way out. A push payload arrives over a channel
  // this app does not control end to end, and \`clients.openWindow\` with an
  // attacker-chosen URL is a redirect out of the application.
  if (!isInternalPath(link)) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open tab rather than opening a second one: the user has one
        // app, and a duplicate tab loses whatever they had on screen.
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.focus().then((focused) => focused.navigate(link));
          }
        }
        return self.clients.openWindow(link);
      })
      .catch(() => undefined),
  );
});

self.addEventListener('notificationclose', (event) => {
  const id = (event.notification.data || {}).sentInteractionId;
  if (typeof id !== 'string') return;

  // No credentials, and none needed: the UUID is the capability, and the route
  // answers 204 whatever happens. Failures are ignored because there is nobody
  // to tell — the notification is already gone.
  event.waitUntil(
    fetch('/api/notifications/interactions/dismissed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentInteractionId: id }),
    }).catch(() => undefined),
  );
});
`;
}

/**
 * Emits `sw.js` alongside the bundle it describes.
 *
 * Build-only: `apply: 'build'` keeps it out of the dev server entirely, so a
 * dev-mode worker can never cache Vite's modules — the classic "my change
 * doesn't show up" trap.
 */
export function appShellServiceWorker(): Plugin {
  return {
    name: 'app-shell-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const emitted = Object.keys(bundle)
        .filter((fileName) => PRECACHE_EXTENSIONS.some((ext) => fileName.endsWith(ext)))
        .map((fileName) => `/${fileName}`);

      const precache = [...new Set([...emitted, ...EXTRA_PRECACHE])].sort();

      // The cache name is a function of the list, so any shell change produces
      // a new cache and `activate` drops the old one. Nothing to bump by hand.
      const revision = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderWorker(precache, `evolvepath-shell-${revision}`),
      });
    },
  };
}
