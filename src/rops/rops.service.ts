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
        managers: {
          orderBy: { fullName: 'asc' },
          include: { user: true },
        },
        _count: { select: { managers: true } },
      },
    });
  }

  async createRop(fullName: string, telegramId?: bigint) {
    if (telegramId && telegramId > 0n) {
      const existing = await this.prisma.user.findUnique({ where: { telegramId } });
      if (existing) {
        if (existing.role === UserRole.ROP) {
          const existingRop = await this.prisma.rop.findUnique({ where: { userId: existing.id } });
          if (existingRop) {
            throw new BadRequestException("Ushbu Telegram ID egasi allaqachon ROP");
          }
        }
        // Upgrade user to ROP
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { role: UserRole.ROP, fullName, isActive: true },
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

    // When Telegram ID is not provided, create with unique negative placeholder
    const placeholderId = BigInt(-1 * (Date.now() * 1000 + Math.floor(Math.random() * 999)));
    const user = await this.prisma.user.create({
      data: {
        telegramId: placeholderId,
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

  async createWithUser(fullName: string, telegramId: bigint) {
    return this.createRop(fullName, telegramId);
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
