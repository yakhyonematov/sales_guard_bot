import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function getSortKey(code: string): number {
  const parts = code.split('.');
  if (parts.length === 2) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    return major + minor / 100;
  }
  return parseFloat(code) || 0;
}

@Injectable()
export class ClausesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(isActive = true) {
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.clause.findMany({
      where,
      include: {
        scale: {
          include: { tiers: { orderBy: { occurrence: 'asc' } } },
        },
      },
      orderBy: { sortKey: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.clause.findUnique({
      where: { id },
      include: { scale: { include: { tiers: true } } },
    });
  }

  async create(code: string, text: string, scaleId: string) {
    const existing = await this.prisma.clause.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`"${code}" kodi bilan band allaqachon mavjud`);

    return this.prisma.clause.create({
      data: {
        code,
        text,
        scaleId,
        sortKey: getSortKey(code),
        isActive: true,
      },
      include: { scale: true },
    });
  }

  async update(id: string, data: { text?: string; scaleId?: string; isActive?: boolean }) {
    return this.prisma.clause.update({
      where: { id },
      data,
      include: { scale: true },
    });
  }

  async toggleActive(id: string) {
    const clause = await this.findById(id);
    if (!clause) throw new NotFoundException("Band topilmadi");

    return this.prisma.clause.update({
      where: { id },
      data: { isActive: !clause.isActive },
    });
  }
}
