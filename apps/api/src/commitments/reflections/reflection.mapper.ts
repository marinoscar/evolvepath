import type { Reflection } from '@prisma/client';

import { ReflectionResponseDto } from './dto/reflection-response.dto';

export function toReflectionDto(row: Reflection): ReflectionResponseDto {
  return {
    id: row.id,
    relatedType: row.relatedType,
    relatedId: row.relatedId,
    userText: row.userText,
    aiSummary: row.aiSummary,
    frictionTags: row.frictionTags,
    mood: row.mood,
    perceivedDifficulty: row.perceivedDifficulty,
    satisfaction: row.satisfaction,
    createdAt: row.createdAt.toISOString(),
  };
}
