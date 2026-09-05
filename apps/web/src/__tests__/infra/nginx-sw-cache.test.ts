import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Three files must escape the one-year `immutable` rule (#58)
// =============================================================================
//
// `apps/web/nginx.conf` caches every `.js|.css|.png|…` for a year as
// `immutable`, which is correct for content-hashed assets: the name changes
// when the content does, so a cached copy can never be wrong.
//
// `sw.js`, `index.html` and `manifest.webmanifest` have STABLE names and
// CHANGING content, so that rule is actively harmful to them — and `sw.js` is
// the dangerous one. A service worker cached `immutable` pins the user's whole
// app at the version they first installed: the browser never fetches a newer
// worker, so it never learns about a newer precache manifest, so it keeps
// serving the old shell. There is nothing the user can do about that short of
// clearing site data.
//
// A regression here is invisible in dev (no worker) and invisible on the first
// deploy (nothing cached yet); it appears on the SECOND deploy, to users only.
// So it is asserted rather than reviewed.
// =============================================================================

const nginxConf = readFileSync(
  resolve(__dirname, '..', '..', '..', 'nginx.conf'),
  'utf8',
);

/**
 * Where the hashed-asset regex block starts. Everything checked must precede it.
 *
 * Located by the `location ~*` directive rather than by the words
 * "public, immutable", which also appear in the file's own explanatory
 * comments — matching those would find the comment and pass vacuously.
 */
const immutableRuleIndex = nginxConf.search(/^\s*location ~\*/m);

/**
 * The full body of `location = <path> { … }`, brace-matched.
 *
 * A naive `indexOf('}')` stops at the first closing brace, which for the
 * manifest block is the one closing its nested `types { … }` — and the
 * `add_header` after it would then look absent.
 */
function locationBlock(path: string): string {
  const start = nginxConf.indexOf(`location = ${path} {`);
  if (start < 0) return '';

  let depth = 0;
  for (let i = nginxConf.indexOf('{', start); i < nginxConf.length; i += 1) {
    if (nginxConf[i] === '{') depth += 1;
    if (nginxConf[i] === '}') {
      depth -= 1;
      if (depth === 0) return nginxConf.slice(start, i + 1);
    }
  }
  return nginxConf.slice(start);
}

describe('web nginx.conf — service worker and shell caching', () => {
  it('has the immutable rule this suite is about', () => {
    // Guards the index below: if the rule were renamed, every "comes before it"
    // assertion would pass vacuously against -1.
    expect(immutableRuleIndex).toBeGreaterThan(0);
  });

  it.each([['/sw.js'], ['/index.html'], ['/manifest.webmanifest']])(
    'serves %s with no-cache, declared before the immutable rule',
    (path) => {
      const location = nginxConf.indexOf(`location = ${path} {`);
      expect(location, `no exact-match location for ${path}`).toBeGreaterThan(0);
      expect(location).toBeLessThan(immutableRuleIndex);

      // The `no-cache` header must be inside THAT block, not merely somewhere
      // in the file.
      expect(locationBlock(path)).toContain('add_header Cache-Control "no-cache"');
    },
  );

  it('serves the manifest as application/manifest+json', () => {
    // nginx's default mime.types has no `.webmanifest` entry, so without this
    // it goes out as application/octet-stream — which Chrome refuses to parse
    // as a manifest, making the app silently uninstallable.
    expect(locationBlock('/manifest.webmanifest')).toContain(
      'application/manifest+json webmanifest',
    );
  });
});
