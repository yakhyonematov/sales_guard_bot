import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { TelegrafExceptionFilter, TelegrafArgumentsHost } from 'nestjs-telegraf';
import { BotContext } from '../interfaces/context.interface';

@Catch()
export class BotGlobalExceptionFilter implements TelegrafExceptionFilter {
  private readonly logger = new Logger(BotGlobalExceptionFilter.name);

  async catch(exception: Error, host: ArgumentsHost): Promise<void> {
    const telegrafHost = TelegrafArgumentsHost.create(host);
    const ctx = telegrafHost.getContext<BotContext>();

    this.logger.error(
      `Unhandled Telegram Exception from user ${ctx.from?.id}: ${exception.message}`,
      exception.stack,
    );

    const friendlyMessage =
      "⚠️ <i>Kechirasiz, tizimda kutilmagan xatolik yuz berdi. Iltimos, birozdan so'ng qayta urinib ko'ring yoki ma'muriyatga xabar bering.</i>";

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery("⚠️ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.", {
          show_alert: true,
        });
      } else {
        await ctx.reply(friendlyMessage, { parse_mode: 'HTML' });
      }
    } catch (sendErr: any) {
      this.logger.error(`Failed to send error notification to user: ${sendErr?.message}`);
    }
  }
}
