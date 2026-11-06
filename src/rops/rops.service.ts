import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class RopsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(isActive?: boolean) {
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.rop.findMany({
      where,
      include: {
        user: true,
        _count: { select: { managers: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.rop.findUnique({
      where: { id },
      include: {
        user: true,
        managers: { where: { isActive: true } },
      },
    });
  }

  async createWithUser(fullName: string, telegramId: bigint) {
    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      if (existing.role === UserRole.ROP) {
        throw new BadRequestException("Ushbu Telegram ID egasi allaqachon ROP");
      }
      // Upgrade user to ROP
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ROP, fullName },
      });
      return this.prisma.rop.create({
        data: { userId: existing.id, isActive: true },
        include: { user: true },
      });
    }

    const user = await this.prisma.user.create({
      data: {
        telegramId,
        fullName,
        role: UserRole.ROP,
        isActive: true,
      },
    });

    return this.prisma.rop.create({
      data: { userId: user.id, isActive: true },
      include: { user: true },
    });
  }

  async deleteOrDeactivate(id: string, reassignToRopId?: string) {
    const rop = await this.prisma.rop.findUnique({
      where: { id },
      include: { managers: true },
    });
    if (!rop) throw new NotFoundException("ROP topilmadi");

    if (rop.managers.length > 0) {
      if (reassignToRopId) {
        // Reassign managers safely
        await this.prisma.manager.updateMany({
          where: { ropId: id },
          data: { ropId: reassignToRopId },
        });
      } else {
        // If not reassigned, safe deactivation
        return this.prisma.rop.update({
          where: { id },
          data: { isActive: false },
        });
      }
    }

    return this.prisma.rop.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
