import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { BotContext } from '../telegram/interfaces/context.interface';
import { PrismaService } from '../prisma/prisma.service';
import { formatConsequenceUz } from '../common/utils/date-time.util';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<BotContext>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Safe message delivery that doesn't throw if user blocked bot or deleted account
   */
  async sendSafeMessage(
    telegramId: bigint | number | string,
    text: string,
    extra?: any,
  ): Promise<boolean> {
    try {
      await this.bot.telegram.sendMessage(telegramId.toString(), text, {
        parse_mode: 'HTML',
        ...extra,
      });
      return true;
    } catch (err: any) {
      if (err?.response?.error_code === 403) {
        this.logger.warn(`User ${telegramId} has blocked the bot or chat not found.`);
      } else if (err?.response?.error_code === 429) {
        const retryAfter = err.response.parameters?.retry_after || 1;
        this.logger.warn(`Rate limit hit, retry after ${retryAfter}s`);
      } else {
        this.logger.error(`Failed to send message to ${telegramId}: ${err?.message}`);
      }
      return false;
    }
  }

  /**
   * Notifies the manager about a recorded violation
   */
  async notifyManagerAboutViolation(params: {
    managerTelegramId?: bigint | null;
    managerName: string;
    clauseCode: string;
    clauseText: string;
    occurrenceIndex: number;
    resultType: 'AMOUNT' | 'FACT';
    resultAmount: number;
    comment?: string | null;
  }) {
    if (!params.managerTelegramId) return;

    const resultStr = formatConsequenceUz(params.resultType, params.resultAmount);
    const commentPart = params.comment ? `\n💬 <b>Izoh:</b> ${this.escapeHtml(params.comment)}` : '';

    const text =
      `📋 <b>Sizga qoidabuzarlik qayd etildi</b>\n\n` +
      `📌 <b>Band:</b> ${params.clauseCode}\n` +
      `📖 <b>Tavsif:</b> ${this.escapeHtml(params.clauseText)}\n` +
      `🔢 <b>Bu oyda takrorlanishi:</b> ${params.occurrenceIndex}-marta\n` +
      `⚖️ <b>Natija:</b> <b>${resultStr}</b>` +
      commentPart +
      `\n\n<i>Batafsil ma'lumotni bot menyusidan ko'rishingiz mumkin.</i>`;

    await this.sendSafeMessage(params.managerTelegramId, text);
  }

  /**
   * Notifies the ROP about a manager's violation
   */
  async notifyRopAboutViolation(params: {
    ropTelegramId?: bigint | null;
    managerName: string;
    clauseCode: string;
    clauseText: string;
    occurrenceIndex: number;
    resultType: 'AMOUNT' | 'FACT';
    resultAmount: number;
    comment?: string | null;
    isTrainingAlert: boolean;
  }) {
    if (!params.ropTelegramId) return;

    const resultStr =
      params.resultType === 'FACT'
        ? 'Fakt olindi'
        : params.resultAmount === 0
          ? "Shtraf: 0 so'm qo'yildi"
          : `Shtraf: ${formatConsequenceUz('AMOUNT', params.resultAmount)}`;

    const commentPart = params.comment ? `\n💬 <b>Izoh:</b> ${this.escapeHtml(params.comment)}` : '';

    const text =
      `🔔 <b>Jamoangiz menejeriga jarima qayd etildi</b>\n\n` +
      `👤 <b>Menejer:</b> ${this.escapeHtml(params.managerName)}\n` +
      `📌 <b>Band:</b> ${params.clauseCode} — ${this.escapeHtml(params.clauseText)}\n` +
      `🔢 <b>Holat:</b> Shu band bo'yicha bu oyda ${params.occurrenceIndex}-marta\n` +
      `⚖️ <b>Natija:</b> <b>${resultStr}</b>` +
      commentPart;

    await this.sendSafeMessage(params.ropTelegramId, text);

    if (params.isTrainingAlert) {
      const alertText =
        `⚠️ <b>DIQQAT: Obuchenie tavsiya etiladi!</b>\n\n` +
        `👤 <b>Menejer:</b> ${this.escapeHtml(params.managerName)}\n` +
        `📌 <b>Band:</b> ${params.clauseCode}\n` +
        `Menejer ushbu qoidani joriy oyda ${params.occurrenceIndex}-marta takrorladi. ` +
        `Sifatni oshirish maqsadida ushbu band bo'yicha o'quv (obuchenie) o'tkazish tavsiya etiladi.`;

      await this.sendSafeMessage(params.ropTelegramId, alertText);
    }
  }

  /**
   * Notifies manager and ROP when a violation was revoked/corrected
   */
  async notifyCorrection(params: {
    targetTelegramId: bigint | null | undefined;
    managerName: string;
    clauseCode: string;
    newOccurrenceIndex: number;
    newResultType: 'AMOUNT' | 'FACT';
    newResultAmount: number;
  }) {
    if (!params.targetTelegramId) return;

    const resultStr = formatConsequenceUz(params.newResultType, params.newResultAmount);
    const text =
      `ℹ️ <b>Qoidabuzarlik qayta hisoblandi</b>\n\n` +
      `Oldingi jarima bekor qilinganligi sababli, <b>${this.escapeHtml(params.managerName)}</b>ning ` +
      `<b>${params.clauseCode}</b> bandi bo'yicha takrorlanish indeksi ` +
      `<b>${params.newOccurrenceIndex}-marta</b>ga va natijasi <b>${resultStr}</b>ga o'zgardi.`;

    await this.sendSafeMessage(params.targetTelegramId, text);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
