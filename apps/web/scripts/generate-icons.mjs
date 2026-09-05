#!/usr/bin/env node
/**
 * Rasterises `public/icons/icon.svg` into the PNG set the manifest names.
 *
 * THE PNGs ARE COMMITTED, and this script exists to REGENERATE them, not to
 * produce them at build time. Two reasons:
 *
 *   1. `sharp` is a native module. Making it a build-time dependency would put
 *      a compiled binary on the critical path of every `npm ci` in CI and in
 *      the production Docker image, for artwork that changes once a year.
 *   2. An icon is a design artefact. A reviewer should see the actual bytes
 *      change in a diff when the mark changes, not infer it from a source SVG.
 *
 * Run it with `npm run icons` in `apps/web` after editing `icon.svg`; the
 * output is deterministic, so a clean `git status` afterwards proves the
 * committed PNGs match the source.
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const source = path.join(publicDir, 'icons', 'icon.svg');

/** The dark theme's `background.default` — see `src/theme/dark.ts`. */
const BACKGROUND = { r: 0x12, g: 0x12, b: 0x12, alpha: 1 };

/**
 * A maskable icon is cropped to a platform-defined shape (a circle on Android),
 * so the artwork must sit inside a safe zone of 80% of the canvas. Rendering
 * the mark at 80% and padding the rest guarantees that regardless of what the
 * SVG itself does.
 */
const MASKABLE_SAFE_RATIO = 0.8;

async function plain(size, out) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .flatten({ background: BACKGROUND })
    .png()
    .toFile(out);
}

async function maskable(size, out) {
  const inner = Math.round(size * MASKABLE_SAFE_RATIO);
  const pad = Math.round((size - inner) / 2);

  const art = await sharp(source, { density: 384 }).resize(inner, inner).png().toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(out);
}

async function main() {
  await mkdir(path.join(publicDir, 'icons'), { recursive: true });

  await plain(192, path.join(publicDir, 'icons', 'icon-192.png'));
  await plain(512, path.join(publicDir, 'icons', 'icon-512.png'));
  await maskable(192, path.join(publicDir, 'icons', 'icon-maskable-192.png'));
  await maskable(512, path.join(publicDir, 'icons', 'icon-maskable-512.png'));

  // iOS ignores the manifest's icons for "Add to Home Screen" and reads this
  // one. It must be OPAQUE: iOS does not composite a background behind it, and
  // a transparent PNG renders as a black square on a light home screen.
  await plain(180, path.join(publicDir, 'apple-touch-icon.png'));

  const written = [
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png',
    'apple-touch-icon.png',
  ];
  // eslint-disable-next-line no-console
  console.log(`Wrote ${written.length} icons:\n  ${written.join('\n  ')}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
