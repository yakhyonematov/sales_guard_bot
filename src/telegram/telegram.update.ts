import { Update, Ctx, Start, Hears, Action, On } from 'nestjs-telegraf';
import { BotContext } from './interfaces/context.interface';
import { getMainMenuKeyboard } from './keyboards/menu.keyboards';
import { UserRole, TierType } from '@prisma/client';
import { VIOLATION_WIZARD_ID } from './scenes/violation.wizard';
import { RopsService } from '../rops/rops.service';
import { ManagersService } from '../managers/managers.service';
import { StatsService } from '../stats/stats.service';
import { UsersService } from '../users/users.service';
import { ClausesService } from '../clauses/clauses.service';
import { ScalesService } from '../scales/scales.service';
import { ViolationsService } from '../violations/violations.service';
import { PenaltyEngineService } from '../penalty-engine/penalty-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { Markup } from 'telegraf';
import { formatDateUz, formatMoneyUz, getMonthKey } from '../common/utils/date-time.util';

@Update()
export class TelegramUpdate {
  constructor(
    private readonly ropsService: RopsService,
    private readonly managersService: ManagersService,
    private readonly statsService: StatsService,
    private readonly usersService: UsersService,
    private readonly clausesService: ClausesService,
    private readonly scalesService: ScalesService,
    private readonly violationsService: ViolationsService,
    private readonly penaltyEngine: PenaltyEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    const text = (ctx.message as any)?.text || '';
    const parts = text.split(' ');

    // Check for invite code deep-linking: /start invite_CODE
    if (parts.length > 1 && parts[1].startsWith('invite_')) {
      const code = parts[1].replace('invite_', '').trim();
      try {
        const from = ctx.from!;
        const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
        const activatedUser = await this.usersService.consumeInviteCode(code, BigInt(from.id), fullName);
        ctx.dbUser = activatedUser as any;
        await ctx.reply(
          `🎉 <b>Xush kelibsiz!</b>\nSiz taklif kodi orqali muvaffaqiyatli tizimga kirdingiz. Roli: <b>${activatedUser.role}</b>`,
          { parse_mode: 'HTML', ...getMainMenuKeyboard(activatedUser.role) },
        );
        return;
      } catch (err: any) {
        await ctx.reply(`❌ Taklif kodi xatosi: ${err.message}`);
      }
    }

    if (!user) {
      const welcome =
        `👋 <b>Assalomu alaykum!</b>\n\n` +
        `Sotuv bo'limi sifat nazorati (OKK) jarimalarni hisoblash tizimiga xush kelibsiz.\n\n` +
        `Davom etish uchun quyidagi tugmalardan birini tanlang:`;
      await ctx.reply(welcome, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(null),
      });
      return;
    }

    const roleNames: Record<UserRole, string> = {
      SUPER_ADMIN: 'Bosh administrator',
      STAFF: 'Xodim (Inspektor)',
      ROP: "Guruh rahbari (ROP)",
      MANAGER: 'Menejer',
    };

    const welcome =
      `👋 <b>Assalomu alaykum, ${user.fullName}!</b>\n` +
      `Siz tizimga <b>${roleNames[user.role]}</b> sifatida kirdingiz.\n\n` +
      `Quyidagi menyudan kerakli bo'limni tanlang:`;

    await ctx.reply(welcome, {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(user.role),
    });
  }

  // ==========================================
  // REGISTRATION & INVITES
  // ==========================================

  @Action('reg:start_manager')
  async onStartManagerReg(@Ctx() ctx: BotContext) {
    const rops = await this.ropsService.list(true);
    if (rops.length === 0) {
      await ctx.answerCbQuery("Hozircha tizimda faol ROPlar mavjud emas.", { show_alert: true });
      return;
    }

    const buttons = rops.map((r) => [
      Markup.button.callback(`🏢 ${r.user.fullName}`, `reg:rop:${r.id}`),
    ]);

    await ctx.answerCbQuery();
    await ctx.reply("🏢 <b>O'z guruhingiz rahbarini (ROP) tanlang:</b>", {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Action(/^reg:rop:(.+)$/)
  async onSelectRopForReg(@Ctx() ctx: BotContext) {
    const ropId = (ctx.match as RegExpMatchArray)[1];
    const unclaimed = await this.managersService.getUnclaimedByRop(ropId);

    const buttons = unclaimed.map((m) => [
      Markup.button.callback(`👤 ${m.fullName}`, `reg:claim:${m.id}`),
    ]);

    buttons.push([Markup.button.callback("➕ Ro'yxatda yo'qman", `reg:not_found:${ropId}`)]);

    await ctx.answerCbQuery();
    await ctx.reply(
      "👤 <b>O'zingizning ism-familiyangizni tanlang:</b>\n" +
      "(Agar ismingiz bo'lmasa, 'Ro'yxatda yo'qman' tugmasini bosing)",
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  @Action(/^reg:claim:(.+)$/)
  async onClaimManagerProfile(@Ctx() ctx: BotContext) {
    const managerId = (ctx.match as RegExpMatchArray)[1];
    const from = ctx.from!;
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Menejer';

    try {
      // 1. Create or ensure user
      let user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(from.id) } });
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            telegramId: BigInt(from.id),
            fullName,
            role: UserRole.MANAGER,
            isActive: true,
          },
        });
      } else {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { role: UserRole.MANAGER, isActive: true },
        });
      }

      // 2. Link manager profile
      await this.managersService.claim(managerId, user.id);
      ctx.dbUser = user as any;

      await ctx.answerCbQuery("Muvaffaqiyatli ulandi!");
      await ctx.reply(
        `🎉 <b>Tabriklaymiz, ${user.fullName}!</b>\nSiz menejer sifatida ro'yxatdan o'tdingiz.`,
        {
          parse_mode: 'HTML',
          ...getMainMenuKeyboard(UserRole.MANAGER),
        },
      );
    } catch (err: any) {
      await ctx.answerCbQuery(`Xatolik: ${err.message}`, { show_alert: true });
    }
  }

  @Action(/^reg:not_found:(.+)$/)
  async onManagerNotFound(@Ctx() ctx: BotContext) {
    const ropId = (ctx.match as RegExpMatchArray)[1];
    ctx.session.registrationDraft = { ropId, step: 'ENTER_NAME' };

    await ctx.answerCbQuery();
    await ctx.reply(
      "📝 <b>Ism va familiyangizni to'liq yozib yuboring:</b>\n" +
      "(Masalan: Alisher Vohidov)",
      { parse_mode: 'HTML' },
    );
  }

  @Action('reg:enter_invite')
  async onEnterInvitePrompt(@Ctx() ctx: BotContext) {
    ctx.session.registrationDraft = { step: 'ENTER_NAME', ropId: 'INVITE_CODE_PROMPT' };
    await ctx.answerCbQuery();
    await ctx.reply("🔑 <b>Sizga berilgan taklif kodini (masalan: INV-ABCD1234) yuboring:</b>", {
      parse_mode: 'HTML',
    });
  }

  // ==========================================
  // VIOLATION ENTRY (Staff / Super Admin)
  // ==========================================

  @Hears('➕ Shtraf kiritish')
  async onEnterViolation(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.STAFF && ctx.dbUser?.role !== UserRole.SUPER_ADMIN) {
      await ctx.reply("⛔ Sizda jarima kiritish huquqi yo'q.");
      return;
    }
    ctx.session.managerPage = 1;
    ctx.session.managerSearchQuery = undefined;
    ctx.session.managerFilterRopId = undefined;
    await ctx.scene.enter(VIOLATION_WIZARD_ID);
  }

  // ==========================================
  // MANAGER VIEWS
  // ==========================================

  @Hears('📊 Shaxsiy statistika')
  async onManagerStats(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user) return;

    const manager = await this.prisma.manager.findFirst({
      where: { userId: user.id },
    });
    if (!manager) {
      await ctx.reply("Sizga biriktirilgan menejer profili topilmadi.");
      return;
    }

    const monthKey = ctx.session.filterMonth || getMonthKey();
    const stats = await this.statsService.getManagerStats(manager.id, monthKey);

    if (!stats) {
      await ctx.reply("Statistika topilmadi.");
      return;
    }

    let text =
      `📊 <b>Shaxsiy statistikangiz (${stats.monthKey}):</b>\n\n` +
      `👤 <b>Menejer:</b> ${stats.managerName}\n` +
      `🏢 <b>Guruh (ROP):</b> ${stats.ropName}\n` +
      `📌 <b>Qoidabuzarliklar soni:</b> ${stats.totalViolations} ta\n` +
      `💰 <b>Jami jarima summasi:</b> <b>${formatMoneyUz(stats.totalAmount)}</b>\n` +
      `⚠️ <b>Olingan faktlar:</b> ${stats.totalFacts} ta\n\n`;

    if (stats.clauseBreakdown.length > 0) {
      text += `📋 <b>Bandlar bo'yicha taqsimot:</b>\n`;
      stats.clauseBreakdown.forEach((cb) => {
        const factText = cb.facts > 0 ? `, ${cb.facts} ta fakt` : '';
        text += `• <b>Band ${cb.clauseCode}</b>: ${cb.count}-marta (${formatMoneyUz(cb.amount)}${factText})\n`;
      });
    } else {
      text += `<i>Joriy oyda hech qanday jarima qayd etilmagan. Ajoyib natija! 🎉</i>\n`;
    }

    const months = this.statsService.getAvailableMonths();
    const monthButtons = months.slice(0, 4).map((m) =>
      Markup.button.callback(m.label, `stats:mgr:month:${m.key}`),
    );

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([monthButtons]),
    });
  }

  @Hears('⚠️ Xavf ostidagi bandlar')
  async onManagerWarnings(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user) return;

    const manager = await this.prisma.manager.findFirst({
      where: { userId: user.id },
    });
    if (!manager) {
      await ctx.reply("Menejer profili topilmadi.");
      return;
    }

    const monthKey = getMonthKey();
    const activeViolations = await this.prisma.violation.findMany({
      where: {
        managerId: manager.id,
        monthKey,
        revokedAt: null,
      },
      include: {
        clause: {
          include: { scale: { include: { tiers: { orderBy: { occurrence: 'asc' } } } } },
        },
      },
    });

    if (activeViolations.length === 0) {
      await ctx.reply(
        "✅ <b>Hozircha sizda xavf ostidagi bandlar yo'q!</b>\nUshbu oyda hech qanday qoidabuzarlik yo'q.",
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Group by clause
    const grouped = new Map<string, { clause: any; count: number }>();
    for (const v of activeViolations) {
      const g = grouped.get(v.clause.code) || { clause: v.clause, count: 0 };
      g.count++;
      grouped.set(v.clause.code, g);
    }

    let text =
      `⚠️ <b>DIQQAT: Sizda takrorlanish xavfi bor bo'lgan bandlar:</b>\n\n` +
      `Ushbu oyda bu bandlar bo'yicha qoidani yana buzsangiz, jarima oshadi:\n\n`;

    for (const [code, item] of grouped.entries()) {
      const warningStr = this.penaltyEngine.calculateUpcomingWarning(
        item.clause.scale.tiers,
        item.count,
      );
      text +=
        `📌 <b>Band ${code}</b>: (bu oyda ${item.count}-marta buzilgan)\n` +
        `➡️ <i>Keyingi marta buzsangiz:</i> <b>${warningStr}</b>\n\n`;
    }

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  @Hears('📑 Jarimalarim tarixi')
  async onManagerViolationHistory(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user) return;

    const manager = await this.prisma.manager.findFirst({ where: { userId: user.id } });
    if (!manager) return;

    const violations = await this.prisma.violation.findMany({
      where: { managerId: manager.id },
      include: { clause: true },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    });

    if (violations.length === 0) {
      await ctx.reply("Sizda hali jarimalar mavjud emas.");
      return;
    }

    let text = `📑 <b>So'nggi jarimalaringiz tarixi:</b>\n\n`;
    violations.forEach((v) => {
      const status = v.revokedAt ? '<s>[BEKOR QILINGAN]</s> ' : '';
      const consequence =
        v.resultType === 'FACT' ? 'Fakt olindi' : formatMoneyUz(v.resultAmount);
      text +=
        `${status}📅 ${formatDateUz(v.occurredAt)}\n` +
        `📌 Band: <b>${v.clause.code}</b> (${v.occurrenceIndex}-marta)\n` +
        `⚖️ Natija: <b>${consequence}</b>\n` +
        (v.comment ? `💬 Izoh: ${v.comment}\n` : '') +
        `---------------------------\n`;
    });

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  // ==========================================
  // ROP VIEWS
  // ==========================================

  @Hears('📊 Jamoam statistikasi')
  async onRopStats(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user || user.role !== UserRole.ROP) return;

    const rop = await this.prisma.rop.findUnique({ where: { userId: user.id } });
    if (!rop) {
      await ctx.reply("ROP profilingiz topilmadi.");
      return;
    }

    const monthKey = ctx.session.filterMonth || getMonthKey();
    const stats = await this.statsService.getRopStats(rop.id, monthKey);

    if (!stats) {
      await ctx.reply("Statistika topilmadi.");
      return;
    }

    let text =
      `📊 <b>Jamoangiz statistikasi (${stats.monthKey}):</b>\n\n` +
      `🏢 <b>Guruh rahbari:</b> ${stats.ropName}\n` +
      `📌 <b>Jami qoidabuzarliklar:</b> ${stats.totalViolations} ta\n` +
      `💰 <b>Jami jarimalar summasi:</b> <b>${formatMoneyUz(stats.totalAmount)}</b>\n` +
      `⚠️ <b>Jami olingan faktlar:</b> ${stats.totalFacts} ta\n\n`;

    if (stats.managerRankings.length > 0) {
      text += `🏆 <b>Menejerlar ko'rsatkichi:</b>\n`;
      stats.managerRankings.forEach((m, idx) => {
        text += `${idx + 1}. <b>${m.managerName}</b>: ${m.count} ta | ${formatMoneyUz(m.amount)} | ${m.facts} fakt\n`;
      });
    }

    if (stats.topClauses.length > 0) {
      text += `\n📌 <b>Eng ko'p buzilgan bandlar:</b>\n`;
      stats.topClauses.slice(0, 5).forEach((cl) => {
        text += `• Band ${cl.clauseCode}: ${cl.count} marta\n`;
      });
    }

    const months = this.statsService.getAvailableMonths();
    const monthButtons = months.slice(0, 4).map((m) =>
      Markup.button.callback(m.label, `stats:rop:month:${m.key}`),
    );

    const exportButton = Markup.button.callback('📥 Excel eksport (.xlsx)', `export:excel:rop:${rop.id}`);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([monthButtons, [exportButton]]),
    });
  }

  @Hears('⚠️ Obuchenie lozim')
  async onRopTrainingAlerts(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user || user.role !== UserRole.ROP) return;

    const rop = await this.prisma.rop.findUnique({ where: { userId: user.id } });
    if (!rop) return;

    const monthKey = getMonthKey();
    const violations = await this.prisma.violation.findMany({
      where: {
        manager: { ropId: rop.id },
        monthKey,
        revokedAt: null,
      },
      include: { manager: true, clause: true },
    });

    const thresholdSetting = await this.prisma.setting.findUnique({ where: { key: 'trainingThreshold' } });
    const threshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 2;

    // Group by manager + clause
    const map = new Map<string, { managerName: string; clauseCode: string; count: number; hasFact: boolean }>();
    for (const v of violations) {
      const key = `${v.managerId}:${v.clauseId}`;
      const entry = map.get(key) || {
        managerName: v.manager.fullName,
        clauseCode: v.clause.code,
        count: 0,
        hasFact: false,
      };
      entry.count++;
      if (v.resultType === TierType.FACT) entry.hasFact = true;
      map.set(key, entry);
    }

    const alerts = Array.from(map.values()).filter(
      (item) => item.count >= threshold || item.hasFact,
    );

    if (alerts.length === 0) {
      await ctx.reply(
        "✅ <b>Jamoangizda obuchenie talab qilinadigan kritik holatlar mavjud emas!</b>",
        { parse_mode: 'HTML' },
      );
      return;
    }

    let text =
      `⚠️ <b>DIQQAT: Quyidagi menejerlar bilan obuchenie o'tkazish tavsiya etiladi:</b>\n\n`;

    alerts.forEach((a, idx) => {
      const reason = a.hasFact ? 'Fakt olindi' : `${a.count}-marta takrorlandi`;
      text += `${idx + 1}. <b>${a.managerName}</b> — Band <b>${a.clauseCode}</b> (${reason})\n`;
    });

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  @Hears('👥 Jamoam menejerlari')
  async onRopManagersList(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user || user.role !== UserRole.ROP) return;

    const rop = await this.prisma.rop.findUnique({ where: { userId: user.id } });
    if (!rop) return;

    const [managers, pendingRequests] = await Promise.all([
      this.prisma.manager.findMany({
        where: { ropId: rop.id, isActive: true },
        include: { user: true },
      }),
      this.usersService.getPendingRequests(rop.id),
    ]);

    let text = `👥 <b>Jamoangiz menejerlari ro'yxati (${managers.length} nafar):</b>\n\n`;
    managers.forEach((m, i) => {
      const tgStatus = m.user ? '✅ Uланган' : '⏳ Ulangan emas';
      text += `${i + 1}. <b>${m.fullName}</b> — ${tgStatus}\n`;
    });

    if (pendingRequests.length > 0) {
      text += `\n📋 <b>Tasdiqlash kutilayotgan arizalar (${pendingRequests.length} ta):</b>\n`;
      const buttons = pendingRequests.map((r) => [
        Markup.button.callback(`✅ Tasdiqlash: ${r.fullName}`, `req:appr:${r.id}`),
        Markup.button.callback(`❌ Rad etish`, `req:rejc:${r.id}`),
      ]);
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
      return;
    }

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  @Hears('📥 Excel eksport')
  async onRopExcelExport(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user || user.role !== UserRole.ROP) return;

    const rop = await this.prisma.rop.findUnique({ where: { userId: user.id } });
    if (!rop) return;

    await this.handleExcelExport(ctx, getMonthKey(), rop.id);
  }

  // ==========================================
  // STAFF & ADMIN: VIOLATIONS LIST & REVOKE
  // ==========================================

  @Hears("📑 Jarimalar ro'yxati")
  async onViolationsList(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.STAFF && ctx.dbUser?.role !== UserRole.SUPER_ADMIN) {
      return;
    }

    const monthKey = getMonthKey();
    const violations = await this.prisma.violation.findMany({
      where: { monthKey },
      include: { manager: true, clause: true, createdBy: true },
      orderBy: { occurredAt: 'desc' },
      take: 8,
    });

    if (violations.length === 0) {
      await ctx.reply("Joriy oyda jarimalar mavjud emas.");
      return;
    }

    let text = `📑 <b>Joriy oydagi so'nggi jarimalar (${monthKey}):</b>\n\n`;
    const buttons: any[] = [];

    violations.forEach((v, idx) => {
      const isRevoked = Boolean(v.revokedAt);
      const resStr =
        v.resultType === 'FACT' ? 'Fakt' : formatMoneyUz(v.resultAmount);
      text +=
        `${idx + 1}. ${isRevoked ? '<s>' : ''}<b>${v.manager.fullName}</b> | Band <b>${v.clause.code}</b> (${v.occurrenceIndex}-marta) -> ${resStr}${isRevoked ? ' [BEKOR]</s>' : ''}\n` +
        `   📅 ${formatDateUz(v.occurredAt)} | Xodim: ${v.createdBy.fullName}\n`;

      if (!isRevoked) {
        buttons.push([
          Markup.button.callback(
            `🗑 Bekor qilish: #${idx + 1} (${v.manager.fullName.slice(0, 15)})`,
            `v:rvk:${v.id}`,
          ),
        ]);
      }
    });

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Action(/^v:rvk:(.+)$/)
  async onRevokeViolationPrompt(@Ctx() ctx: BotContext) {
    const violationId = (ctx.match as RegExpMatchArray)[1];
    ctx.session.violationDraft = { comment: `REVOKE_PROMPT:${violationId}` };

    await ctx.answerCbQuery();
    await ctx.reply(
      "🗑 <b>Ushbu jarimani bekor qilish sababini yozib yuboring:</b>\n(Bekor qilmaslik uchun /cancel deng)",
      { parse_mode: 'HTML' },
    );
  }

  // ==========================================
  // SUPER ADMIN & GLOBAL STATS
  // ==========================================

  @Hears('📊 Statistika va Hisobotlar')
  @Hears('📊 Statistika')
  async onGlobalStats(@Ctx() ctx: BotContext) {
    const user = ctx.dbUser;
    if (!user) return;

    const monthKey = ctx.session.filterMonth || getMonthKey();
    const stats = await this.statsService.getGlobalStats(monthKey);

    let text =
      `📊 <b>Umumiy korporativ statistika (${stats.monthKey}):</b>\n\n` +
      `📌 <b>Jami qoidabuzarliklar:</b> ${stats.totalViolations} ta\n` +
      `💰 <b>Jami jarimalar summasi:</b> <b>${formatMoneyUz(stats.totalAmount)}</b>\n` +
      `⚠️ <b>Jami olingan faktlar:</b> ${stats.totalFacts} ta\n\n`;

    if (stats.teamStats.length > 0) {
      text += `🏢 <b>Guruhlar (ROPlar) bo'yicha taqsimot:</b>\n`;
      stats.teamStats.forEach((t, i) => {
        text += `${i + 1}. <b>${t.ropName}</b>: ${t.totalViolations} ta | ${formatMoneyUz(t.totalAmount)} | ${t.totalFacts} fakt\n`;
      });
    }

    if (stats.topClauses.length > 0) {
      text += `\n📌 <b>Eng ko'p buzilgan qoidalar (TOP-5):</b>\n`;
      stats.topClauses.slice(0, 5).forEach((cl) => {
        text += `• Band <b>${cl.clauseCode}</b>: ${cl.count} marta\n`;
      });
    }

    const months = this.statsService.getAvailableMonths();
    const monthButtons = months.slice(0, 4).map((m) =>
      Markup.button.callback(m.label, `stats:glob:month:${m.key}`),
    );

    const exportBtn = Markup.button.callback('📥 Excel to\'liq eksport (.xlsx)', `export:excel:global`);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([monthButtons, [exportBtn]]),
    });
  }

  // ==========================================
  // ADMIN CRUD & SYSTEM CONTROLS
  // ==========================================

  @Hears('📋 Qoidalar va Shkalalar')
  async onClausesAndScales(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const scales = await this.scalesService.list();
    let text = `📋 <b>Amaldagi jarima shkalalari va bandlar:</b>\n\n`;

    scales.forEach((s) => {
      text += `⚖️ <b>${s.name}</b>:\n`;
      s.tiers.forEach((t) => {
        const occLabel = t.occurrence === 5 ? '5+' : `${t.occurrence}`;
        const valStr = t.type === TierType.FACT ? 'FAKT' : formatMoneyUz(t.amount);
        text += `   • ${occLabel}-marta -> ${valStr}\n`;
      });
      const assigned = s.clauses.map((c) => c.code).join(', ');
      text += `   📌 Bandlar: ${assigned || "yo'q"}\n\n`;
    });

    const buttons = [
      [Markup.button.callback("➕ Yangi band qo'shish", 'adm:add_clause')],
      [Markup.button.callback("⚙️ Shkala qiymatlarini tahrirlash", 'adm:edit_scale')],
    ];

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Hears('🏢 ROPlar')
  async onRopsAdminList(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN && ctx.dbUser?.role !== UserRole.STAFF) return;

    const rops = await this.ropsService.list();
    let text = `🏢 <b>ROPlar ro'yxati (${rops.length} ta):</b>\n\n`;

    rops.forEach((r, idx) => {
      const status = r.isActive ? '✅ Faol' : '❌ Faolsiz';
      text += `${idx + 1}. <b>${r.user.fullName}</b> (${status}) — ${r._count.managers} nafar menejer\n`;
    });

    const buttons = [
      [Markup.button.callback("➕ Yangi ROP qo'shish", 'adm:add_rop')],
    ];

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Hears('👥 Menejerlar')
  async onManagersAdminList(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN && ctx.dbUser?.role !== UserRole.STAFF) return;

    const result = await this.managersService.list({ limit: 10 });
    let text = `👥 <b>Menejerlar ro'yxati (Jami: ${result.total} ta):</b>\n\n`;

    result.items.forEach((m, idx) => {
      const status = m.isActive ? '✅' : '❌';
      const tg = m.user ? '📱 Uланган' : '⏳ Kutilmoqda';
      text += `${idx + 1}. ${status} <b>${m.fullName}</b> (${m.rop.user.fullName}) — ${tg}\n`;
    });

    const buttons = [
      [Markup.button.callback("➕ Yangi menejer qo'shish", 'adm:add_manager')],
    ];

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Hears('👔 Xodimlar (Staff)')
  async onStaffAdminList(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const staffList = await this.usersService.listStaff();
    let text = `👔 <b>Sifat nazoratchilari (Staff / Xodimlar):</b>\n\n`;

    staffList.forEach((s, idx) => {
      const status = s.isActive ? '✅ Faol' : '❌ Faolsiz';
      text += `${idx + 1}. <b>${s.fullName}</b> (TG ID: <code>${s.telegramId}</code>) — ${status}\n`;
    });

    const buttons = [
      [Markup.button.callback("➕ Yangi xodim taklif kodi", 'adm:invite_staff')],
      [Markup.button.callback("➕ Yangi ROP taklif kodi", 'adm:invite_rop')],
    ];

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Hears('📜 Audit log')
  async onAuditLogView(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const logs = await this.usersService.getAuditLogs(1, 10);
    let text = `📜 <b>Tizim audit jurnali (So'nggi 10 ta amal):</b>\n\n`;

    logs.items.forEach((l) => {
      const actorName = l.actor?.fullName || 'Tizim';
      text +=
        `🔹 <b>${l.action}</b> (${l.entity})\n` +
        `👤 Bajaruvchi: ${actorName}\n` +
        `🕒 Vaqt: ${formatDateUz(l.createdAt)}\n` +
        `---------------------------\n`;
    });

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  @Hears('⚙️ Sozlamalar')
  async onSettingsView(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const [threshold, revokeSetting] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'trainingThreshold' } }),
      this.prisma.setting.findUnique({ where: { key: 'staffCanRevokeOthers' } }),
    ]);

    const text =
      `⚙️ <b>Tizim parametrlari va sozlamalari:</b>\n\n` +
      `1. <b>Obuchenie chegarasi (trainingThreshold):</b> ${threshold?.value || '2'} marta\n` +
      `2. <b>Xodim boshqalar jarimasini bekor qila oladimi:</b> ${revokeSetting?.value === 'true' ? 'Ha' : "Yo'q (faqat o'zinikini)"}\n\n` +
      `<i>O'zgartirish uchun kerakli tugmani bosing:</i>`;

    const buttons = [
      [Markup.button.callback("O'zgartirish: Obuchenie chegarasi", 'adm:set_thresh')],
      [Markup.button.callback("O'zgartirish: Jarimani bekor qilish huquqi", 'adm:toggle_revoke_perm')],
    ];

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Hears('📢 Xabar tarqatish')
  async onBroadcastPrompt(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    ctx.session.registrationDraft = { step: 'ENTER_NAME', ropId: 'BROADCAST_PROMPT' };
    await ctx.reply(
      "📢 <b>Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringiz matnini yuboring:</b>\n" +
      "(Bekor qilish uchun /cancel deb yozing)",
      { parse_mode: 'HTML' },
    );
  }

  // ==========================================
  // ACTION HANDLERS & EXCEL
  // ==========================================

  @Action(/^stats:mgr:month:(.+)$/)
  async onMgrMonthChange(@Ctx() ctx: BotContext) {
    const monthKey = (ctx.match as RegExpMatchArray)[1];
    ctx.session.filterMonth = monthKey;
    await ctx.answerCbQuery();
    return this.onManagerStats(ctx);
  }

  @Action(/^stats:rop:month:(.+)$/)
  async onRopMonthChange(@Ctx() ctx: BotContext) {
    const monthKey = (ctx.match as RegExpMatchArray)[1];
    ctx.session.filterMonth = monthKey;
    await ctx.answerCbQuery();
    return this.onRopStats(ctx);
  }

  @Action(/^stats:glob:month:(.+)$/)
  async onGlobMonthChange(@Ctx() ctx: BotContext) {
    const monthKey = (ctx.match as RegExpMatchArray)[1];
    ctx.session.filterMonth = monthKey;
    await ctx.answerCbQuery();
    return this.onGlobalStats(ctx);
  }

  @Action(/^export:excel:rop:(.+)$/)
  async onExportRopExcel(@Ctx() ctx: BotContext) {
    const ropId = (ctx.match as RegExpMatchArray)[1];
    const monthKey = ctx.session.filterMonth || getMonthKey();
    await ctx.answerCbQuery("Hisobot tayyorlanmoqda...");
    await this.handleExcelExport(ctx, monthKey, ropId);
  }

  @Action('export:excel:global')
  async onExportGlobalExcel(@Ctx() ctx: BotContext) {
    const monthKey = ctx.session.filterMonth || getMonthKey();
    await ctx.answerCbQuery("Hisobot tayyorlanmoqda...");
    await this.handleExcelExport(ctx, monthKey);
  }

  private async handleExcelExport(ctx: BotContext, monthKey: string, ropId?: string) {
    try {
      const buffer = await this.statsService.generateExcelReport({ monthKey, ropId });
      const filename = `Hisobot_${monthKey}${ropId ? '_ROP' : '_Global'}.xlsx`;

      await ctx.replyWithDocument({
        source: buffer,
        filename,
      });
    } catch (err: any) {
      await ctx.reply(`❌ Eksportda xatolik: ${err.message}`);
    }
  }

  @Action(/^req:appr:(.+)$/)
  async onApproveRequest(@Ctx() ctx: BotContext) {
    const reqId = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.dbUser) return;

    await this.usersService.decideRegistrationRequest(reqId, true, ctx.dbUser.id);
    await ctx.answerCbQuery("Ariza tasdiqlandi!");
    await ctx.reply("✅ Nomzod menejer sifatida tasdiqlandi va xabardor qilindi.");
  }

  @Action(/^req:rejc:(.+)$/)
  async onRejectRequest(@Ctx() ctx: BotContext) {
    const reqId = (ctx.match as RegExpMatchArray)[1];
    if (!ctx.dbUser) return;

    await this.usersService.decideRegistrationRequest(reqId, false, ctx.dbUser.id);
    await ctx.answerCbQuery("Ariza rad etildi");
    await ctx.reply("❌ Nomzod arizasi rad etildi.");
  }

  @Action('adm:invite_staff')
  async onInviteStaff(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const invite = await this.usersService.generateInviteCode(UserRole.STAFF);
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔑 <b>Xodim (Staff) uchun bir martalik taklif kodi:</b>\n\n` +
      `Kod: <code>${invite.code}</code>\n` +
      `Havola: <code>https://t.me/${ctx.botInfo.username}?start=invite_${invite.code}</code>\n\n` +
      `<i>Ushbu havolani xodimga yuboring. U bosganda avtomatik Staff sifatida tizimga ulanadi.</i>`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('adm:invite_rop')
  async onInviteRop(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const invite = await this.usersService.generateInviteCode(UserRole.ROP);
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔑 <b>ROP uchun bir martalik taklif kodi:</b>\n\n` +
      `Kod: <code>${invite.code}</code>\n` +
      `Havola: <code>https://t.me/${ctx.botInfo.username}?start=invite_${invite.code}</code>\n\n` +
      `<i>Ushbu havolani yangi ROPga yuboring.</i>`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('adm:toggle_revoke_perm')
  async onToggleRevokePerm(@Ctx() ctx: BotContext) {
    if (ctx.dbUser?.role !== UserRole.SUPER_ADMIN) return;

    const current = await this.prisma.setting.findUnique({ where: { key: 'staffCanRevokeOthers' } });
    const nextVal = current?.value === 'true' ? 'false' : 'true';

    await this.prisma.setting.upsert({
      where: { key: 'staffCanRevokeOthers' },
      update: { value: nextVal },
      create: { key: 'staffCanRevokeOthers', value: nextVal },
    });

    await ctx.answerCbQuery("Sozlama yangilandi");
    return this.onSettingsView(ctx);
  }

  @Action('nav:main_menu')
  async onNavMainMenu(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    await ctx.reply("🏠 Asosiy menyu:", getMainMenuKeyboard(ctx.dbUser?.role));
  }

  @On('text')
  async onGlobalText(@Ctx() ctx: BotContext) {
    const text = (ctx.message as any)?.text?.trim();
    if (!text || text.startsWith('/')) return;

    // 1. Pending registration draft name
    if (ctx.session.registrationDraft?.step === 'ENTER_NAME') {
      const ropId = ctx.session.registrationDraft.ropId;
      ctx.session.registrationDraft = undefined;

      if (ropId === 'INVITE_CODE_PROMPT') {
        const from = ctx.from!;
        const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
        try {
          const user = await this.usersService.consumeInviteCode(text.trim(), BigInt(from.id), fullName);
          ctx.dbUser = user as any;
          await ctx.reply(
            `🎉 <b>Xush kelibsiz!</b>\nTaklif kodi qabul qilindi. Sizning rolingiz: <b>${user.role}</b>`,
            { parse_mode: 'HTML', ...getMainMenuKeyboard(user.role) },
          );
        } catch (err: any) {
          await ctx.reply(`❌ Xatolik: ${err.message}`);
        }
        return;
      }

      if (ropId === 'BROADCAST_PROMPT') {
        const res = await this.usersService.broadcastMessage(text);
        await ctx.reply(`📢 Xabar ${res.sent}/${res.total} ta faol foydalanuvchiga yuborildi.`);
        return;
      }

      if (ropId) {
        await this.usersService.createRegistrationRequest(BigInt(ctx.from!.id), text, ropId);
        await ctx.reply(
          `⏳ <b>Arizangiz qabul qilindi!</b>\n` +
          `Sizning a'zolik so'rovingiz ROP va ma'murlarga yuborildi. Tasdiqlanishi bilan sizga xabar beriladi.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
    }

    // 2. Pending Revoke reason
    if (ctx.session.violationDraft?.comment?.startsWith('REVOKE_PROMPT:')) {
      const violationId = ctx.session.violationDraft.comment.replace('REVOKE_PROMPT:', '');
      ctx.session.violationDraft = undefined;

      if (!ctx.dbUser) return;

      try {
        await this.violationsService.revokeViolation(
          violationId,
          ctx.dbUser.id,
          text,
          ctx.dbUser.role,
        );
        await ctx.reply(
          `✅ <b>Jarima muvaffaqiyatli bekor qilindi.</b>\nBarcha keyingi jarimalar avtomatik qayta hisoblandi va tegishli tomonlar xabardor qilindi.`,
          { parse_mode: 'HTML' },
        );
      } catch (err: any) {
        await ctx.reply(`❌ Bekor qilishda xatolik: ${err.message}`);
      }
      return;
    }
  }
}
