import { Markup } from 'telegraf';
import { UserRole } from '@prisma/client';

export function getMainMenuKeyboard(role?: UserRole | null) {
  if (!role) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("👤 Menejer sifatida ro'yxatdan o'tish", 'reg:start_manager')],
      [Markup.button.callback("🔑 Taklif kodini kiritish", 'reg:enter_invite')],
    ]);
  }

  switch (role) {
    case UserRole.SUPER_ADMIN:
      return Markup.keyboard([
        ['➕ Shtraf kiritish', '📊 Statistika va Hisobotlar'],
        ['👥 Menejerlar', '🏢 ROPlar'],
        ['👔 Xodimlar (Staff)', '📋 Qoidalar va Shkalalar'],
        ['📑 Jarimalar ro\'yxati', '📜 Audit log'],
        ['⚙️ Sozlamalar', '📢 Xabar tarqatish'],
      ]).resize();

    case UserRole.STAFF:
      return Markup.keyboard([
        ['➕ Shtraf kiritish', '📊 Statistika'],
        ['👥 Menejerlar', '🏢 ROPlar'],
        ['📑 Jarimalar ro\'yxati', '👤 Mening profilim'],
      ]).resize();

    case UserRole.ROP:
      return Markup.keyboard([
        ['📊 Jamoam statistikasi', '👥 Jamoam menejerlari'],
        ['⚠️ Obuchenie lozim', '📑 Jamoa jarimalari tarixi'],
        ['📥 Excel eksport', '👤 Mening profilim'],
      ]).resize();

    case UserRole.MANAGER:
      return Markup.keyboard([
        ['📊 Shaxsiy statistika', '⚠️ Xavf ostidagi bandlar'],
        ['📑 Jarimalarim tarixi', '👤 Profilim'],
      ]).resize();

    default:
      return Markup.removeKeyboard();
  }
}

export function getBackKeyboard(backCallbackData = 'nav:back') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Orqaga', backCallbackData)],
    [Markup.button.callback('🏠 Asosiy menyu', 'nav:main_menu')],
  ]);
}
