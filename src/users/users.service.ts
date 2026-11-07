import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, RequestStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createStaff(fullName: string, telegramId: bigint) {
    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.STAFF, fullName, isActive: true },
      });
    }

    return this.prisma.user.create({
      data: {
        telegramId,
        fullName,
        role: UserRole.STAFF,
        isActive: true,
      },
    });
  }

  async listStaff() {
    return this.prisma.user.findMany({
      where: { role: UserRole.STAFF },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleActive(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Foydalanuvchi topilmadi");

    return this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
    });
  }

  async generateInviteCode(role: UserRole, ropId?: string) {
    const code = 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    return this.prisma.inviteCode.create({
      data: {
        code,
        role,
        ropId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  }

  async consumeInviteCode(code: string, telegramId: bigint, fullName: string) {
    const invite = await this.prisma.inviteCode.findUnique({
      where: { code },
    });

    if (!invite) {
      throw new NotFoundException("Bunday taklif kodi topilmadi");
    }
    if (invite.usedAt) {
      throw new BadRequestException("Ushbu taklif kodi allaqachon ishlatilgan");
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new BadRequestException("Taklif kodining amal qilish muddati tugagan");
    }

    return this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { telegramId } });
      if (!user) {
        user = await tx.user.create({
          data: {
            telegramId,
            fullName,
            role: invite.role,
            isActive: true,
          },
        });
      } else {
        user = await tx.user.update({
          where: { id: user.id },
          data: { role: invite.role, isActive: true },
        });
      }

      // If ROP role, create or link Rop profile
      if (invite.role === UserRole.ROP) {
        if (invite.ropId) {
          const targetRop = await tx.rop.findUnique({
            where: { id: invite.ropId },
            include: { user: true },
          });
          if (targetRop && targetRop.user && targetRop.user.telegramId < 0n) {
            const oldUserId = targetRop.userId;
            await tx.rop.update({
              where: { id: targetRop.id },
              data: { userId: user.id },
            });
            await tx.user.delete({
              where: { id: oldUserId },
            });
          } else {
            const ropExists = await tx.rop.findUnique({ where: { userId: user.id } });
            if (!ropExists) {
              await tx.rop.create({
                data: { userId: user.id, isActive: true },
              });
            }
          }
        } else {
          const ropExists = await tx.rop.findUnique({ where: { userId: user.id } });
          if (!ropExists) {
            await tx.rop.create({
              data: { userId: user.id, isActive: true },
            });
          }
        }
      }

      // Mark invite as used
      await tx.inviteCode.update({
        where: { id: invite.id },
        data: {
          usedAt: new Date(),
          usedById: user.id,
        },
      });

      return user;
    });
  }

  async createRegistrationRequest(telegramId: bigint, fullName: string, ropId: string) {
    const existing = await this.prisma.registrationRequest.findFirst({
      where: { telegramId, status: RequestStatus.PENDING },
    });
    if (existing) {
      return existing;
    }

    const req = await this.prisma.registrationRequest.create({
      data: {
        telegramId,
        fullName,
        ropId,
      },
      include: { rop: { include: { user: true } } },
    });

    // Notify ROP
    await this.notifications.sendSafeMessage(
      req.rop.user.telegramId,
      `📋 <b>Yangi a'zolik arizasi:</b>\n` +
      `👤 <b>Nomzod:</b> ${fullName}\n` +
      `Telegram ID: <code>${telegramId}</code>\n\n` +
      `Tasdiqlash uchun bot menyusidan '👥 Jamoam menejerlari' bo'limiga kiring.`,
    );

    return req;
  }

  async getPendingRequests(ropId?: string) {
    const where: any = { status: RequestStatus.PENDING };
    if (ropId) where.ropId = ropId;

    return this.prisma.registrationRequest.findMany({
      where,
      include: { rop: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decideRegistrationRequest(
    requestId: string,
    approve: boolean,
    decidedById: string,
  ) {
    const req = await this.prisma.registrationRequest.findUnique({
      where: { id: requestId },
      include: { rop: true },
    });
    if (!req) throw new NotFoundException("Ariza topilmadi");

    if (approve) {
      await this.prisma.$transaction(async (tx) => {
        // Create or update user as MANAGER
        const user = await tx.user.upsert({
          where: { telegramId: req.telegramId },
          update: {
            fullName: req.fullName,
            role: UserRole.MANAGER,
            isActive: true,
          },
          create: {
            telegramId: req.telegramId,
            fullName: req.fullName,
            role: UserRole.MANAGER,
            isActive: true,
          },
        });

        // Create Manager profile linked to user and ROP
        await tx.manager.create({
          data: {
            fullName: req.fullName,
            ropId: req.ropId,
            userId: user.id,
            isActive: true,
          },
        });

        // Update request status
        await tx.registrationRequest.update({
          where: { id: req.id },
          data: {
            status: RequestStatus.APPROVED,
            decidedById,
          },
        });
      });

      await this.notifications.sendSafeMessage(
        req.telegramId,
        "🎉 <b>Arizangiz tasdiqlandi!</b>\nSiz tizimga menejer sifatida muvaffaqiyatli qabul qilindingiz. /start ni bosing.",
      );
    } else {
      await this.prisma.registrationRequest.update({
        where: { id: req.id },
        data: {
          status: RequestStatus.REJECTED,
          decidedById,
        },
      });

      await this.notifications.sendSafeMessage(
        req.telegramId,
        "❌ Afsuski, sizning ro'yxatdan o'tish arizangiz rad etildi.",
      );
    }

    return { success: true };
  }

  async getAuditLogs(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]);

    return { items, total, page, totalPages: Math.ceil(total / limit) || 1 };
  }

  async broadcastMessage(text: string, targetRole?: UserRole) {
    const where: any = { isActive: true };
    if (targetRole) where.role = targetRole;

    const users = await this.prisma.user.findMany({
      where,
      select: { telegramId: true },
    });

    let sent = 0;
    for (const u of users) {
      const ok = await this.notifications.sendSafeMessage(
        u.telegramId,
        `📢 <b>XABAR:</b>\n\n${text}`,
      );
      if (ok) sent++;
    }

    return { total: users.length, sent };
  }
}
