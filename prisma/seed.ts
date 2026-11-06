import { PrismaClient, UserRole, TierType } from '@prisma/client';

const prisma = new PrismaClient();

function getSortKey(code: string): number {
  const parts = code.split('.');
  if (parts.length === 2) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    return major + minor / 100;
  }
  return parseFloat(code) || 0;
}

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Scales
  const scaleA = await prisma.scale.upsert({
    where: { name: 'Shkala A' },
    update: {},
    create: {
      name: 'Shkala A',
      tiers: {
        create: [
          { occurrence: 1, type: TierType.AMOUNT, amount: 60000 },
          { occurrence: 2, type: TierType.AMOUNT, amount: 60000 },
          { occurrence: 3, type: TierType.AMOUNT, amount: 100000 },
          { occurrence: 4, type: TierType.AMOUNT, amount: 0 },
          { occurrence: 5, type: TierType.FACT, amount: 0 },
        ],
      },
    },
  });

  const scaleB = await prisma.scale.upsert({
    where: { name: 'Shkala B' },
    update: {},
    create: {
      name: 'Shkala B',
      tiers: {
        create: [
          { occurrence: 1, type: TierType.AMOUNT, amount: 100000 },
          { occurrence: 2, type: TierType.AMOUNT, amount: 100000 },
          { occurrence: 3, type: TierType.AMOUNT, amount: 0 },
          { occurrence: 4, type: TierType.FACT, amount: 0 },
          { occurrence: 5, type: TierType.FACT, amount: 0 },
        ],
      },
    },
  });

  const scaleC = await prisma.scale.upsert({
    where: { name: 'Shkala C' },
    update: {},
    create: {
      name: 'Shkala C',
      tiers: {
        create: [
          { occurrence: 1, type: TierType.AMOUNT, amount: 0 },
          { occurrence: 2, type: TierType.AMOUNT, amount: 0 },
          { occurrence: 3, type: TierType.FACT, amount: 0 },
          { occurrence: 4, type: TierType.FACT, amount: 0 },
          { occurrence: 5, type: TierType.FACT, amount: 0 },
        ],
      },
    },
  });

  console.log('✅ Scales seeded: A, B, C');

  // 2. Clauses
  const clausesData = [
    // Scale A
    {
      code: '2.1',
      text: 'Ustiy dogovorda kerakli punktlarni qoldirib ketish mumkin emas.',
      scaleId: scaleA.id,
    },
    {
      code: '2.7',
      text: "O'quvchining o'qishi bo'yicha analiz qilish kerak",
      scaleId: scaleA.id,
    },
    {
      code: '2.13',
      text: 'Crmdan tashqari saqlangan zapislarni 12 soat ichida zapis gruppaga jo\'natish kerak',
      scaleId: scaleA.id,
    },
    {
      code: '2.22',
      text: "To'lov bo'yicha ota-ona savoliga to'g'ri va to'liq javob berish kerak.",
      scaleId: scaleA.id,
    },
    // Scale B
    {
      code: '3.1',
      text: '1 oylik kurs narxini aytish shart. Kurs paketlarini yashirish mumkin emas',
      scaleId: scaleB.id,
    },
    {
      code: '3.3',
      text: "Vozvratga bog'liq vozvrajeniyani menejer to'liq yopishi kerak",
      scaleId: scaleB.id,
    },
    {
      code: '3.5',
      text: "Ustiy dogovor yo'q",
      scaleId: scaleB.id,
    },
    {
      code: '3.10',
      text: 'Konsultatsiya bermasdan sotish mumkin emas.',
      scaleId: scaleB.id,
    },
    {
      code: '3.11',
      text: "'Free Tasks'siz 6 va 12 oylik kurslarni sotish mumkin emas.",
      scaleId: scaleB.id,
    },
    // Scale C
    {
      code: '4.2',
      text: "Vozvrat bor deb aytish mumkin emas",
      scaleId: scaleC.id,
    },
  ];

  for (const c of clausesData) {
    await prisma.clause.upsert({
      where: { code: c.code },
      update: {
        text: c.text,
        scaleId: c.scaleId,
        sortKey: getSortKey(c.code),
        isActive: true,
      },
      create: {
        code: c.code,
        text: c.text,
        scaleId: c.scaleId,
        sortKey: getSortKey(c.code),
        isActive: true,
      },
    });
  }

  console.log(`✅ ${clausesData.length} Clauses seeded with natural sort keys`);

  // 3. Settings
  await prisma.setting.upsert({
    where: { key: 'trainingThreshold' },
    update: {},
    create: {
      key: 'trainingThreshold',
      value: process.env.DEFAULT_TRAINING_THRESHOLD || '2',
    },
  });

  await prisma.setting.upsert({
    where: { key: 'staffCanRevokeOthers' },
    update: {},
    create: {
      key: 'staffCanRevokeOthers',
      value: process.env.STAFF_CAN_REVOKE_OTHERS || 'false',
    },
  });

  // 4. Super Admin users from environment
  const superAdminIds = (process.env.SUPER_ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const tidStr of superAdminIds) {
    try {
      const tid = BigInt(tidStr);
      await prisma.user.upsert({
        where: { telegramId: tid },
        update: {
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
        create: {
          telegramId: tid,
          fullName: `Bosh Admin (${tidStr})`,
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
      });
      console.log(`👑 Super Admin ensured for Telegram ID: ${tidStr}`);
    } catch (e) {
      console.error(`Invalid Telegram ID in SUPER_ADMIN_TELEGRAM_IDS: ${tidStr}`);
    }
  }

  // 5. Initial Sample ROP and Managers for testing & demonstration
  const sampleRopUser = await prisma.user.upsert({
    where: { telegramId: BigInt(99990001) },
    update: {},
    create: {
      telegramId: BigInt(99990001),
      fullName: 'Azizbek ROP (Namuna)',
      role: UserRole.ROP,
      isActive: true,
    },
  });

  const sampleRop = await prisma.rop.upsert({
    where: { userId: sampleRopUser.id },
    update: {},
    create: {
      userId: sampleRopUser.id,
      isActive: true,
    },
  });

  const sampleManagers = [
    'Javohir Aliyev',
    'Sardor Rahimov',
    'Dilshod Karimov',
    'Madina Usmonova',
  ];

  for (const mName of sampleManagers) {
    const existing = await prisma.manager.findFirst({
      where: { fullName: mName, ropId: sampleRop.id },
    });
    if (!existing) {
      await prisma.manager.create({
        data: {
          fullName: mName,
          ropId: sampleRop.id,
          isActive: true,
        },
      });
    }
  }
  console.log('✅ Sample ROP and Unclaimed Managers seeded');

  console.log('🚀 Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
