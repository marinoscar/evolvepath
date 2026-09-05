import { buildDatabaseUrl } from '../common/database-url';

export default () => {
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  const dbName = process.env.POSTGRES_DB || 'appdb';
  const ssl = process.env.POSTGRES_SSL === 'true';

  // Built by the shared helper, NOT interpolated here. This module used to do
  // its own interpolation without percent-encoding, and because the line below
  // assigns the result to process.env.DATABASE_URL — which PrismaService then
  // trusts — that unencoded string overwrote the encoded one the service had
  // been careful to build. See src/common/database-url.ts.
  const databaseUrl = buildDatabaseUrl();

  // Prisma reads DATABASE_URL (prisma.config.ts, and the generated client),
  // so publish the derived value for it.
  process.env.DATABASE_URL = databaseUrl;

  return {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3535',

    // Database
    database: {
      host,
      port: parseInt(port, 10),
      user,
      password,
      name: dbName,
      ssl,
      url: databaseUrl,
    },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtlMinutes: parseInt(process.env.JWT_ACCESS_TTL_MINUTES || '15', 10),
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS || '14', 10),
  },

  // SECRETS_ENCRYPTION_KEY is DELIBERATELY ABSENT from this object (#116,
  // epic #108). It is read directly from process.env by
  // common/crypto/secret-cipher.ts, which caches it once and never re-reads,
  // and validated at bootstrap by common/crypto/encryption-key-startup-check.ts.
  // Adding it here would create a second source of truth that could disagree
  // with the cached one, and would put raw key material into the ConfigService
  // object — a structure that is far easier to log, dump to a debug endpoint or
  // serialise wholesale than a module-private Buffer. Do not add it.

  // OAuth - Google
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },

  // Admin bootstrap
  initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL,

  // Device Authorization Flow (RFC 8628)
  //
  // Two independent lifetimes live here, and conflating them is the mistake to
  // avoid (#141, epic #110):
  //
  //   tokenExpiryDays (DEVICE_TOKEN_EXPIRY_DAYS) — the SESSION credential the
  //     browser-driven activation page has always produced. Short by design;
  //     it is a JWT, so it cannot be revoked before it expires. Raising it to
  //     CLI-friendly lengths would weaken every device session in the app to
  //     serve one client, which is exactly the alternative epic #110 rejected.
  //
  //   patExpiryDays (DEVICE_PAT_EXPIRY_DAYS) — the lifetime of the personal
  //     access token minted when a device asks for `clientInfo.tokenType:
  //     'pat'`. It can be far longer precisely BECAUSE a PAT is revocable
  //     server-side: a stolen laptop is handled by deleting one row in the
  //     Access Tokens page, with nothing else to rotate. 90 days matches the
  //     epic's suggestion and a comparable reference CLI's default.
  deviceAuth: {
    expiryMinutes: parseInt(process.env.DEVICE_CODE_EXPIRY_MINUTES || '15', 10),
    pollInterval: parseInt(process.env.DEVICE_CODE_POLL_INTERVAL || '5', 10),
    tokenExpiryDays: parseInt(process.env.DEVICE_TOKEN_EXPIRY_DAYS || '7', 10),
    patExpiryDays: parseInt(process.env.DEVICE_PAT_EXPIRY_DAYS || '90', 10),
  },

  // Observability
  otel: {
    enabled: process.env.OTEL_ENABLED === 'true',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: process.env.OTEL_SERVICE_NAME || 'evolvepath-api',
  },

  // Storage Configuration
  storage: {
    provider: process.env.STORAGE_PROVIDER || 's3',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      endpoint: process.env.S3_ENDPOINT || undefined,
    },
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10), // 10GB default
    allowedMimeTypes: (
      process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,video/*'
    ).split(','),
    signedUrlExpiry: parseInt(process.env.SIGNED_URL_EXPIRY || '3600', 10), // 1 hour default
    partSize: parseInt(process.env.STORAGE_PART_SIZE || '10485760', 10), // 10MB default
  },

  // Email transports (issue #122, epic #109)
  //
  // NO NEW SECRET IS INTRODUCED HERE. SES reuses the AWS credentials this
  // deployment already has in its environment for S3 — the same two variables,
  // read again, so an operator who has storage working has email working with
  // no additional key to issue, rotate, or leak.
  //
  // Read from `process.env` DIRECTLY rather than from `storage.s3.*` above,
  // deliberately. What email shares with storage is the ENVIRONMENT, not
  // storage's configuration: pointing email at `storage.s3` would make it
  // break the day someone gives storage its own credential source, and it is
  // the same coupling epic #109 explicitly rejects (a reference SES provider
  // that reads the S3 storage provider's database credentials, so email
  // silently depends on storage being configured at all).
  //
  // `sesRegionFallback` has NO DEFAULT, unlike `storage.s3.region`. A wrong
  // region does not fail as "wrong region": SES answers that the sending
  // identity is not verified, because the identity is verified in the region
  // the admin actually uses. An unset region reported as "SES region is not
  // configured" is a far better error than us-east-1 guessing wrong.
  email: {
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sesRegionFallback: process.env.S3_REGION || '',
  },

  // AI provider (issue #23, epic #20)
  //
  // `baseUrl` exists for two real cases and no others: a corporate egress
  // proxy, and the fake OpenAI server the e2e suite runs against (#30, which
  // sets it to http://fake-openai:8089/v1 through a Compose overlay). It is
  // normally unset. An administrator can also override it per-installation
  // through `AiSettings.baseUrl`, which wins over this value; the HTTPS rule
  // for production is enforced on that write path (#24), not here, because a
  // deployment that reaches OpenAI through a sidecar on localhost is a
  // legitimate operator decision and the environment is the operator's.
  //
  // `requestTimeoutMs` bounds ONE generate call. 60 s is chosen against a
  // reasoning-tier model on a long planning prompt, which is the slowest thing
  // this product asks for; it is not a nudge-generation latency budget.
  ai: {
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    },
    requestTimeoutMs: parseInt(
      process.env.AI_REQUEST_TIMEOUT_MS || '60000',
      10,
    ),

    // Attachment resolution for vision personas (#26, epic #20).
    //
    // `mode` is FIXED at 'inline': images travel as base64 inside the request
    // the user's own key pays for. A 'signed-url' mode is declared in the type
    // so E03 can add it deliberately; selecting it today throws AT BOOT, so a
    // misconfiguration is a failed deploy rather than a broken coaching reply.
    //
    // The two limits bound one call, not one upload — storage has its own
    // MAX_FILE_SIZE. 20 MiB is comfortably above OpenAI's own per-image ceiling,
    // and 10 images is what a form-check video's sampled frames need.
    attachments: {
      maxImageBytes: parseInt(process.env.AI_MAX_IMAGE_BYTES || '20971520', 10),
      maxImagesPerCall: parseInt(
        process.env.AI_MAX_IMAGES_PER_CALL || '10',
        10,
      ),
      mode: 'inline' as const,
    },
  },

  // Web push (VAPID) — issue #64, epic E12.
  //
  // ALL THREE OPTIONAL, and the deployment runs normally without them: the push
  // channel simply reports no address, the dispatcher logs and skips, and the
  // user still gets the inbox row and the live SSE update. That is the fallback
  // the epic asks for, and it needs no code because `resolveTo` returning null
  // already means exactly this.
  //
  // Generate a pair once per deployment with `npx web-push generate-vapid-keys`.
  // ROTATING THEM INVALIDATES EVERY EXISTING SUBSCRIPTION — the browser signed
  // up against the old public key — so it is a deliberate act, not a routine
  // secret rotation.
  webPush: {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? null,
    // A SECRET. Never logged, never returned by any endpoint, never sent to the
    // browser — only the public half is.
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? null,
    subject: process.env.WEB_PUSH_SUBJECT ?? null,
  },

  // The coaching decision engine's clock (#59, epic E12).
  //
  // An OFF SWITCH, not a feature flag: the engine's failure mode is sending
  // people messages, and an operator investigating "why is everyone getting
  // notifications at 3am" needs to be able to stop it in one restart without
  // reverting a deploy. Default on, because an engine that ships disabled ships
  // untested.
  //
  // The on-demand `POST /auth/test/run-job` route is deliberately NOT gated by
  // this: it is how a test proves the pipeline still works while the cron is
  // parked.
  coachingNotifications: {
    enabled: process.env.COACHING_NOTIFICATIONS_ENABLED !== 'false',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  };
};
