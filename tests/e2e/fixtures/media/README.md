# Media fixtures

Synthetic, committed, and tiny. Every one of these is generated — there are no
real photographs here, and there should never be: a fixture is a file in Git
history forever, and a person's actual squat video or lunch is not something to
put there.

Regenerate with the commands below and re-check the sizes before committing.

## `photo.jpg` — 1280×960, ~8 KiB, **carries EXIF GPS**

The GPS tag is load-bearing, not decoration: it is what makes the E03-05
normalization assertion meaningful. Without EXIF on the source, "the variant has
no EXIF" would pass against a source that never had any.

```bash
node -e "
const sharp = require('sharp');
sharp({ create: { width: 1280, height: 960, channels: 3, background: '#6b8fa3' } })
  .withMetadata({
    exif: {
      IFD0: { Copyright: 'evolvepath-test-fixture' },
      GPS: {
        GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1',
      },
    },
  })
  .jpeg({ quality: 60 })
  .toFile('photo.jpg');
"
```

Verify: `exiftool photo.jpg | grep -i gps` prints coordinates, and
`identify photo.jpg` reports `1280x960`.

## `clip.mp4` — 2 s, 320×240, 10 fps, ~11 KiB

Two seconds is chosen against the sampler's `floor(durationMs / 500)` rule:
with `AI_VIDEO_MAX_FRAMES=4` in the e2e environment it yields **exactly four
frames**, which is what makes the frame-count assertion a number rather than a
range.

```bash
ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -pix_fmt yuv420p clip.mp4
```

## `note.txt` — 91 bytes

A file the picker must refuse **without a network request**. Its content does
not matter; its content type does.

```bash
printf 'This is not a photograph and not a video.\nIt is here so a spec can drop it and be refused.\n' > note.txt
```
