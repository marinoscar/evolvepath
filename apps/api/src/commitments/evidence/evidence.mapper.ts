import type { Evidence } from '@prisma/client';

import { EvidenceResponseDto } from './dto/evidence-response.dto';

export function toEvidenceDto(row: Evidence): EvidenceResponseDto {
  return {
    id: row.id,
    commitmentId: row.commitmentId,
    evidenceType: row.evidenceType,
    source: row.source,
    occurredAt: row.occurredAt.toISOString(),
    quantitativeValue: row.quantitativeValue,
    quantitativeUnit: row.quantitativeUnit,
    qualitativeValue: row.qualitativeValue,
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}
