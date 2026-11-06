import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TierType } from '@prisma/client';
import { PenaltyEngineService } from '../penalty-engine/penalty-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getMonthKey } from '../common/utils/date-time.util';

@Injectable()
export class ScalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly penaltyEngine: PenaltyEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  async list() {
    return this.prisma.scale.findMany({
      include: {
        tiers: { orderBy: { occurrence: 'asc' } },
        clauses: { where: { isActive: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.scale.findUnique({
      where: { id },
      include: {
        tiers: { orderBy: { occurrence: 'asc' } },
        clauses: true,
      },
    });
  }

  async updateTier(params: {
    scaleId: string;
    occurrence: number;
    type: TierType;
    amount: number;
    recalculateCurrentMonth?: boolean;
    actorId?: string;
  }) {
    const { scaleId, occurrence, type, amount, recalculateCurrentMonth, actorId } = params;

    const scale = await this.findById(scaleId);
    if (!scale) throw new NotFoundException("Shkala topilmadi");

    // 1. Update the tier
    await this.prisma.scaleTier.upsert({
      where: {
        scaleId_occurrence: {
          scaleId,
          occurrence,
        },
      },
      update: {
        type,
        amount: type === TierType.FACT ? 0 : amount,
      },
      create: {
        scaleId,
        occurrence,
        type,
        amount: type === TierType.FACT ? 0 : amount,
      },
    });

    let recomputedTotal = 0;

    // 2. If recalculateCurrentMonth is requested:
    if (recalculateCurrentMonth) {
      const currentMonthKey = getMonthKey();
      const updatedScale = await this.findById(scaleId);
      const tiers = updatedScale?.tiers || [];

      // Find all clauses belonging to this scale
      const clauseIds = scale.clauses.map((c) => c.id);

      // Find all active violations in current month for these clauses
      const violations = await this.prisma.violation.findMany({
        where: {
          clauseId: { in: clauseIds },
          monthKey: currentMonthKey,
          revokedAt: null,
        },
        include: {
          manager: { include: { rop: { include: { user: true } }, user: true } },
          clause: true,
        },
        orderBy: { occurredAt: 'asc' },
      });

      // Group by managerId + clauseId
      const grouped = new Map<string, typeof violations>();
      for (const v of violations) {
        const key = `${v.managerId}:${v.clauseId}`;
        const list = grouped.get(key) || [];
        list.push(v);
        grouped.set(key, list);
      }

      await this.prisma.$transaction(async (tx) => {
        for (const [_, list] of grouped.entries()) {
          const recomputed = this.penaltyEngine.recomputeChain(list, tiers);
          for (const item of recomputed) {
            if (item.changed) {
              await tx.violation.update({
                where: { id: item.id },
                data: {
                  occurrenceIndex: item.occurrenceIndex,
                  resultType: item.resultType,
                  resultAmount: item.resultAmount,
                },
              });
              recomputedTotal++;
            }
          }
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'UPDATE_SCALE_AND_RECALCULATE',
            entity: 'Scale',
            entityId: scaleId,
            payload: {
              occurrence,
              type,
              amount,
              recomputedTotal,
            },
          },
        });
      });
    }

    return { success: true, recomputedTotal };
  }
}
