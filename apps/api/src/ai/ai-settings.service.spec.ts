import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import { AiSettingsService } from './ai-settings.service';
import { DEFAULT_AI_SETTINGS } from './ai-settings.schema';
import {
  AI_PLATFORM_CREDENTIAL_NAME,
  AI_PLATFORM_CREDENTIAL_PURPOSE,
} from './ai-credential.constants';

describe('AiSettingsService', () => {
  let service: AiSettingsService;
  let prisma: {
    systemSettings: { findUnique: jest.Mock; upsert: jest.Mock };
    auditEvent: { create: jest.Mock };
  };
  let credentials: { describe: jest.Mock; setSecret: jest.Mock; getSecret: jest.Mock };
  let nodeEnv: string;

  const validInput = {
    provider: 'openai' as const,
    enabled: true,
    defaultModel: 'gpt-5.4',
    personaModels: {},
  };

  const savedRow = {
    version: 1,
    updatedAt: new Date('2026-09-04T00:00:00Z'),
    updatedByUser: null,
  };

  beforeEach(async () => {
    nodeEnv = 'test';

    prisma = {
      systemSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(savedRow),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    credentials = {
      describe: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn().mockResolvedValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [
        AiSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CredentialsService, useValue: credentials },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'nodeEnv'
                ? nodeEnv
                : key === 'ai.openai.baseUrl'
                  ? 'https://api.openai.com/v1'
                  : undefined,
          },
        },
      ],
    }).compile();

    service = module.get(AiSettingsService);
  });

  describe('get', () => {
    it('returns defaults when nothing is stored', async () => {
      await expect(service.get()).resolves.toEqual(DEFAULT_AI_SETTINGS);
    });

    it('throws on a stored-but-invalid row, naming field paths only', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: 'anthropic', enabled: true },
      });

      await expect(service.get()).rejects.toThrow(/invalid at: provider/);
    });
  });

  describe('describeForAdmin', () => {
    it('degrades an invalid row instead of throwing', async () => {
      // The broken row must not take down the one screen that repairs it.
      prisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: 'anthropic', enabled: true },
        version: 3,
        updatedAt: savedRow.updatedAt,
        updatedByUser: null,
      });

      const view = await service.describeForAdmin();

      expect(view.provider).toBeNull();
      expect(view.settingsError).toContain('provider');
      expect(view.version).toBe(3);
    });

    it('reports the stored key through describe, never getSecret', async () => {
      credentials.describe.mockResolvedValue({
        hint: '••••0000',
        updatedAt: savedRow.updatedAt,
        updatedByUserId: 'user-1',
      });

      const view = await service.describeForAdmin();

      expect(view.platformKeyStatus).toEqual({
        configured: true,
        hint: '••••0000',
        updatedAt: savedRow.updatedAt,
        updatedByUserId: 'user-1',
      });
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a default model below the floor with an actionable message', async () => {
      await expect(
        service.update({ ...validInput, defaultModel: 'gpt-5.3' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.update({ ...validInput, defaultModel: 'gpt-5.3' }, 'user-1'),
      ).rejects.toThrow(/gpt-5\.3.*5\.4/);

      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('rejects an unsupported per-persona model', async () => {
      await expect(
        service.update(
          { ...validInput, personaModels: { coach: 'gpt-4o' } },
          'user-1',
        ),
      ).rejects.toThrow(/gpt-4o/);
    });

    it('enforces https on the base URL only in production', async () => {
      const insecure = { ...validInput, baseUrl: 'http://fake-openai:8089/v1' };

      // Development and test are exempt so the fake server works.
      await expect(service.update(insecure, 'user-1')).resolves.toBeDefined();

      nodeEnv = 'production';
      await expect(service.update(insecure, 'user-1')).rejects.toThrow(/https/);
    });

    it('409s on a stale If-Match rather than overwriting', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue({ version: 4 });

      await expect(service.update(validInput, 'user-1', 2)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('writes the key before the row, at the platform address', async () => {
      const order: string[] = [];
      credentials.setSecret.mockImplementation(async () => {
        order.push('key');
      });
      prisma.systemSettings.upsert.mockImplementation(async () => {
        order.push('row');
        return savedRow;
      });

      await service.update(
        { ...validInput, platformApiKey: 'sk-platform-0000' },
        'user-1',
      );

      // Key first: a row saved before a rejected key write would claim a key
      // that does not exist.
      expect(order).toEqual(['key', 'row']);
      expect(credentials.setSecret).toHaveBeenCalledWith(
        AI_PLATFORM_CREDENTIAL_PURPOSE,
        AI_PLATFORM_CREDENTIAL_NAME,
        'sk-platform-0000',
        expect.objectContaining({ updatedByUserId: 'user-1' }),
      );
    });

    it.each([[undefined], [null], ['']])(
      'preserves the stored key when the field is %p',
      async (platformApiKey) => {
        await service.update(
          { ...validInput, platformApiKey } as never,
          'user-1',
        );

        expect(credentials.setSecret).not.toHaveBeenCalled();
      },
    );

    it('never persists the key into the settings blob', async () => {
      await service.update(
        { ...validInput, platformApiKey: 'sk-platform-0000' },
        'user-1',
      );

      const stored = JSON.stringify(
        prisma.systemSettings.upsert.mock.calls[0]![0].create.value,
      );
      expect(stored).not.toContain('sk-platform-0000');
    });

    it('audits whether the key changed, never the key or the hint', async () => {
      credentials.describe.mockResolvedValue({
        hint: '••••0000',
        updatedAt: savedRow.updatedAt,
        updatedByUserId: 'user-1',
      });

      await service.update(
        { ...validInput, platformApiKey: 'sk-platform-0000' },
        'user-1',
      );

      const meta = prisma.auditEvent.create.mock.calls[0]![0].data.meta;
      expect(meta.platformKeyReplaced).toBe(true);

      const serialised = JSON.stringify(meta);
      expect(serialised).not.toContain('sk-platform-0000');
      expect(serialised).not.toContain('••••');
    });

    it('drops a blank baseUrl rather than failing the URL rule', async () => {
      await expect(
        service.update({ ...validInput, baseUrl: '' }, 'user-1'),
      ).resolves.toBeDefined();

      expect(
        prisma.systemSettings.upsert.mock.calls[0]![0].create.value,
      ).not.toHaveProperty('baseUrl');
    });
  });

  describe('resolveModel', () => {
    const settings = {
      ...DEFAULT_AI_SETTINGS,
      defaultModel: 'gpt-5.4',
      personaModels: { coach: 'gpt-5.4-mini', planner: null },
    };

    it('prefers the persona override', () => {
      expect(service.resolveModel(settings, 'coach')).toBe('gpt-5.4-mini');
    });

    it('falls back to the default for an absent key', () => {
      expect(service.resolveModel(settings, 'safety')).toBe('gpt-5.4');
    });

    it('treats an explicit null the same as absent', () => {
      expect(service.resolveModel(settings, 'planner')).toBe('gpt-5.4');
    });

    it('is null when nothing is configured at all', () => {
      expect(service.resolveModel(DEFAULT_AI_SETTINGS, 'coach')).toBeNull();
    });
  });

  describe('resolveBaseUrl', () => {
    it('prefers the administrator override', () => {
      expect(
        service.resolveBaseUrl({
          ...DEFAULT_AI_SETTINGS,
          baseUrl: 'http://fake-openai:8089/v1',
        }),
      ).toBe('http://fake-openai:8089/v1');
    });

    it('falls back to the environment', () => {
      expect(service.resolveBaseUrl(DEFAULT_AI_SETTINGS)).toBe(
        'https://api.openai.com/v1',
      );
    });
  });
});
