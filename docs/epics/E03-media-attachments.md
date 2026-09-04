# E03 — Media Attachments for AI Advice

<!-- epic-meta: slug=media-attachments phase=1 -->
<!-- epic-issue: #67 -->

> GitHub epic: [#67](https://github.com/marinoscar/evolvepath/issues/67)

## Epic

### Goal
Let a user photograph or film something from their phone — a set at the gym, the equipment in front of them, a plate of food — and hand it to the coach for structured advice. This epic makes the existing storage module safe for user media (MIME allowlist, size limits, quota, admin overrides that actually exist), turns uploaded videos into AI-consumable frames and images into normalized AI variants, models the attachment as a first-class product object with a purpose and a target, and ships the generic "Ask the coach about this" flow that E06 (Coach) and E09 (Health: form-check, equipment substitutions, meal photos) reuse. VISION §14 ("workout planning must be a real product capability") and §16 ("nutrition should begin with behavior") define the use; PRD §87 ("every AI call should receive the smallest sufficient context") defines the boundary: the AI sees a handful of sampled frames, never a raw video.

### Background
Codebase facts this epic builds on (verified 2026-09-04):

- **Storage module** `apps/api/src/storage/` is S3-only (`S3StorageProvider`, MinIO via `S3_ENDPOINT`). `ObjectsController` (`storage/objects/objects.controller.ts`) exposes simple upload (`POST /storage/objects`, Fastify multipart, 100 MiB hard limit in `main.ts`) and resumable multipart upload (`upload/init` → presigned part URLs → `upload/complete`). Every route is plain `@Auth()`; `ObjectsService.getObjectWithAuthCheck` enforces **ownership only**.
- **`storage.allowedMimeTypes`** (`ALLOWED_MIME_TYPES`, default `image/*,application/pdf,video/*`) and **`storage.maxFileSize`** (`MAX_FILE_SIZE`, default 10 GiB) are declared in `apps/api/src/config/configuration.ts` and **read by nobody**. `simpleUpload` stores `size: 0` "to be updated by post-processing" — nothing updates it.
- **Permissions**: `roles.constants.ts` and `prisma/seed.ts` define `storage:read`, `storage:write`, `storage:delete_any` only. `CLAUDE.md` claims `storage:read_any/write_any/delete_any` exist — it is wrong; `read_any`/`write_any` are not seeded and none of the three is consulted by any code path. Viewer (the default role) holds `storage:read` but not `storage:write`, and still uploads today because the controller does not check permissions.
- **Processing pipeline** `storage/processing/`: `ObjectProcessingService` listens to `OBJECT_UPLOADED_EVENT`, runs every registered `OBJECT_PROCESSOR` whose `canProcess()` matches (sorted by `priority`), stores each result under `metadata._processing[<processor.name>]`, and marks the object `ready` or `failed` (`_processingFailed: true`, `<name>_error`). Zero processors are registered. `processors/README.md` shows `multi: true` — NestJS has no such option; register an array through a factory provider (see E03-03 (#79) notes).
- **Frontend**: no upload code path works. `apps/web/src/components/settings/ImageUpload.tsx` bypasses `ApiService` with a raw `fetch` to `/api/users/profile-image`, an endpoint that does not exist. `ApiService.request` forces `Content-Type: application/json` whenever a body is present, so it cannot send `FormData`, and `fetch` has no upload progress.
- **Compose** has no object store: `base/dev/test.compose.yml` define postgres, api, web, nginx only; `.env.example` mentions MinIO as a comment. Nothing storage-related can be verified end to end from a clean clone today.
- **AI contract (E01)**: `AiGatewayService.invoke({persona, userId, promptVersion, instructions, input, attachments?, schema, schemaName})` → `{ok:true, output}` | `{ok:false, error:{code,message}}`, never throws for provider problems. `AiAttachment = { storageObjectId, detail? }`. The resolver (E01-06 (#26), `apps/api/src/ai/attachments/ai-attachment-resolver.service.ts`) checks ownership and `status === 'ready'`, inlines images as base64 data URLs, and expands videos from `metadata._processing['video-frames'].frames[{objectId,timestampMs}]`. Only personas with capability `vision` (`media_analyst`) accept attachments. The fake OpenAI server (E01-10 (#30), `tools/fake-openai/server.mjs`, `infra/compose/fake-openai.compose.yml`) answers `/v1/responses` with schema-shaped JSON.
- **Sequencing**: E03 follows E02, so the five-destination shell (`DESTINATION_ROUTES` with `today|path|coach|progress|profile`) exists when E03-07 (#96) registers its route.

Specs this epic produces: `docs/specs/media-attachments.md` (E03-08 (#103)). Related: `docs/specs/ai-gateway.md` (E01-12 (#32)) documents the attachment contract this epic feeds.

### Scope
- [ ] #71 fix(api): enforce storage MIME allowlist and size limits (E03-01)
- [ ] #74 feat(db): add media attachments model (E03-02)
- [ ] #79 feat(api): add video frame sampling processor (E03-03)
- [ ] #83 feat(api): add media attachment endpoints (E03-04)
- [ ] #87 feat(api): media pipeline hardening (E03-05)
- [ ] #91 feat(web): add MediaAttachmentPicker component (E03-06)
- [ ] #96 feat(web): add "Ask the coach about this" media flow (E03-07)
- [ ] #103 test(tests): E03 end-to-end verification (E03-08)

### Out of scope
- Domain-specific media coaching prompts and flows (form-check from the workout runner, equipment → substitutions, meal → behavior advice) — E09-06 (#92) / E09-09 (#111) build on the generic `/media/attachments/:id/ask` endpoint and `AskAboutMediaDialog` shipped here.
- Attaching media to coach chat messages — E06-07 (#86) mounts `MediaAttachmentPicker` inside the Coach screen.
- Calorie or macro estimation from meal photos (PRD §46 "should not dominate V1"; VISION §16). `MEAL` purpose advice is behavior-level only.
- Video transcoding, streaming playback, HLS, thumbnails for arbitrary documents, virus scanning.
- Profile-image persistence by storage object id (a `customImageUrl` that never expires). E03-06 (#91) makes `ImageUpload` work through the real API; the persistence model is a follow-up outside this epic.
- Multi-user media sharing. Every attachment is private to its uploader; admins reach objects only through the `*_any` permissions.
- Offline upload queueing (PRD §121 applies to workout set logs, E09-08 (#109)).

### Sequencing
- **E03-01 (#71)** (storage hardening + MinIO overlay) has no dependencies and unblocks manual verification of everything else. Start here.
- **E03-02 (#74)** (schema) is independent of E03-01 (#71); can run in parallel.
- **E03-03 (#79)** (video frames) depends on E03-01 (#71) (ffmpeg in the image, MinIO to test against). **E03-05 (#87)** (image normalization, quota, signed-url mode) depends on E03-01 (#71) and on E01-06 (#26) (the resolver it extends).
- **E03-04 (#83)** (attachment endpoints) depends on E03-02 (#74) and E03-01 (#71); it reads `_processing` metadata written by E03-03 (#79)/E03-05 (#87) but tolerates their absence (`processingStatus` derives from `StorageObject.status`).
- **E03-06 (#91)** (picker) depends on E03-01 (#71) (limits it mirrors) and E03-04 (#83) (attach call). **E03-07 (#96)** (ask flow) depends on E03-04 (#83), E03-06 (#91) and E01-06 (#26) (`AiGatewayService`).
- **E03-08 (#103)** last; needs E01-10 (#30) (fake OpenAI server) and everything above.
- Critical path: E03-01 (#71) → E03-03 (#79) → E03-04 (#83) → E03-06 (#91) → E03-07 (#96) → E03-08 (#103). E03-02 (#74) and E03-05 (#87) fill the gaps in parallel.

### Manual end-to-end verification
Prerequisites: E01 merged (AI key gate, gateway, fake OpenAI server), E02 merged (five-destination shell). Run from a clean clone.

1. `cp infra/compose/.env.example infra/compose/.env`; set `SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)`, `INITIAL_ADMIN_EMAIL=<you>`, and the MinIO block exactly as the `.env.example` comments say (`S3_ENDPOINT=http://minio:9000`, `S3_BUCKET=evolvepath-dev`, `AWS_ACCESS_KEY_ID=minioadmin`, `AWS_SECRET_ACCESS_KEY=minioadmin`, `S3_FORCE_PATH_STYLE=true`).
2. `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f minio.compose.yml -f fake-openai.compose.yml up --build`. Wait for `api` to log `Nest application successfully started` and `minio-init` to exit 0 (bucket created).
3. In another shell: `docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:migrate && docker compose -f base.compose.yml -f dev.compose.yml exec api npm run prisma:seed`.
4. `docker compose -f base.compose.yml -f dev.compose.yml exec api ffmpeg -version | head -1` prints an ffmpeg version line (E03-03 (#79)).
5. Open http://localhost:3535/testing/login, sign in as `viewer-media@test.local` (role viewer) with the "with AI key" option from E01-10 (#30). You land on `/`.
6. Open http://localhost:3535/media (E03-07 (#96)). Empty state reads "No media yet".
7. Click **Add media**. On a phone (or Chrome DevTools device mode < 600px) the control is a single **Take photo or video** button that opens the camera; on desktop it is a drop zone plus **Choose files**. Drop a JPEG (< 25 MiB). Observe: thumbnail, progress bar to 100 %, then "Processing…" that resolves to "Ready" within ~5 s (E03-05 (#87) image normalization).
8. Drop a `.txt` file. Observe: inline error "File type text/plain is not allowed. Allowed: image/*, video/*" and **no** network call (client validation). Then `curl -s -X POST http://localhost:3535/api/storage/objects/upload/init -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{"name":"x.txt","size":10,"mimeType":"text/plain"}'` → HTTP 400 with the same message (server validation, E03-01 (#71)).
9. Drop a short MP4 (≤ 2 min, ≤ 500 MiB). Observe "Processing…" for a few seconds, then "Ready" with a frame strip (up to 8 thumbnails). DB check: `docker compose -f base.compose.yml -f dev.compose.yml exec postgres psql -U postgres -d appdb -c "select id, status, metadata->'_processing'->'video-frames'->>'durationMs' as duration_ms, jsonb_array_length(metadata->'_processing'->'video-frames'->'frames') as frames from storage_objects where mime_type like 'video/%' order by created_at desc limit 1;"` → status `ready`, `frames` between 1 and 8. `select count(*) from storage_objects where metadata->>'derivedFrom' = '<that id>';` equals `frames`.
10. Pick the video, choose purpose **Workout form**, type "Is my back rounding?", click **Ask the coach**. Observe: a result card with a summary, observations, advice, and (from the fake server's canned response) a caution flag rendered as a warning `Alert`. `select purpose, ai_summary->>'summary' from media_attachments order by created_at desc limit 1;` shows the same summary. `select persona, status, attachment_count from ai_invocations order by created_at desc limit 1;` → `media_analyst`, `succeeded`, `attachment_count` = number of frames.
11. Delete the video from the library. `select count(*) from storage_objects where id = '<id>' or metadata->>'derivedFrom' = '<id>';` → 0 (parent and frames gone, E03-03 (#79)); `select count(*) from media_attachments where storage_object_id = '<id>';` → 0 (cascade, E03-02 (#74)).
12. Sign in as `admin-media@test.local` (role admin) in a private window. `GET /api/storage/objects/<viewer's remaining image id>` → 200 (`storage:read_any`, E03-01 (#71)). Sign in as a second viewer: same request → 404 (ownership; E03-04 (#83) semantics for attachments, 403 for raw storage objects as today).
13. Quota: with `STORAGE_USER_QUOTA_BYTES=1048576` in `.env` and the api restarted, uploading a 2 MiB image as any user returns HTTP 413 and the picker shows "You have used all of your 1 MiB storage" (E03-05 (#87)).
14. `cd tests/e2e && npx playwright test specs/media-attachments.spec.ts` passes (E03-08 (#103)).

## Child issues

### E03-01 `fix(api): enforce storage MIME allowlist and size limits` — #71

**Part of epic:** E03 · **Blocked by:** none · **Component:** api, infra, database · **Priority:** P0 · **Agents:** backend-dev → database-dev → testing-dev → docs-dev

#### Problem statement
`storage.allowedMimeTypes` and `storage.maxFileSize` exist in `apps/api/src/config/configuration.ts` and `.env.example` but nothing reads them: any authenticated user can upload any content type of any size (up to the 100 MiB Fastify multipart cap for simple uploads, 10,000 parts for multipart). `simpleUpload` persists `size: 0` forever. `CLAUDE.md` promises "images only, size/type limits" and admin `storage:read_any/write_any/delete_any` permissions; the first is unenforced and the last two do not exist. Every later child of this epic and every E09 media flow depends on user-uploaded photos and videos, so the allowlist must be real before the product starts inviting uploads (VISION §14, §16; PRD §86 data minimization). There is also no object store in compose, so none of this can be verified from a clean clone.

#### Proposed solution
Wire the two config values into both upload paths, fix the size bookkeeping, make the admin `*_any` permissions exist and be honored, and add a MinIO compose overlay so storage can be exercised locally.

**Data (database-dev)** — No Prisma model change. `apps/api/src/common/constants/roles.constants.ts`: add `STORAGE_READ_ANY: 'storage:read_any'` and `STORAGE_WRITE_ANY: 'storage:write_any'`. `apps/api/prisma/seed.ts`: add both to the `PERMISSIONS` array (descriptions "Admin: read any object's metadata and download URL", "Admin: update any object's metadata") and to `ROLE_PERMISSIONS.admin` only. Seed uses `upsert`, so re-running it on an existing database adds the rows. Migration: n/a.

**API (backend-dev)**
- New pure module `apps/api/src/storage/objects/mime-allowlist.ts` (new): `export function isMimeTypeAllowed(mimeType: string, patterns: readonly string[]): boolean`. Lowercases, strips parameters (`image/jpeg; charset=…` → `image/jpeg`), supports exact matches and one trailing `/*` wildcard (`image/*`). Empty pattern list denies everything. `export function formatAllowedMimeTypes(patterns)` → `"image/*, video/*"` for messages.
- `configuration.ts`: change `MAX_FILE_SIZE` default from 10 GiB to **524288000** (500 MiB) and `ALLOWED_MIME_TYPES` default to **`image/*,video/*`** (PDF dropped: no product use, and "images only" was the documented intent). Update `.env.example` and its comments to match.
- `ObjectsService.initUpload(dto, userId)`: before touching the provider, `if (!isMimeTypeAllowed(dto.mimeType, allowed)) throw new BadRequestException(\`File type "${dto.mimeType}" is not allowed. Allowed: ${formatAllowedMimeTypes(allowed)}\`)`; `if (dto.size > maxFileSize) throw new BadRequestException(\`File is ${size} bytes; the limit is ${maxFileSize} bytes (${humanBytes})\`)`. Also tighten `initUploadSchema.mimeType` to `z.string().regex(/^[\w.+-]+\/[\w.+-]+$/)`.
- `ObjectsService.simpleUpload(file, userId)`: validate `file.mimetype` the same way **before** `storageProvider.upload`. Pipe the multipart stream through a byte-counting `Transform` (`apps/api/src/storage/objects/byte-counter.stream.ts` (new)); when the count exceeds `maxFileSize` destroy the stream with a `PayloadTooLargeException`-carrying error, best-effort `storageProvider.delete(storageKey)`, and rethrow as `BadRequestException` with the same size message. On success write the counted bytes into `size` (fixes the permanent `0`). Note the Fastify multipart `limits.fileSize` in `main.ts` stays at 100 MiB and is the hard ceiling for the simple path; change it to `Math.min(100 MiB, storage.maxFileSize)` read from config so the two cannot disagree.
- `getObjectWithAuthCheck(id, user: RequestUser, action: 'read' | 'write' | 'delete')` replaces the `userId` signature. Owner passes always; otherwise pass when `user.permissions` includes `storage:read_any` (read), `storage:write_any` (write), `storage:delete_any` (delete). Non-owner without the permission → `ForbiddenException` as today. `getById`, `getDownloadUrl`, `updateMetadata`, `delete` take `RequestUser`; the controller passes `@CurrentUser() user: RequestUser` (the decorator already exposes `permissions`). `getUploadStatus`, `completeUpload`, `abortUpload` and `list` remain owner-only (uploads in flight are never an admin concern; an admin listing is out of scope).
- Audit: existing `storage:object:delete` / `storage:object:metadata:update` events gain `meta.actedAsAdmin: true` when the actor is not the owner. No new audit actions.
- OpenAPI: no new tag. Add `@ApiResponse({ status: 400, description: 'MIME type not allowed or file too large' })` to `initUpload` and `simpleUpload`; update the `Storage` tag description in `apps/api/src/openapi/tags.ts` ("A caller sees only the objects they uploaded, unless they hold `storage:read_any`…").

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/storage/objects/upload/init` | `@Auth()` | `{name,size,mimeType}` | 201 as today; **400** on disallowed MIME or `size > maxFileSize` |
| POST | `/api/storage/objects` | `@Auth()` | multipart `file` | 201 with real `size`; **400** on disallowed MIME or oversize (stream aborted) |
| GET | `/api/storage/objects/:id`, `/:id/download` | `@Auth()`; owner or `storage:read_any` | — | as today |
| PATCH | `/api/storage/objects/:id/metadata` | `@Auth()`; owner or `storage:write_any` | as today | as today |
| DELETE | `/api/storage/objects/:id` | `@Auth()`; owner or `storage:delete_any` | — | 204 |

**Infra** — `infra/compose/minio.compose.yml` (new): service `minio` (`minio/minio:RELEASE.2025-04-22T22-12-26Z` or newer, `server /data --console-address :9001`, ports `9000:9000`, `9001:9001`, volume `minio-data`, env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from `.env` defaulting to `minioadmin`, `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3535`) and one-shot `minio-init` (`minio/mc`, `mc alias set local http://minio:9000 … && mc mb -p local/$S3_BUCKET`). `api` gets `depends_on: minio-init: condition: service_completed_successfully`. `.env.example` gains a commented MinIO block (`S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`, bucket, creds) and `S3StorageProvider` reads `S3_FORCE_PATH_STYLE` into `forcePathStyle` (MinIO needs it; AWS ignores it). Presigned part URLs point at `S3_ENDPOINT`; for browser PUTs from the picker (E03-06 (#91)) add `S3_PUBLIC_ENDPOINT` (default = `S3_ENDPOINT`) used **only** when signing URLs, so compose can sign against `http://localhost:9000` while the API talks to `http://minio:9000`.

**UI (frontend-dev)** — n/a (E03-06 (#91) mirrors the limits client-side).

**Tests (testing-dev)**
- Unit `apps/api/src/storage/objects/mime-allowlist.spec.ts` (new): exact, wildcard, parameters stripped, case-insensitive, empty list denies, `application/pdf` rejected under the new default.
- Unit `apps/api/src/storage/objects/objects.service.spec.ts` (extend): `initUpload` rejects `text/plain` with the exact message; rejects `size = maxFileSize + 1`; accepts `size = maxFileSize`; `simpleUpload` rejects disallowed MIME before `storageProvider.upload` is called; `simpleUpload` aborts and deletes the key when the stream exceeds the limit; `simpleUpload` persists counted bytes; `getById` for a non-owner with `storage:read_any` succeeds, without it throws `ForbiddenException`; `delete` non-owner with `storage:delete_any` succeeds; `updateMetadata` non-owner with `storage:write_any` succeeds and audit meta carries `actedAsAdmin: true`.
- Integration `apps/api/test/storage/storage.integration.spec.ts` (extend): `POST /storage/objects/upload/init` with `mimeType: 'text/plain'` → 400 and message contains `not allowed`; oversize → 400; admin user (`createMockAdminUser` with the new permissions) reads another user's object → 200; contributor → 403.
- Seed/constants: `apps/api/src/common/constants/roles.constants.spec.ts` (extend or new) asserts every `PERMISSIONS` value appears in `seed.ts` — grep-style consistency test.
- Compose: `apps/api/test/production-image.spec.ts` unchanged; add `infra/compose/minio.compose.yml` to the `docker compose config` smoke in `docs/DEVELOPMENT.md` instructions (no test).

**Docs (docs-dev)** — `CLAUDE.md`: RBAC "Key Permissions" lines for storage become exactly `storage:read/write` (own objects) and `storage:read_any/write_any/delete_any` (Admin only, now real); Security Guidelines bullet "File uploads: images only…" → "File uploads: images and videos only (`ALLOWED_MIME_TYPES`), size limit (`MAX_FILE_SIZE`, 500 MiB default), randomized object keys"; Key Commands gains the `minio.compose.yml` overlay line. `docs/API.md` Storage Objects: document the 400s and the admin overrides. `docs/DEVELOPMENT.md`: MinIO section (console at http://localhost:9001). `.env.example` as above.

#### Acceptance criteria
- [ ] `POST /api/storage/objects/upload/init` with `mimeType: "text/plain"` returns 400 whose `message` names the type and the allowed list.
- [ ] `POST /api/storage/objects/upload/init` with `size` above `MAX_FILE_SIZE` returns 400; exactly `MAX_FILE_SIZE` is accepted.
- [ ] `POST /api/storage/objects` with a `.txt` part returns 400 and no object row or S3 key is created.
- [ ] `POST /api/storage/objects` with a valid image returns an object whose `size` equals the file's byte length (no longer `"0"`).
- [ ] A simple upload whose stream exceeds the limit is aborted, the partial key is deleted, and the response is 400.
- [ ] `storage:read_any` and `storage:write_any` exist in `roles.constants.ts` and in `seed.ts` (admin only); an admin can `GET`/`PATCH`/`DELETE` another user's object; a contributor gets 403.
- [ ] `ALLOWED_MIME_TYPES` default is `image/*,video/*`; `MAX_FILE_SIZE` default is 524288000; `.env.example` matches.
- [ ] `docker compose -f base.compose.yml -f dev.compose.yml -f minio.compose.yml up` brings up MinIO with the bucket created, and a simple upload succeeds end to end through nginx.
- [ ] `CLAUDE.md` no longer says "images only" and no longer lists permissions that are not seeded.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: validation failures are `BadRequestException` with human-readable messages (the exception filter derives `code` from status — do not try to attach custom codes); provider failures during abort are logged at `warn` and never mask the 400
- [ ] Observability: `ObjectsService` logs rejected uploads at `warn` with `userId`, `mimeType`, `size` (never the filename's user content beyond its extension)
- [ ] Security: non-owners reach objects only through the three `*_any` permissions; `list` stays owner-scoped; signed URLs unchanged
- [ ] Config & secrets: `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` documented in `.env.example`; no new secrets in code
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic script steps 1–3 (compose with `minio.compose.yml`, migrate, seed).
2. Epic step 8 (`text/plain` → 400 from `upload/init`).
3. `curl -s -X POST http://localhost:3535/api/storage/objects -H "Authorization: Bearer <viewer token>" -F file=@/etc/hostname` → 400 `not allowed`.
4. `curl -s -X POST http://localhost:3535/api/storage/objects -H "Authorization: Bearer <viewer token>" -F file=@photo.jpg` → 201; `data.size` equals `stat -c %s photo.jpg`. Open http://localhost:9001 (minioadmin/minioadmin) and see the key under `evolvepath-dev/uploads/`.
5. `psql`: `select name, description from permissions where name like 'storage:%';` lists five rows; `select r.name from roles r join role_permissions rp on rp.role_id=r.id join permissions p on p.id=rp.permission_id where p.name='storage:read_any';` → `admin` only.
6. As admin: `GET /api/storage/objects/<viewer's object id>` → 200. As a second viewer → 403.

#### Out of scope
- Per-user quota (E03-05 (#87)), per-kind size limits for video vs image (E03-05 (#87) image normalization and E03-03 (#79) duration cap cover the product need).
- Enforcing `storage:write` on upload routes: Viewer is the default EvolvePath role and every user uploads media, so uploads stay plain `@Auth()`. Documented as a deliberate decision in `docs/specs/media-attachments.md` (E03-08 (#103)).
- Admin listing of all objects (`GET /storage/objects?scope=all`).
- ffmpeg in the Dockerfile (E03-03 (#79)).

#### Notes for the implementing agent
- Pattern for pure validators with colocated specs: `apps/api/src/common/database-url.spec.ts`. Pattern for `RequestUser` in a service: `apps/api/src/auth/interfaces/authenticated-user.interface.ts` (`permissions: string[]` is already populated by `toRequestUser`).
- The existing `ForbiddenException` on non-owner is kept for raw storage objects; E03-04 (#83) deliberately returns 404 for attachments (do not "fix" one to match the other — the storage API is generic, the attachment API is a private resource).
- `objects.service.spec.ts` mocks `ConfigService.get` with `jest.fn()`; set `mockConfig.get.mockImplementation((key, def) => ({ 'storage.allowedMimeTypes': ['image/*','video/*'], 'storage.maxFileSize': 1000 }[key] ?? def))`.
- For the byte counter use `stream.pipeline` semantics: `@aws-sdk/lib-storage`'s `Upload` consumes the readable; a `Transform` in between is enough, but destroy **both** streams on overflow or the multipart parser keeps buffering.
- Fastify: `req.file()` throws `FST_REQ_FILE_TOO_LARGE` when the 100 MiB plugin cap trips before yours; map it to the same 400 message in the controller.
- Do not use bare `npx prisma`; `npm run prisma:seed` (add the script if missing — check `apps/api/package.json`).
- Compose file naming follows `otel.compose.yml`; the overlay must not redefine `api` beyond `depends_on` and `environment`.

---

### E03-02 `feat(db): add media attachments model` — #74

**Part of epic:** E03 · **Blocked by:** none · **Component:** database, api · **Priority:** P0 · **Agents:** database-dev → testing-dev → docs-dev

#### Problem statement
A raw `StorageObject` knows what was uploaded, not why. The product needs to know that *this* video is a form-check for *that* workout session, that *this* photo shows the user's equipment, and what the coach said about it — otherwise E06 and E09 cannot show "the coach's notes on your last squat video" or attach media to a commitment (VISION §14: "next time, EvolvePath remembers"; PRD §10.9 evidence is typed and sourced). PRD §86 (data minimization) and §85 (AI privacy) want the AI's conclusion stored once, in a structured field, not re-derived from a chat log.

#### Proposed solution
One table, `media_attachments`, that points at a storage object, records who owns it, what kind of media it is, what it is for, and optionally which product object it belongs to, plus the AI's last structured verdict.

**Data (database-dev)** — `apps/api/prisma/schema.prisma`:

```prisma
enum MediaKind {
  PHOTO
  VIDEO
}

enum MediaPurpose {
  WORKOUT_FORM
  EQUIPMENT
  MEAL
  GENERAL
}

model MediaAttachment {
  id              String        @id @default(uuid()) @db.Uuid
  userId          String        @map("user_id") @db.Uuid
  storageObjectId String        @unique @map("storage_object_id") @db.Uuid
  kind            MediaKind
  purpose         MediaPurpose  @default(GENERAL)
  targetType      String?       @map("target_type")   // e.g. "workout_session", "commitment", "outcome"
  targetId        String?       @map("target_id") @db.Uuid
  aiSummary       Json?         @map("ai_summary")     // shape governed by mediaAdviceSchema (E03-07 (#96)); null until asked
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime      @updatedAt @map("updated_at") @db.Timestamptz

  user          User          @relation("UserMediaAttachments", fields: [userId], references: [id], onDelete: Cascade)
  storageObject StorageObject @relation(fields: [storageObjectId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([targetType, targetId])
  @@map("media_attachments")
}
```

Add `mediaAttachments MediaAttachment[] @relation("UserMediaAttachments")` to `User` and `mediaAttachment MediaAttachment?` to `StorageObject`. `targetType`/`targetId` are polymorphic and **not** foreign keys (E09 targets do not exist yet); `targetType` values are validated by a Zod enum at the API boundary (E03-04 (#83)), not by the database. `storageObjectId` is `@unique`: one attachment per upload; re-purposing means uploading again. Migration: `npm run prisma:migrate:dev -- --name add_media_attachments`. Seed: none.

**API (backend-dev)** — n/a in this issue (E03-04 (#83)). Run `npm run prisma:generate` so `MediaKind`/`MediaPurpose` are importable.

**UI (frontend-dev)** — n/a.

**Tests (testing-dev)**
- `apps/api/test/prisma/media-attachments.schema.spec.ts` (new, real-DB `*.e2e.spec.ts` style if the project's Postgres test container is available; otherwise a schema-text spec like `production-image.spec.ts`): asserts the migration SQL creates `media_attachments` with `ON DELETE CASCADE` on both FKs, the unique index on `storage_object_id`, and both composite indexes; asserts the two enums list exactly the values above.
- Extend `apps/api/test/mocks/prisma.mock.ts` with `mediaAttachment: { create, findUnique, findFirst, findMany, delete, update, count }` so E03-04 (#83)'s integration tests have a mock delegate.

**Docs (docs-dev)** — `CLAUDE.md` Database Tables: add `media_attachments - User media (photo/video) with purpose, optional target and the coach's structured summary`. `docs/ARCHITECTURE.md` data model section if it lists tables.

#### Acceptance criteria
- [ ] `npm run prisma:migrate` on a clean database applies `add_media_attachments` without error.
- [ ] Deleting a user cascades to their `media_attachments`; deleting a storage object cascades to its attachment.
- [ ] Inserting two attachments with the same `storage_object_id` fails with a unique violation.
- [ ] `MediaKind` and `MediaPurpose` exist in `@prisma/client` after `npm run prisma:generate`.
- [ ] `prisma.mock.ts` exposes a `mediaAttachment` delegate.
- [ ] `CLAUDE.md` Database Tables lists the new table.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: n/a (schema only)
- [ ] Observability: n/a
- [ ] Security: both FKs cascade so orphaned media metadata cannot outlive its owner or its object
- [ ] Config & secrets: none
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–3.
2. `psql -U postgres -d appdb -c "\d media_attachments"` shows the columns, `media_attachments_storage_object_id_key` unique index, and both FKs with `ON DELETE CASCADE`.
3. `psql -c "select enum_range(null::\"MediaPurpose\")"` → `{WORKOUT_FORM,EQUIPMENT,MEAL,GENERAL}`.

#### Out of scope
- Any endpoint (E03-04 (#83)), any UI.
- Foreign keys to `workout_sessions` / `commitments` (E09 may add a check constraint or a typed join later).
- Storing multiple AI verdicts per attachment (the latest overwrites `aiSummary`; history lives in `ai_invocations`).

#### Notes for the implementing agent
- Follow the mapping conventions already in `schema.prisma`: `@map` snake_case columns, `@db.Uuid`, `@db.Timestamptz`, `@@map` table names.
- Do not add `aiSummary` typing in Prisma; the Zod schema lives in `apps/api/src/media/dto/media-advice.schema.ts` (E03-07 (#96)) and is the only place the JSON shape is enforced.
- Keep the migration to this table; do not touch `storage_objects`.

---

### E03-03 `feat(api): add video frame sampling processor` — #79

**Part of epic:** E03 · **Blocked by:** E03-01 (#71) · **Component:** api, infra · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
The AI gateway (E01-06 (#26)) can only send images. A form-check video is the single most valuable media input in the Health domain (VISION §14; PRD §41, §45) and the only way to give the coach a video is to turn it into a small set of representative frames — the "smallest sufficient context" PRD §87 demands. Nothing in the repo runs ffmpeg, the API image has no ffmpeg, and the processing pipeline has zero registered processors.

#### Proposed solution
A storage `ObjectProcessor` that, for every uploaded `video/*` object, probes it, extracts N evenly spaced JPEG frames, stores each frame as a child `StorageObject`, and writes the exact metadata shape the E01 resolver reads.

**Data (database-dev)** — n/a. Frames are ordinary `StorageObject` rows: `mimeType: 'image/jpeg'`, `status: 'ready'`, `uploadedById` = parent's `uploadedById`, `storageKey: derived/<parentId>/frame-<index>.jpg`, `metadata: { derivedFrom: <parentId>, frameIndex, timestampMs, width, height }`.

**API (backend-dev)**
- `apps/api/Dockerfile`: base stage `RUN apk add --no-cache openssl ffmpeg` (ffmpeg brings ffprobe). Every stage inherits it, including production and development.
- `apps/api/src/config/configuration.ts`: `ai.video.maxFrames` (`AI_VIDEO_MAX_FRAMES`, default 8, clamped 1–16), `ai.video.maxDurationSeconds` (`AI_VIDEO_MAX_SECONDS`, default 120), `ai.video.frameLongestEdge` (default 1024, no env), `ai.video.ffmpegPath` / `ffprobePath` (`FFMPEG_PATH`, `FFPROBE_PATH`, default `ffmpeg` / `ffprobe`).
- `apps/api/src/storage/processing/processors/video-frames.processor.ts` (new): `@Injectable() class VideoFramesProcessor implements ObjectProcessor` — `name = 'video-frames'`, `priority = 50`, `canProcess(o) = o.mimeType.startsWith('video/') && !(o.metadata as any)?.derivedFrom`. Constructor injects `PrismaService`, `STORAGE_PROVIDER`, `ConfigService`. `process(object, getStream)`:
  1. `mkdtemp(join(tmpdir(), 'evolvepath-video-'))`; stream the object to `<tmp>/input` (`pipeline(await getStream(), createWriteStream(...))`). ffmpeg needs a seekable file (MP4 `moov` atoms are often at the end).
  2. `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,side_data_list:format=duration -of json input` via `execFile` (timeout 30 s, `maxBuffer` 1 MiB). Parse `durationMs` (stream duration, fallback format duration), `width`, `height` (swap when a rotation side-data of ±90 is present). No video stream → `{ success: false, error: 'no video stream' }`. `durationMs > maxDurationSeconds * 1000` → `{ success: false, error: \`video is ${s}s; the limit is ${max}s\` }`.
  3. `N = min(maxFrames, max(1, floor(durationMs / 500)))` so a 1-second clip yields 2 frames, not 8 near-identical ones. Timestamps `t_i = (i + 0.5) * durationMs / N`.
  4. For each `i`: `ffmpeg -hide_banner -loglevel error -ss <t_i seconds> -i input -frames:v 1 -vf "scale='if(gt(iw,ih),min(1024,iw),-2)':'if(gt(iw,ih),-2,min(1024,ih))'" -q:v 3 -y <tmp>/frame-<i>.jpg` (`-q:v 3` ≈ JPEG quality 80; `-ss` before `-i` for fast seek; ffmpeg auto-rotates by default). `execFile` timeout 60 s each. Read the JPEG, `storageProvider.upload(key, Readable.from(buf), { mimeType: 'image/jpeg', contentLength })`, `prisma.storageObject.create` the child with the metadata above. Frame dimensions from the scale expression (compute in TS; do not re-probe).
  5. Return `{ success: true, metadata: { frames: [{ objectId, timestampMs }], durationMs, width, height, frameCount } }` — the pipeline stores it at `metadata._processing['video-frames']`, which is exactly what `AiAttachmentResolverService` (E01-06 (#26)) reads.
  6. `finally`: `rm(tmp, { recursive: true, force: true })`. On any failure after some frames were created, delete those children (S3 + rows) before returning `{ success: false, error }` so a `failed` parent never leaves orphans.
- Registration: `apps/api/src/storage/processing/processors/storage-processors.module.ts` (new): `providers: [VideoFramesProcessor, { provide: OBJECT_PROCESSOR, useFactory: (v) => [v], inject: [VideoFramesProcessor] }]`, `exports: [OBJECT_PROCESSOR]`; `ObjectProcessingModule` imports it. NestJS has no `multi: true`; the array factory is the supported way and `ObjectProcessingService` already normalizes arrays. E03-05 (#87) adds a second processor to the same factory. Fix `processors/README.md` accordingly.
- `ObjectsService.delete(id, user)`: after the auth check, `findMany({ where: { metadata: { path: ['derivedFrom'], equals: id } } })` → delete each child's key and row, then the parent. Log the count. Deleting a frame directly is allowed (owner) and leaves a dangling `frames[]` entry; the resolver already skips objects that are not `ready`/present — document, do not guard.
- `ObjectProcessingService`: no change, except `markFailed` is reached when the processor returns `success: false`; the reason is at `metadata._processing['video-frames_error']`. Wrap `process` in a `@Trace('storage.video-frames')` span with attributes `storage.object_id`, `video.duration_ms`, `video.frame_count`.
- OpenAPI: none (no endpoint). `ObjectResponseDto.metadata` already exposes `_processing`.

**UI (frontend-dev)** — n/a (E03-06 (#91) renders `frames[]` as a strip).

**Tests (testing-dev)**
- Unit `apps/api/src/storage/processing/processors/video-frames.processor.spec.ts` (new). Guard: `const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0; (hasFfmpeg ? describe : describe.skip)('VideoFramesProcessor (ffmpeg)', …)` with a single always-run test that logs "skipped: ffmpeg not on PATH". In `beforeAll`, generate the fixture: `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -pix_fmt yuv420p -y <tmp>/testsrc.mp4`. Cases: (a) 2 s clip with `maxFrames = 8` → `frameCount === 4` (`floor(2000/500)`), timestamps `[250, 750, 1250, 1750]`, `width 320`, `height 240`, `durationMs ≈ 2000 ± 100`; (b) `maxFrames = 2` → 2 frames; (c) one child `storageObject.create` per frame with `metadata.derivedFrom` = parent id, `mimeType 'image/jpeg'`, `status 'ready'`, `uploadedById` = parent's; (d) provider `upload` called with a buffer whose first bytes are `FF D8` (JPEG SOI); (e) `maxDurationSeconds = 1` → `success: false`, error mentions the limit, zero `create` calls; (f) a non-video buffer (`Readable.from('not a video')`) → `success: false`, no throw; (g) temp dir removed after success and after failure; (h) `canProcess` false for `image/*` and for a video with `metadata.derivedFrom`; (i) a 640×360 fixture (`size=1280x720`) scales to longest edge 1024 → frame metadata `width 1024, height 576`. Use `createMockPrismaService` and `createMockStorageProvider`.
- Unit `objects.service.spec.ts` (extend): `delete` removes children found by `derivedFrom` before the parent, calls `storageProvider.delete` once per child + parent.
- Integration `apps/api/test/storage/processing.integration.spec.ts` (new): with `overrideProviders: [{ provide: OBJECT_PROCESSOR, useValue: [stubProcessor] }]` assert the pipeline stores `metadata._processing['video-frames']` under that key and marks `ready`; with a stub returning `success: false` assert status `failed` and `_processing['video-frames_error']`.
- `apps/api/test/production-image.spec.ts` (extend): the base stage's `apk add` line contains `ffmpeg`.

**Docs (docs-dev)** — `processors/README.md`: correct the registration section (array factory, not `multi: true`) and add the video-frames processor to "Example Processors" with the metadata shape. `CLAUDE.md` env section: `AI_VIDEO_MAX_FRAMES`, `AI_VIDEO_MAX_SECONDS`, `FFMPEG_PATH`, `FFPROBE_PATH`. `.env.example` same. `docs/specs/ai-gateway.md` (E01-12 (#32)) already names the shape — link to it.

#### Acceptance criteria
- [ ] The dev and production API images contain `ffmpeg` and `ffprobe` (`docker compose exec api ffprobe -version` works).
- [ ] Uploading an MP4 ≤ `AI_VIDEO_MAX_SECONDS` ends with `status: ready` and `metadata._processing['video-frames'] = { frames: [{objectId, timestampMs}], durationMs, width, height, frameCount }` with `1 ≤ frames.length ≤ AI_VIDEO_MAX_FRAMES`.
- [ ] Every `frames[].objectId` resolves to a `ready` `image/jpeg` storage object owned by the uploader whose longest edge is ≤ 1024 px and whose `metadata.derivedFrom` is the parent id.
- [ ] A video longer than the limit ends `failed` with `_processing['video-frames_error']` naming the limit; no frame objects exist.
- [ ] A corrupt upload ends `failed`; the API process does not crash and the temp directory is gone.
- [ ] `DELETE /api/storage/objects/:parentId` removes every frame object and key.
- [ ] Child frames are never re-processed (no recursion: `canProcess` returns false for `derivedFrom` objects).
- [ ] The unit spec runs the ffmpeg cases locally when ffmpeg is installed and skips cleanly (not fails) when it is not.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: every ffmpeg/ffprobe failure, timeout, and parse error becomes `{ success: false, error }` (never an unhandled rejection); partial children are cleaned up; stderr is truncated to 500 chars before it lands in metadata
- [ ] Observability: one span per processed video with duration/frame-count attributes; `log` at start/end with object id, `warn` on failure; never log file paths from user filenames
- [ ] Security: ffmpeg is invoked with `execFile` and an argv array (no shell); input path is the temp file the API wrote, never a user string; temp dirs are per-object and removed
- [ ] Config & secrets: `AI_VIDEO_MAX_FRAMES` (8, cap 16), `AI_VIDEO_MAX_SECONDS` (120), `FFMPEG_PATH`, `FFPROBE_PATH` documented with defaults
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–5.
2. `ffmpeg -f lavfi -i testsrc=duration=3:size=640x480:rate=24 -pix_fmt yuv420p clip.mp4` on the host.
3. `curl -s -X POST http://localhost:3535/api/storage/objects -H "Authorization: Bearer <token>" -F file=@clip.mp4 | jq .data.id` → `<id>`.
4. Poll `GET /api/storage/objects/<id>` until `status` is `ready` (≤ 10 s). `jq '.data.metadata._processing["video-frames"]'` shows `frameCount: 6`, `durationMs ≈ 3000`, `width 640`, `height 480`.
5. `GET /api/storage/objects/<frames[0].objectId>/download` → signed URL; open it: a 640×480 JPEG of the test pattern at ~0.25 s.
6. `ffmpeg -f lavfi -i testsrc=duration=200:size=320x240:rate=5 long.mp4`; upload; `status` becomes `failed`, `metadata._processing["video-frames_error"]` mentions `120s`.
7. `DELETE /api/storage/objects/<id>` → 204; MinIO console shows no `derived/<id>/` keys; `psql`: `select count(*) from storage_objects where metadata->>'derivedFrom'='<id>';` → 0.

#### Out of scope
- Image normalization (E03-05 (#87)), thumbnails for the UI beyond reusing frame 0, transcoding, audio.
- Scene-change detection or smart frame selection; evenly spaced is the V1 rule.
- Queueing/backpressure for many concurrent videos (pipeline runs in-process on the event loop's thread pool; noted as a follow-up in the spec).

#### Notes for the implementing agent
- Interface: `apps/api/src/storage/processing/object-processor.interface.ts`. Pipeline: `object-processing.service.ts` — note `allMetadata[processor.name] = result.metadata`, so the processor `name` **is** the metadata key the resolver reads (`'video-frames'`, hyphen, exactly).
- The processor writes rows directly with `PrismaService`; do **not** emit `OBJECT_UPLOADED_EVENT` for children (they are born `ready`).
- `execFile` from `node:child_process` with `{ timeout, maxBuffer, windowsHide: true }`; reject on non-zero exit and include the last 500 chars of stderr.
- Alpine's `ffmpeg` package supports H.264/HEVC decode, MP4/MOV/WebM demux; that covers iOS and Android captures. HEIC/HEIF stills are E03-05 (#87)'s problem.
- ffprobe reports rotation under `side_data_list[].rotation` (newer builds) or `tags.rotate` (older); handle both, treat ±90/±270 as a swap.
- Temp dir under `os.tmpdir()`; in the container that is `/tmp` on the overlay FS — fine for 500 MiB inputs; document `TMPDIR` as the override.
- Prisma JSON filter for children: `where: { metadata: { path: ['derivedFrom'], equals: parentId } }` (Postgres JSONB path filter).
- Do not add `fluent-ffmpeg` or any wrapper dependency; two `execFile` calls are the whole integration.

---

### E03-04 `feat(api): add media attachment endpoints` — #83

**Part of epic:** E03 · **Blocked by:** E03-01 (#71), E03-02 (#74) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
Clients need a product-level way to say "this upload is a form-check for this session" and to ask "is it ready for the coach yet?" without reasoning about `_processing` JSON. The storage API is generic and permission-based; the attachment API is a private, purpose-typed resource with the ownership semantics the rest of EvolvePath uses (per-user resources, 404 for anything you do not own). PRD §10.9 (evidence has a source and type), §85 (AI privacy: media is the user's), VISION §14.

#### Proposed solution
A `MediaModule` with a controller under `/media/attachments` and a service that validates the storage object, creates the attachment, derives processing state, and exposes a preview URL.

**Data (database-dev)** — n/a (E03-02 (#74)).

**API (backend-dev)** — `apps/api/src/media/` (new): `media.module.ts` (imports `PrismaModule`, `StorageModule`, `CommonModule`; exports `MediaAttachmentsService`; registered in `app.module.ts` after `StorageModule`), `media-attachments.controller.ts`, `media-attachments.service.ts`, `dto/create-media-attachment.dto.ts`, `dto/media-attachment-response.dto.ts`, `dto/media-attachment-list-query.dto.ts`, `media-target-types.ts` (`MEDIA_TARGET_TYPES = ['workout_session','commitment','outcome','coach_message'] as const`).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/media/attachments` | `@Auth()` (owner of the storage object) | `{ storageObjectId: uuid, purpose: enum(MediaPurpose), targetType?: enum(MEDIA_TARGET_TYPES), targetId?: uuid }` (`targetId` requires `targetType` and vice versa, `superRefine`) | 201 `MediaAttachmentResponseDto`; 404 if the storage object is not the caller's; 400 if its MIME is not `image/*`/`video/*` or status is `failed`; 409 if already attached |
| GET | `/api/media/attachments` | `@Auth()` | query `targetType?`, `targetId?`, `purpose?`, `page` (1), `pageSize` (20, max 100) | 200 nested list `{ items, meta }` (same shape as storage list), caller's rows only, newest first |
| GET | `/api/media/attachments/:id` | `@Auth()` | — | 200 `MediaAttachmentResponseDto`; 404 if absent **or not the caller's** |
| DELETE | `/api/media/attachments/:id` | `@Auth()` | — | 204; deletes the attachment **and** its storage object (via `ObjectsService.delete`, which cascades frames); 404 if not the caller's |
| GET | `/api/media/attachments/:id/preview` | `@Auth()` | query `variant?: 'original' \| 'ai' \| 'frame'`, `frameIndex?` | 200 `{ url, expiresIn, variant }` signed URL; `ai` returns the normalized variant when present (E03-05 (#87)) else original; `frame` returns frame `frameIndex` (default 0) for videos; 400 when the object is not `ready` |

`MediaAttachmentResponseDto` (zod + `createZodDto`, like `object-response.dto.ts`): `{ id, storageObjectId, kind: 'PHOTO'|'VIDEO', purpose, targetType, targetId, processingStatus: 'processing'|'ready'|'failed', processingError: string|null, media: { mimeType, size: string, width: number|null, height: number|null, durationMs: number|null, frameCount: number|null }, aiSummary: MediaAdvice|null, createdAt, updatedAt }`. `processingStatus` maps `StorageObject.status`: `pending|uploading|processing` → `processing`, `ready` → `ready`, `failed` → `failed`; `processingError` = the first `_processing.*_error` string. `media.*` read from `_processing['video-frames']` / `_processing['image-normalize']` when present, else nulls. `kind` derived from MIME at creation (`image/*` → PHOTO, `video/*` → VIDEO).

Service `MediaAttachmentsService`: `create(dto, userId)`, `list(query, userId)`, `getOwned(id, userId)` (throws `NotFoundException` for both missing and foreign — never 403, so existence is not leaked), `delete(id, user)`, `getPreviewUrl(id, userId, variant, frameIndex)`. Audit via `prisma.auditEvent.create` with `targetType: 'media_attachment'`: `media:attach` (`meta: { storageObjectId, purpose, targetType, targetId, kind }`), `media:delete`. No audit on reads. Unique-violation on `storageObjectId` → `ConflictException('This upload is already attached')`.

OpenAPI: register tag **`Media`** in `apps/api/src/openapi/tags.ts` in a new group `EvolvePath` (create the group if E01/E02 have not; it sits before `Storage`), description: "User photos and videos attached to product objects for coaching. Private to the uploader; processing state derived from storage." `test/openapi/openapi-document.spec.ts` fails on undeclared tags, so this is not optional.

**UI (frontend-dev)** — n/a here; E03-06 (#91) adds `services/api.ts` functions and `types/index.ts` types matching the DTOs above (`MediaAttachment`, `MediaPurpose`, `MediaTargetType`, `MediaPreview`).

**Tests (testing-dev)**
- Unit `apps/api/src/media/media-attachments.service.spec.ts` (new): kind derivation; `processingStatus` mapping for all five storage statuses; `processingError` picks `video-frames_error`; `media.durationMs/frameCount` from `_processing`; `create` with a foreign storage object → `NotFoundException`; with `application/pdf` → `BadRequestException`; unique violation (`PrismaClientKnownRequestError` code `P2002`) → `ConflictException`; `delete` calls `ObjectsService.delete` with the object id; `getPreviewUrl('frame', 2)` resolves `frames[2].objectId` and 400 when out of range.
- Integration `apps/api/test/media/media-attachments.integration.spec.ts` (new, `createTestApp` + `overrideProviders` for `STORAGE_PROVIDER`): POST 201 round-trip; POST with `targetId` but no `targetType` → 400; GET list filtered by `targetType/targetId` returns only the caller's rows; GET `:id` as another user → 404 (assert body has no hint); DELETE → 204 and `storageObject.delete` mock called; preview on a `processing` object → 400; preview `variant=frame` → the frame's key is signed, not the parent's.
- `test/openapi/openapi-document.spec.ts` passes with the new `Media` tag.

**Docs (docs-dev)** — `docs/API.md`: new "Media Attachments" section with the five endpoints, DTO, and the 404-for-foreign rule. `CLAUDE.md` API Endpoints: "Media" block; Database Tables already updated (E03-02 (#74)).

#### Acceptance criteria
- [ ] `POST /api/media/attachments` with the caller's `ready` image returns 201 with `kind: "PHOTO"`, `processingStatus: "ready"`.
- [ ] Attaching a storage object still `processing` returns 201 with `processingStatus: "processing"`; a later `GET /:id` reports `ready` once the pipeline finishes, with `media.frameCount` for videos.
- [ ] Attaching another user's storage object returns 404; attaching a `text/plain` object (only possible for pre-existing rows) returns 400; attaching the same object twice returns 409.
- [ ] `GET /api/media/attachments?targetType=workout_session&targetId=<uuid>` returns only matching rows of the caller.
- [ ] `GET`/`DELETE` on a foreign attachment id return 404 with the generic not-found body.
- [ ] `DELETE` removes the attachment, the storage object, and any derived frames.
- [ ] `GET /:id/preview?variant=frame&frameIndex=0` returns a signed URL to the first frame of a video; `variant=ai` on a photo returns the normalized variant when E03-05 produced one.
- [ ] `Media` tag appears under the `EvolvePath` group at `/api/docs`.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: 404 (missing or foreign), 400 (bad MIME, not ready for preview, inconsistent target), 409 (already attached); Zod validation errors surface through `ZodValidationPipe` as 400
- [ ] Observability: audit `media:attach` / `media:delete`; `log` line per create/delete with attachment id and purpose (no filenames)
- [ ] Security: every read and write is scoped by `userId`; storage object ownership re-checked at create; preview URLs use the existing signed-URL expiry
- [ ] Config & secrets: none new
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–5; upload `photo.jpg` and `clip.mp4` via `POST /api/storage/objects` (E03-01 (#71) script) → `<img>`, `<vid>`.
2. `curl -s -X POST http://localhost:3535/api/media/attachments -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{"storageObjectId":"<vid>","purpose":"WORKOUT_FORM"}' | jq .data` → `kind: "VIDEO"`, `processingStatus` `processing` or `ready`.
3. Repeat step 2 → 409.
4. `GET /api/media/attachments/<id>` until `processingStatus: "ready"`; `media.frameCount` ≥ 1.
5. `GET /api/media/attachments/<id>/preview?variant=frame` → open `url`: the first frame.
6. With a second user's token: `GET /api/media/attachments/<id>` → 404.
7. `DELETE /api/media/attachments/<id>` → 204; `GET /api/storage/objects/<vid>` → 404.

#### Out of scope
- The `ask` endpoint (E03-07 (#96)), any UI (E03-06 (#91)/07).
- Admin access to attachments (admins use the raw storage API with `*_any`).
- Validating that `targetId` exists in its target table (targets arrive in E05/E09; they may add validation there).

#### Notes for the implementing agent
- Copy structure from `apps/api/src/pat/` (per-user resource, plain `@Auth()`, ownership in the service) and DTO style from `apps/api/src/storage/objects/dto/object-response.dto.ts` (`createZodDto`, BigInt as string).
- `ObjectsService.delete(id, user)` now takes `RequestUser` (E03-01 (#71)); `MediaAttachmentsService.delete` receives `@CurrentUser() user` and forwards it. Delete the attachment row first inside a `$transaction`, then call `ObjectsService.delete` outside it (S3 calls do not belong in a DB transaction); the FK cascade would also remove the row, but explicit-first makes the audit order deterministic.
- Nested list shape and `@ApiDataResponse(Dto, { pagination: 'nested' })` as in `ObjectsController.list`.
- Register the tag group before writing the controller; the OpenAPI spec test runs in the default `npm test`.
- Zod 4: `z.enum(MediaPurpose)` works with Prisma's enum object as in `objectResponseSchema`.

---

### E03-05 `feat(api): media pipeline hardening` — #87

**Part of epic:** E03 · **Blocked by:** E03-01 (#71), E03-03 (#79), E01-06 (#26) · **Component:** api · **Priority:** P0 · **Agents:** backend-dev → testing-dev → docs-dev

#### Problem statement
Three gaps stand between "uploads work" and "uploads are safe to hand to the AI at scale": (1) phones produce HEIC/HEIF stills with EXIF GPS and 12-megapixel dimensions — the gateway would inline 8 MiB of base64 with the user's location embedded, violating PRD §85/§86 and the E01 `maxImageBytes` cap; (2) inlining is the only attachment mode, but production object stores can serve short-lived signed URLs the provider fetches itself (PRD §118 AI cost strategy: smaller requests); (3) nothing bounds how much a single user can store. The E01 design already anticipated this issue ("E03 adjustment": the resolver ships in E01-06 (#26); E03-05 (#87) adds signed-url mode, image normalization and quota).

#### Proposed solution
**Data (database-dev)** — n/a. AI variants are child `StorageObject`s like frames: `metadata: { derivedFrom, variant: 'ai', width, height }`, key `derived/<parentId>/ai.jpg`.

**API (backend-dev)**
1. **Image normalization processor** `apps/api/src/storage/processing/processors/image-normalize.processor.ts` (new): `name = 'image-normalize'`, `priority = 40` (before video-frames; order is irrelevant since `canProcess` is disjoint), `canProcess(o) = o.mimeType.startsWith('image/') && !metadata.derivedFrom`. Dependencies: `sharp` (`npm i sharp --workspace=api`; prebuilt `@img/sharp-linuxmusl-*` binaries install under `npm ci --ignore-scripts`, no build step) and `heic-convert` (`npm i heic-convert --workspace=api`; WASM libheif — sharp's prebuilt libvips does **not** decode HEIC). Steps: buffer the stream (images are ≤ 25 MiB in practice; enforce `ai.attachments.maxSourceImageBytes`, `AI_MAX_SOURCE_IMAGE_BYTES` default 26214400, fail beyond); if `image/heic|heif` → `heic-convert({ buffer, format: 'JPEG', quality: 0.9 })`; then `sharp(buf).rotate()` (applies EXIF orientation) `.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })` **without** `.withMetadata()` (strips EXIF/GPS/ICC); upload as child, create the row, return `{ success: true, metadata: { aiVariantObjectId, width, height, sourceWidth, sourceHeight, sourceFormat, exifStripped: true } }` → stored at `metadata._processing['image-normalize']`. Corrupt or unsupported input → `{ success: false, error }`. Register in `StorageProcessorsModule`'s factory array (E03-03 (#79)).
2. **Resolver preference** `apps/api/src/ai/attachments/ai-attachment-resolver.service.ts` (E01-06 (#26), extend): for an `image/*` object, if `metadata._processing['image-normalize'].aiVariantObjectId` exists and that object is `ready`, use it instead of the original; otherwise fall back to the original **only if** its `size ≤ ai.attachments.maxImageBytes`, else `{ ok: false, error: { code: 'attachment', message: 'image too large and no normalized variant' } }`. Frames from E03-03 (#79) are already ≤ 1024 px and need no variant.
3. **Signed-url mode** `configuration.ts` `ai.attachments.mode` (`AI_ATTACHMENT_MODE`, `'inline' | 'signed-url'`, default `inline`). In `signed-url` mode the resolver emits `{ type: 'input_image', image_url: <signed GET URL>, detail }` using `storageProvider.getSignedDownloadUrl(key, { expiresIn: ai.attachments.signedUrlTtlSeconds })` (`AI_ATTACHMENT_SIGNED_URL_TTL`, default 300) instead of a data URL. The OpenAI provider (E01-03 (#23)) already accepts `image_url` strings; add a unit test that the provider passes an `https://` URL through untouched. Startup validation: `signed-url` mode with `S3_ENDPOINT` set to a non-public host (`http://minio:9000`, any `http://`) logs a `warn` "provider cannot fetch private endpoints; use S3_PUBLIC_ENDPOINT or inline mode" — it does not refuse, because a public MinIO is legitimate.
4. **Per-user quota** `configuration.ts` `storage.userQuotaBytes` (`STORAGE_USER_QUOTA_BYTES`, default 2147483648 = 2 GiB; `0` disables). `apps/api/src/storage/objects/storage-quota.service.ts` (new): `usedBytes(userId)` = `SUM(size)` over the user's objects with `status IN (pending, uploading, processing, ready)` (children included — they are the user's bytes); `assertCanStore(userId, incomingBytes)` throws `PayloadTooLargeException(\`Storage quota exceeded: ${used} of ${quota} bytes used\`)` (413; the filter derives `code`). Called by `initUpload` (with `dto.size`) and `simpleUpload` (with `Content-Length` when the multipart part carries it, else 0 up-front and the byte counter from E03-01 (#71) re-checks on completion, deleting the key and returning 413 if the total crossed the quota). Expose `GET /api/storage/quota` `@Auth()` → `{ usedBytes: string, quotaBytes: string|null, remainingBytes: string|null }` (tag `Storage`) so the picker can show remaining space.
5. **Attachment ids on invocations**: `AiGatewayService.invoke` already records `attachmentCount`; add `attachmentObjectIds: string[]` to the redacted `input` JSON it stores (ids only, never bytes).

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| GET | `/api/storage/quota` | `@Auth()` | — | `{ usedBytes, quotaBytes, remainingBytes }` (strings; nulls when disabled) |
| POST | `/api/storage/objects/upload/init` | `@Auth()` | as today | **413** when `used + size > quota` |
| POST | `/api/storage/objects` | `@Auth()` | as today | **413** when the quota is exceeded before or during the stream |

Audit: none new (quota rejections are `warn` logs with `userId`, `used`, `quota`).

**UI (frontend-dev)** — n/a here; E03-06 (#91) consumes `GET /storage/quota` and renders 413.

**Tests (testing-dev)**
- Unit `image-normalize.processor.spec.ts` (new): generate inputs with `sharp` in the test (`sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#888' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'x' } } })`): output variant is ≤ 1024 on the longest edge (`1024×683`), `sharp(out).metadata()` has no `exif`, `mimeType 'image/jpeg'`, child row created with `derivedFrom`; a PNG with alpha flattens without error; a 200×100 input is not enlarged; a HEIC fixture — commit a tiny one at `apps/api/test/fixtures/media/tiny.heic` (≤ 20 KiB) — converts and resizes; garbage bytes → `success: false`; source over `maxSourceImageBytes` → `success: false` and no child.
- Unit `ai-attachment-resolver.service.spec.ts` (extend E01-06 (#26)'s spec): prefers `aiVariantObjectId` when ready; falls back to the original under the size cap; errors above the cap without a variant; `signed-url` mode emits an `image_url` beginning with the signed URL and never reads the stream; frames path unchanged.
- Unit `storage-quota.service.spec.ts` (new): sums only live statuses; `0` quota disables; boundary `used + size === quota` allowed; `+1` throws 413.
- Unit `objects.service.spec.ts` (extend): `initUpload` calls `assertCanStore` before provider init; `simpleUpload` post-stream re-check deletes the key and throws 413.
- Integration `storage.integration.spec.ts` (extend): `GET /storage/quota` shape; `upload/init` → 413 with `prismaMock.storageObject.aggregate` returning `_sum.size` near the quota.
- Integration (E01-10 (#30) fake server) `apps/api/test/ai/gateway-attachments.integration.spec.ts` (new): `invoke` with an image attachment whose object has an `image-normalize` variant sends exactly one `input_image` part whose data URL decodes to the variant's bytes (mock provider captures the payload); a video attachment with 4 frames sends 4 parts.

**Docs (docs-dev)** — `.env.example` + `CLAUDE.md` env: `AI_ATTACHMENT_MODE`, `AI_ATTACHMENT_SIGNED_URL_TTL`, `AI_MAX_SOURCE_IMAGE_BYTES`, `STORAGE_USER_QUOTA_BYTES`. `docs/specs/ai-gateway.md`: "Attachment modes" and "Variant preference" subsections. `docs/API.md`: `GET /storage/quota`, the 413s. `processors/README.md`: list `image-normalize`.

#### Acceptance criteria
- [ ] Uploading a 4000×3000 JPEG with EXIF GPS yields `status: ready`, `metadata._processing['image-normalize'].aiVariantObjectId`, and the variant is 1024×768 JPEG with no EXIF.
- [ ] Uploading a HEIC from an iPhone yields a JPEG AI variant; the original is retained unchanged.
- [ ] `AiGatewayService.invoke` with that photo attached sends the variant's bytes, not the original's (asserted by payload size < 400 KiB in the integration test).
- [ ] With `AI_ATTACHMENT_MODE=signed-url` the provider request contains `image_url: "http…"` and no `data:` URL; with `inline` (default) it contains a `data:image/jpeg;base64,…` URL.
- [ ] `GET /api/storage/quota` reports used/quota/remaining; `STORAGE_USER_QUOTA_BYTES=0` returns nulls and never rejects.
- [ ] `POST /api/storage/objects/upload/init` beyond the quota returns 413 with a message naming used and quota bytes; the same for simple upload.
- [ ] Deleting objects lowers `usedBytes` (frames and variants included).
- [ ] `ai_invocations.input` JSON lists `attachmentObjectIds`.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: processor failures mark the object `failed` with a reason and never throw; resolver failures are `{ ok: false, error: { code: 'attachment' } }` per the E01 contract; quota is `PayloadTooLargeException`
- [ ] Observability: span `storage.image-normalize` with source/variant dimensions; `warn` on quota rejection; gateway span attribute `gen_ai.attachment.mode`
- [ ] Security: EXIF/GPS/ICC stripped from every AI-bound image; signed URLs are short-TTL GETs to a single key; originals never leave the bucket except through the user's own signed download
- [ ] Config & secrets: four new env vars with documented defaults; `sharp` and `heic-convert` pinned in `apps/api/package.json`
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–5.
2. Upload a phone photo (HEIC or a large JPEG with location) via `POST /api/storage/objects`; poll `GET /api/storage/objects/<id>` → `ready`, `_processing["image-normalize"].aiVariantObjectId`.
3. `GET /api/storage/objects/<aiVariantObjectId>/download` → download; `exiftool -a variant.jpg | grep -i gps` prints nothing; `identify variant.jpg` (ImageMagick) shows longest edge 1024.
4. `GET /api/storage/quota` → `usedBytes` equals the sum of your objects.
5. Set `STORAGE_USER_QUOTA_BYTES=1048576`, restart `api`, upload a 2 MiB image → 413.
6. Set `AI_ATTACHMENT_MODE=signed-url`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, restart; run E03-07 (#96)'s ask flow; the fake OpenAI server log (`docker compose logs fake-openai`) shows `image_url: http://localhost:9000/…`.

#### Out of scope
- Video re-encoding or per-video size caps beyond `MAX_FILE_SIZE`/`AI_VIDEO_MAX_SECONDS`.
- Admin quota management UI or per-role quotas (single global default).
- Content moderation of images.

#### Notes for the implementing agent
- The resolver's public contract from E01-06 (#26) (`resolve(attachments, userId) → parts | error`) must not change; only its internal selection and emission do. Read `docs/specs/ai-gateway.md` first.
- `sharp` on Alpine: the `@img/sharp-linuxmusl-x64` / `-arm64` optional dependency must be present in the lockfile for both arches; run `npm install` on the host (which picks your platform) **and** verify `npm ci --workspace=api --ignore-scripts` inside `docker build` succeeds. If the lockfile lacks the musl entry, add `--os=linux --libc=musl --cpu=x64` to a one-off `npm install sharp` to record it.
- `heic-convert` is pure JS/WASM and slow (~1–2 s per 12 MP image); acceptable, off the request path.
- Quota aggregate: `prisma.storageObject.aggregate({ _sum: { size: true }, where: { uploadedById, status: { in: [...] } } })` — `size` is `BigInt`; do arithmetic in `bigint`, serialize as strings.
- Do not run the quota check inside the byte-counter on every chunk; check once at start and once at end.

---

### E03-06 `feat(web): add MediaAttachmentPicker component` — #91

**Part of epic:** E03 · **Blocked by:** E03-01 (#71), E03-04 (#83) · **Component:** web · **Priority:** P0 · **Agents:** frontend-dev → testing-dev → docs-dev

#### Problem statement
There is no working upload UI. `ImageUpload.tsx` posts to an endpoint that does not exist and bypasses `ApiService` (no token refresh, no error envelope). Behavior intervention "often occurs near the moment of action" (PRD §123 mobile-first): a user at the squat rack must be able to tap once, film a set, and hand it to the coach. That requires a phone-first capture control, client-side validation that mirrors the server allowlist so the error is instant, upload progress for multi-hundred-megabyte videos, and a visible "processing…" state that resolves when frames are ready (PRD §122: status not conveyed by color alone).

#### Proposed solution
**Data (database-dev)** — n/a.

**API (backend-dev)** — n/a (uses E03-01 (#71)/E03-04 (#83)/E03-05 (#87) endpoints).

**UI (frontend-dev)**
- `apps/web/src/services/api.ts` additions:
  - `ApiService.upload<T>(endpoint, formData, { onProgress?: (loaded, total) => void, signal?: AbortSignal }): Promise<T>` (new method): XHR-based (fetch has no upload progress), sets `Authorization` from the current token, **no** `Content-Type` (browser sets the multipart boundary), `withCredentials`, unwraps `data`, on 401 runs the existing `refreshToken()` once and retries, rejects with `ApiError(message, status)` parsed from the JSON envelope.
  - `putToSignedUrl(url, blob, { onProgress, signal }): Promise<string /* ETag */>` (new, exported function): raw XHR PUT with **no** auth header (presigned URL), returns the `ETag` response header. Note: requires the object store's CORS to expose `ETag` — the MinIO overlay sets it.
  - Storage functions: `uploadStorageObject(file, opts)` (simple path, `POST /storage/objects`), `initResumableUpload({name,size,mimeType})`, `completeResumableUpload(id, parts)`, `abortResumableUpload(id)`, `getStorageObject(id)`, `deleteStorageObject(id)`, `getStorageDownloadUrl(id)`, `getStorageQuota()`.
  - Media functions: `createMediaAttachment(body)`, `listMediaAttachments(params)`, `getMediaAttachment(id)`, `deleteMediaAttachment(id)`, `getMediaPreviewUrl(id, variant?, frameIndex?)`.
- `apps/web/src/types/index.ts`: `StorageObject`, `StorageObjectStatus`, `InitUploadResponse`, `StorageQuota`, `MediaKind`, `MediaPurpose`, `MediaTargetType`, `MediaAttachment`, `MediaPreview`, `MediaAdvice` (E03-07 (#96) shape, declared now so the attachment type is complete).
- `apps/web/src/lib/mediaLimits.ts` (new): `ACCEPTED_MIME_PREFIXES = ['image/', 'video/']`, `MAX_FILE_BYTES = 524288000`, `SIMPLE_UPLOAD_MAX_BYTES = 104857600` (100 MiB; above it use resumable), `validateMediaFile(file): { ok: true } | { ok: false, reason: string }` with messages byte-identical to the server's (`File type "text/plain" is not allowed. Allowed: image/*, video/*`). Note in a comment that these mirror `ALLOWED_MIME_TYPES`/`MAX_FILE_SIZE` defaults and that the server remains authoritative.
- `apps/web/src/hooks/useMediaUpload.ts` (new): `useMediaUpload({ purpose, targetType?, targetId? })` → `{ items: UploadItem[], addFiles(files: File[]), remove(localId), retry(localId) }` where `UploadItem = { localId, file, previewUrl (object URL, revoked on unmount), phase: 'validating'|'uploading'|'processing'|'ready'|'failed', progress: 0–100, storageObjectId?, attachment?: MediaAttachment, error?: string }`. Flow per file: validate → (size ≤ 100 MiB) `uploadStorageObject` **or** resumable (`initResumableUpload` → slice `file` by `partSize` → `putToSignedUrl` each part, 3 concurrent, fetch further presigned URLs by re-calling init? — no: the init response returns the first 10 URLs only; for > 10 parts call `GET /storage/objects/:id/upload/status` is not enough — **add** `GET /storage/objects/:id/upload/urls?from=&to=` in this issue's small API delta, see Notes) → `completeResumableUpload` → `createMediaAttachment({ storageObjectId, purpose, targetType, targetId })` → poll `getMediaAttachment(id)` every 2 s (backoff to 5 s after 30 s, stop at 5 min) until `processingStatus !== 'processing'`. 413 → `error: "You have used all of your <quota> storage"`; 400 → server message verbatim.
- `apps/web/src/components/media/MediaAttachmentPicker.tsx` (new). Props: `{ purpose: MediaPurpose; targetType?: MediaTargetType; targetId?: string; maxFiles?: number (default 1); onAttached: (attachments: MediaAttachment[]) => void; disabled?: boolean }`. Renders:
  - `< sm` (`useMediaQuery(theme.breakpoints.down('sm'))`, a local layout choice — **not** one of the five coupled gates): one full-width `Button` "Take photo or video" wrapping `<input type="file" accept="image/*,video/*" capture="environment" hidden>`, plus a secondary text button "Choose from library" (same input without `capture`).
  - `≥ sm`: a drop zone (`onDragOver/onDrop`, `role="button"`, `tabIndex=0`, Enter/Space opens the file dialog, `aria-label="Add photos or videos"`), "Choose files" button, `multiple` when `maxFiles > 1`.
  - Item list: thumbnail (`previewUrl` for images; for videos a `<video muted preload="metadata">` poster until ready, then the first frame via `getMediaPreviewUrl(id, 'frame', 0)`), file name, `LinearProgress` with `aria-valuenow` while uploading, a `Chip` with text **and** icon per phase ("Uploading 42 %", "Processing…", "Ready", "Failed: <reason>"), remove `IconButton` (`aria-label="Remove <name>"`), retry on failure. `aria-live="polite"` region announces phase changes.
  - Calls `onAttached(readyAttachments)` whenever an item becomes `ready`.
  - Shows remaining quota from `getStorageQuota()` as a caption when `quotaBytes !== null`.
- `apps/web/src/components/settings/ImageUpload.tsx`: **rewrite** to `uploadStorageObject` → poll ready → `getStorageDownloadUrl(id)` → `onUpload(url)`; delete the raw `fetch`; keep the props so `ProfileSettings.tsx` is untouched. Document in a comment that the returned URL is a signed URL with `SIGNED_URL_EXPIRY` lifetime and that persisting a storage object id is the follow-up (out of scope).
- `apps/web/src/__tests__/mocks/handlers.ts`: handlers for every endpoint above with mutable in-memory state (`resetMediaMocks()`), a `POST /storage/objects` that reads the multipart body length, a `GET /media/attachments/:id` that flips `processing → ready` after two polls.

**Tests (testing-dev)** — `apps/web/src/__tests__/`:
- `services/api.upload.test.ts` (new): `api.upload` sets `Authorization`, omits `Content-Type`, reports progress events, retries once after 401+refresh, maps 413 to `ApiError.status === 413` (mock `XMLHttpRequest` with a minimal fake).
- `lib/mediaLimits.test.ts` (new): accepts `image/heic`, `video/quicktime`; rejects `application/pdf`, `text/plain`, oversize; message text exact.
- `hooks/useMediaUpload.test.ts` (new): simple path for a 1 KiB image → phases `uploading → processing → ready` and `attachment` populated; resumable path for a 150 MiB `File` stub → `initResumableUpload` called, parts PUT to signed URLs, `complete` called with ETags; 413 → `failed` with the quota message; 400 → server message; polling stops on `failed` and reports `processingError`.
- `components/media/MediaAttachmentPicker.test.tsx` (new): renders capture button below `sm` and drop zone at/above `sm` (mock `matchMedia` as `useNavigationPrefs` tests do); drop of a `.txt` shows the error and makes **no** request (assert MSW handler not hit); drop of a JPEG shows progress then "Ready" and calls `onAttached` with the attachment; video shows "Processing…" then a frame thumbnail; remove button revokes the object URL and removes the item; `maxFiles` enforced; keyboard: Enter on the drop zone opens the file dialog (`click` spied on the input); `vitest-axe` `toHaveNoViolations` in both layouts.
- `components/settings/ImageUpload.test.tsx` (new): uses the storage handlers, calls `onUpload` with the signed URL, no raw `fetch` to `/users/profile-image` (assert handler for that path is never hit).

**Docs (docs-dev)** — `docs/specs/media-attachments.md` (E03-08 (#103) owns the file; this issue adds a "Client upload flow" section stub if E03-08 (#103) has not started). `apps/web/README.md` or `docs/DEVELOPMENT.md`: how to run the picker against MinIO (CORS note).

#### Acceptance criteria
- [ ] On a viewport narrower than 600 px the picker shows "Take photo or video" whose input has `accept="image/*,video/*"` and `capture="environment"`; at 600 px and wider it shows a drop zone and "Choose files".
- [ ] Dropping a `.txt` file shows `File type "text/plain" is not allowed. Allowed: image/*, video/*` without any network request.
- [ ] A 600 MiB file is rejected client-side with the size message; a 150 MiB video goes through the resumable path with a progress bar that reaches 100 %.
- [ ] A JPEG upload shows progress, then "Processing…", then "Ready" with a thumbnail, and `onAttached` receives a `MediaAttachment` with `processingStatus: "ready"`.
- [ ] A video upload shows "Processing…" until frames exist, then the first frame as its thumbnail.
- [ ] A 413 renders "You have used all of your N storage"; the remaining-quota caption updates after a successful upload.
- [ ] `ImageUpload` in Profile settings uploads through `/api/storage/objects` and sets the preview; the dead `/api/users/profile-image` call is gone.
- [ ] `vitest-axe` reports no violations in either layout; every phase has a text label, not just a color.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: server messages shown verbatim for 400/413; network failures show "Upload failed — retry"; abort on unmount via `AbortSignal`; object URLs revoked
- [ ] Observability: n/a (client); errors surface through the existing `ErrorBoundary` only for programming errors, never for upload failures
- [ ] Security: presigned PUTs carry no bearer token; `api.upload` never logs the token; file names are rendered as text, never as HTML
- [ ] Config & secrets: none; limits mirrored in `lib/mediaLimits.ts` with a comment pointing to the server defaults
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–5, then open http://localhost:3535/settings/profile — the "Upload Custom Image" button now uploads and previews an image (network tab: `POST /api/storage/objects` 201, then `GET …/download`).
2. Until E03-07 (#96) lands, mount the picker in the visual harness (`apps/web/visual/main.tsx` route `/visual/media-picker`) with `purpose="GENERAL"`; run epic steps 7–9 there.
3. Chrome DevTools device toolbar (iPhone 12): the control is a single "Take photo or video" button; tapping it on a real phone opens the camera (verify on device via the LAN URL).
4. Resize to 900 px: drop zone appears; drag a 150 MiB MP4 from Finder/Explorer: progress climbs, MinIO console shows the multipart object after completion, then "Processing…" → "Ready" with a frame thumbnail.

#### Out of scope
- The "ask the coach" action and the media library page (E03-07 (#96)).
- Pausing/resuming a resumable upload across page reloads (the API supports it; the hook restarts the file).
- Profile-image persistence by object id.

#### Notes for the implementing agent
- Small API delta owned by this issue (backend-dev, one commit): `GET /api/storage/objects/:id/upload/urls?from=<n>&to=<m>` `@Auth()` owner-only → `{ presignedUrls: [{partNumber,url}] }` (max 50 per call), tag `Storage`, plus a unit test in `objects.service.spec.ts`. The init response's 10-URL batch is otherwise a dead end for > 100 MiB files with 10 MiB parts. Document in `docs/API.md`.
- Pattern for hooks with polling and cleanup: `apps/web/src/hooks/useBrowserNotificationPermission.ts` (effect cleanup) and `usePersonalAccessTokens.ts` (mutations + refresh). Pattern for `useMediaQuery(down('sm'))` as a documented local choice: `apps/web/src/components/settings/SettingsHub.tsx` lines ~86–97 — copy its comment style stating this is **not** one of the five coupled gates.
- MSW pattern: `apps/web/src/__tests__/mocks/handlers.ts` with `API_BASE = '*/api'`; presigned URLs in tests should be `http://minio.test/…` so a handler can match them.
- `vitest-axe` usage: `apps/web/src/__tests__/components/admin/AllowlistTable.test.tsx`.
- Do not touch `Layout.tsx`, `BottomNav`, `AppBar.tsx` breakpoints (CLAUDE.md rule 5).
- iOS Safari ignores `capture` for video on some versions and shows the chooser — acceptable; do not add a custom `getUserMedia` recorder.
- MinIO CORS: the overlay sets `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3535`; `ETag` is exposed by MinIO by default. AWS S3 needs a bucket CORS rule with `ExposeHeaders: [ETag]` — document in `docs/deployment/vps.md` under storage.

---

### E03-07 `feat(web): add "Ask the coach about this" media flow` — #96

**Part of epic:** E03 · **Blocked by:** E03-04 (#83), E03-06 (#91), E01-06 (#26) · **Component:** web, api · **Priority:** P0 · **Agents:** backend-dev → frontend-dev → testing-dev → docs-dev

#### Problem statement
Media is only worth uploading if the coach can look at it. The user needs one generic gesture — pick media, say what it is, optionally ask something — that returns structured, safety-aware advice and remembers it on the attachment (VISION §14 example coaching; PRD §14.8 safety layer, §45 pain/injury: "recommend appropriate professional evaluation", §16 AI response contracts: structured output, §128 explainability). E06 (Coach) and E09 (Health) will call the same endpoint with domain context; this issue ships the endpoint, the persona wiring, and the reusable dialog, plus a small media library page so the flow is reachable before those epics land.

#### Proposed solution
**Data (database-dev)** — n/a. `MediaAttachment.aiSummary` (E03-02 (#74)) receives the validated advice object plus provenance.

**API (backend-dev)**
- `apps/api/src/media/dto/media-advice.schema.ts` (new): Zod
  ```ts
  export const mediaAdviceSchema = z.object({
    summary: z.string().min(1).max(600),
    observations: z.array(z.string().min(1).max(300)).max(8),
    advice: z.array(z.string().min(1).max(300)).min(1).max(6),
    safetyFlag: z.object({
      level: z.enum(['none', 'caution', 'seek_professional']),
      reason: z.string().max(300),
    }).optional(),
  });
  export type MediaAdvice = z.infer<typeof mediaAdviceSchema>;
  ```
  `AiSummaryStored = MediaAdvice & { askedAt: string; question: string | null; invocationId: string; promptVersion: string; model: string }` is what lands in `aiSummary`.
- `apps/api/src/media/prompts/media-analyst.prompt.ts` (new): `MEDIA_ANALYST_PROMPT_VERSION = 'media_analyst.v1'`; `buildMediaAnalystInstructions(purpose)` returns purpose-specific instructions: `WORKOUT_FORM` — describe what is visible in the sampled frames (setup, range of motion, bar path, tempo), give 1–3 practical cues, never diagnose injury, set `seek_professional` for reported or visible sharp pain, joint instability, or neurological symptoms; `EQUIPMENT` — list the equipment recognized, note what is usable for strength training, keep claims to what is visible; `MEAL` — behavior-level observations only (protein source present, vegetables, portion pattern), **never** calories, macros, or weight judgments (PRD §46, VISION §16); `GENERAL` — describe and answer the question. Common rules: only describe what is visible, say when frames are unclear, one short summary, plain language (VISION §41 warm, direct, grounded), no medical diagnosis (VISION §48). `buildMediaAnalystInput({ purpose, question, kind, frameTimestampsMs?, durationMs? })` returns the text part ("Video, 12 s, 6 frames at 1.0 s, 3.0 s, …" or "Photo") followed by the user's question.
- `MediaAttachmentsService.ask(id, userId, question?)`: `getOwned` → `processingStatus === 'ready'` else 409 `Media is still processing` / 400 `Media processing failed` → `aiGateway.invoke<MediaAdvice>({ persona: 'media_analyst', userId, promptVersion, instructions, input, attachments: [{ storageObjectId, detail: kind === 'VIDEO' ? 'low' : 'auto' }], schema: mediaAdviceSchema, schemaName: 'media_advice', maxOutputTokens: 800 })` → on `ok` persist `aiSummary` and return `{ ok: true, advice, invocationId }`; on `!ok` return `{ ok: false, error: { code, message } }` with HTTP 200 (the E01 contract: provider problems are results, not exceptions; `no_user_key` is the one the UI must handle by linking to `/settings/ai-key`). Audit `media:ask` with `meta: { attachmentId, purpose, hasQuestion, invocationId, ok, errorCode }`. `question` is `z.string().trim().max(500).optional()`.

| Method | Path | Permission / guard | Request | Response |
|---|---|---|---|---|
| POST | `/api/media/attachments/:id/ask` | `@Auth()` (owner) | `{ question?: string }` | 200 `{ ok: true, advice: MediaAdvice, invocationId, model, latencyMs, askedAt }` **or** 200 `{ ok: false, error: { code, message } }`; 404 foreign/missing; 409 still processing; 400 processing failed; 429 when the E01 per-user test throttle (`gateway/test-throttle.ts`) is reused as `mediaAskThrottle` at 10/min |

`MediaModule` imports `AiModule` (E01) for `AiGatewayService`. `MediaAttachmentResponseDto.aiSummary` already carries the stored shape (E03-04 (#83)).

**UI (frontend-dev)**
- `apps/web/src/types/index.ts`: `MediaAdvice`, `MediaAskResult`. `services/api.ts`: `askAboutMedia(id, question?)`.
- `apps/web/src/components/media/MediaAdviceCard.tsx` (new): renders `summary` (`Typography` body1), "What I noticed" list, "Try this" list, and `safetyFlag`: `caution` → `Alert severity="warning"` with the reason; `seek_professional` → `Alert severity="error"` titled "Please get this checked" with the reason and the fixed copy "I can't assess injuries from a video. If you have sharp pain, numbness, or instability, see a qualified professional before continuing." (PRD §45, §81). Footer caption "Coach's read of this <photo|video> · <askedAt relative>". Props `{ advice: MediaAdvice, kind, askedAt }`.
- `apps/web/src/components/media/AskAboutMediaDialog.tsx` (new). Props `{ open, onClose, purpose?: MediaPurpose (preselect), targetType?, targetId?, attachment?: MediaAttachment (skip step 1 when given), onAsked?: (attachment: MediaAttachment) => void }`. Three steps in one `Dialog` (`fullScreen` below `sm` via `useMediaQuery(down('sm'))` — local choice, not a coupled gate; `maxWidth="sm"` otherwise): (1) **Media** — `MediaAttachmentPicker maxFiles={1}` or the given attachment's preview; (2) **What is this?** — `ToggleButtonGroup` (exclusive) with the four purposes labelled "Workout form", "Equipment", "Meal", "Something else", each with a one-line helper; (3) **Question (optional)** — `TextField multiline maxRows={4}` with `inputProps.maxLength=500` and purpose-specific placeholder ("Is my back rounding on the way up?"). Primary button "Ask the coach" disabled until the attachment is `ready`; while pending shows a `CircularProgress` and "Looking at your <photo|video>…"; result replaces the steps with `MediaAdviceCard` and a "Done" button; `ok: false` shows an `Alert` with the message, a **Retry** button, and for `no_user_key` a link to `/settings/ai-key`. Escape/close during pending keeps the request running (result lands on the attachment) and shows a `Snackbar` "Still looking — check your media library".
- `apps/web/src/pages/MediaLibraryPage.tsx` (new) at route `/media` inside `Layout` (`App.tsx`): title "Media"; `listMediaAttachments({ pageSize: 50 })`; `< sm` a vertical list of cards, `≥ sm` a responsive `Grid` (3 columns); each card: thumbnail (frame 0 / ai variant via `getMediaPreviewUrl`), purpose chip, processing chip, "Ask the coach" (opens the dialog with `attachment`), "Delete" (confirm `Dialog`, then `deleteMediaAttachment`), and, when `aiSummary` exists, an expandable `MediaAdviceCard`. Empty state "No media yet" with an **Add media** button that opens the dialog at step 1. FAB "Add media" below `sm`. Register `/media` in `DESTINATION_ROUTES.coach` (E02-05 (#51)'s five-destination model — the route-ownership test in `apps/web/src/__tests__/config/destinations.test.ts` fails otherwise) and resolve the AppBar title "Media" in the title resolver `AppBar.tsx` uses.
- Entry point: a "Media" `ListItemButton` on the Coach screen placeholder if E06 has not landed (E02-05 (#51) leaves `/coach` as a placeholder page) — one line, removed by E06-07 (#86).

**Tests (testing-dev)**
- API unit `media-attachments.service.spec.ts` (extend): `ask` on `processing` → `ConflictException`; on `failed` → `BadRequestException`; happy path calls `aiGateway.invoke` with `persona 'media_analyst'`, `schema mediaAdviceSchema`, one attachment with `detail: 'low'` for video / `'auto'` for photo, `promptVersion 'media_analyst.v1'`; persists `aiSummary` with `askedAt`, `question`, `invocationId`; `ok: false` from the gateway → returned as-is, `aiSummary` untouched, audit meta `ok: false`; foreign id → 404.
- API unit `prompts/media-analyst.prompt.spec.ts` (new): each purpose's instructions contain its must-have rule strings (`MEAL` contains "never" + "calories"; `WORKOUT_FORM` contains "seek_professional"); input text lists frame timestamps for video and "Photo" for images.
- API integration `apps/api/test/media/media-ask.integration.spec.ts` (new): with `overrideProviders: [{ provide: AiGatewayService, useValue: stub }]` — 200 `ok: true` and the row updated (`prismaMock.mediaAttachment.update` called with `aiSummary.summary`); gateway `{ ok: false, error: { code: 'no_user_key' } }` → 200 `ok: false`; 409 while processing; 11th call in a minute → 429.
- Web `components/media/MediaAdviceCard.test.tsx` (new): renders lists; `caution` → warning alert; `seek_professional` → error alert with the fixed copy; axe clean.
- Web `components/media/AskAboutMediaDialog.test.tsx` (new, MSW): full flow with a mocked ready attachment → `askAboutMedia` called with `{ question }` → advice rendered; `ok: false` `no_user_key` shows the `/settings/ai-key` link; button disabled while `processingStatus === 'processing'`; `fullScreen` below `sm`; Escape while pending shows the snackbar; axe clean in both layouts.
- Web `pages/MediaLibraryPage.test.tsx` (new): empty state; list renders cards with purpose chips; delete confirm → `DELETE` handler hit and card removed; "Ask the coach" opens the dialog with the attachment preselected; grid vs list at the `sm` boundary.
- Web `config/destinations.test.ts` passes with `/media` owned by `coach`.

**Docs (docs-dev)** — `docs/API.md`: `POST /media/attachments/:id/ask` with both 200 shapes. `CLAUDE.md`: API Endpoints "Media" block gains `ask`; the E01-12 (#32) "Adding an AI persona" recipe gets a one-line pointer "worked example of a vision call: `MediaAttachmentsService.ask`". `docs/specs/media-attachments.md` (E03-08 (#103)) "Advice contract" section.

#### Acceptance criteria
- [ ] From `/media`, a user can upload a photo, choose "Meal", ask "Is this a decent breakfast?", and see a summary, observations and advice within the fake server's latency; the same works on a 375 px viewport as a full-screen dialog.
- [ ] The same flow with a short video sends every sampled frame (`ai_invocations.attachment_count` equals `frameCount`).
- [ ] `POST /api/media/attachments/:id/ask` returns 409 while the media is processing and 400 when processing failed.
- [ ] A `MEAL` response never contains calorie or macro numbers in the fake-server fixture, and the prompt's instructions forbid them (asserted in the prompt spec).
- [ ] `safetyFlag.level = "seek_professional"` renders the error alert with the fixed professional-care copy; `caution` renders a warning; `none`/absent renders nothing extra.
- [ ] The advice is persisted: reloading `/media` shows the same `MediaAdviceCard` under the attachment.
- [ ] A user without an OpenAI key (E01 gate bypassed via a direct API call) receives `ok: false, error.code: "no_user_key"` and the dialog links to `/settings/ai-key`.
- [ ] `/media` is owned by the `coach` destination; the AppBar title reads "Media"; the destinations test passes.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: gateway failures are 200 `{ ok: false }` (never 5xx); 404/409/400/429 as specified; the dialog distinguishes "coach unavailable" from "your key is missing"
- [ ] Observability: one `ai_invocations` row per ask (E01-06 does this); audit `media:ask`; web: none
- [ ] Security: owner-only; the question is passed to the gateway verbatim but stored redacted by E01's redactor in `ai_invocations.input`; `aiSummary` stores only the validated schema output plus provenance — never raw provider text
- [ ] Config & secrets: none new
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Epic steps 1–10 (this issue is what steps 6–10 exercise).
2. Repeat step 10 with a photo and purpose "Meal": the advice card shows behavior-level observations and no numbers with "kcal".
3. Send `x-fake-behaviour: refusal` (E01-10 (#30)) by setting it on the fake server's default (see `tools/fake-openai/README`) and ask again: the dialog shows "The coach couldn't answer this one" with **Retry**.
4. Ask again immediately 11 times via curl → the 11th returns 429.
5. `psql`: `select action, meta->>'ok', meta->>'errorCode' from audit_events where action='media:ask' order by created_at desc limit 3;`.

#### Out of scope
- Domain context in the prompt (last set logs, program name, equipment inventory) — E09-06 (#92) passes it through a new optional `context` argument on `ask`.
- Chat follow-ups about the same media (E06 conversations reference attachments by id).
- Streaming the answer.
- Editing or deleting a stored `aiSummary` separately from the attachment.

#### Notes for the implementing agent
- The gateway call site is the only place the output shape is checked: annotate `invoke<MediaAdvice>` and pass `mediaAdviceSchema`; do not re-parse in the controller.
- `AiGatewayService` throttle helper: `apps/api/src/ai/gateway/test-throttle.ts` (E01-06 (#26)) is per-process sliding window; instantiate a second one with `10/min` rather than sharing the test limiter.
- `detail: 'low'` for video frames keeps token cost bounded (8 frames × low detail); photos use `'auto'` so the normalized 1024 px variant is read at full detail.
- Dialog pattern: `apps/web/src/components/admin/ManageRolesDialog.tsx` (MUI `Dialog` with actions and loading state). Full-screen-below-`sm` is a per-component decision; comment it as such (see `SettingsHub.tsx` comment for the wording).
- Route registration: `App.tsx` inside the `Layout` route group; `DESTINATION_ROUTES` in `apps/web/src/config/destinations.ts` (E02-05 (#51) shape); AppBar title resolver — grep `AppBar.tsx` for the settings-title map and extend it.
- Fake OpenAI server (E01-10 (#30)) returns schema-shaped JSON for any `schemaName`; add a `media_advice` fixture to `tools/fake-openai/fixtures/` with a `caution` flag so the manual script has something to render; E03-08 (#103) adds the `seek_professional` variant behind `x-fake-behaviour: media_seek_professional`.

---

### E03-08 `test(tests): E03 end-to-end verification` — #103

**Part of epic:** E03 · **Blocked by:** E03-01 (#71), E03-02 (#74), E03-03 (#79), E03-04 (#83), E03-05 (#87), E03-06 (#91), E03-07 (#96), E01-10 (#30) · **Component:** tests, docs, infra · **Priority:** P0 · **Agents:** testing-dev → ops-dev → docs-dev

#### Problem statement
The epic's promise — a phone upload becomes coach advice — spans MinIO, ffmpeg, sharp, the processing pipeline, the attachment API, the gateway, the fake provider, and two React components. Unit and integration tests cover each seam; nothing proves the chain from a browser against real containers, and there is no document a future agent can read to learn how media works (PRD §88 observability, §90 hallucination tests need a reproducible harness). The `docs/epics` index also needs its back-link.

#### Proposed solution
**Data (database-dev)** — n/a.

**API (backend-dev)** — Fake OpenAI server (E01-10 (#30)): add `x-fake-behaviour: media_seek_professional` returning a `media_advice` object with `safetyFlag.level = 'seek_professional'`; add an env toggle `FAKE_OPENAI_ECHO_ATTACHMENTS=true` that logs `input_image` part count and the first 40 chars of each `image_url` (no bytes) so the spec can assert frame count via the compose log. Test-auth login (`/testing/login`, E01-10 (#30)'s `withAiKey`) is reused unchanged.

**Infra (ops-dev)** — `infra/compose/test.compose.yml` (extend) or a new `e2e.compose.yml`: include MinIO (E03-01 (#71) overlay) and the fake OpenAI server so `cd tests/e2e && npx playwright test` boots everything E03 needs; `playwright.config.ts` `webServer.command` gains `-f minio.compose.yml -f fake-openai.compose.yml`. Set `AI_VIDEO_MAX_FRAMES=4` in the e2e env so the spec has a deterministic frame count.

**UI (frontend-dev)** — n/a; add `data-testid`s where the spec needs stable hooks: `media-picker-input`, `media-item-status`, `media-purpose-<PURPOSE>`, `media-ask-button`, `media-advice-summary`, `media-advice-safety`.

**Tests (testing-dev)**
- Fixtures `tests/e2e/fixtures/media/` (new): `photo.jpg` (≤ 50 KiB, 1280×960 with an EXIF GPS tag, generated once with ImageMagick/exiftool and committed), `clip.mp4` (2 s, 320×240, ≤ 60 KiB, generated with `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -pix_fmt yuv420p`), `note.txt`. A `README.md` in the folder records the exact generation commands so fixtures can be regenerated.
- `tests/e2e/helpers/media.helper.ts` (new): `uploadViaPicker(page, fixturePath)` (uses `page.setInputFiles('[data-testid=media-picker-input]', …)`), `waitForReady(page, name)`, `apiGet(page, path)` (uses the token from `localStorage`/`auth.helper`).
- `tests/e2e/specs/media-attachments.spec.ts` (new), desktop project plus a `mobile` project (`devices['Pixel 7']`) added to `playwright.config.ts` for this spec only:
  1. `rejects a text file client-side` — set `note.txt`; expect the error text; expect no `POST /api/storage/objects` request (`page.waitForRequest` with a short timeout rejects).
  2. `uploads a photo, normalizes it, and asks the coach` — upload `photo.jpg`; wait for "Ready"; `apiGet('/api/media/attachments?purpose=MEAL')` shows `media.width === 1024`; open ask, choose "Meal", type a question, click Ask; expect `[data-testid=media-advice-summary]` non-empty and no "kcal" text; reload `/media`; the advice is still rendered.
  3. `uploads a video, samples frames, and sends them all` — upload `clip.mp4`; wait for "Ready"; `apiGet('/api/storage/objects/<id>')` has `_processing['video-frames'].frameCount === 4`; ask with "Workout form"; expect advice; `apiGet` of the latest `ai_invocations` is not exposed — instead assert via the fake server's echo log fetched through `docker compose logs fake-openai` in a `test.afterAll` (or a tiny `/__debug/last` endpoint on the fake server gated by `NODE_ENV !== 'production'`) that 4 `input_image` parts were sent.
  4. `renders the professional-care alert` — set the fake behaviour header via the fake server's `/__debug/behaviour` toggle (E01-10 (#30) exposes it for e2e) to `media_seek_professional`; ask; expect `[data-testid=media-advice-safety]` to contain "see a qualified professional".
  5. `deletes media and its derived objects` — delete the video from the library; `apiGet('/api/storage/objects/<frameId>')` → 404.
  6. `mobile: capture control and full-screen dialog` (mobile project) — expect the "Take photo or video" button, `input[capture=environment]`; open Ask; the dialog is full-screen (`role=dialog` bounding box equals viewport).
  7. `quota` — skipped unless `E2E_QUOTA_BYTES` is set (the api must be booted with it): upload → expect the 413 message.
- `docs/TESTING.md`: e2e section lists the media spec, the fixtures folder rule, and the compose overlays.

**Docs (docs-dev)**
- `docs/specs/media-attachments.md` (new): purpose and scope; storage limits and why `storage:write` is not enforced on uploads; the processing pipeline (processor registration, `_processing` keys `video-frames` and `image-normalize` with exact shapes, derived objects and the `derivedFrom` convention, deletion cascade); attachment model and 404 semantics; the advice contract (`mediaAdviceSchema`, prompt version, purposes and their rules, safety levels and the fixed copy); attachment modes (`inline`/`signed-url`) and variant preference; quota; client upload flow (simple vs resumable, polling); env var table; rejected alternatives (transcoding, storing frames inline as base64 in metadata, a `media` table per domain, enforcing `storage:write`); follow-ups (queueing heavy processing, profile-image by object id, resumable upload resume across reloads).
- `docs/API.md`: consolidate the Media section (E03-04 (#83)/E03-07 (#96)) and the storage deltas (E03-01 (#71)/E03-05 (#87)/E03-06 (#91)) into final form.
- `CLAUDE.md`: "Adding a media-aware flow" three-line recipe under Common Patterns (create attachment → wait for `ready` → `ask` or pass `{ storageObjectId }` to the gateway), pointing at the spec; verify the Security Guidelines bullet reads "images and videos only (`ALLOWED_MIME_TYPES`), size limit (`MAX_FILE_SIZE`), per-user quota (`STORAGE_USER_QUOTA_BYTES`), randomized object keys, EXIF stripped before AI use".
- `docs/epics/README.md`: E03 row links to this file and the GitHub epic; this file's Scope list gets `#N` back-filled by the main agent.

#### Acceptance criteria
- [ ] `cd tests/e2e && npx playwright test specs/media-attachments.spec.ts` passes on a clean clone after `docker compose … -f minio.compose.yml -f fake-openai.compose.yml up` (desktop and mobile projects).
- [ ] The spec proves: client-side rejection, photo normalization to 1024 px, video → exactly 4 frames sent to the provider, advice rendered and persisted, professional-care alert, delete cascade, mobile capture control.
- [ ] Fixtures are committed, each ≤ 60 KiB, with regeneration commands in `tests/e2e/fixtures/media/README.md`.
- [ ] `docs/specs/media-attachments.md` exists and is linked from `CLAUDE.md`, `docs/API.md`, and `docs/epics/README.md`.
- [ ] `docs/API.md` documents every endpoint this epic added or changed (`upload/init` 400/413, `objects` 400/413, `upload/urls`, `quota`, five `media/attachments` routes, `ask`).
- [ ] `CLAUDE.md` Security Guidelines no longer contains "images only".
- [ ] `npm test` in `apps/api` and `npm run test:run` in `apps/web` are green on the epic branch.

#### Definition of done
- [ ] Scope/exclusions respected; interfaces as specified
- [ ] Error handling: the spec fails with a readable message when MinIO or the fake server is not up (health pre-check in `beforeAll`)
- [ ] Observability: the fake server's echo log documents what the provider received; `docs/specs` explains how to read `ai_invocations` for media calls
- [ ] Security: fixtures contain synthetic content only (test pattern, generated EXIF); no real photos
- [ ] Config & secrets: e2e env documented in `tests/e2e/README` or `docs/TESTING.md` (`AI_VIDEO_MAX_FRAMES=4`, `FAKE_OPENAI_ECHO_ATTACHMENTS=true`)
- [ ] Tests listed above pass locally (`npm test` in `apps/api`, `npm run test:run` in `apps/web`; e2e where listed)
- [ ] Docs updated

#### Manual test script
1. Run the full epic script (steps 1–14).
2. `cd tests/e2e && npx playwright test specs/media-attachments.spec.ts --project=chromium --project=mobile` → all green; `npx playwright show-report` shows the mobile screenshots with the capture button.
3. Open `docs/specs/media-attachments.md` and follow its "Reading a media invocation" psql snippet against the rows the spec just created.

#### Out of scope
- CI workflow (user declined GitHub Actions); the spec runs locally and in the manual script.
- Performance/load testing of the processing pipeline.
- Visual regression baselines for the media pages (add when the visual harness covers product screens in E05+).

#### Notes for the implementing agent
- Playwright helpers: `tests/e2e/helpers/auth.helper.ts` (`loginAsTestUser` with the E01-10 (#30) `withAiKey` option); config in `tests/e2e/playwright.config.ts` (`webServer.reuseExistingServer: true` — the epic script's running stack is reused).
- Keep fixtures tiny; Git history is forever. Generate, verify size, commit.
- The fake OpenAI server is zero-dependency Node (`tools/fake-openai/server.mjs`); add the echo/behaviour toggles there, not in a new service.
- Do not write the spec against `page.waitForTimeout`; poll the API (`expect.poll`) for `processingStatus`.
- `ops-dev` may rebuild containers and run migrations for this issue; it must not commit or touch git.

---
