import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { BotContext } from '../interfaces/context.interface';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const telegrafContext = TelegrafExecutionContext.create(context);
    const ctx = telegrafContext.getContext<BotContext>();

    const user = ctx.dbUser;
    if (!user || !user.isActive) {
      if (ctx.callbackQuery) {
        ctx.answerCbQuery("⛔ Sizda ushbu amalni bajarish huquqi yo'q.", { show_alert: true }).catch(() => {});
      } else {
        ctx.reply("⛔ Sizda ushbu amalni bajarish uchun ruxsat yo'q.").catch(() => {});
      }
      return false;
    }

    // SUPER_ADMIN has access to everything
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      if (ctx.callbackQuery) {
        ctx.answerCbQuery("⛔ Ushbu bo'limga faqat tegishli xodimlar kira oladi.", { show_alert: true }).catch(() => {});
      } else {
        ctx.reply("⛔ Ushbu bo'limga faqat tegishli xodimlar kira oladi.").catch(() => {});
      }
      return false;
    }

    return true;
  }
}
