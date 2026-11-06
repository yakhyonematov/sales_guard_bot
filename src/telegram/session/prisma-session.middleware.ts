import { MiddlewareFn } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { BotContext, SessionData } from '../interfaces/context.interface';

export function createPrismaSessionMiddleware(prisma: PrismaService): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!fromId) {
      return next();
    }

    const sessionKey = `${chatId ?? fromId}:${fromId}`;

    // 1. Load session from database
    let sessionData: SessionData = {} as SessionData;
    try {
      const record = await prisma.session.findUnique({
        where: { id: sessionKey },
      });
      if (record && record.data) {
        sessionData = JSON.parse(record.data);
      }
    } catch (e) {
      sessionData = {} as SessionData;
    }

    ctx.session = sessionData;

    // 2. Run next handlers
    await next();

    // 3. Save modified session back to database
    try {
      const serialized = JSON.stringify(ctx.session || {});
      await prisma.session.upsert({
        where: { id: sessionKey },
        update: { data: serialized },
        create: { id: sessionKey, data: serialized },
      });
    } catch (err) {
      // Ignore or log error
    }
  };
}
