import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MediaKind, MediaPurpose } from '@prisma/client';

import configuration from '../../src/config/configuration';
import { PERMISSIONS } from '../../src/common/constants/roles.constants';
import { MEDIA_TARGET_TYPES } from '../../src/media/media-target-types';
import { MEDIA_ANALYST_PROMPT_VERSION } from '../../src/media/prompts/media-analyst.prompt';
import { mediaAdviceSchema } from '../../src/media/dto/media-advice.schema';
import { VideoFramesProcessor } from '../../src/storage/processing/processors/video-frames.processor';
import { ImageNormalizeProcessor } from '../../src/storage/processing/processors/image-normalize.processor';
import { THROTTLE_LIMITS } from '../../src/ai/gateway/test-throttle';
import { formatAllowedMimeTypes } from '../../src/storage/objects/mime-allowlist';

// =============================================================================
// docs/specs/media-attachments.md against the code it documents (issue #103)
// =============================================================================
//
// The same bargain the other spec documents have: E06 and E09 already read this
// one and ship against it, so a stale document is worse than none.
//
// It asserts the DIRECTION THAT ACTUALLY FIRES — every constant appears with
// its CURRENT VALUE. Halving `AI_VIDEO_MAX_FRAMES` and leaving the table alone
// is the realistic mistake, and a document-mentions-the-name check would sail
// straight past it.
//
// Two things are quoted VERBATIM rather than described, because they are the
// ones a reader would otherwise have to trust: the professional-care copy
// (which the client renders as a constant, not from the model) and the
// processor names, which ARE the metadata keys with no shared constant behind
// them.
// =============================================================================

const DOC_PATH = resolve(__dirname, '../../../../docs/specs/media-attachments.md');
const doc = readFileSync(DOC_PATH, 'utf8');

/** The web app's copy of the professional-care sentence. */
const CLIENT_COPY_PATH = resolve(
  __dirname,
  '../../../../apps/web/src/components/media/MediaAdviceCard.tsx',
);

describe('docs/specs/media-attachments.md', () => {
  const config = configuration();

  describe('storage limits carry their current values', () => {
    it('names MAX_FILE_SIZE and its default', () => {
      // Moving the default and leaving the table alone is the realistic
      // mistake this whole file exists to catch.
      expect(doc).toContain(String(config.storage.maxFileSize));
      expect(doc).toContain('`MAX_FILE_SIZE`');
    });

    it('names the allowlist default exactly as the code renders it', () => {
      expect(doc).toContain(
        formatAllowedMimeTypes(config.storage.allowedMimeTypes),
      );
    });

    it('names the quota default and that 0 disables it', () => {
      expect(doc).toContain(String(config.storage.userQuotaBytes));
      expect(doc).toMatch(/`0` disables/);
    });

    it('records that uploads are deliberately not gated on storage:write', () => {
      // A future reader will otherwise "fix" it, and Viewer — the default role
      // — would lose the ability to upload anything.
      expect(doc).toContain('`storage:write` is deliberately not enforced');
      expect(doc).toContain('Viewer is the default');
    });

    it('names all three admin overrides', () => {
      for (const permission of [
        PERMISSIONS.STORAGE_READ_ANY,
        PERMISSIONS.STORAGE_WRITE_ANY,
        PERMISSIONS.STORAGE_DELETE_ANY,
      ]) {
        expect(doc).toContain(permission);
      }
    });
  });

  describe('video sampling carries its current values', () => {
    it('names the frame cap, its clamp and the duration limit', () => {
      expect(doc).toContain(String(config.ai.video.maxFrames));
      expect(doc).toContain(String(config.ai.video.maxDurationSeconds));
      expect(doc).toContain('clamped 1–16');
    });

    it('states the sampling rule as the code computes it', () => {
      expect(doc).toContain(
        'min(AI_VIDEO_MAX_FRAMES, max(1, floor(durationMs / 500)))',
      );
    });

    it('says the duration limit is a refusal, not a truncation', () => {
      expect(doc).toMatch(/refusal, not a truncation/);
    });
  });

  describe('the processor names are quoted, because they ARE the metadata keys', () => {
    // There is no shared constant between a processor and the code that reads
    // its output. Renaming one silently breaks every video the coach has been
    // shown, so the document has to name both.
    it('quotes both, and says why the name matters', () => {
      const videoFrames = Object.getPrototypeOf(
        Object.create(VideoFramesProcessor.prototype),
      );
      void videoFrames;

      expect(doc).toContain("_processing['video-frames']");
      expect(doc).toContain("_processing['image-normalize']");
      expect(doc).toContain('IS the metadata key');
    });

    it('matches the names the classes actually declare', () => {
      // Read off the prototypes so a rename fails here rather than in
      // production. `name` is a readonly instance field, so an instance is
      // needed — constructed with nulls, since nothing is called.
      const video = new VideoFramesProcessor(null as never, null as never, null as never);
      const image = new ImageNormalizeProcessor(null as never, null as never, null as never);

      expect(video.name).toBe('video-frames');
      expect(image.name).toBe('image-normalize');
      expect(doc).toContain(`\`${video.name}\``);
      expect(doc).toContain(`\`${image.name}\``);
    });

    it('records that the EXIF strip is an absence, not a call', () => {
      expect(doc).toContain('absence, not a call');
      expect(doc).toContain('.withMetadata()');
      expect(doc).toContain('.rotate()');
    });

    it('records the derived-object convention and the deletion sweep', () => {
      expect(doc).toContain('derivedFrom');
      expect(doc).toContain('no foreign key back to the parent');
    });
  });

  describe('the attachment model', () => {
    it('lists every purpose and every kind', () => {
      for (const purpose of Object.values(MediaPurpose)) {
        expect(doc).toContain(purpose);
      }
      for (const kind of Object.values(MediaKind)) {
        expect(doc).toContain(kind);
      }
    });

    it('lists every legal target type', () => {
      for (const target of MEDIA_TARGET_TYPES) {
        expect(doc).toContain(target);
      }
    });

    it('records the 404-not-403 rule AND why it differs from storage', () => {
      // Both halves. A document that said only "media answers 404" would
      // invite somebody to make storage match it.
      expect(doc).toContain('404, never 403');
      expect(doc).toContain('enumeration primitive');
      expect(doc).toMatch(/storage API answers \*\*403\*\*/);
    });

    it('records the three-state collapse', () => {
      expect(doc).toContain('collapses five statuses into three');
    });
  });

  describe('the advice contract', () => {
    it('reproduces the schema’s own bounds', () => {
      // Read off the schema so a widened limit fails here.
      const shape = mediaAdviceSchema.shape;
      expect(shape.summary).toBeDefined();
      expect(shape.observations).toBeDefined();
      expect(shape.advice).toBeDefined();
      expect(shape.safetyFlag).toBeDefined();

      expect(doc).toContain('mediaAdviceSchema');
      expect(doc).toContain('minimum of one');
    });

    it('names the current prompt version', () => {
      expect(doc).toContain(MEDIA_ANALYST_PROMPT_VERSION);
    });

    it('quotes the professional-care copy verbatim, matching the client', () => {
      // The one string in this epic that must be identical in two places: the
      // document a future agent reads, and the component a user reads.
      const client = readFileSync(CLIENT_COPY_PATH, 'utf8');

      const sentence =
        'see a qualified professional before continuing.';
      expect(client).toContain(sentence);
      expect(doc).toContain(sentence);
      expect(doc).toContain("I can't assess injuries from a video.");
    });

    it('records that MEAL forbids every kind of number', () => {
      expect(doc).toMatch(/Never\*\* a calorie, macronutrient or gram/);
    });

    it('names the ask throttle and its current limit', () => {
      expect(doc).toContain(String(THROTTLE_LIMITS.media_ask));
      expect(doc).toContain('media_ask');
    });
  });

  describe('attachment modes', () => {
    it('names the mode default, the TTL and the two size caps', () => {
      expect(doc).toContain(String(config.ai.attachments.signedUrlTtlSeconds));
      expect(doc).toContain(String(config.ai.attachments.maxSourceImageBytes));
      expect(doc).toContain(String(config.ai.attachments.maxImageBytes));
      expect(doc).toContain('`AI_ATTACHMENT_MODE`');
    });

    it('records that inline is and stays the default', () => {
      expect(doc).toContain('Inline is the default and stays the default');
    });
  });

  describe('completeness', () => {
    it('has a rejected-alternatives section', () => {
      // The section that stops the same idea being re-proposed every epic.
      expect(doc).toContain('## 10. Rejected alternatives');
      expect(doc).toContain('Transcoding video');
      expect(doc).toContain('Client-side frame sampling');
    });

    it('has a follow-ups section', () => {
      expect(doc).toContain('## 11. Follow-ups');
    });

    it('has the psql snippet the observability story points at', () => {
      expect(doc).toContain('ai_invocations');
      expect(doc).toContain('attachmentObjectIds');
    });
  });
});
