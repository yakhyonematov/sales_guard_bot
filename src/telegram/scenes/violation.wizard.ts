import { Wizard, WizardStep, Ctx, On, Action } from 'nestjs-telegraf';
import { BotContext } from '../interfaces/context.interface';
import { ManagersService } from '../../managers/managers.service';
import { ClausesService } from '../../clauses/clauses.service';
import { ViolationsService } from '../../violations/violations.service';
import { Markup } from 'telegraf';
import { getBackKeyboard, getMainMenuKeyboard } from '../keyboards/menu.keyboards';
import * as crypto from 'crypto';

export const VIOLATION_WIZARD_ID = 'VIOLATION_WIZARD';

@Wizard(VIOLATION_WIZARD_ID)
export class ViolationWizard {
  constructor(
    private readonly managersService: ManagersService,
    private readonly clausesService: ClausesService,
    private readonly violationsService: ViolationsService,
  ) {}

  /**
   * STEP 1: Select Manager
   */
  @WizardStep(1)
  async step1ManagerList(@Ctx() ctx: BotContext) {
    if (!ctx.session.violationDraft) {
      ctx.session.violationDraft = {};
    }
    const page = ctx.session.managerPage || 1;
    const search = ctx.session.managerSearchQuery;
    const ropId = ctx.session.managerFilterRopId;

    const result = await this.managersService.list({
      isActive: true,
      page,
      limit: 8,
      search,
      ropId,
    });

    const buttons = result.items.map((m) => [
      Markup.button.callback(`${m.fullName} (${m.rop.user.fullName})`, `vw:mgr:${m.id}`),
    ]);

    // Pagination row
    const navRow: any[] = [];
    if (page > 1) {
      navRow.push(Markup.button.callback('⬅️ Oldingi', `vw:page:${page - 1}`));
    }
    navRow.push(Markup.button.callback(`${page} / ${result.totalPages}`, 'noop'));
    if (page < result.totalPages) {
      navRow.push(Markup.button.callback('Keyingi ➡️', `vw:page:${page + 1}`));
    }
    if (navRow.length > 1) buttons.push(navRow);

    // Filter & Search row
    buttons.push([
      Markup.button.callback('🔍 Ism bo\'yicha qidirish', 'vw:search'),
      Markup.button.callback('❌ Bekor qilish', 'vw:cancel'),
    ]);

    const title = search
      ? `🔍 "${search}" bo'yicha topilgan menejerlar:`
      : `👤 <b>Menejerni tanlang:</b>`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(title, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      await ctx.reply(title, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  }

  @Action(/^vw:page:(\d+)$/)
  async onPageChange(@Ctx() ctx: BotContext) {
    const match = (ctx.match as RegExpMatchArray)[1];
    ctx.session.managerPage = parseInt(match, 10);
    await ctx.answerCbQuery();
    return this.step1ManagerList(ctx);
  }

  @Action('vw:search')
  async onSearchPrompt(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.reply(
      "🔍 Qidirmoqchi bo'lgan menejer ismini yozib yuboring (yoki bekor qilish uchun /cancel deb yozing):",
    );
  }

  @Action(/^vw:mgr:(.+)$/)
  async onManagerSelected(@Ctx() ctx: BotContext) {
    const managerId = (ctx.match as RegExpMatchArray)[1];
    const manager = await this.managersService.list({ limit: 1 });
    const selected = await this.managersService.list({ search: '', limit: 100 });
    const m = selected.items.find((item) => item.id === managerId);

    if (!m) {
      await ctx.answerCbQuery("Menejer topilmadi", { show_alert: true });
      return;
    }

    ctx.session.violationDraft = {
      ...ctx.session.violationDraft,
      managerId: m.id,
      managerName: m.fullName,
      ropName: m.rop.user.fullName,
    };

    await ctx.answerCbQuery();
    ctx.wizard.selectStep(1); // Proceed to Step 2
    return this.step2ClauseList(ctx);
  }

  /**
   * STEP 2: Select Clause
   */
  async step2ClauseList(@Ctx() ctx: BotContext) {
    const clauses = await this.clausesService.list(true);

    // Build grid of 3-4 buttons per row with ONLY clause numbers
    const rows: any[][] = [];
    let currentRow: any[] = [];

    clauses.forEach((c) => {
      currentRow.push(Markup.button.callback(c.code, `vw:cls:${c.id}`));
      if (currentRow.length === 4) {
        rows.push(currentRow);
        currentRow = [];
      }
    });
    if (currentRow.length > 0) rows.push(currentRow);

    // Extra controls
    rows.push([Markup.button.callback('ℹ️ Bandlar matni', 'vw:clause_info')]);
    rows.push([
      Markup.button.callback('◀️ Boshqa menejer', 'vw:back_manager'),
      Markup.button.callback('❌ Bekor qilish', 'vw:cancel'),
    ]);

    const text =
      `👤 Tanlangan menejer: <b>${ctx.session.violationDraft?.managerName}</b>\n` +
      `🏢 ROP: <b>${ctx.session.violationDraft?.ropName}</b>\n\n` +
      `📌 <b>Qoidabuzarlik bandini tanlang:</b>`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      });
    }
  }

  @Action('vw:clause_info')
  async onClauseInfo(@Ctx() ctx: BotContext) {
    const clauses = await this.clausesService.list(true);
    let message = `📋 <b>Barcha normativ bandlar ro'yxati:</b>\n\n`;

    clauses.forEach((c) => {
      message += `🔹 <b>${c.code}</b> — ${c.text}\n`;
    });

    await ctx.answerCbQuery();
    await ctx.reply(message, { parse_mode: 'HTML' });
  }

  @Action(/^vw:cls:(.+)$/)
  async onClauseSelected(@Ctx() ctx: BotContext) {
    const clauseId = (ctx.match as RegExpMatchArray)[1];
    const clause = await this.clausesService.findById(clauseId);

    if (!clause) {
      await ctx.answerCbQuery("Band topilmadi", { show_alert: true });
      return;
    }

    const draft = ctx.session.violationDraft;
    if (!draft || !draft.managerId) {
      await ctx.answerCbQuery("Xatolik. Qaytadan boshlang.", { show_alert: true });
      return ctx.scene.leave();
    }

    // Compute preview
    const preview = await this.violationsService.previewViolation(draft.managerId, clause.id);

    ctx.session.violationDraft = {
      ...draft,
      clauseId: clause.id,
      clauseCode: clause.code,
      clauseText: clause.text,
      predictedOccurrence: preview.occurrenceIndex,
      predictedType: preview.resultType,
      predictedAmount: preview.resultAmount,
    };

    await ctx.answerCbQuery();
    ctx.wizard.selectStep(2); // Proceed to Step 3: Comment prompt
    return this.step3CommentPrompt(ctx);
  }

  /**
   * STEP 3: Comment prompt
   */
  async step3CommentPrompt(@Ctx() ctx: BotContext) {
    const text =
      `💬 <b>Izoh yozing (ixtiyoriy):</b>\n\n` +
      `Qoidabuzarlik tafsilotlarini yozib yuboring (yoki rasm ilova qiling).\n` +
      `Agar izoh kerak bo'lmasa, pastdagi tugmani bosing:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("⏭ O'tkazib yuborish", 'vw:skip_comment')],
      [Markup.button.callback('◀️ Orqaga (Band tanlash)', 'vw:back_clause')],
    ]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  }

  @Action('vw:skip_comment')
  async onSkipComment(@Ctx() ctx: BotContext) {
    if (ctx.session.violationDraft) {
      ctx.session.violationDraft.comment = undefined;
    }
    await ctx.answerCbQuery();
    ctx.wizard.selectStep(3); // Proceed to Step 4: Confirmation screen
    return this.step4ConfirmationScreen(ctx);
  }

  /**
   * STEP 4: Confirmation Screen
   */
  async step4ConfirmationScreen(@Ctx() ctx: BotContext) {
    const draft = ctx.session.violationDraft;
    if (!draft || !draft.managerId || !draft.clauseId) {
      await ctx.reply("Ma'lumotlar to'liq emas. Qaytadan boshlang.");
      return ctx.scene.leave();
    }

    draft.idempotencyKey = crypto.randomUUID();

    const consequenceStr =
      draft.predictedType === 'FACT'
        ? 'Fakt olinadi'
        : draft.predictedAmount === 0
          ? "0 so'm (0 so'm qo'yiladi)"
          : `${draft.predictedAmount?.toLocaleString('ru-RU')} so'm`;

    const commentStr = draft.comment ? `\n💬 <b>Izoh:</b> ${draft.comment}` : '\n💬 <b>Izoh:</b> <i>(kiritilmadi)</i>';

    const text =
      `⚠️ <b>Qoidabuzarlikni tasdiqlaysizmi?</b>\n\n` +
      `👤 <b>Menejer:</b> ${draft.managerName} (${draft.ropName})\n` +
      `📌 <b>Band:</b> ${draft.clauseCode} — ${draft.clauseText}\n` +
      `🔢 <b>Hisoblangan holat:</b> Bu oyda ushbu band bo'yicha <b>${draft.predictedOccurrence}-marta</b>\n` +
      `⚖️ <b>Natija (PREVIEW):</b> <b>${consequenceStr}</b>` +
      commentStr;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Tasdiqlash', `vw:confirm:${draft.idempotencyKey}`)],
      [
        Markup.button.callback("✏️ Izohni o'zgartirish", 'vw:edit_comment'),
        Markup.button.callback('❌ Bekor qilish', 'vw:cancel'),
      ],
    ]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  }

  @Action(/^vw:confirm:(.+)$/)
  async onConfirmViolation(@Ctx() ctx: BotContext) {
    const idempotencyKey = (ctx.match as RegExpMatchArray)[1];
    const draft = ctx.session.violationDraft;

    if (!draft || !draft.managerId || !draft.clauseId || !ctx.dbUser) {
      await ctx.answerCbQuery("Sessiya muddati tugagan.", { show_alert: true });
      return ctx.scene.leave();
    }

    // Avoid double-tap by modifying message immediately
    await ctx.answerCbQuery("Jarima saqlanmoqda...");
    await ctx.editMessageText("⏳ Jarima saqlanmoqda va hisoblanmoqda...");

    try {
      const result = await this.violationsService.recordViolation({
        managerId: draft.managerId,
        clauseId: draft.clauseId,
        createdById: ctx.dbUser.id,
        comment: draft.comment,
        attachmentFileId: draft.attachmentFileId,
        idempotencyKey,
      });

      const v = result.violation;
      const consequenceStr =
        v.resultType === 'FACT'
          ? 'Fakt olindi'
          : `${v.resultAmount.toLocaleString('ru-RU')} so'm`;

      const successText =
        `✅ <b>Jarima muvaffaqiyatli qayd etildi!</b>\n\n` +
        `👤 <b>Menejer:</b> ${v.manager.fullName}\n` +
        `📌 <b>Band:</b> ${v.clause.code}\n` +
        `🔢 <b>Takrorlanishi:</b> ${v.occurrenceIndex}-marta\n` +
        `⚖️ <b>Natija:</b> <b>${consequenceStr}</b>\n\n` +
        `<i>Menejer va uning ROPiga darhol bildirishnoma yuborildi.</i>`;

      const quickActions = Markup.inlineKeyboard([
        [Markup.button.callback("↩️ Bekor qilish (o'chirish)", `vw:quick_revoke:${v.id}`)],
        [Markup.button.callback("➕ Yana shtraf kiritish", 'vw:restart')],
        [Markup.button.callback('🏠 Asosiy menyu', 'nav:main_menu')],
      ]);

      await ctx.editMessageText(successText, {
        parse_mode: 'HTML',
        ...quickActions,
      });
    } catch (err: any) {
      await ctx.reply(`❌ Xatolik yuz berdi: ${err.message || 'Noma\'lum xatolik'}`);
    }

    ctx.session.violationDraft = undefined;
    return ctx.scene.leave();
  }

  @Action(/^vw:quick_revoke:(.+)$/)
  async onQuickRevoke(@Ctx() ctx: BotContext) {
    const violationId = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.dbUser) return;

    await ctx.answerCbQuery();
    await ctx.reply(
      `🗑 Ushbu jarimani bekor qilish sababini yozib yuboring (yoki bekor qilmaslik uchun /cancel deng):`,
    );
    // Track pending revoke in session
    ctx.session.violationDraft = { comment: `REVOKE_PROMPT:${violationId}` };
  }

  @Action('vw:restart')
  async onRestart(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    ctx.session.violationDraft = {};
    ctx.wizard.selectStep(0);
    return this.step1ManagerList(ctx);
  }

  @Action('vw:cancel')
  async onCancel(@Ctx() ctx: BotContext) {
    ctx.session.violationDraft = undefined;
    await ctx.answerCbQuery("Bekor qilindi");
    if (ctx.callbackQuery) {
      await ctx.editMessageText("❌ Jarima kiritish bekor qilindi.");
    } else {
      await ctx.reply("❌ Jarima kiritish bekor qilindi.");
    }
    return ctx.scene.leave();
  }

  @Action('vw:back_manager')
  async onBackManager(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    ctx.wizard.selectStep(0);
    return this.step1ManagerList(ctx);
  }

  @Action('vw:back_clause')
  async onBackClause(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    ctx.wizard.selectStep(1);
    return this.step2ClauseList(ctx);
  }

  @Action('vw:edit_comment')
  async onEditComment(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    ctx.wizard.selectStep(2);
    return this.step3CommentPrompt(ctx);
  }

  @On('text')
  async onTextMessage(@Ctx() ctx: BotContext) {
    const text = (ctx.message as any)?.text;
    if (text === '/cancel') {
      ctx.session.violationDraft = undefined;
      await ctx.reply("Bekor qilindi.", getMainMenuKeyboard(ctx.dbUser?.role));
      return ctx.scene.leave();
    }

    // If searching manager in step 1
    if (ctx.wizard.cursor === 0) {
      ctx.session.managerSearchQuery = text.trim();
      ctx.session.managerPage = 1;
      return this.step1ManagerList(ctx);
    }

    // If entering comment in step 3
    if (ctx.wizard.cursor === 2) {
      if (ctx.session.violationDraft) {
        ctx.session.violationDraft.comment = text.slice(0, 1000);
      }
      ctx.wizard.selectStep(3);
      return this.step4ConfirmationScreen(ctx);
    }
  }

  @On('photo')
  async onPhotoMessage(@Ctx() ctx: BotContext) {
    const message = ctx.message as any;
    const photos = message?.photo;
    const caption = message?.caption || '';

    if (ctx.wizard.cursor === 2 && photos && photos.length > 0) {
      const bestPhoto = photos[photos.length - 1];
      if (ctx.session.violationDraft) {
        ctx.session.violationDraft.attachmentFileId = bestPhoto.file_id;
        ctx.session.violationDraft.comment = caption.slice(0, 1000);
      }
      ctx.wizard.selectStep(3);
      return this.step4ConfirmationScreen(ctx);
    }
  }
}
