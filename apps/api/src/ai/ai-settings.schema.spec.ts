import {
  AI_SETTINGS_CARRIES_NO_SECRET,
  DEFAULT_AI_SETTINGS,
  aiSettingsSchema,
} from './ai-settings.schema';

describe('aiSettingsSchema', () => {
  it('accepts the "nothing configured yet" default', () => {
    expect(aiSettingsSchema.safeParse(DEFAULT_AI_SETTINGS).success).toBe(true);
  });

  it('accepts a persona explicitly reset to the default model', () => {
    // `null` is what the admin page sends for "Use default"; it must be a
    // value, not a validation error, so the form can round-trip it.
    const parsed = aiSettingsSchema.safeParse({
      ...DEFAULT_AI_SETTINGS,
      personaModels: { coach: null },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.personaModels.coach).toBeNull();
  });

  it('rejects an unknown persona key', () => {
    // This is the parse failure E01-04 (#24) turns into a 400 — without it the
    // key would be stored and never read again.
    expect(
      aiSettingsSchema.safeParse({
        ...DEFAULT_AI_SETTINGS,
        personaModels: { bogus: 'gpt-5.4' },
      }).success,
    ).toBe(false);
  });

  it('rejects a base URL that is not a URL', () => {
    expect(
      aiSettingsSchema.safeParse({
        ...DEFAULT_AI_SETTINGS,
        baseUrl: 'not a url',
      }).success,
    ).toBe(false);
  });

  it('rejects a provider this app cannot talk to', () => {
    expect(
      aiSettingsSchema.safeParse({
        ...DEFAULT_AI_SETTINGS,
        provider: 'anthropic',
      }).success,
    ).toBe(false);
  });

  it('carries no secret-bearing field', () => {
    // The real assertion is the compile-time one in the schema file; this
    // reads the constant so the proof is also visible in the suite.
    expect(AI_SETTINGS_CARRIES_NO_SECRET).toBe(true);
  });
});
