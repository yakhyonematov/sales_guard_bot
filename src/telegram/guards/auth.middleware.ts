import { MiddlewareFn } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { BotContext } from '../interfaces/context.interface';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

export function createAuthMiddleware(
  prisma: PrismaService,
  configService: ConfigService,
): MiddlewareFn<BotContext> {
  const superAdminIdsStr = configService.get<string>('SUPER_ADMIN_TELEGRAM_IDS', '');
  const superAdminIds = new Set(
    superAdminIdsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  return async (ctx, next) => {
    const from = ctx.from;
    if (!from) {
      return next();
    }

    const tid = BigInt(from.id);
    const tidStr = from.id.toString();

    let user = await prisma.user.findUnique({
      where: { telegramId: tid },
      include: {
        ropProfile: true,
        managerProfile: true,
      },
    });

    // Check if user is Super Admin by env
    if (!user && superAdminIds.has(tidStr)) {
      const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || `Admin (${tidStr})`;
      user = await prisma.user.create({
        data: {
          telegramId: tid,
          fullName,
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
        include: {
          ropProfile: true,
          managerProfile: true,
        },
      });
    }

    if (user) {
      if (!user.isActive) {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery("⛔ Hisobingiz faolsizlantirilgan.", { show_alert: true });
        } else {
          await ctx.reply("⛔ Sizning hisobingiz tizimda faolsizlantirilgan. Iltimos, ma'muriyat bilan bog'laning.");
        }
        return;
      }
      ctx.dbUser = user;
    } else {
      ctx.dbUser = null;
    }

    await next();
  };
}
