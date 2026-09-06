# Media attachments

**Epic #67 (E03).** How a photograph or a video taken on a phone becomes
structured coaching advice, and every rule that makes that safe to do at scale.

Read this before changing anything under `apps/api/src/media/`,
`apps/api/src/storage/`, `apps/web/src/components/media/` or
`apps/web/src/hooks/useMediaUpload.ts`.

Related: [`ai-gateway.md`](./ai-gateway.md) documents the attachment contract
this epic feeds; [`health-domain.md`](./health-domain.md) documents E09's three
typed media checks, which are a *different* thing from the generic `ask` here
and say why.

---

## 1. What the epic is for

VISION §14 ("workout planning must be a real product capability") and §16
("nutrition should begin with behavior") define the use: film a set, photograph
the equipment in front of you, photograph a plate, and hand it to the coach.

PRD §87 defines the boundary — *"every AI call should receive the smallest
sufficient context"*. Taken literally, that is the whole architecture of this
epic: **the model never sees a video**, and for a photograph it never sees the
original. It sees a handful of 1024-pixel JPEGs with the EXIF stripped.

---

## 2. Storage limits, and why uploads are not permission-gated

`storage.allowedMimeTypes` and `storage.maxFileSize` existed in configuration
from the day the storage module was written and were **read by nobody**. Any
authenticated user could upload any content type of any size, and
`simpleUpload` persisted `size: 0` "to be updated by post-processing" with
nothing ever updating it. Issue #71 is the fix.

| Limit | Env var | Default | Where it is enforced |
|---|---|---|---|
| Content types | `ALLOWED_MIME_TYPES` | `image/*, video/*` | `upload/init` from `mimeType`; simple upload from the multipart part, **before a byte reaches the provider** |
| Size | `MAX_FILE_SIZE` | `524288000` (500 MiB) | `upload/init` from the declared size; simple upload from the **counted** bytes |
| Per-user total | `STORAGE_USER_QUOTA_BYTES` | `2147483648` (2 GiB), `0` disables | both paths, before and (on the simple path) after |

Three rules inside that table are easy to get wrong:

- **An empty allowlist denies everything.** That is the safe reading of "no
  types are configured", and it is the opposite of what a naive `.some()` over
  an empty array does if the check is inverted.
- **The simple path's size limit is measured, not declared.** A
  `Content-Length` is a claim the client controls, so the bytes flow through a
  counting `Transform` that destroys the stream on overflow, deletes the
  partial key, and answers 400. That counter is also what finally gives `size`
  a real value.
- **`used + incoming === quota` is allowed.** A limit you cannot reach is a
  different limit, and an off-by-one refusal at a round number gets reported as
  "it says 2 GB and it won't take 2 GB".

### `storage:write` is deliberately not enforced on upload routes

Every storage route is plain `@Auth()`. **Viewer is the default EvolvePath
role**, Viewer does not hold `storage:write`, and every user of this product
uploads media — a form check is not an administrative act. Gating uploads on
`storage:write` would mean either granting it to Viewer (making the permission
meaningless) or making the product's main input an admin feature.

Reads and writes on an *existing* object are owner-scoped, with three admin
overrides that are now real and seeded to admin only:

| Route | Override |
|---|---|
| `GET /storage/objects/:id`, `…/download` | `storage:read_any` |
| `PATCH /storage/objects/:id/metadata` | `storage:write_any` |
| `DELETE /storage/objects/:id` | `storage:delete_any` |

`read_any` and `write_any` were documented in `CLAUDE.md` and existed nowhere:
not in `roles.constants.ts`, not in the seed, and consulted by no code path.
The only symptom was an admin quietly getting a 403.

`ObjectsService.getOwnedById` is a **separate, owner-only read** for
server-side callers with a user id and no request — the AI attachment resolver,
E09's media checks. An admin resolving their own attachments must not be able
to inline another user's photo into a model call because their token happens to
carry `storage:read_any`. The override is an operator affordance on the storage
API, not a capability the AI path inherits.

---

## 3. The processing pipeline

`ObjectProcessingService` listens for `OBJECT_UPLOADED_EVENT`, runs every
registered processor whose `canProcess()` matches (sorted by `priority`), and
stores each result at **`metadata._processing[processor.name]`**, marking the
object `ready` or `failed` (`_processingFailed: true`,
`<name>_error: '<reason>'`).

Before this epic, **zero processors were registered**, so every uploaded object
went straight to `ready` with an empty `_processing`.

### Registration

**NestJS has no `multi: true`.** `processors/README.md` documented that option
for the life of the module, which is a large part of why nothing was ever
registered. The token is bound to exactly one value; the supported form is a
factory that returns the **array**, which the pipeline already normalizes:

```ts
providers: [
  ImageNormalizeProcessor,
  VideoFramesProcessor,
  {
    provide: OBJECT_PROCESSOR,
    useFactory: (image, video) => [image, video],
    inject: [ImageNormalizeProcessor, VideoFramesProcessor],
  },
],
```

### The processor `name` IS the metadata key

There is **no shared constant** between a processor and the code that reads its
output. `AiAttachmentResolverService` reads `_processing['video-frames']` and
`_processing['image-normalize']` by literal string. Renaming a processor
silently breaks every video the coach has been shown, and silently sends
full-size originals with their EXIF intact.

### `video-frames` (issue #79)

Claims `video/*` objects with no `metadata.derivedFrom` — that second clause is
what stops the pipeline re-entering itself, since every frame it writes is a
`StorageObject` too.

```json
{
  "_processing": {
    "video-frames": {
      "frames": [{ "objectId": "uuid", "timestampMs": 250 }],
      "durationMs": 2000,
      "width": 320,
      "height": 240,
      "frameCount": 4
    }
  }
}
```

- **The video is written to disk before ffmpeg touches it.** MP4 `moov` atoms
  are routinely at the *end* of the file, so a non-seekable stream makes ffprobe
  report nothing at all — for exactly the format phones produce.
- **`min(AI_VIDEO_MAX_FRAMES, max(1, floor(durationMs / 500)))` frames**,
  sampled at the **middle** of each slice. A one-second clip gives two frames
  rather than eight near-identical ones, and sampling at `t = 0` gives the frame
  before the lift begins — a picture of somebody standing still, in a form check.
- **Over `AI_VIDEO_MAX_SECONDS` is a refusal, not a truncation.** Sampling the
  first two minutes of a ten-minute video hands the coach frames of something
  the user did not ask about. `AI_VIDEO_MAX_FRAMES` is the opposite — *clamped*
  to 1–16 rather than validated, because the failure mode of too many frames is
  a bill, not a broken deploy.
- **A partial failure deletes the frames it already wrote.** A `failed` parent
  that left half its frames behind is worse than one that left none: the
  resolver would send an arbitrary prefix of the video and nothing would say so.
- Rotation is read from **both** `side_data_list[].rotation` and `tags.rotate`.
  Both are in the wild, and getting it wrong describes a portrait video as
  landscape.

### `image-normalize` (issue #87)

Claims `image/*` objects with no `derivedFrom` — which excludes video frames
(already 1024 px and EXIF-free) and its own output.

```json
{
  "_processing": {
    "image-normalize": {
      "aiVariantObjectId": "uuid",
      "width": 1024,
      "height": 683,
      "sourceWidth": 3000,
      "sourceHeight": 2000,
      "sourceFormat": "jpeg",
      "exifStripped": true
    }
  }
}
```

- **The EXIF strip is an absence, not a call.** `sharp` drops metadata unless
  asked to keep it, so stripping is achieved by *not* calling
  `.withMetadata()` — the way to break it is to **add** a line.
- **`.rotate()` runs first.** Stripping metadata without applying the
  orientation tag turns every portrait phone photo sideways: the tag was the
  only thing saying which way was up.
- **HEIC is decoded first.** libvips as shipped does not read it, and it is
  what an iPhone actually produces. `heic-convert` is pure WASM and slow
  (~1–2 s per 12 MP still) — acceptable off the request path, and not on it.
- **The original is never modified.** The user uploaded it and can download it;
  this writes a sibling at `derived/<id>/ai.jpg`.

### Derived objects and the deletion cascade

Both processors write ordinary `StorageObject` rows carrying
`metadata.derivedFrom = <parent id>`, keyed under `derived/<parentId>/…`, born
`status: 'ready'` (nothing further is done to them, and emitting an upload event
would re-enter the pipeline) and owned by the parent's uploader.

They have **no foreign key back to the parent**, so nothing cascades them.
`ObjectsService.delete` therefore sweeps `metadata.derivedFrom = <id>` before
deleting the parent. Without that, deleting a video leaves images of it in the
bucket — bytes the user believes they deleted.

Deleting a derived object **directly** is allowed and leaves a dangling entry in
the parent's `frames[]`. The resolver already skips objects that are absent or
not `ready`, so this is documented rather than guarded; the preview endpoint
answers a readable 400.

---

## 4. The attachment model

A raw `StorageObject` knows *what* was uploaded, not *why*.

```prisma
model MediaAttachment {
  id              String       @id @default(uuid())
  userId          String
  storageObjectId String       @unique
  kind            MediaKind    // PHOTO | VIDEO
  purpose         MediaPurpose // WORKOUT_FORM | EQUIPMENT | MEAL | GENERAL
  targetType      String?      // polymorphic, NOT a foreign key
  targetId        String?
  aiSummary       Json?
}
```

- **`storage_object_id` is unique.** One attachment per upload; re-purposing
  means uploading again. Without it a photo could be simultaneously a meal and
  a piece of equipment, carrying two pieces of AI advice, with nothing to say
  which one a screen should read.
- **`targetType`/`targetId` are not foreign keys.** The four targets
  (`workout_session`, `commitment`, `outcome`, `coach_message`) live in four
  tables and not all of them exist yet; a nullable FK per target would be four
  columns that are null three times out of four. The legal values are a Zod
  enum at the API boundary (`media-target-types.ts`), which is where a bad one
  can still be refused with a readable message — so `GET ?targetType=` does not
  become a filter over typos. They are **all or nothing**: half a target is not
  a target, because the index is on the pair.
- **`aiSummary` is untyped in Prisma.** Its shape is enforced in exactly one
  place — `mediaAdviceSchema` — and a second declaration would be a copy that
  drifts. The **latest** verdict overwrites; the history is `ai_invocations`.
- **Both foreign keys cascade.** Media metadata that outlives its owner is
  personal data surviving an account deletion; metadata that outlives its bytes
  is a row describing a file nobody can fetch.

### 404, never 403 — and why that differs from storage

Every `/media/attachments` route answers **404 for both a missing id and a
foreign one**, with a byte-identical body.

The storage API answers **403** for a foreign object. That asymmetry is
deliberate and must not be "fixed" in either direction:

- **Storage is generic and permission-based.** "You may not" is the honest
  answer there, and admins legitimately reach other people's objects through
  `storage:*_any`.
- **An attachment is a private product resource.** An answer that distinguishes
  "not yours" from "does not exist" tells a caller whether an id they do not own
  is real — the enumeration primitive the ownership check exists to prevent.

### `processingStatus` collapses five statuses into three

`pending | uploading | processing` → `processing` (wait), `ready` (ask),
`failed` (retry). A picker showing the first three as different things asks the
user to care about a distinction that changes nothing they can do.

`processingError` is the first `_processing.*_error` string, so a client can say
*why* without reading `_processing` JSON itself. `media.*` is read from the two
processor keys and is all-null until they run.

---

## 5. The advice contract

```ts
mediaAdviceSchema = z.object({
  summary: z.string().min(1).max(600),
  observations: z.array(z.string().min(1).max(300)).max(8),
  advice: z.array(z.string().min(1).max(300)).min(1).max(6),
  safetyFlag: z.object({
    level: z.enum(['none', 'caution', 'seek_professional']),
    reason: z.string().max(300),
  }).nullable(),
});
```

`advice` has a **minimum of one**: a coaching call that produces observations
and no advice is a description, and the user asked a question.

Stored on `aiSummary` as the validated output **plus provenance** — `askedAt`,
the question, the invocation id, the prompt version, the model — so "which
prompt said this?" is answerable from the row (PRD §128).

### Purposes and their rules

`buildMediaAnalystInstructions(purpose)` composes common rules with per-purpose
ones, under prompt version **`media_analyst.v1`** — bump it on every meaningful
change, because nothing can detect that for you and it is what makes "did the
coach get worse after we changed the prompt?" answerable from
`ai_invocations`. The prompt is not compiled, so nothing but
`media-analyst.prompt.spec.ts` would notice one being softened; that spec
asserts each rule by name.

| Purpose | The rule that matters |
|---|---|
| `WORKOUT_FORM` | Never diagnose. `seek_professional` for sharp pain, a joint giving way, or numbness — and **no coaching cues on that path** |
| `EQUIPMENT` | Only what is recognisable; no weight, brand or model number that cannot be read |
| `MEAL` | **Never** a calorie, macronutrient or gram. Never a judgment of the user's body. Not as a range, not as a guess, not with a caveat (PRD §46, VISION §16) |
| `GENERAL` | Describe, then answer the question if there was one |

Common to all four: describe only what is visible, **say when the frames are
unclear** (a model asked to coach from a blurry video will coach from a blurry
video), no medical diagnosis, one idea per line.

### The input text names what the model is looking at

> `Video, 3 s, 3 frames sampled evenly at 0.3 s, 0.8 s, 1.3 s. They are one continuous clip, in order.`

Without that, a model handed six images of a squat has no way to know whether it
is seeing one rep from six angles or six reps — and it will confidently pick one.

### Safety levels, and the fixed copy

`seek_professional` is rendered on the client with a **constant string**, not
the model's words:

> I can't assess injuries from a video. If you have sharp pain, numbness, or
> instability, see a qualified professional before continuing.

The sentence a person reads when they are told to see a professional has to be
the same sentence every time — including on the day the provider is having a bad
one (PRD §45, §81). The model's `reason` is shown **beside** it, never instead
of it: that is what makes the warning specific.

### Always 200

`POST /media/attachments/:id/ask` answers 200 on the coaching path, always. A
provider failure, a missing key, or output that fails the contract is
`{ ok: false, error }` (PRD §120). `no_user_key` is the one the UI answers with
a **link to `/settings/ai-key`** rather than a retry — it is the user's to fix,
and retrying without a key produces the same answer.

The 4xx answers are about the **media**: 404 foreign, 409 still processing
(poll, do not change the request), 400 processing failed, 429 past ten a minute
(`media_ask`, its own bucket rather than sharing E09's `media_check`).

---

## 6. Attachment modes and variant preference

**Inline is the default and stays the default.** A signed URL hands the provider
a credential that reaches this deployment's storage, with a lifetime to reason
about and a fetch we cannot observe; inlining keeps the whole exchange inside
one request the user's own key pays for.

`AI_ATTACHMENT_MODE=signed-url` is the PRD §118 alternative: the resolver emits
an `image_url` part carrying a short-lived GET
(`AI_ATTACHMENT_SIGNED_URL_TTL`, 300 s) and **never reads the bytes**, which is
the whole point. The inline size cap does not apply there — it exists because
base64 in a request body is the expensive part. In that mode `S3_PUBLIC_ENDPOINT`
must be a host the *provider* can resolve; a plain-`http://` one logs a warning
rather than refusing, because a public MinIO behind a TLS-terminating proxy is
legitimate and this process cannot tell it from `http://minio:9000`. An
**unknown** mode throws at boot.

For an `image/*` attachment the resolver prefers the normalized variant and
falls back to the original only when no variant is `ready` — and then only under
`AI_MAX_IMAGE_BYTES`. An oversize original with no variant is an `attachment`
**error**, not an attempt: the provider would refuse it anyway, after the upload
bandwidth was spent, with a message about base64 length nobody can act on.

**Video frames need no variant.** The sampler already produced them at 1024 px
from a decoded video, so there is no EXIF and nothing to shrink.

---

## 7. The client upload flow

`useMediaUpload` runs four phases, each one a thing the user can see:

```
validating → uploading → processing → ready | failed
```

- **`validating` is synchronous and local.** A `.txt` is refused with **no
  network request at all**: PRD §123 has somebody at a squat rack, and a round
  trip to learn that a text file is not a video is a round trip wasted.
  `lib/mediaLimits.ts` mirrors the server's defaults and its messages
  byte-for-byte, and the server stays authoritative — an operator who narrows
  the allowlist makes the mirror stale in the *safe* direction.
- **An empty `file.type` is passed through, not refused.** Older Safari reports
  none for HEIC, the format this product cares most about, and the server sees
  the real multipart content type.
- **Simple vs. resumable at 100 MiB**, the Fastify multipart ceiling. The
  resumable path PUTs parts straight to the object store with the presigned URL
  as the **only** credential — a bearer token alongside it makes S3 reject the
  request as double-authenticated — three at a time, and fetches further URLs in
  batches through `GET /storage/objects/:id/upload/urls` because the init
  response carries only ten.
- **`ETag` must be exposed by CORS.** MinIO does by default; an AWS bucket needs
  `ExposeHeaders: [ETag]`. Without it every part returns 200 and `complete`
  fails on a missing field, so `putToSignedUrl` fails loudly at the part and
  names the rule.
- **`processing` is a real phase.** The server's work is not over when the bytes
  land. The hook polls (2 s, backing off to 5 s after 30 s, giving up at five
  minutes) rather than subscribing: an SSE channel for a state that changes
  twice would be a connection per upload.
- **XHR, not `fetch`.** `fetch` has no upload progress event, and a phone video
  over a mobile connection without a progress bar is indistinguishable from a
  dead one.

The picker is a **camera button below `sm`** (`capture="environment"`) and a
drop zone above it. Both `useMediaQuery(down('sm'))` calls in this epic — the
picker's and the dialog's full-screen gate — are **local layout choices** and
are *not* among the five coupled breakpoint gates in `common/Layout.tsx`.

Every phase carries an **icon and text** (PRD §122): "the green one is fine" is
not something a colour-blind user or a screen reader can act on.

---

## 8. Environment variables

| Variable | Default | What it bounds |
|---|---|---|
| `ALLOWED_MIME_TYPES` | `image/*,video/*` | What may be uploaded. **Empty denies everything** |
| `MAX_FILE_SIZE` | `524288000` | One upload |
| `STORAGE_USER_QUOTA_BYTES` | `2147483648` | One user's total, derived children included. `0` disables |
| `S3_FORCE_PATH_STYLE` | true when `S3_ENDPOINT` is set | MinIO/LocalStack addressing |
| `S3_PUBLIC_ENDPOINT` | `S3_ENDPOINT` | The host **signed URLs** are signed against |
| `AI_VIDEO_MAX_FRAMES` | `8`, clamped 1–16 | Frames per video |
| `AI_VIDEO_MAX_SECONDS` | `120` | Longest video accepted (a refusal) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binary locations |
| `AI_MAX_SOURCE_IMAGE_BYTES` | `26214400` | Largest **original** the normalizer decodes |
| `AI_MAX_IMAGE_BYTES` | `20971520` | Largest image **inlined** into a request |
| `AI_ATTACHMENT_MODE` | `inline` | `inline` or `signed-url`; unknown throws at boot |
| `AI_ATTACHMENT_SIGNED_URL_TTL` | `300` | Signed-URL lifetime in that mode |

---

## 9. Reading a media invocation

After the e2e suite (or a manual run) has produced some rows:

```sql
-- The attachment, its processing state and what the coach said.
SELECT m.id,
       m.purpose,
       m.kind,
       o.status                              AS storage_status,
       o.metadata -> '_processing' -> 'video-frames' ->> 'frameCount'  AS frames,
       o.metadata -> '_processing' -> 'image-normalize' ->> 'width'    AS variant_width,
       m.ai_summary ->> 'summary'            AS coach_summary,
       m.ai_summary -> 'safetyFlag' ->> 'level' AS safety_level,
       m.ai_summary ->> 'promptVersion'      AS prompt_version
FROM media_attachments m
JOIN storage_objects o ON o.id = m.storage_object_id
ORDER BY m.created_at DESC
LIMIT 5;

-- The call behind it. `attachment_count` is the number of IMAGES sent, so a
-- four-frame video reads as 4 — that is the check that the frames travelled.
SELECT persona, status, attachment_count, prompt_version, latency_ms,
       input -> 'attachmentObjectIds' AS attachment_ids
FROM ai_invocations
WHERE persona = 'media_analyst'
ORDER BY created_at DESC
LIMIT 5;

-- Every object derived from one upload.
SELECT id, mime_type, size, metadata ->> 'frameIndex' AS frame, metadata ->> 'variant' AS variant
FROM storage_objects
WHERE metadata ->> 'derivedFrom' = '<parent id>'
ORDER BY (metadata ->> 'frameIndex')::int NULLS FIRST;
```

`invocationId` on the attachment is the join key into `ai_invocations`. Nothing
in either row carries image bytes — attachments are recorded by id only.

---

## 10. Rejected alternatives

**Transcoding video.** Considered and rejected: the model cannot watch a video
at all, so a re-encode would produce a smaller file nobody sends. Sampling is
not a compromise on transcoding, it is the actual requirement.

**Storing frames as base64 inside `_processing`.** It would avoid the derived
objects and their deletion sweep — and put tens of megabytes of image into a
JSONB column that every `GET /storage/objects/:id` reads, on a table the
attachment API joins.

**Scene-change detection for frame selection.** Picks the moments where the
picture changes most, which in a squat video is the moment somebody walks past
the camera. Evenly spaced is the V1 rule and it is defensible.

**A `media` table per domain** (`workout_media`, `meal_media`). Every consumer
— the coach, the library, the deletion cascade, the quota — would have to learn
about each one separately. `purpose` plus a polymorphic target is one table and
one set of rules.

**Enforcing `storage:write` on uploads.** See §2: Viewer is the default role
and every user uploads media.

**Client-side frame sampling.** The model would see different frames depending
on the browser, which makes a coaching answer irreproducible and a bug report
unactionable.

**Editing a calorie count out of a meal answer.** E09 settled this for its
typed checks and it holds here: a stripped sentence reads as an omission, and
we would be publishing the rest of a reply that had already ignored its
instructions. The prompt forbids it and the fixture proves the fixture does not
produce one.

---

## 11. Follow-ups

- **Queueing heavy processing.** Both processors run in-process. A burst of
  concurrent videos is bounded only by the event loop's thread pool; a real
  queue is the next step if this becomes a load problem.
- **Profile images by object id.** `ImageUpload` hands `onUpload` a *signed*
  URL with `SIGNED_URL_EXPIRY`'s lifetime. Persisting the object id and
  resolving it on read is the right model and is deliberately outside this
  epic.
- **Resuming an upload across a page reload.** The API supports it — the parts
  are recorded — and the hook restarts the file.
- **Admin quota management.** One global default today; no per-role quotas and
  no UI.
- **Content moderation.** Nothing inspects uploads for anything but format.
