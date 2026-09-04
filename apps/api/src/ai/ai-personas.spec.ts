import {
  AI_PERSONAS,
  PERSONA_KEYS,
  findPersona,
  isPersonaKey,
} from './ai-personas';

// The registry is data, so these are declaration invariants rather than
// behaviour tests: they fail when someone adds a persona wrongly, which is the
// only way this file can break.
describe('AI persona registry', () => {
  it('has unique, greppable keys', () => {
    expect(new Set(PERSONA_KEYS).size).toBe(PERSONA_KEYS.length);

    for (const key of PERSONA_KEYS) {
      // Lowercase snake_case: the key is persisted on every ai_invocations row
      // and used as a JSON object key in `personaModels`.
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('keeps AI_PERSONAS and PERSONA_KEYS in the same order', () => {
    // PERSONA_KEYS is a hand-written tuple (it has to be, for z.enum and
    // Partial<Record<…>>), so this is the assertion that stops the two
    // declarations drifting.
    expect(AI_PERSONAS.map((persona) => persona.key)).toEqual([...PERSONA_KEYS]);
  });

  it('declares vision on media_analyst and on nothing else', () => {
    const withVision = AI_PERSONAS.filter((persona) =>
      persona.capabilities.includes('vision'),
    ).map((persona) => persona.key);

    // `vision` is a gate in the gateway (#26), not a label: widening it is a
    // deliberate act, and this assertion is what makes it one.
    expect(withVision).toEqual(['media_analyst']);
  });

  it('gives every persona text input and non-empty user-facing copy', () => {
    for (const persona of AI_PERSONAS) {
      expect(persona.capabilities).toContain('text');
      expect(persona.label.trim().length).toBeGreaterThan(0);
      expect(persona.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('looks a persona up without throwing on an unknown key', () => {
    expect(findPersona('coach')?.label).toBe('Coach');
    expect(() => findPersona('nope')).not.toThrow();
    expect(findPersona('nope')).toBeUndefined();
    expect(isPersonaKey('coach')).toBe(true);
    expect(isPersonaKey('nope')).toBe(false);
  });
});
