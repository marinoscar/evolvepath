import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@app/shared';

import { darkTheme } from '../../theme';

// =============================================================================
// The web manifest, against the three things it must agree with (#58)
// =============================================================================
//
// The manifest is a hand-authored static file, deliberately — it is one
// reviewable artefact rather than plugin configuration. The cost of that
// choice is that NOTHING generates it, so three values in it are literals that
// can drift from their real sources:
//
//   1. `name` from `APP_NAME`. The `%APP_NAME%` build transform rewrites
//      `index.html` and does not touch `.webmanifest`, so a fork that renames
//      the product would ship a correct wordmark, a correct browser tab, and
//      the OLD name on the home screen — visible only after installing.
//   2. `theme_color` from the dark theme's `background.default`, which is also
//      what `index.html`'s `<meta name="theme-color">` declares. Three copies
//      of one colour.
//   3. Every icon `src`, from files on disk. A manifest naming a missing icon
//      makes the app silently uninstallable in Chrome.
//
// Each is asserted here rather than trusted.
// =============================================================================

const webRoot = resolve(__dirname, '..', '..', '..');

function readWeb(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), 'utf8');
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(readWeb('public/manifest.webmanifest')) as Manifest;

describe('web manifest', () => {
  it('names the product exactly as @app/shared does', () => {
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBe(APP_NAME);
  });

  it('declares an installable standalone app rooted at /', () => {
    // Chrome refuses to offer installation without all three.
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('carries both required sizes, and a maskable pair', () => {
    const bySize = (size: string, maskable: boolean) =>
      manifest.icons.filter(
        (icon) => icon.sizes === size && (icon.purpose === 'maskable') === maskable,
      );

    expect(bySize('192x192', false)).toHaveLength(1);
    expect(bySize('512x512', false)).toHaveLength(1);
    // Without a maskable pair Android crops the plain icon to a circle and
    // clips the artwork.
    expect(bySize('192x192', true)).toHaveLength(1);
    expect(bySize('512x512', true)).toHaveLength(1);
  });

  it('points every icon at a file that exists', () => {
    for (const icon of manifest.icons) {
      const path = resolve(webRoot, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(path), `${icon.src} is named by the manifest but missing on disk`).toBe(
        true,
      );
    }
  });

  it('agrees with index.html and the dark theme on the theme colour', () => {
    const html = readWeb('index.html');
    const metaColour = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];

    expect(metaColour, 'index.html has no theme-color meta').toBeDefined();
    expect(manifest.theme_color).toBe(metaColour);
    // The third copy: the actual theme the app renders in.
    expect(manifest.theme_color).toBe(darkTheme.palette.background.default);
    // The splash screen behind the app while it boots — same colour, so the
    // launch does not flash a different background.
    expect(manifest.background_color).toBe(manifest.theme_color);
  });
});

describe('index.html PWA head', () => {
  const html = readWeb('index.html');

  it('links the manifest', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it('links an apple-touch-icon that exists', () => {
    expect(html).toContain('rel="apple-touch-icon"');
    // iOS ignores the manifest's icons entirely and reads this one.
    expect(existsSync(resolve(webRoot, 'public/apple-touch-icon.png'))).toBe(true);
  });

  it('declares standalone capability for both iOS and the modern spelling', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
  });
});
