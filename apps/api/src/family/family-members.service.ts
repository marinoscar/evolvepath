import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { findOwnedOrThrow } from '../path/owned-resource';
import { FAMILY_MEMBER_ORDER, toFamilyMemberDto } from './family.mapper';
import type { FamilyMemberResponse } from './family.schema';
import { CreateFamilyMemberDto, UpdateFamilyMemberDto } from './dto/family-member.dto';

/**
 * A calendar date, stored as one.
 *
 * `new Date('2018-05-09')` is already midnight UTC, which is what `@db.Date`
 * wants; the explicit suffix says so rather than relying on the reader knowing
 * that a date-only string parses as UTC while a date-time one does not.
 */
function toDateColumn(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

@Injectable()
export class FamilyMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<FamilyMemberResponse[]> {
    const rows = await this.prisma.familyMember.findMany({
      where: { userId },
      orderBy: FAMILY_MEMBER_ORDER,
    });

    return rows.map(toFamilyMemberDto);
  }

  async create(userId: string, dto: CreateFamilyMemberDto): Promise<FamilyMemberResponse> {
    const row = await this.prisma.familyMember.create({
      data: {
        userId,
        nickname: dto.nickname,
        relationship: dto.relationship,
        birthday: toDateColumn(dto.birthday),
      },
    });

    await this.audit(userId, 'family_member:create', row.id, row.relationship);

    return toFamilyMemberDto(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateFamilyMemberDto,
  ): Promise<FamilyMemberResponse> {
    const existing = await this.findOwned(userId, id);

    const data: Prisma.FamilyMemberUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.relationship !== undefined) data.relationship = dto.relationship;
    if (dto.birthday !== undefined) data.birthday = toDateColumn(dto.birthday);

    const row = await this.prisma.familyMember.update({ where: { id: existing.id }, data });

    await this.audit(userId, 'family_member:update', row.id, row.relationship);

    return toFamilyMemberDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwned(userId, id);

    // The schema's `SetNull` keeps the rituals and the commitments; only the
    // name goes.
    await this.prisma.familyMember.delete({ where: { id: existing.id } });

    await this.audit(userId, 'family_member:delete', existing.id, existing.relationship);
  }

  private async findOwned(userId: string, id: string) {
    return findOwnedOrThrow(
      () => this.prisma.familyMember.findFirst({ where: { id, userId } }),
      'Family member',
    );
  }

  /**
   * THE `meta` IS THE RELATIONSHIP AND NOTHING ELSE.
   *
   * Audit rows outlive the record they describe — that is what an audit log is
   * for — so putting the nickname or the birthday in one would defeat the
   * deletion the user just asked for and would reintroduce, in a table nobody
   * thinks to look at, exactly the profile PRD §33 forbids. A specs assertion
   * checks the argument of this call, not the intention behind it.
   */
  private async audit(
    userId: string,
    action: string,
    targetId: string,
    relationship: string,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'family_member',
        targetId,
        meta: { relationship },
      },
    });
  }
}
