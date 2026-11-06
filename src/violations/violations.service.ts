import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PenaltyEngineService } from '../penalty-engine/penalty-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole, TierType } from '@prisma/client';
import { getMonthKey } from '../common/utils/date-time.util';

export interface CreateViolationDto {
  managerId: string;
  clauseId: string;
  createdById: string;
  comment?: string;
  attachmentFileId?: string;
  idempotencyKey: string;
  occurredAt?: Date;
}

@Injectable()
export class ViolationsService {
  private readonly logger = new Logger(ViolationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly penaltyEngine: PenaltyEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Previews the computed penalty for a manager and clause before confirming
   */
  async previewViolation(managerId: string, clauseId: string) {
    const occurredAt = new Date();
    const monthKey = getMonthKey(occurredAt);

    const [manager, clause, currentCount] = await Promise.all([
      this.prisma.manager.findUnique({
        where: { id: managerId },
        include: { rop: { include: { user: true } } },
      }),
      this.prisma.clause.findUnique({
        where: { id: clauseId },
        include: {
          scale: {
            include: { tiers: { orderBy: { occurrence: 'asc' } } },
          },
        },
      }),
      this.prisma.violation.count({
        where: {
          managerId,
          clauseId,
          monthKey,
          revokedAt: null,
        },
      }),
    ]);

    if (!manager) {
      throw new NotFoundException("Menejer topilmadi");
    }
    if (!clause) {
      throw new NotFoundException("Qoida bandi topilmadi");
    }

    const calc = this.penaltyEngine.calculateNextOccurrence(clause.scale.tiers, currentCount);

    return {
      manager,
      clause,
      monthKey,
      occurrenceIndex: calc.occurrenceIndex,
      resultType: calc.type,
      resultAmount: calc.amount,
      formattedResult: calc.formattedResult,
    };
  }

  /**
   * Records a violation with atomic transaction and consequence calculation
   */
  async recordViolation(dto: CreateViolationDto) {
    const occurredAt = dto.occurredAt || new Date();
    const monthKey = getMonthKey(occurredAt);

    // Double-tap idempotency check
    const existing = await this.prisma.violation.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: {
        manager: { include: { rop: { include: { user: true } }, user: true } },
        clause: true,
      },
    });
    if (existing) {
      return { violation: existing, isDuplicate: true };
    }

    // Execute within a serializable transaction to prevent race conditions
    const result = await this.prisma.$transaction(
      async (tx) => {
        const manager = await tx.manager.findUnique({
          where: { id: dto.managerId },
          include: { rop: { include: { user: true } }, user: true },
        });
        if (!manager || !manager.isActive) {
          throw new BadRequestException("Menejer topilmadi yoki faol emas");
        }

        const clause = await tx.clause.findUnique({
          where: { id: dto.clauseId },
          include: {
            scale: {
              include: { tiers: { orderBy: { occurrence: 'asc' } } },
            },
          },
        });
        if (!clause || !clause.isActive) {
          throw new BadRequestException("Qoida bandi topilmadi yoki faol emas");
        }

        // Count previous active violations in this month
        const activeCount = await tx.violation.count({
          where: {
            managerId: dto.managerId,
            clauseId: dto.clauseId,
            monthKey,
            revokedAt: null,
          },
        });

        const nextIndex = activeCount + 1;
        const calc = this.penaltyEngine.calculateConsequence(clause.scale.tiers, nextIndex);

        const violation = await tx.violation.create({
          data: {
            managerId: dto.managerId,
            clauseId: dto.clauseId,
            createdById: dto.createdById,
            comment: dto.comment,
            attachmentFileId: dto.attachmentFileId,
            occurredAt,
            monthKey,
            occurrenceIndex: nextIndex,
            resultType: calc.type,
            resultAmount: calc.amount,
            idempotencyKey: dto.idempotencyKey,
          },
          include: {
            manager: { include: { rop: { include: { user: true } }, user: true } },
            clause: true,
          },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId: dto.createdById,
            action: 'CREATE_VIOLATION',
            entity: 'Violation',
            entityId: violation.id,
            payload: {
              managerId: dto.managerId,
              managerName: manager.fullName,
              clauseCode: clause.code,
              occurrenceIndex: nextIndex,
              resultType: calc.type,
              resultAmount: calc.amount,
            },
          },
        });

        // Training threshold check
        const thresholdSetting = await tx.setting.findUnique({
          where: { key: 'trainingThreshold' },
        });
        const threshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 2;
        const isTrainingAlert = nextIndex >= threshold || calc.type === TierType.FACT;

        return { violation, isTrainingAlert };
      },
      { isolationLevel: 'Serializable' },
    );

    // Send notifications to Manager and ROP asynchronously
    const { violation, isTrainingAlert } = result;
    const managerTgId = violation.manager.user?.telegramId;
    const ropTgId = violation.manager.rop.user.telegramId;

    await Promise.allSettled([
      this.notifications.notifyManagerAboutViolation({
        managerTelegramId: managerTgId,
        managerName: violation.manager.fullName,
        clauseCode: violation.clause.code,
        clauseText: violation.clause.text,
        occurrenceIndex: violation.occurrenceIndex,
        resultType: violation.resultType,
        resultAmount: violation.resultAmount,
        comment: violation.comment,
      }),
      this.notifications.notifyRopAboutViolation({
        ropTelegramId: ropTgId,
        managerName: violation.manager.fullName,
        clauseCode: violation.clause.code,
        clauseText: violation.clause.text,
        occurrenceIndex: violation.occurrenceIndex,
        resultType: violation.resultType,
        resultAmount: violation.resultAmount,
        comment: violation.comment,
        isTrainingAlert,
      }),
    ]);

    return { violation, isTrainingAlert, isDuplicate: false };
  }

  /**
   * Revokes a violation, soft-deletes it and recomputes all later violations in that month
   */
  async revokeViolation(
    violationId: string,
    revokedById: string,
    reason: string,
    userRole: UserRole,
  ) {
    const violation = await this.prisma.violation.findUnique({
      where: { id: violationId },
      include: {
        manager: { include: { rop: { include: { user: true } }, user: true } },
        clause: {
          include: {
            scale: {
              include: { tiers: { orderBy: { occurrence: 'asc' } } },
            },
          },
        },
      },
    });

    if (!violation) {
      throw new NotFoundException("Jarima topilmadi");
    }
    if (violation.revokedAt) {
      throw new BadRequestException("Ushbu jarima allaqachon bekor qilingan");
    }

    // Permission check
    if (userRole !== UserRole.SUPER_ADMIN) {
      const setting = await this.prisma.setting.findUnique({
        where: { key: 'staffCanRevokeOthers' },
      });
      const canRevokeOthers = setting?.value === 'true';

      if (!canRevokeOthers && violation.createdById !== revokedById) {
        throw new ForbiddenException(
          "Siz faqat o'zingiz kiritgan jarimalarni bekor qila olasiz",
        );
      }
    }

    // Recompute transaction
    const { changedItems } = await this.prisma.$transaction(
      async (tx) => {
        // Mark as revoked
        await tx.violation.update({
          where: { id: violationId },
          data: {
            revokedAt: new Date(),
            revokedById,
            revokeReason: reason,
          },
        });

        // Fetch remaining active violations for this manager & clause in this month
        const remainingActive = await tx.violation.findMany({
          where: {
            managerId: violation.managerId,
            clauseId: violation.clauseId,
            monthKey: violation.monthKey,
            revokedAt: null,
          },
          orderBy: { occurredAt: 'asc' },
        });

        const recomputed = this.penaltyEngine.recomputeChain(
          remainingActive,
          violation.clause.scale.tiers,
        );

        const changedList: typeof recomputed = [];

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
            changedList.push(item);
          }
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId: revokedById,
            action: 'REVOKE_VIOLATION',
            entity: 'Violation',
            entityId: violationId,
            payload: {
              reason,
              clauseCode: violation.clause.code,
              managerName: violation.manager.fullName,
              recomputedCount: changedList.length,
            },
          },
        });

        return { changedItems: changedList };
      },
      { isolationLevel: 'Serializable' },
    );

    // Notify affected manager and ROP if consequences changed
    if (changedItems.length > 0) {
      const managerTgId = violation.manager.user?.telegramId;
      const ropTgId = violation.manager.rop.user.telegramId;

      for (const item of changedItems) {
        await Promise.allSettled([
          this.notifications.notifyCorrection({
            targetTelegramId: managerTgId,
            managerName: violation.manager.fullName,
            clauseCode: violation.clause.code,
            newOccurrenceIndex: item.occurrenceIndex,
            newResultType: item.resultType,
            newResultAmount: item.resultAmount,
          }),
          this.notifications.notifyCorrection({
            targetTelegramId: ropTgId,
            managerName: violation.manager.fullName,
            clauseCode: violation.clause.code,
            newOccurrenceIndex: item.occurrenceIndex,
            newResultType: item.resultType,
            newResultAmount: item.resultAmount,
          }),
        ]);
      }
    }

    return { success: true, recomputedCount: changedItems.length };
  }

  /**
   * Restores a previously revoked violation
   */
  async restoreViolation(violationId: string, restoredById: string, userRole: UserRole) {
    const violation = await this.prisma.violation.findUnique({
      where: { id: violationId },
      include: {
        manager: { include: { rop: { include: { user: true } }, user: true } },
        clause: {
          include: {
            scale: {
              include: { tiers: { orderBy: { occurrence: 'asc' } } },
            },
          },
        },
      },
    });

    if (!violation) {
      throw new NotFoundException("Jarima topilmadi");
    }
    if (!violation.revokedAt) {
      throw new BadRequestException("Ushbu jarima bekor qilinmagan");
    }

    if (userRole !== UserRole.SUPER_ADMIN && userRole !== UserRole.STAFF) {
      throw new ForbiddenException("Sizda tiklash huquqi yo'q");
    }

    const { changedItems } = await this.prisma.$transaction(
      async (tx) => {
        // Unmark revoke
        await tx.violation.update({
          where: { id: violationId },
          data: {
            revokedAt: null,
            revokedById: null,
            revokeReason: null,
          },
        });

        // Fetch all active violations including restored one
        const activeList = await tx.violation.findMany({
          where: {
            managerId: violation.managerId,
            clauseId: violation.clauseId,
            monthKey: violation.monthKey,
            revokedAt: null,
          },
          orderBy: { occurredAt: 'asc' },
        });

        const recomputed = this.penaltyEngine.recomputeChain(
          activeList,
          violation.clause.scale.tiers,
        );

        const changedList: typeof recomputed = [];

        for (const item of recomputed) {
          await tx.violation.update({
            where: { id: item.id },
            data: {
              occurrenceIndex: item.occurrenceIndex,
              resultType: item.resultType,
              resultAmount: item.resultAmount,
            },
          });
          if (item.changed) {
            changedList.push(item);
          }
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId: restoredById,
            action: 'RESTORE_VIOLATION',
            entity: 'Violation',
            entityId: violationId,
            payload: {
              clauseCode: violation.clause.code,
              managerName: violation.manager.fullName,
            },
          },
        });

        return { changedItems: changedList };
      },
      { isolationLevel: 'Serializable' },
    );

    return { success: true, recomputedCount: changedItems.length };
  }
}
