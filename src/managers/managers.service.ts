import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ManagersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(fullName: string, ropId: string) {
    const rop = await this.prisma.rop.findUnique({ where: { id: ropId } });
    if (!rop) throw new NotFoundException("Bunday ROP topilmadi");

    return this.prisma.manager.create({
      data: { fullName, ropId, isActive: true },
      include: { rop: { include: { user: true } } },
    });
  }

  async findById(id: string) {
    return this.prisma.manager.findUnique({
      where: { id },
      include: {
        rop: { include: { user: true } },
        user: true,
        _count: { select: { violations: true } },
      },
    });
  }

  async assignToRop(managerId: string, ropId: string) {
    const rop = await this.prisma.rop.findUnique({ where: { id: ropId } });
    if (!rop) throw new NotFoundException("Bunday ROP topilmadi");

    return this.prisma.manager.update({
      where: { id: managerId },
      data: { ropId },
      include: { rop: { include: { user: true } }, user: true },
    });
  }

  async toggleActive(id: string) {
    const manager = await this.prisma.manager.findUnique({ where: { id } });
    if (!manager) throw new NotFoundException("Menejer topilmadi");

    return this.prisma.manager.update({
      where: { id },
      data: { isActive: !manager.isActive },
      include: { rop: { include: { user: true } }, user: true },
    });
  }

  async update(id: string, data: { fullName?: string; ropId?: string; isActive?: boolean }) {
    return this.prisma.manager.update({
      where: { id },
      data,
      include: { rop: { include: { user: true } }, user: true },
    });
  }

  async deleteOrDeactivate(id: string) {
    const manager = await this.prisma.manager.findUnique({
      where: { id },
      include: { _count: { select: { violations: true } } },
    });
    if (!manager) throw new NotFoundException("Menejer topilmadi");

    if (manager._count.violations > 0) {
      // Must not orphan violations -> soft delete / deactivate
      return this.prisma.manager.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return this.prisma.manager.delete({ where: { id } });
  }

  async list(params: {
    ropId?: string;
    search?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 8;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.ropId) where.ropId = params.ropId;
    if (params.search) {
      where.fullName = { contains: params.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.manager.findMany({
        where,
        include: { rop: { include: { user: true } }, user: true },
        orderBy: { fullName: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.manager.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getUnclaimedByRop(ropId: string) {
    return this.prisma.manager.findMany({
      where: { ropId, userId: null, isActive: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async claim(managerId: string, userId: string) {
    const manager = await this.prisma.manager.findUnique({
      where: { id: managerId },
    });
    if (!manager) throw new NotFoundException("Menejer topilmadi");
    if (manager.userId) {
      throw new BadRequestException("Ushbu profil allaqachon boshqa foydalanuvchiga biriktirilgan");
    }

    return this.prisma.manager.update({
      where: { id: managerId },
      data: { userId },
    });
  }
}
