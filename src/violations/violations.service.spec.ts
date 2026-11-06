import { Test, TestingModule } from '@nestjs/testing';
import { ViolationsService } from './violations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PenaltyEngineService } from '../penalty-engine/penalty-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole, TierType } from '@prisma/client';

describe('ViolationsService', () => {
  let service: ViolationsService;
  let prisma: PrismaService;

  const mockScale = {
    id: 'scale-a-id',
    name: 'Shkala A',
    tiers: [
      { occurrence: 1, type: TierType.AMOUNT, amount: 60000 },
      { occurrence: 2, type: TierType.AMOUNT, amount: 60000 },
      { occurrence: 3, type: TierType.AMOUNT, amount: 100000 },
      { occurrence: 4, type: TierType.AMOUNT, amount: 0 },
      { occurrence: 5, type: TierType.FACT, amount: 0 },
    ],
  };

  const mockClause = {
    id: 'clause-2.1-id',
    code: '2.1',
    text: 'Ustiy dogovorda kerakli punktlarni qoldirib ketish mumkin emas.',
    scaleId: 'scale-a-id',
    scale: mockScale,
    isActive: true,
  };

  const mockManager = {
    id: 'mgr-1-id',
    fullName: 'Javohir Aliyev',
    ropId: 'rop-1-id',
    isActive: true,
    rop: {
      id: 'rop-1-id',
      user: { id: 'rop-user-id', fullName: 'Azizbek ROP', telegramId: BigInt(99990001) },
    },
    user: { id: 'mgr-user-id', fullName: 'Javohir Aliyev', telegramId: BigInt(99990002) },
  };

  const mockNotifications = {
    notifyManagerAboutViolation: jest.fn().mockResolvedValue(true),
    notifyRopAboutViolation: jest.fn().mockResolvedValue(true),
    notifyCorrection: jest.fn().mockResolvedValue(true),
    sendSafeMessage: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationsService,
        PenaltyEngineService,
        {
          provide: PrismaService,
          useValue: {
            manager: {
              findUnique: jest.fn().mockResolvedValue(mockManager),
            },
            clause: {
              findUnique: jest.fn().mockResolvedValue(mockClause),
            },
            violation: {
              findUnique: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            setting: {
              findUnique: jest.fn().mockResolvedValue({ key: 'trainingThreshold', value: '2' }),
            },
            auditLog: {
              create: jest.fn().mockResolvedValue({ id: 'log-1' }),
            },
            $transaction: jest.fn((callback) =>
              callback({
                manager: { findUnique: jest.fn().mockResolvedValue(mockManager) },
                clause: { findUnique: jest.fn().mockResolvedValue(mockClause) },
                violation: {
                  count: jest.fn().mockResolvedValue(0),
                  create: jest.fn().mockImplementation((args) => ({
                    id: 'new-v-id',
                    ...args.data,
                    manager: mockManager,
                    clause: mockClause,
                  })),
                  update: jest.fn(),
                  findMany: jest.fn(),
                },
                auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
                setting: {
                  findUnique: jest.fn().mockResolvedValue({ key: 'trainingThreshold', value: '2' }),
                },
              }),
            ),
          },
        },
        {
          provide: NotificationsService,
          useValue: mockNotifications,
        },
      ],
    }).compile();

    service = module.get<ViolationsService>(ViolationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('previewViolation', () => {
    it('returns calculated preview for 1st occurrence', async () => {
      (prisma.violation.count as jest.Mock).mockResolvedValue(0);

      const preview = await service.previewViolation('mgr-1-id', 'clause-2.1-id');

      expect(preview.occurrenceIndex).toBe(1);
      expect(preview.resultType).toBe(TierType.AMOUNT);
      expect(preview.resultAmount).toBe(60000);
      expect(preview.formattedResult).toBe("60 000 so'm");
    });

    it('returns calculated preview for 3rd occurrence escalating to 100 000', async () => {
      (prisma.violation.count as jest.Mock).mockResolvedValue(2);

      const preview = await service.previewViolation('mgr-1-id', 'clause-2.1-id');

      expect(preview.occurrenceIndex).toBe(3);
      expect(preview.resultType).toBe(TierType.AMOUNT);
      expect(preview.resultAmount).toBe(100000);
      expect(preview.formattedResult).toBe("100 000 so'm");
    });
  });

  describe('recordViolation', () => {
    it('records violation and sends notifications', async () => {
      (prisma.violation.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await service.recordViolation({
        managerId: 'mgr-1-id',
        clauseId: 'clause-2.1-id',
        createdById: 'staff-1-id',
        comment: 'Kechiqdi',
        idempotencyKey: 'uniq-key-1',
      });

      expect(res.violation).toBeDefined();
      expect(res.violation.occurrenceIndex).toBe(1);
      expect(res.violation.resultAmount).toBe(60000);
      expect(mockNotifications.notifyManagerAboutViolation).toHaveBeenCalled();
      expect(mockNotifications.notifyRopAboutViolation).toHaveBeenCalled();
    });

    it('handles duplicate idempotencyKey safely without creating duplicate', async () => {
      const existingViolation = {
        id: 'existing-id',
        idempotencyKey: 'duplicate-key',
        manager: mockManager,
        clause: mockClause,
        occurrenceIndex: 1,
        resultAmount: 60000,
        resultType: TierType.AMOUNT,
      };
      (prisma.violation.findUnique as jest.Mock).mockResolvedValue(existingViolation);

      const res = await service.recordViolation({
        managerId: 'mgr-1-id',
        clauseId: 'clause-2.1-id',
        createdById: 'staff-1-id',
        idempotencyKey: 'duplicate-key',
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.violation.id).toBe('existing-id');
    });
  });
});
