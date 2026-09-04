import {
  compareModelIds,
  filterSupportedModels,
  isSupportedModelId,
  parseGptModelId,
} from './model-version-filter';

describe('isSupportedModelId', () => {
  const cases: Array<[string, boolean, string]> = [
    ['gpt-5.4', true, 'the floor itself'],
    ['gpt-5.4-mini', true, 'a cheaper sibling of a supported version'],
    ['gpt-5.4-2026-03-01', true, 'a dated snapshot'],
    ['gpt-5.10', true, 'numeric minor compare, not string compare'],
    ['gpt-6', true, 'a bare new major reads as 6.0'],
    ['GPT-5.4', true, 'ids are matched case-insensitively'],
    ['gpt-5.3', false, 'below the floor'],
    ['gpt-5', false, 'a bare 5 reads as 5.0, which is a real older model'],
    ['gpt-4o', false, 'not a version-shaped id at all'],
    ['gpt-4.1', false, 'well below the floor'],
    ['o3', false, 'not a gpt- id'],
    ['chatgpt-5.4-latest', false, 'anchored at gpt-, so the prefix disqualifies'],
    ['gpt-5.4-realtime-preview', false, 'excluded variant token'],
    ['gpt-5.5-audio', false, 'excluded variant token however new'],
  ];

  it.each(cases)('%s -> %s (%s)', (id, expected) => {
    expect(isSupportedModelId(id)).toBe(expected);
  });
});

describe('parseGptModelId', () => {
  it('defaults a missing minor to zero', () => {
    expect(parseGptModelId('gpt-6')).toEqual({
      major: 6,
      minor: 0,
      variant: null,
    });
  });

  it('lowercases the variant and keeps dashes', () => {
    expect(parseGptModelId('GPT-5.4-Mini')).toEqual({
      major: 5,
      minor: 4,
      variant: 'mini',
    });
    expect(parseGptModelId('gpt-5.4-2026-03-01')?.variant).toBe('2026-03-01');
  });

  it('returns null rather than throwing on anything else', () => {
    expect(() => parseGptModelId('text-embedding-3-large')).not.toThrow();
    expect(parseGptModelId('text-embedding-3-large')).toBeNull();
  });
});

describe('filterSupportedModels', () => {
  it('sorts version-descending then id-ascending', () => {
    const sorted = filterSupportedModels([
      { id: 'gpt-5.4-mini' },
      { id: 'gpt-6' },
      { id: 'gpt-5.10' },
      { id: 'gpt-5.4' },
    ]);

    expect(sorted.map((model) => model.id)).toEqual([
      'gpt-6',
      'gpt-5.10',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
  });

  it('drops everything below the floor and every excluded variant', () => {
    const sorted = filterSupportedModels([
      { id: 'gpt-5.4' },
      { id: 'gpt-5.3' },
      { id: 'gpt-4o' },
      { id: 'gpt-5.5-realtime' },
      { id: 'gpt-5.4-mini' },
    ]);

    expect(sorted.map((model) => model.id)).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
  });

  it('does not sort the caller in place', () => {
    const input = [{ id: 'gpt-5.4-mini' }, { id: 'gpt-6' }];
    filterSupportedModels(input);
    expect(input.map((model) => model.id)).toEqual(['gpt-5.4-mini', 'gpt-6']);
  });

  it('preserves the extra fields the provider sends', () => {
    expect(filterSupportedModels([{ id: 'gpt-5.4', created: 42 }])).toEqual([
      { id: 'gpt-5.4', created: 42 },
    ]);
  });
});

describe('compareModelIds', () => {
  it('sorts an unparseable id last without throwing', () => {
    expect(compareModelIds('gpt-5.4', 'o3')).toBeLessThan(0);
    expect(compareModelIds('o3', 'gpt-5.4')).toBeGreaterThan(0);
    expect(compareModelIds('o3', 'o1')).toBeGreaterThan(0);
  });
});
