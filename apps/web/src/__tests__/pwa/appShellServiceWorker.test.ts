import { describe, expect, it } from 'vitest';
import type { OutputBundle } from 'rollup';

import { appShellServiceWorker } from '../../../build/appShellServiceWorker';

// =============================================================================
// The generated service worker (#58)
// =============================================================================
//
// The one thing a hand-written `sw.js` gets wrong is the precache list: it
// names hashed filenames, and they change every build. This plugin exists
// because it DERIVES that list from the finished bundle, so the first two
// tests below are the whole reason it is code rather than a static file.
//
// The rest assert the security property: no `/api` response is ever cached or
// served from cache. That is not a performance choice — a cached API response
// is a user's own data surviving their logout in a shared browser cache.
// =============================================================================

/** Runs the plugin's `generateBundle` over a fake bundle and returns `sw.js`. */
function generate(fileNames: string[]): string {
  const plugin = appShellServiceWorker();
  const emitted: Array<{ fileName?: string; source?: unknown }> = [];

  const bundle = Object.fromEntries(
    fileNames.map((fileName) => [fileName, { fileName }]),
  ) as unknown as OutputBundle;

  const hook = plugin.generateBundle;
  const handler = typeof hook === 'function' ? hook : hook?.handler;
  handler?.call(
    { emitFile: (file: { fileName?: string; source?: unknown }) => emitted.push(file) },
    {} as never,
    bundle,
    false,
  );

  return String(emitted[0]?.source ?? '');
}

const DEFAULT_BUNDLE = [
  'assets/index-A1b2C3.js',
  'assets/index-D4e5F6.css',
  'assets/TodayPage-G7h8I9.js',
];

describe('appShellServiceWorker', () => {
  it('only runs during a build, never under the dev server', () => {
    // A dev-mode worker caching Vite's modules is the classic "my change
    // doesn't show up" trap.
    expect(appShellServiceWorker().apply).toBe('build');
  });

  it('precaches the hashed assets this build actually emitted', () => {
    const sw = generate(DEFAULT_BUNDLE);

    for (const fileName of DEFAULT_BUNDLE) {
      expect(sw).toContain(`"/${fileName}"`);
    }
  });

  it('leaves out assets that are not part of the shell', () => {
    const sw = generate([...DEFAULT_BUNDLE, 'assets/index-A1b2C3.js.map', 'assets/hero-X9.png']);

    // Source maps and images are downloaded on demand; precaching them would
    // cost the user megabytes on install for nothing.
    expect(sw).not.toContain('index-A1b2C3.js.map');
    expect(sw).not.toContain('hero-X9.png');
  });

  it('precaches index.html, which the offline fallback depends on', () => {
    // `index.html` is emitted by Vite's HTML handling rather than by Rollup,
    // so it never appears in the bundle — a worker without it explicitly
    // added does nothing useful offline.
    const sw = generate(DEFAULT_BUNDLE);

    expect(sw).toContain('"/index.html"');
    expect(sw).toContain('"/manifest.webmanifest"');
  });

  it('names its cache after the content, so a changed shell drops the old one', () => {
    const first = /const CACHE_NAME = "([^"]+)"/.exec(generate(DEFAULT_BUNDLE))?.[1];
    const second = /const CACHE_NAME = "([^"]+)"/.exec(
      generate(['assets/index-ZZZZZZ.js', 'assets/index-D4e5F6.css']),
    )?.[1];
    const again = /const CACHE_NAME = "([^"]+)"/.exec(generate(DEFAULT_BUNDLE))?.[1];

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
    // Deterministic: the same bundle produces the same worker, so a rebuild
    // with no changes does not invalidate every user's cache.
    expect(again).toBe(first);
  });

  it('never precaches an API path', () => {
    const sw = generate(DEFAULT_BUNDLE);
    const precache = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)?.[1];

    expect(precache).toBeTruthy();
    expect(JSON.parse(precache as string)).not.toContain('/api');
    expect((JSON.parse(precache as string) as string[]).some((p) => p.startsWith('/api'))).toBe(
      false,
    );
  });

  it('bails out of the fetch handler for API requests', () => {
    // The security property, read off the emitted source: `/api/*` returns
    // before any cache is consulted or written.
    const sw = generate(DEFAULT_BUNDLE);

    expect(sw).toContain("if (url.pathname.startsWith('/api/')) return;");
  });

  it('ignores non-GET requests and other origins', () => {
    const sw = generate(DEFAULT_BUNDLE);

    expect(sw).toContain("if (request.method !== 'GET') return;");
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
  });

  it('serves navigations network-first with the cached shell as fallback', () => {
    // Cache-first would show the previous deploy for one more load after every
    // release, which users experience as "the update didn't apply".
    const sw = generate(DEFAULT_BUNDLE);

    expect(sw).toContain("if (request.mode === 'navigate')");
    expect(sw).toMatch(/fetch\(request\)\.catch\(\(\) =>[\s\S]*caches\.match\('\/index\.html'/);
  });

  it('deletes every cache but the current one on activate', () => {
    const sw = generate(DEFAULT_BUNDLE);

    expect(sw).toContain('caches.delete(key)');
    expect(sw).toContain('key !== CACHE_NAME');
  });
});
