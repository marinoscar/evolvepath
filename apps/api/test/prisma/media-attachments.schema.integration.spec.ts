import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

// =============================================================================
// media_attachments — schema guarantees against a real database (issue #74)
// =============================================================================
//
// Requires a live Postgres reachable via the individual POSTGRES_* env vars
// (loaded from apps/api/.env.test by test/setup.ts) with the schema migrated,
// exactly like test/prisma/weekly-schema.integration.spec.ts.
//
// WHAT ONLY THE DATABASE CAN PROVE, and therefore what is asserted here:
//
//   1. One attachment per upload. `storage_object_id` is unique, so
//      re-purposing means uploading again. Without the index a photo could be
//      simultaneously a meal and a piece of equipment, with two different
//      pieces of AI advice, and nothing to say which one a screen should read.
//   2. BOTH foreign keys cascade. Media metadata that outlives its owner or
//      its bytes is a row describing a file nobody can fetch — and, for the
//      user cascade, personal data surviving an account deletion.
//   3. The enums list exactly the four purposes and two kinds. A fifth purpose
//      arriving without a prompt for it is a coaching call with no rules.
// =============================================================================

describe('media_attachments (integration, real DB)', () => {
  let prisma: PrismaClient;
  const seededUserIds: string[] = [];

  const uniqueEmail = () =>
    `media-schema-${randomBytes(6).toString('hex')}@example.test`;

  async function seedUser() {
    const user = await prisma.user.create({ data: { email: uniqueEmail() } });
    seededUserIds.push(user.id);
    return user;
  }

  async function seedObject(userId: string) {
    return prisma.storageObject.create({
      data: {
        name: 'clip.mp4',
        size: BigInt(1234),
        mimeType: 'video/mp4',
        storageKey: `uploads/${randomBytes(8).toString('hex')}.mp4`,
        bucket: 'test-bucket',
        status: 'ready',
        uploadedById: userId,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl()) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (seededUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('applies the defaults an attachment is created with', async () => {
    const user = await seedUser();
    const object = await seedObject(user.id);

    const attachment = await prisma.mediaAttachment.create({
      data: { userId: user.id, storageObjectId: object.id, kind: 'VIDEO' },
    });

    // GENERAL, not null: "we do not know what this is for" is a purpose, and
    // it is the one the generic ask flow uses.
    expect(attachment.purpose).toBe('GENERAL');
    expect(attachment.targetType).toBeNull();
    expect(attachment.targetId).toBeNull();
    // Null until somebody asks. An empty object would be indistinguishable
    // from a coaching call that returned nothing.
    expect(attachment.aiSummary).toBeNull();
  });

  it('allows one attachment per storage object and refuses a second', async () => {
    const user = await seedUser();
    const object = await seedObject(user.id);

    await prisma.mediaAttachment.create({
      data: { userId: user.id, storageObjectId: object.id, kind: 'VIDEO' },
    });

    await expect(
      prisma.mediaAttachment.create({
        data: {
          userId: user.id,
          storageObjectId: object.id,
          kind: 'VIDEO',
          purpose: 'EQUIPMENT',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('round-trips aiSummary as jsonb', async () => {
    const user = await seedUser();
    const object = await seedObject(user.id);

    const summary = {
      summary: 'Your setup looks steady.',
      observations: ['Feet under the bar'],
      advice: ['Brace before you unrack'],
      safetyFlag: { level: 'none', reason: '' },
      askedAt: '2026-09-05T00:00:00.000Z',
      question: 'Is my back rounding?',
      invocationId: '00000000-0000-0000-0000-000000000000',
      promptVersion: 'media_analyst.v1',
      model: 'gpt-test',
    };

    const created = await prisma.mediaAttachment.create({
      data: {
        userId: user.id,
        storageObjectId: object.id,
        kind: 'VIDEO',
        purpose: 'WORKOUT_FORM',
        aiSummary: summary,
      },
    });

    const read = await prisma.mediaAttachment.findUnique({
      where: { id: created.id },
    });

    expect(read?.aiSummary).toEqual(summary);
  });

  it('removes the attachment when its storage object is deleted', async () => {
    const user = await seedUser();
    const object = await seedObject(user.id);

    const attachment = await prisma.mediaAttachment.create({
      data: { userId: user.id, storageObjectId: object.id, kind: 'VIDEO' },
    });

    await prisma.storageObject.delete({ where: { id: object.id } });

    expect(
      await prisma.mediaAttachment.findUnique({ where: { id: attachment.id } }),
    ).toBeNull();
  });

  it('removes the attachment when the account is deleted', async () => {
    const user = await seedUser();
    const object = await seedObject(user.id);

    const attachment = await prisma.mediaAttachment.create({
      data: { userId: user.id, storageObjectId: object.id, kind: 'VIDEO' },
    });

    await prisma.user.delete({ where: { id: user.id } });
    seededUserIds.splice(seededUserIds.indexOf(user.id), 1);

    expect(
      await prisma.mediaAttachment.findUnique({ where: { id: attachment.id } }),
    ).toBeNull();
  });

  it('stores a polymorphic target without a foreign key to enforce it', async () => {
    // Deliberate: the four target tables do not all exist yet, and a nullable
    // FK per target would be four columns null three times out of four. A
    // target id pointing at nothing is refused at the API boundary, not here.
    const user = await seedUser();
    const object = await seedObject(user.id);

    const attachment = await prisma.mediaAttachment.create({
      data: {
        userId: user.id,
        storageObjectId: object.id,
        kind: 'PHOTO',
        purpose: 'EQUIPMENT',
        targetType: 'workout_session',
        targetId: '00000000-0000-0000-0000-0000000000ff',
      },
    });

    expect(attachment.targetType).toBe('workout_session');
  });

  it('declares exactly the enum values the coaching prompts switch on', async () => {
    const kinds = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT unnest(enum_range(NULL::"MediaKind"))::text AS v`,
    );
    const purposes = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT unnest(enum_range(NULL::"MediaPurpose"))::text AS v`,
    );

    expect(kinds.map((r) => r.v)).toEqual(['PHOTO', 'VIDEO']);
    // A fifth purpose arriving without a prompt written for it is a coaching
    // call with no rules — MEAL's "never mention calories" is a per-purpose
    // rule, not a global one.
    expect(purposes.map((r) => r.v)).toEqual([
      'WORKOUT_FORM',
      'EQUIPMENT',
      'MEAL',
      'GENERAL',
    ]);
  });
});
